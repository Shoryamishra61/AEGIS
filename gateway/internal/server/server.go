// Package server wires the full enforcement pipeline and HTTP surface. It applies
// the decision precedence in SRS 7.3: identity -> containment -> freshness ->
// schema -> policy -> approval -> budget -> durable audit -> dispatch.
package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/aegis/gateway/internal/action"
	"github.com/aegis/gateway/internal/audit"
	"github.com/aegis/gateway/internal/authn"
	"github.com/aegis/gateway/internal/backend"
	"github.com/aegis/gateway/internal/budget"
	"github.com/aegis/gateway/internal/containment"
	"github.com/aegis/gateway/internal/policy"
	"github.com/aegis/gateway/internal/reason"
	"github.com/oklog/ulid/v2"
)

type Deps struct {
	Auth        *authn.Authenticator
	Containment *containment.Manager
	Policy      *policy.Evaluator
	Budget      *budget.Coordinator
	Audit       *audit.Writer
	Backend     *backend.Adapter
	GatewayID   string
	Ready       *atomic.Bool
}

type Server struct {
	d Deps
}

func New(d Deps) *Server { return &Server{d: d} }

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/actions", s.handleAction)
	mux.HandleFunc("GET /healthz", s.handleLiveness)
	mux.HandleFunc("GET /readyz", s.handleReadiness)
	return mux
}

// response body returned to agents.
type actionResponse struct {
	ActionID      string                 `json:"action_id"`
	CorrelationID string                 `json:"correlation_id"`
	Decision      string                 `json:"decision"`
	ReasonCodes   []string               `json:"reason_codes"`
	PolicyVersion int64                  `json:"policy_version,omitempty"`
	ReservationID string                 `json:"reservation_id,omitempty"`
	Execution     map[string]interface{} `json:"execution,omitempty"`
	Retryable     bool                   `json:"retryable"`
	Advice        string                 `json:"advice"`
	SafeDetails   map[string]interface{} `json:"safe_details,omitempty"`
	Reconcile     bool                   `json:"reconciliation_required,omitempty"`
}

func (s *Server) handleAction(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	corr := "corr_" + ulid.Make().String()

	// --- Gate 1: identity (from verified token only) ---
	bearer := extractBearer(r)
	ag, err := s.d.Auth.Verify(ctx, bearer)
	if err != nil {
		code := reason.Unauthenticated
		if err == authn.ErrNoAgent {
			code = reason.AgentUnknown
		}
		s.deny(ctx, w, corr, "", "", code, ag, nil, 0)
		return
	}
	if ag.Status != "active" {
		s.deny(ctx, w, corr, "", ag.ID, reason.AgentNotActive, ag, nil, 0)
		return
	}

	// --- Parse body (bounded) ---
	body, err := io.ReadAll(io.LimitReader(r.Body, action.MaxPayloadBytes+1))
	if err != nil || len(body) > action.MaxPayloadBytes {
		s.deny(ctx, w, corr, "", ag.ID, reason.SchemaInvalid, ag, nil, 0)
		return
	}
	var env action.Envelope
	if err := json.Unmarshal(body, &env); err != nil {
		s.deny(ctx, w, corr, "", ag.ID, reason.SchemaInvalid, ag, nil, 0)
		return
	}
	// Idempotency key must be present and match header.
	hdrKey := r.Header.Get("Idempotency-Key")
	if hdrKey == "" || env.IdempotencyKey == "" || hdrKey != env.IdempotencyKey {
		s.deny(ctx, w, corr, env.ActionID, ag.ID, reason.IdempotencyMissing, ag, nil, 0)
		return
	}

	// --- Gate 2+3: containment + freshness (highest precedence) ---
	cd := s.d.Containment.Check(ctx, ag.ID)
	if !cd.Allowed {
		s.deny(ctx, w, corr, env.ActionID, ag.ID, cd.ReasonCode, ag, &env, 0)
		return
	}

	// --- Gate 4: schema/canonicalization ---
	env.Canonicalize()
	if err := env.Validate(); err != nil {
		code := reason.SchemaInvalid
		switch err {
		case action.ErrUnknownAction:
			code = reason.ActionNotRegistered
		case action.ErrAmount:
			code = reason.InvalidAmount
		}
		s.deny(ctx, w, corr, env.ActionID, ag.ID, code, ag, &env, 0)
		return
	}

	// --- Gate 5: policy (permission only) ---
	pin := policy.Input{
		Action: env.Action,
		Principal: policy.PrincipalInput{
			Status:      ag.Status,
			RiskTier:    ag.RiskTier,
			Environment: ag.Environment,
		},
		Resource: policy.ResourceInput{
			Type:         env.Resource.Type,
			PayeeID:      env.Arguments.PayeeID,
			PayeeAllowed: s.d.Policy.PayeeAllowed(env.Arguments.PayeeID),
		},
		Context: policy.ContextInput{Environment: ag.Environment},
		Amount: policy.AmountInput{
			AmountMinor: env.Arguments.AmountMinor,
			Currency:    env.Arguments.Currency,
		},
		PolicyVersion: s.d.Policy.PolicyVersion(),
	}
	pd, err := s.d.Policy.Evaluate(ctx, pin)
	if err != nil {
		s.deny(ctx, w, corr, env.ActionID, ag.ID, reason.PolicyEvalError, ag, &env, s.d.Policy.PolicyVersion())
		return
	}
	if pd.Effect == reason.EffectRequireApproval {
		// P1 approval workflow deferred: REQUIRE_APPROVAL must fail-closed (no dispatch).
		s.deny(ctx, w, corr, env.ActionID, ag.ID, reason.RequireApproval, ag, &env, s.d.Policy.PolicyVersion())
		return
	}
	if pd.Effect != reason.EffectAllow {
		code := reason.NoExplicitPermit
		if len(pd.ReasonCodes) > 0 {
			code = pd.ReasonCodes[0]
		}
		s.deny(ctx, w, corr, env.ActionID, ag.ID, code, ag, &env, s.d.Policy.PolicyVersion())
		return
	}

	// --- Gate 8: atomic budget reservation ---
	keyHash := action.HashKey(ag.ID, env.IdempotencyKey)
	reqDigest := env.RequestDigest()
	rr, err := s.d.Budget.Reserve(ctx, ag.ID, keyHash, reqDigest,
		env.Arguments.AmountMinor, env.Arguments.Currency, ag.BudgetPoolCurrency(),
		ag.BudgetPoolID, corr)
	if err != nil {
		s.deny(ctx, w, corr, env.ActionID, ag.ID, reason.BudgetStateUnavailable, ag, &env, s.d.Policy.PolicyVersion())
		return
	}
	switch rr.Status {
	case "REPLAY":
		// Return the original decision idempotently.
		s.replay(w, corr, env.ActionID, rr)
		return
	case "CONFLICT":
		s.deny(ctx, w, corr, env.ActionID, ag.ID, reason.IdempotencyConflict, ag, &env, s.d.Policy.PolicyVersion())
		return
	case "DENY":
		s.deny(ctx, w, corr, env.ActionID, ag.ID, budget.MapDenyReason(rr.ReasonCode), ag, &env, s.d.Policy.PolicyVersion())
		return
	}
	// rr.Status == RESERVED
	resID := rr.ReservationID

	// --- Gate 9: durable decision evidence BEFORE dispatch (ADR-006) ---
	_, _, aerr := s.d.Audit.Append(ctx, audit.Event{
		EventType:      "ACTION_DECISION",
		CorrelationID:  corr,
		IdempotencyKey: env.IdempotencyKey,
		AgentID:        ag.ID,
		Decision:       reason.EffectAllow,
		ReasonCode:     reason.PolicyPermit,
		PolicyVersion:  s.d.Policy.PolicyVersion(),
		Payload:        safePayload(&env, resID),
	})
	if aerr != nil {
		// Compensation: release the undispatched reservation, then deny fail-closed.
		_, _, _ = s.d.Budget.Transition(ctx, resID, ag.BudgetPoolID, "RELEASED")
		s.deny(ctx, w, corr, env.ActionID, ag.ID, reason.AuditWriteFailed, ag, &env, s.d.Policy.PolicyVersion())
		return
	}

	// --- Pre-dispatch recheck of containment (FR-026) ---
	cd2 := s.d.Containment.Check(ctx, ag.ID)
	if !cd2.Allowed {
		_, _, _ = s.d.Budget.Transition(ctx, resID, ag.BudgetPoolID, "RELEASED")
		s.auditOutcome(ctx, corr, ag.ID, reason.EffectDeny, cd2.ReasonCode, resID, "RELEASED")
		s.deny(ctx, w, corr, env.ActionID, ag.ID, cd2.ReasonCode, ag, &env, s.d.Policy.PolicyVersion())
		return
	}

	// --- Mark Dispatched, then call backend (FR-024) ---
	_, _, _ = s.d.Budget.Transition(ctx, resID, ag.BudgetPoolID, "DISPATCHED")
	dr, _ := s.d.Backend.Dispatch(ctx, backend.DispatchRequest{
		IdempotencyKey: env.IdempotencyKey,
		CorrelationID:  corr,
		PayeeID:        env.Arguments.PayeeID,
		AmountMinor:    env.Arguments.AmountMinor,
		Currency:       env.Arguments.Currency,
		SimMode:        env.Arguments.PurposeCode, // purpose used to trigger sim modes in demo
	})

	// --- Finalize outcome ---
	var execState string
	var backendRef string
	outcomeReason := reason.ExecutionOK
	switch dr.Outcome {
	case backend.OutcomeCommitted:
		_, _, _ = s.d.Budget.Transition(ctx, resID, ag.BudgetPoolID, "COMMITTED")
		execState = "COMMITTED"
		backendRef = dr.BackendReference
		outcomeReason = reason.ExecutionOK
	case backend.OutcomeReleased:
		_, _, _ = s.d.Budget.Transition(ctx, resID, ag.BudgetPoolID, "RELEASED")
		execState = "RELEASED"
		outcomeReason = reason.ExecutionFailed
	default: // UNKNOWN: retain exposure
		_, _, _ = s.d.Budget.Transition(ctx, resID, ag.BudgetPoolID, "UNKNOWN")
		execState = "UNKNOWN"
		outcomeReason = reason.ExecutionUnknown
	}
	s.auditOutcome(ctx, corr, ag.ID, reason.EffectAllow, outcomeReason, resID, execState)

	resp := actionResponse{
		ActionID:      env.ActionID,
		CorrelationID: corr,
		Decision:      reason.EffectAllow,
		ReasonCodes:   []string{reason.PolicyPermit, "BUDGET_RESERVED"},
		PolicyVersion: s.d.Policy.PolicyVersion(),
		ReservationID: resID,
		Execution:     map[string]interface{}{"state": execState},
		Retryable:     false,
		Advice:        string(reason.Advice(outcomeReason)),
	}
	if backendRef != "" {
		resp.Execution["backend_reference"] = backendRef
	}
	if execState == "UNKNOWN" {
		resp.Reconcile = true
		resp.ReasonCodes = []string{reason.ExecutionUnknown}
	}
	writeJSON(w, 200, resp)
}

func (s *Server) auditOutcome(ctx context.Context, corr, agentID, decision, reasonCode, resID, execState string) {
	_, _, _ = s.d.Audit.Append(ctx, audit.Event{
		EventType:     "ACTION_OUTCOME",
		CorrelationID: corr,
		AgentID:       agentID,
		Decision:      decision,
		ReasonCode:    reasonCode,
		Payload: map[string]interface{}{
			"reservation_id": resID,
			"execution":      execState,
		},
	})
}

func (s *Server) deny(ctx context.Context, w http.ResponseWriter, corr, actionID, agentID, code string, ag *authn.Agent, env *action.Envelope, polVer int64) {
	// Durable evidence for the denied intent (FR-039). Best-effort but attempted.
	payload := map[string]interface{}{}
	if env != nil {
		payload = safePayload(env, "")
	}
	_, _, _ = s.d.Audit.Append(ctx, audit.Event{
		EventType:     "ACTION_DECISION",
		CorrelationID: corr,
		AgentID:       agentID,
		Decision:      reason.EffectDeny,
		ReasonCode:    code,
		PolicyVersion: polVer,
		Payload:       payload,
	})
	resp := actionResponse{
		ActionID:      actionID,
		CorrelationID: corr,
		Decision:      reason.EffectDeny,
		ReasonCodes:   []string{code},
		PolicyVersion: polVer,
		Retryable:     reason.Advice(code) == reason.AdviceWait,
		Advice:        string(reason.Advice(code)),
	}
	if env != nil {
		resp.SafeDetails = map[string]interface{}{"currency": env.Arguments.Currency}
	}
	writeJSON(w, reason.HTTPStatus(reason.EffectDeny, code), resp)
}

func (s *Server) replay(w http.ResponseWriter, corr, actionID string, rr *budget.ReserveResult) {
	writeJSON(w, 200, actionResponse{
		ActionID:      actionID,
		CorrelationID: rr.CorrelationID,
		Decision:      reason.EffectAllow,
		ReasonCodes:   []string{reason.PolicyPermit, "IDEMPOTENT_REPLAY"},
		ReservationID: rr.ReservationID,
		Retryable:     false,
		Advice:        string(reason.AdviceProceed),
	})
}

func (s *Server) handleLiveness(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]string{"status": "alive"})
}

func (s *Server) handleReadiness(w http.ResponseWriter, r *http.Request) {
	if s.d.Ready != nil && s.d.Ready.Load() {
		writeJSON(w, 200, map[string]interface{}{
			"status":         "ready",
			"policy_version": s.d.Policy.PolicyVersion(),
			"halt_epoch":     s.d.Containment.CurrentHaltEpoch(r.Context()),
		})
		return
	}
	writeJSON(w, 503, map[string]string{"status": "not_ready"})
}

func safePayload(env *action.Envelope, resID string) map[string]interface{} {
	p := map[string]interface{}{
		"action":        env.Action,
		"resource_type": env.Resource.Type,
		"amount_minor":  env.Arguments.AmountMinor,
		"currency":      env.Arguments.Currency,
		"payee_token":   env.Arguments.PayeeID, // already a token in the demo schema
		"purpose_code":  env.Arguments.PurposeCode,
	}
	if resID != "" {
		p["reservation_id"] = resID
	}
	return p
}

func extractBearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return ""
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

var _ = context.Background
var _ = time.Now
