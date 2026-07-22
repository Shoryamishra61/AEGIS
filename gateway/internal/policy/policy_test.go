package policy

import (
	"context"
	"testing"
)

func newEval(t *testing.T) *Evaluator {
	t.Helper()
	e, err := New(context.Background(), 1, []string{"tok_payee_A921"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return e
}

func baseInput() Input {
	return Input{
		Action:        "payments.transfer.create",
		Principal:     PrincipalInput{Status: "active", RiskTier: "low", Environment: "sandbox"},
		Resource:      ResourceInput{Type: "payment_account", PayeeID: "tok_payee_A921", PayeeAllowed: true},
		Context:       ContextInput{Environment: "sandbox"},
		Amount:        AmountInput{AmountMinor: 250000, Currency: "INR"},
		PolicyVersion: 1,
	}
}

func TestEvaluateAllow(t *testing.T) {
	e := newEval(t)
	d, err := e.Evaluate(context.Background(), baseInput())
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if d.Effect != "ALLOW" {
		t.Fatalf("expected ALLOW got %s (%v)", d.Effect, d.ReasonCodes)
	}
}

func TestEvaluateDenyHighRisk(t *testing.T) {
	e := newEval(t)
	in := baseInput()
	in.Principal.RiskTier = "high"
	d, err := e.Evaluate(context.Background(), in)
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if d.Effect != "DENY" {
		t.Fatalf("expected DENY got %s", d.Effect)
	}
}

func TestEvaluateDefaultDenyEmpty(t *testing.T) {
	e := newEval(t)
	d, err := e.Evaluate(context.Background(), Input{})
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if d.Effect != "DENY" {
		t.Fatalf("empty input must default-deny, got %s", d.Effect)
	}
	if len(d.ReasonCodes) == 0 {
		t.Fatalf("deny must carry reason codes")
	}
}

func TestPayeeAllowlist(t *testing.T) {
	e := newEval(t)
	if !e.PayeeAllowed("tok_payee_A921") {
		t.Fatal("expected payee allowed")
	}
	if e.PayeeAllowed("tok_unknown") {
		t.Fatal("expected payee not allowed")
	}
}
