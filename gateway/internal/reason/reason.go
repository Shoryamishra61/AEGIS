// Package reason defines the stable machine-readable reason-code registry.
// These codes are part of the public gateway contract (SRS Appendix A) and are
// mirrored by the control plane, dashboard, and simulator. Do not repurpose a
// code; add a new one instead.
package reason

// Decision effects.
const (
	EffectAllow           = "ALLOW"
	EffectDeny            = "DENY"
	EffectRequireApproval = "REQUIRE_APPROVAL"
)

// Reason codes. Grouped by the gate that produces them.
const (
	// Identity / schema gate
	Unauthenticated    = "UNAUTHENTICATED"
	AgentUnknown       = "AGENT_UNKNOWN"
	AgentNotActive     = "AGENT_NOT_ACTIVE"
	SchemaInvalid      = "SCHEMA_INVALID"
	IdempotencyMissing = "IDEMPOTENCY_KEY_MISSING"
	IdempotencyConflict = "IDEMPOTENCY_CONFLICT"

	// Containment gate (highest precedence)
	FleetHalted  = "FLEET_HALTED"
	AgentRevoked = "AGENT_REVOKED"
	HaltStale    = "HALT_STATE_STALE"

	// Policy gate
	PolicyPermit       = "POLICY_PERMIT"
	PolicyDeny         = "POLICY_DENY"
	NoExplicitPermit   = "NO_EXPLICIT_PERMIT"
	PayeeNotAllowed    = "PAYEE_NOT_ALLOWED"
	EnvironmentMismatch = "ENVIRONMENT_MISMATCH"
	ActionNotRegistered = "ACTION_NOT_REGISTERED"
	PolicyEvalError    = "POLICY_EVAL_ERROR"
	RequireApproval    = "REQUIRE_APPROVAL"

	// Budget gate
	InvalidAmount           = "INVALID_AMOUNT"
	AmountOverflow          = "AMOUNT_OVERFLOW"
	CurrencyBudgetMismatch  = "CURRENCY_BUDGET_MISMATCH"
	PerTxnCapExceeded       = "PER_TXN_CAP_EXCEEDED"
	WindowCapExceeded       = "WINDOW_CAP_EXCEEDED"
	SharedPoolCapExceeded   = "SHARED_POOL_CAP_EXCEEDED"
	BudgetStateUnavailable  = "BUDGET_STATE_UNAVAILABLE"

	// Audit / dependency gate (fail-closed)
	AuditWriteFailed = "AUDIT_WRITE_FAILED"
	DependencyDown   = "DEPENDENCY_UNAVAILABLE"

	// Outcome codes
	ExecutionOK      = "EXECUTION_OK"
	ExecutionFailed  = "EXECUTION_FAILED"
	ExecutionUnknown = "EXECUTION_UNKNOWN"

	// Success
	Allowed = "ALLOWED"
)

// AgentAdvice tells the calling agent what to do next for a given reason.
// STOP: do not retry (policy/containment deny).
// WAIT: limit will reset; retry later (window cap).
// RECONCILE: outcome uncertain; do not blind-retry (unknown).
// FIX: malformed request; correct and resubmit (schema).
type AgentAdvice string

const (
	AdviceStop      AgentAdvice = "STOP"
	AdviceWait      AgentAdvice = "WAIT"
	AdviceReconcile AgentAdvice = "RECONCILE"
	AdviceFix       AgentAdvice = "FIX"
	AdviceApproval  AgentAdvice = "REQUEST_APPROVAL"
	AdviceProceed   AgentAdvice = "PROCEED"
)

// Advice maps a reason code to deterministic agent guidance.
func Advice(code string) AgentAdvice {
	switch code {
	case PolicyPermit, Allowed, ExecutionOK:
		return AdviceProceed
	case WindowCapExceeded, SharedPoolCapExceeded, PerTxnCapExceeded:
		return AdviceWait
	case ExecutionUnknown:
		return AdviceReconcile
	case SchemaInvalid, InvalidAmount, AmountOverflow, IdempotencyMissing,
		CurrencyBudgetMismatch, IdempotencyConflict:
		return AdviceFix
	case RequireApproval:
		return AdviceApproval
	default:
		// Default-deny advice: containment, policy deny, dependency failure, unknown codes.
		return AdviceStop
	}
}

// HTTPStatus maps a reason code to the HTTP status the gateway returns.
func HTTPStatus(effect, code string) int {
	if effect == EffectAllow {
		return 200
	}
	switch code {
	case Unauthenticated:
		return 401
	case AgentUnknown, AgentNotActive, FleetHalted, AgentRevoked, HaltStale,
		PolicyDeny, NoExplicitPermit, PayeeNotAllowed, EnvironmentMismatch,
		ActionNotRegistered, RequireApproval:
		return 403
	case SchemaInvalid, InvalidAmount, AmountOverflow, IdempotencyMissing,
		CurrencyBudgetMismatch:
		return 422
	case IdempotencyConflict:
		return 409
	case PerTxnCapExceeded, WindowCapExceeded, SharedPoolCapExceeded:
		return 429
	case AuditWriteFailed, DependencyDown, BudgetStateUnavailable, PolicyEvalError:
		return 503
	default:
		return 403
	}
}
