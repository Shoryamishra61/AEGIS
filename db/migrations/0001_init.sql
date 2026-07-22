-- AEGIS :: 0001_init.sql
-- PostgreSQL schema: configuration + append-only audit evidence.
-- Monetary values are integer minor units (BIGINT). Never floating point.
--
-- Roles:
--   aegis_app     : control-plane read/write on config tables; INSERT-only on audit_events.
--   aegis_gateway : INSERT-only on audit_events; SELECT on active policy/config it needs.
-- Append-only enforcement for audit_events is done via:
--   * REVOKE UPDATE, DELETE from all app roles
--   * a trigger that raises on UPDATE/DELETE (defence in depth)

BEGIN;

-- ---------------------------------------------------------------------------
-- Enum-like domains kept as TEXT + CHECK for portability / easy evolution.
-- ---------------------------------------------------------------------------

CREATE TABLE schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Agents (principals)
-- ---------------------------------------------------------------------------
CREATE TABLE agents (
    id              TEXT PRIMARY KEY,                     -- agent principal id (e.g. agent-payments-01)
    display_name    TEXT NOT NULL,
    owner           TEXT NOT NULL,
    risk_tier       TEXT NOT NULL CHECK (risk_tier IN ('low','medium','high','critical')),
    environment     TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','active','disabled')),
    -- workload identity subject the gateway will map verified JWT claims to
    workload_sub    TEXT NOT NULL UNIQUE,
    allowed_actions TEXT[] NOT NULL DEFAULT '{}',         -- action families (informational; policy is authoritative)
    budget_pool_id  TEXT,                                 -- FK added after budget_pools
    policy_version  BIGINT,                               -- pinned active policy version (FK added later)
    version         BIGINT NOT NULL DEFAULT 1,            -- optimistic concurrency token
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Budget pools & caps
-- A pool aggregates spend for one or more agents. Caps are versioned.
-- ---------------------------------------------------------------------------
CREATE TABLE budget_pools (
    id              TEXT PRIMARY KEY,
    display_name    TEXT NOT NULL,
    currency        TEXT NOT NULL CHECK (char_length(currency) = 3),   -- ISO 4217
    -- cap amounts in integer minor units
    per_txn_max            BIGINT NOT NULL CHECK (per_txn_max >= 0),
    window_max             BIGINT NOT NULL CHECK (window_max >= 0),      -- rolling/fixed window cap
    window_seconds         INTEGER NOT NULL CHECK (window_seconds > 0),  -- window length
    window_kind            TEXT NOT NULL DEFAULT 'rolling'
                             CHECK (window_kind IN ('rolling','fixed')),
    shared_pool_max        BIGINT NOT NULL CHECK (shared_pool_max >= 0), -- absolute shared ceiling
    version         BIGINT NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agents
    ADD CONSTRAINT agents_budget_pool_fk
    FOREIGN KEY (budget_pool_id) REFERENCES budget_pools(id);

-- ---------------------------------------------------------------------------
-- Policy versions (immutable, monotonic). Active pointer is separate.
-- The Rego module + data are stored so the control plane can serve bundles
-- and simulate; the gateway loads the active bundle at boot / on change.
-- ---------------------------------------------------------------------------
CREATE TABLE policy_versions (
    version         BIGSERIAL PRIMARY KEY,
    label           TEXT NOT NULL,
    rego_module     TEXT NOT NULL,          -- Rego source
    data_json       JSONB NOT NULL,         -- policy data document (allowlists, limits references)
    status          TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','active','superseded','rolled_back')),
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at    TIMESTAMPTZ
);

-- Exactly one active version at a time is enforced by partial unique index.
CREATE UNIQUE INDEX one_active_policy ON policy_versions ((status)) WHERE status = 'active';

ALTER TABLE agents
    ADD CONSTRAINT agents_policy_version_fk
    FOREIGN KEY (policy_version) REFERENCES policy_versions(version);

-- ---------------------------------------------------------------------------
-- Emergency stops: durable, monotonic epochs for halt & per-agent revocation.
-- scope = 'fleet' (agent_id NULL) or 'agent' (agent_id set).
-- The current epoch is the MAX(epoch). "active" halt = latest fleet row state.
-- ---------------------------------------------------------------------------
CREATE TABLE emergency_stops (
    epoch           BIGSERIAL PRIMARY KEY,   -- monotonic across all scopes
    scope           TEXT NOT NULL CHECK (scope IN ('fleet','agent')),
    agent_id        TEXT REFERENCES agents(id),
    state           TEXT NOT NULL CHECK (state IN ('halted','resumed','revoked','reinstated')),
    reason          TEXT NOT NULL,
    actor           TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fleet_has_no_agent CHECK (
        (scope = 'fleet' AND agent_id IS NULL) OR
        (scope = 'agent' AND agent_id IS NOT NULL)
    )
);
CREATE INDEX emergency_stops_scope_idx ON emergency_stops (scope, agent_id, epoch DESC);

-- ---------------------------------------------------------------------------
-- Gateway registry & halt acknowledgements (convergence tracking).
-- ---------------------------------------------------------------------------
CREATE TABLE gateways (
    id              TEXT PRIMARY KEY,        -- gateway instance id
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    acked_epoch     BIGINT NOT NULL DEFAULT 0,   -- highest emergency epoch acknowledged
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Audit events: append-only, per-tenant hash chain.
-- Chain: prev_hash of row N = event_hash of row N-1 (same chain_id).
-- event_hash = sha256(canonical(payload) || prev_hash).
-- ---------------------------------------------------------------------------
CREATE TABLE audit_events (
    seq             BIGSERIAL PRIMARY KEY,
    chain_id        TEXT NOT NULL DEFAULT 'default',    -- tenant/chain partition
    event_type      TEXT NOT NULL,                       -- DECISION | OUTCOME | CONFIG | EMERGENCY | INTEGRITY
    correlation_id  TEXT NOT NULL,                       -- ties intent -> decision -> outcome
    idempotency_key TEXT,
    agent_id        TEXT,
    decision        TEXT,                                -- ALLOW | DENY | REQUIRE_APPROVAL | null (non-decision)
    reason_code     TEXT,
    policy_version  BIGINT,
    payload         JSONB NOT NULL,                      -- redacted, canonical event body
    prev_hash       TEXT NOT NULL,
    event_hash      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_corr_idx      ON audit_events (correlation_id);
CREATE INDEX audit_events_agent_idx     ON audit_events (agent_id);
CREATE INDEX audit_events_type_idx      ON audit_events (event_type);
CREATE INDEX audit_events_reason_idx    ON audit_events (reason_code);
CREATE INDEX audit_events_created_idx   ON audit_events (created_at);
CREATE UNIQUE INDEX audit_events_chain_seq ON audit_events (chain_id, seq);

-- Signed checkpoints (tamper-evidence anchor). In MVP the signature is an
-- HMAC over the tip hash using a checkpoint key held by the control plane
-- (documented as NOT an external HSM/WORM anchor).
CREATE TABLE audit_checkpoints (
    id              BIGSERIAL PRIMARY KEY,
    chain_id        TEXT NOT NULL,
    tip_seq         BIGINT NOT NULL,
    tip_hash        TEXT NOT NULL,
    signature       TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency ledger: maps idempotency_key -> original correlation/decision.
-- Lives in Postgres for durability; Redis holds the hot reservation record.
CREATE TABLE idempotency_records (
    idempotency_key TEXT PRIMARY KEY,
    agent_id        TEXT NOT NULL,
    request_digest  TEXT NOT NULL,           -- sha256 of canonical request body
    correlation_id  TEXT NOT NULL,
    decision        TEXT NOT NULL,
    reason_code     TEXT NOT NULL,
    http_status     INTEGER NOT NULL,
    response_json   JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Append-only enforcement for audit tables (defence in depth).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'append-only table: % not permitted on %', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER audit_checkpoints_no_mutation
    BEFORE UPDATE OR DELETE ON audit_checkpoints
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

INSERT INTO schema_migrations (version) VALUES ('0001_init');

COMMIT;
