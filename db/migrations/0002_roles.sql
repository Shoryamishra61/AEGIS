-- AEGIS :: 0002_roles.sql
-- Least-privilege runtime roles. Passwords/usernames are injected via psql -v
-- variables at bootstrap time (see db/bootstrap.sh).
--
-- IMPORTANT: psql does NOT substitute :'var' / :"var" inside dollar-quoted
-- ($$ ... $$) blocks. Role creation therefore uses the \gexec pattern: a SELECT
-- produces the DDL text (with psql-interpolated identifiers/literals) which is
-- then executed. CREATE ROLE has no IF NOT EXISTS, so we guard on pg_roles.

BEGIN;

-- gateway role: INSERT audit, SELECT config it reads at runtime.
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'gateway_user', :'gateway_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'gateway_user')
\gexec

-- control role: full read/write on config tables, INSERT audit, checkpoints.
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'control_user', :'control_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'control_user')
\gexec

-- audit reader role: SELECT-only on audit tables (auditor/verifier).
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'audit_reader_user', :'audit_reader_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'audit_reader_user')
\gexec

GRANT CONNECT ON DATABASE aegis TO :"gateway_user", :"control_user", :"audit_reader_user";
GRANT USAGE ON SCHEMA public TO :"gateway_user", :"control_user", :"audit_reader_user";

-- ---- Gateway grants ----
-- Reads config needed for enforcement.
GRANT SELECT ON agents, budget_pools, policy_versions, emergency_stops, gateways
    TO :"gateway_user";
-- Registers/updates its own heartbeat + ack.
GRANT INSERT, UPDATE ON gateways TO :"gateway_user";
-- Append-only audit + idempotency durable ledger.
GRANT INSERT, SELECT ON audit_events TO :"gateway_user";
GRANT INSERT, SELECT ON idempotency_records TO :"gateway_user";
GRANT USAGE, SELECT ON SEQUENCE audit_events_seq_seq TO :"gateway_user";
-- Explicitly NO update/delete on audit_events (append-only). Not granted above.

-- ---- Control grants ----
GRANT SELECT, INSERT, UPDATE ON agents, budget_pools, policy_versions, emergency_stops, gateways
    TO :"control_user";
GRANT INSERT, SELECT ON audit_events TO :"control_user";
GRANT SELECT, INSERT, UPDATE ON idempotency_records TO :"control_user";
GRANT INSERT, SELECT ON audit_checkpoints TO :"control_user";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"control_user";
-- Control role must NOT be able to UPDATE/DELETE audit_events (append-only). The
-- trigger enforces this even if a grant were mistakenly added.

-- ---- Audit reader grants ----
GRANT SELECT ON audit_events, audit_checkpoints TO :"audit_reader_user";

INSERT INTO schema_migrations (version) VALUES ('0002_roles');

COMMIT;
