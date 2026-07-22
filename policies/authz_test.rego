package aegis.authz_test

import rego.v1

import data.aegis.authz

# ---- Helpers -----------------------------------------------------------------

base_allow := {
	"action": "payments.transfer.create",
	"principal": {"status": "active", "risk_tier": "low", "environment": "sandbox"},
	"resource": {"type": "payment_account", "payee_id": "tok_payee_A921", "payee_allowed": true},
	"context": {"environment": "sandbox"},
	"amount": {"amount_minor": 250000, "currency": "INR"},
	"policy_version": 1,
}

# ---- Golden ALLOW ------------------------------------------------------------

test_golden_allow if {
	d := authz.decision with input as base_allow
	d.effect == "ALLOW"
	d.reason_codes == ["POLICY_PERMIT"]
	d.determining_rule_ids == ["POL-PAY-001"]
}

test_allow_medium_risk if {
	i := json.patch(base_allow, [{"op": "replace", "path": "/principal/risk_tier", "value": "medium"}])
	d := authz.decision with input as i
	d.effect == "ALLOW"
}

# Boundary: amount of exactly 1 (minimum positive) is allowed by policy (caps are gateway-side).
test_allow_min_positive_amount if {
	i := json.patch(base_allow, [{"op": "replace", "path": "/amount/amount_minor", "value": 1}])
	d := authz.decision with input as i
	d.effect == "ALLOW"
}

# ---- DENY: risk tier ---------------------------------------------------------

test_deny_high_risk if {
	i := json.patch(base_allow, [{"op": "replace", "path": "/principal/risk_tier", "value": "high"}])
	d := authz.decision with input as i
	d.effect == "DENY"
	"POLICY_DENY" in d.reason_codes
}

test_deny_critical_risk if {
	i := json.patch(base_allow, [{"op": "replace", "path": "/principal/risk_tier", "value": "critical"}])
	d := authz.decision with input as i
	d.effect == "DENY"
	"POLICY_DENY" in d.reason_codes
}

# ---- DENY: payee -------------------------------------------------------------

test_deny_payee_not_allowed if {
	i := json.patch(base_allow, [{"op": "replace", "path": "/resource/payee_allowed", "value": false}])
	d := authz.decision with input as i
	d.effect == "DENY"
	"PAYEE_NOT_ALLOWED" in d.reason_codes
}

# ---- DENY: environment mismatch ---------------------------------------------

test_deny_environment_mismatch if {
	i := json.patch(base_allow, [{"op": "replace", "path": "/context/environment", "value": "production"}])
	d := authz.decision with input as i
	d.effect == "DENY"
	"ENVIRONMENT_MISMATCH" in d.reason_codes
}

# ---- DENY: agent not active --------------------------------------------------

test_deny_agent_not_active if {
	i := json.patch(base_allow, [{"op": "replace", "path": "/principal/status", "value": "pending"}])
	d := authz.decision with input as i
	d.effect == "DENY"
	"AGENT_NOT_ACTIVE" in d.reason_codes
}

# ---- DENY: invalid amount (zero / negative) ----------------------------------

test_deny_zero_amount if {
	i := json.patch(base_allow, [{"op": "replace", "path": "/amount/amount_minor", "value": 0}])
	d := authz.decision with input as i
	d.effect == "DENY"
	"INVALID_AMOUNT" in d.reason_codes
}

test_deny_negative_amount if {
	i := json.patch(base_allow, [{"op": "replace", "path": "/amount/amount_minor", "value": -5}])
	d := authz.decision with input as i
	d.effect == "DENY"
	"INVALID_AMOUNT" in d.reason_codes
}

# ---- DENY: unknown action ----------------------------------------------------

test_deny_unknown_action if {
	i := json.patch(base_allow, [{"op": "replace", "path": "/action", "value": "payments.wire.exotic"}])
	d := authz.decision with input as i
	d.effect == "DENY"
	"ACTION_NOT_REGISTERED" in d.reason_codes
}

# ---- Default deny: empty input ----------------------------------------------

test_default_deny_empty_input if {
	d := authz.decision with input as {}
	d.effect == "DENY"
}

# ---- Multiple deny reasons are sorted & stable -------------------------------

test_multiple_deny_reasons_sorted if {
	i := json.patch(base_allow, [
		{"op": "replace", "path": "/resource/payee_allowed", "value": false},
		{"op": "replace", "path": "/context/environment", "value": "production"},
	])
	d := authz.decision with input as i
	d.effect == "DENY"
	# sorted: ENVIRONMENT_MISMATCH < PAYEE_NOT_ALLOWED
	d.reason_codes == ["ENVIRONMENT_MISMATCH", "PAYEE_NOT_ALLOWED"]
}

# ---- Decision always carries policy_version ----------------------------------

test_decision_carries_policy_version if {
	d := authz.decision with input as base_allow
	d.policy_version == 1
}
