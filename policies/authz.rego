# AEGIS authorization policy (Rego, OPA v1 / rego.v1).
#
# Contract (SRS 18.2): OPA receives ONLY normalized trusted input and returns a
# structured decision. It does NOT read Redis, budgets, revocation, or halt state
# (the gateway owns that precedence). It decides permission only.
#
# Input shape:
#   input.action                string  e.g. "payments.transfer.create"
#   input.principal.status      string  "active" | ...
#   input.principal.risk_tier   string  "low"|"medium"|"high"|"critical"
#   input.principal.environment string  "sandbox"|"production"
#   input.resource.type         string
#   input.resource.payee_id     string
#   input.resource.payee_allowed bool   (gateway resolves against policy data allowlist)
#   input.context.environment   string
#   input.amount.amount_minor   number  (integer minor units)
#   input.amount.currency       string  ISO 4217
#   input.policy_version        number
#
# Output (read by gateway as data.aegis.authz.decision):
#   { effect, reason_codes, determining_rule_ids, policy_version, diagnostics }

package aegis.authz

import rego.v1

# ---- Permit rule(s) ----------------------------------------------------------

# POL-PAY-001: a transfer is permitted only when every condition holds.
permit if {
	input.action == "payments.transfer.create"
	input.principal.status == "active"
	input.principal.risk_tier in {"low", "medium"}
	input.resource.payee_allowed == true
	input.context.environment == input.principal.environment
	is_number(input.amount.amount_minor)
	input.amount.amount_minor > 0
}

# ---- Deny reasons (explicit) -------------------------------------------------
# Each deny reason is a stable code from the reason registry. Collected into a set.

deny_reasons contains "ACTION_NOT_REGISTERED" if {
	not known_action
}

deny_reasons contains "AGENT_NOT_ACTIVE" if {
	known_action
	input.principal.status != "active"
}

deny_reasons contains "POLICY_DENY" if {
	known_action
	input.principal.status == "active"
	not input.principal.risk_tier in {"low", "medium"}
}

deny_reasons contains "PAYEE_NOT_ALLOWED" if {
	known_action
	input.principal.status == "active"
	input.resource.payee_allowed != true
}

deny_reasons contains "ENVIRONMENT_MISMATCH" if {
	known_action
	input.principal.status == "active"
	input.context.environment != input.principal.environment
}

deny_reasons contains "INVALID_AMOUNT" if {
	known_action
	not valid_amount
}

known_action if {
	input.action == "payments.transfer.create"
}

valid_amount if {
	is_number(input.amount.amount_minor)
	input.amount.amount_minor > 0
}

# ---- Effect resolution -------------------------------------------------------

default effect := "DENY"

effect := "ALLOW" if {
	permit
	count(deny_reasons) == 0
}

# Reason codes
default reason_codes := ["NO_EXPLICIT_PERMIT"]

reason_codes := ["POLICY_PERMIT"] if {
	effect == "ALLOW"
}

# When denied and we have explicit reasons, surface them (sorted for determinism).
reason_codes := sorted_reasons if {
	effect == "DENY"
	count(deny_reasons) > 0
	sorted_reasons := sort([r | some r in deny_reasons])
}

default determining_rule_ids := ["POL-DENY"]

determining_rule_ids := ["POL-PAY-001"] if effect == "ALLOW"

# ---- Structured decision object read by the gateway --------------------------

# policy_version echoes the pinned version the gateway supplied; null when absent.
policy_version := input.policy_version if {
	input.policy_version
}

default policy_version := null

decision := {
	"effect": effect,
	"reason_codes": reason_codes,
	"determining_rule_ids": determining_rule_ids,
	"policy_version": policy_version,
	"diagnostics": [],
}
