// Package policy embeds OPA and evaluates the pinned authz bundle against a
// normalized PARC input, returning the structured decision contract
// (FR-011..FR-015, SRS 18.2). OPA never reads Redis/network; the gateway owns
// containment/budget precedence.
package policy

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/aegis/gateway/internal/reason"
	"github.com/open-policy-agent/opa/rego"
)

//go:embed bundle/authz.rego
var authzModule string

type Evaluator struct {
	query         rego.PreparedEvalQuery
	policyVersion int64
	allowedPayees map[string]bool
}

// Decision mirrors the Rego decision object.
type Decision struct {
	Effect             string   `json:"effect"`
	ReasonCodes        []string `json:"reason_codes"`
	DeterminingRuleIDs []string `json:"determining_rule_ids"`
	PolicyVersion      *int64   `json:"policy_version"`
	Diagnostics        []string `json:"diagnostics"`
}

// Input is the normalized PARC envelope handed to OPA.
type Input struct {
	Action    string         `json:"action"`
	Principal PrincipalInput `json:"principal"`
	Resource  ResourceInput  `json:"resource"`
	Context   ContextInput   `json:"context"`
	Amount    AmountInput    `json:"amount"`
	PolicyVersion int64      `json:"policy_version"`
}

type PrincipalInput struct {
	Status      string `json:"status"`
	RiskTier    string `json:"risk_tier"`
	Environment string `json:"environment"`
}
type ResourceInput struct {
	Type         string `json:"type"`
	PayeeID      string `json:"payee_id"`
	PayeeAllowed bool   `json:"payee_allowed"`
}
type ContextInput struct {
	Environment string `json:"environment"`
}
type AmountInput struct {
	AmountMinor int64  `json:"amount_minor"`
	Currency    string `json:"currency"`
}

// New compiles the embedded bundle and prepares the decision query.
// allowedPayees is the policy data allowlist loaded from the active version.
func New(ctx context.Context, policyVersion int64, allowedPayees []string) (*Evaluator, error) {
	payeeSet := map[string]bool{}
	for _, p := range allowedPayees {
		payeeSet[p] = true
	}
	r := rego.New(
		rego.Query("data.aegis.authz.decision"),
		rego.Module("authz.rego", authzModule),
	)
	pq, err := r.PrepareForEval(ctx)
	if err != nil {
		return nil, fmt.Errorf("prepare policy: %w", err)
	}
	return &Evaluator{query: pq, policyVersion: policyVersion, allowedPayees: payeeSet}, nil
}

// PayeeAllowed reports whether a payee token is in the active allowlist.
func (e *Evaluator) PayeeAllowed(payee string) bool {
	return e.allowedPayees[payee]
}

func (e *Evaluator) PolicyVersion() int64 { return e.policyVersion }

var ErrEvaluation = errors.New("policy evaluation error")

// Evaluate runs the policy and validates the output contract. Any structural
// violation is fail-closed (returns ErrEvaluation).
func (e *Evaluator) Evaluate(ctx context.Context, in Input) (*Decision, error) {
	rs, err := e.query.Eval(ctx, rego.EvalInput(in))
	if err != nil {
		return nil, ErrEvaluation
	}
	if len(rs) != 1 || len(rs[0].Expressions) != 1 {
		return nil, ErrEvaluation
	}
	raw, err := json.Marshal(rs[0].Expressions[0].Value)
	if err != nil {
		return nil, ErrEvaluation
	}
	var d Decision
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, ErrEvaluation
	}
	// Output-contract validation (SRS 18.2).
	switch d.Effect {
	case reason.EffectAllow, reason.EffectDeny, reason.EffectRequireApproval:
	default:
		return nil, ErrEvaluation
	}
	if len(d.ReasonCodes) == 0 {
		return nil, ErrEvaluation
	}
	// ALLOW with diagnostics is fail-closed.
	if d.Effect == reason.EffectAllow && len(d.Diagnostics) > 0 {
		return nil, ErrEvaluation
	}
	return &d, nil
}
