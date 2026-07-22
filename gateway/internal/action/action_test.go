package action

import "testing"

func TestCanonicalizeUppercasesCurrencyAndTrims(t *testing.T) {
	e := Envelope{
		APIVersion:     "v1",
		ActionID:       "a1",
		IdempotencyKey: "k1",
		Action:         " payments.transfer.create ",
		Resource:       Resource{Type: " payment_account ", ID: " acct-1 "},
		Arguments:      Arguments{PayeeID: " tok_x ", AmountMinor: 100, Currency: "inr", PurposeCode: "vendor"},
	}
	e.Canonicalize()
	if e.Arguments.Currency != "INR" {
		t.Fatalf("currency not uppercased: %q", e.Arguments.Currency)
	}
	if e.Action != "payments.transfer.create" {
		t.Fatalf("action not trimmed: %q", e.Action)
	}
	if e.Resource.ID != "acct-1" || e.Arguments.PayeeID != "tok_x" {
		t.Fatalf("fields not trimmed")
	}
	if e.Arguments.PurposeCode != "VENDOR" {
		t.Fatalf("purpose not uppercased: %q", e.Arguments.PurposeCode)
	}
}

func TestValidateRejectsUnknownAction(t *testing.T) {
	e := Envelope{APIVersion: "v1", ActionID: "a", IdempotencyKey: "k", Action: "payments.wire.exotic",
		Resource: Resource{Type: "x", ID: "y"}, Arguments: Arguments{Currency: "INR"}}
	if err := e.Validate(); err != ErrUnknownAction {
		t.Fatalf("expected ErrUnknownAction, got %v", err)
	}
}

func TestValidateRejectsBadCurrency(t *testing.T) {
	e := Envelope{APIVersion: "v1", ActionID: "a", IdempotencyKey: "k", Action: "payments.transfer.create",
		Resource: Resource{Type: "x", ID: "y"}, Arguments: Arguments{Currency: "INRR"}}
	if err := e.Validate(); err != ErrSchema {
		t.Fatalf("expected ErrSchema, got %v", err)
	}
}

func TestRequestDigestStableAcrossFieldConstruction(t *testing.T) {
	a := Envelope{Action: "payments.transfer.create", Resource: Resource{Type: "t", ID: "i"},
		Arguments: Arguments{PayeeID: "p", AmountMinor: 500, Currency: "INR", PurposeCode: "X"}}
	b := a
	if a.RequestDigest() != b.RequestDigest() {
		t.Fatalf("digest not stable")
	}
	b.Arguments.AmountMinor = 501
	if a.RequestDigest() == b.RequestDigest() {
		t.Fatalf("digest should change when amount changes")
	}
}

func TestHashKeyDeterministic(t *testing.T) {
	if HashKey("agent-1", "key-1") != HashKey("agent-1", "key-1") {
		t.Fatalf("hash key not deterministic")
	}
	if HashKey("agent-1", "key-1") == HashKey("agent-2", "key-1") {
		t.Fatalf("hash key should differ per agent")
	}
}
