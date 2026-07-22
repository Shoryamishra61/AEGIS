// Package action defines the canonical action envelope, schema validation, and
// canonicalization used before policy evaluation and hashing (FR-006..FR-010).
package action

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strings"
)

// MaxPayloadBytes bounds the request body (FR-010).
const MaxPayloadBytes = 64 * 1024

// Envelope is the canonical action intent submitted by an agent.
type Envelope struct {
	APIVersion     string          `json:"api_version"`
	ActionID       string          `json:"action_id"`
	IdempotencyKey string          `json:"idempotency_key"`
	Action         string          `json:"action"`
	Resource       Resource        `json:"resource"`
	Arguments      Arguments       `json:"arguments"`
	DelegationID   string          `json:"delegation_id,omitempty"`
	ClientContext  json.RawMessage `json:"client_context,omitempty"`
}

type Resource struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type Arguments struct {
	PayeeID     string `json:"payee_id"`
	AmountMinor int64  `json:"amount_minor"`
	Currency    string `json:"currency"`
	PurposeCode string `json:"purpose_code"`
}

// registeredActions is the schema allowlist of governed actions (FR-007).
var registeredActions = map[string]bool{
	"payments.transfer.create": true,
}

var (
	ErrSchema        = errors.New("invalid action schema")
	ErrUnknownAction = errors.New("action not registered")
	ErrAmount        = errors.New("invalid amount")
)

// Validate enforces the schema allowlist and field-level constraints.
// Returns a stable reason-ish error; the caller maps to reason codes.
func (e *Envelope) Validate() error {
	if e.APIVersion == "" || e.ActionID == "" || e.IdempotencyKey == "" || e.Action == "" {
		return ErrSchema
	}
	if !registeredActions[e.Action] {
		return ErrUnknownAction
	}
	if e.Resource.Type == "" || e.Resource.ID == "" {
		return ErrSchema
	}
	if e.Arguments.Currency == "" || len(e.Arguments.Currency) != 3 {
		return ErrSchema
	}
	// Non-finite / overflow guards. amount_minor is int64 already; guard extremes.
	if e.Arguments.AmountMinor == math.MinInt64 {
		return ErrAmount
	}
	return nil
}

// Canonicalize normalizes identifiers, currency, and enums prior to policy eval
// and hashing (FR-008). Idempotent.
func (e *Envelope) Canonicalize() {
	e.Action = strings.TrimSpace(e.Action)
	e.Arguments.Currency = strings.ToUpper(strings.TrimSpace(e.Arguments.Currency))
	e.Arguments.PayeeID = strings.TrimSpace(e.Arguments.PayeeID)
	e.Resource.ID = strings.TrimSpace(e.Resource.ID)
	e.Resource.Type = strings.TrimSpace(e.Resource.Type)
	e.Arguments.PurposeCode = strings.ToUpper(strings.TrimSpace(e.Arguments.PurposeCode))
}

// RequestDigest returns a deterministic sha256 over the canonical, security-
// relevant fields. Used for idempotency binding (same key + different body =>
// conflict). Field ordering is fixed and independent of JSON key order.
func (e *Envelope) RequestDigest() string {
	parts := []string{
		"action=" + e.Action,
		"resource_type=" + e.Resource.Type,
		"resource_id=" + e.Resource.ID,
		"payee=" + e.Arguments.PayeeID,
		"amount=" + itoa(e.Arguments.AmountMinor),
		"currency=" + e.Arguments.Currency,
		"purpose=" + e.Arguments.PurposeCode,
	}
	sort.Strings(parts)
	h := sha256.Sum256([]byte(strings.Join(parts, "&")))
	return hex.EncodeToString(h[:])
}

func itoa(n int64) string {
	neg := n < 0
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	u := uint64(n)
	if neg {
		u = uint64(-n)
	}
	for u > 0 {
		i--
		b[i] = byte('0' + u%10)
		u /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

// HashKey derives the idempotency key hash used as the Redis idem key component.
func HashKey(agentID, idempotencyKey string) string {
	h := sha256.Sum256([]byte(agentID + "|" + idempotencyKey))
	return hex.EncodeToString(h[:])
}
