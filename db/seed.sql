-- AEGIS :: seed.sql
-- Synthetic demo data (single tenant). Safe to run once on a fresh DB.
-- Idempotent-ish: uses ON CONFLICT DO NOTHING where possible.

BEGIN;

-- ---- Budget pool ----
-- INR minor units (paise). per_txn 100000 = ₹1,000.00 ; window 500000 = ₹5,000.00 / 60s ;
-- shared 1000000 = ₹10,000.00 absolute shared ceiling.
INSERT INTO budget_pools
    (id, display_name, currency, per_txn_max, window_max, window_seconds, window_kind, shared_pool_max)
VALUES
    ('pool_payables', 'Payables shared pool', 'INR', 100000, 500000, 60, 'rolling', 1000000)
ON CONFLICT (id) DO NOTHING;

-- Judge demo pool: ₹50,000 per transaction so the required ₹5,000 scenario is
-- permitted while ₹1,00,000 is deterministically denied by the cap.
INSERT INTO budget_pools
    (id, display_name, currency, per_txn_max, window_max, window_seconds, window_kind, shared_pool_max)
VALUES
    ('pool_judge_demo', 'Judge demo pool', 'INR', 5000000, 20000000, 60, 'rolling', 50000000)
ON CONFLICT (id) DO UPDATE SET
    per_txn_max=EXCLUDED.per_txn_max,
    window_max=EXCLUDED.window_max,
    shared_pool_max=EXCLUDED.shared_pool_max;

-- ---- Active policy version ----
-- The gateway's authoritative Rego bundle is baked into its image from policies/authz.rego
-- (single source of truth). This row stores version metadata + a reference copy used by the
-- control plane for simulation/versioning. Keep the label/version in sync with the bundle.
INSERT INTO policy_versions (version, label, rego_module, data_json, status, created_by, activated_at)
VALUES (
    1,
    'baseline-v1',
    $REGO$package aegis.authz
# Reference copy for control-plane simulation. Authoritative bundle: policies/authz.rego
# (baked into the gateway image). See docs/README for the sync note.
import rego.v1
default effect := "DENY"
permit if {
    input.action == "payments.transfer.create"
    input.principal.status == "active"
    input.principal.risk_tier in {"low", "medium"}
    input.resource.payee_allowed == true
    input.context.environment == input.principal.environment
    input.amount.amount_minor > 0
}
effect := "ALLOW" if permit
$REGO$,
    '{"allowed_payees": ["tok_payee_A921", "tok_payee_B550", "tok_payee_C777"]}'::jsonb,
    'active',
    'seed',
    now()
)
ON CONFLICT (version) DO NOTHING;

-- ---- Agents ----
-- Normal payables agent (active, low risk) bound to workload subject.
INSERT INTO agents
    (id, display_name, owner, risk_tier, environment, status, workload_sub, allowed_actions, budget_pool_id, policy_version)
VALUES
    ('agent-payables-01', 'Payables Agent 01', 'treasury-ops', 'low', 'sandbox', 'active',
     'sub-agent-payables-01', ARRAY['payments.transfer.create'], 'pool_payables', 1)
ON CONFLICT (id) DO NOTHING;

-- Dedicated agent for the judge-facing amounts; isolated from concurrency tests.
INSERT INTO agents
    (id, display_name, owner, risk_tier, environment, status, workload_sub, allowed_actions, budget_pool_id, policy_version)
VALUES
    ('agent-judge-demo', 'Judge Demo Agent', 'demo-operations', 'low', 'sandbox', 'active',
     'sub-agent-judge-demo', ARRAY['payments.transfer.create'], 'pool_judge_demo', 1)
ON CONFLICT (id) DO UPDATE SET budget_pool_id=EXCLUDED.budget_pool_id, workload_sub=EXCLUDED.workload_sub;

-- Rogue/high-risk agent used by the adversary simulator (active but high tier -> policy denies).
INSERT INTO agents
    (id, display_name, owner, risk_tier, environment, status, workload_sub, allowed_actions, budget_pool_id, policy_version)
VALUES
    ('agent-rogue-01', 'Rogue Agent 01', 'unknown', 'high', 'sandbox', 'active',
     'sub-agent-rogue-01', ARRAY['payments.transfer.create'], 'pool_payables', 1)
ON CONFLICT (id) DO NOTHING;

-- Pending agent (not yet active -> denied AGENT_NOT_ACTIVE).
INSERT INTO agents
    (id, display_name, owner, risk_tier, environment, status, workload_sub, allowed_actions, budget_pool_id, policy_version)
VALUES
    ('agent-pending-01', 'Pending Agent 01', 'treasury-ops', 'low', 'sandbox', 'pending',
     'sub-agent-pending-01', ARRAY['payments.transfer.create'], 'pool_payables', 1)
ON CONFLICT (id) DO NOTHING;

COMMIT;
