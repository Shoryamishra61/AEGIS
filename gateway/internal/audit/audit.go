// Package audit writes append-only, hash-chained decision/outcome evidence to
// PostgreSQL (FR-039..FR-044, ADR-006, ADR-007). The decision record MUST be
// durably appended before dispatch. Chain: event_hash = sha256(canonical || prev).
package audit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
)

const genesisHash = "sha256:0000000000000000000000000000000000000000000000000000000000000000"

type Writer struct {
	db      *pgxpool.Pool
	chainID string
	mu      sync.Mutex // serialize appends per process to keep chain linkage correct
}

func NewWriter(db *pgxpool.Pool, chainID string) *Writer {
	return &Writer{db: db, chainID: chainID}
}

// Event is the redacted, canonical event body.
type Event struct {
	EventType      string                 `json:"event_type"`
	CorrelationID  string                 `json:"correlation_id"`
	IdempotencyKey string                 `json:"idempotency_key,omitempty"`
	AgentID        string                 `json:"agent_id,omitempty"`
	Decision       string                 `json:"decision,omitempty"`
	ReasonCode     string                 `json:"reason_code,omitempty"`
	PolicyVersion  int64                  `json:"policy_version,omitempty"`
	Payload        map[string]interface{} `json:"payload"`
}

// Append writes one event, linking it to the current chain tip. Returns the new
// event hash and sequence. This is a synchronous, durable operation.
func (w *Writer) Append(ctx context.Context, e Event) (string, int64, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	tx, err := w.db.Begin(ctx)
	if err != nil {
		return "", 0, err
	}
	defer tx.Rollback(ctx)

	// Read current tip (highest seq) for this chain, locking read.
	var prevHash string
	err = tx.QueryRow(ctx, `
		SELECT event_hash FROM audit_events
		WHERE chain_id=$1 ORDER BY seq DESC LIMIT 1`, w.chainID).Scan(&prevHash)
	if err != nil {
		// no rows => genesis
		prevHash = genesisHash
	}

	payloadJSON, err := json.Marshal(e.Payload)
	if err != nil {
		return "", 0, err
	}

	canonical := canonicalString(w.chainID, e, string(payloadJSON), prevHash)
	sum := sha256.Sum256([]byte(canonical))
	eventHash := "sha256:" + hex.EncodeToString(sum[:])

	var seq int64
	err = tx.QueryRow(ctx, `
		INSERT INTO audit_events
		  (chain_id, event_type, correlation_id, idempotency_key, agent_id,
		   decision, reason_code, policy_version, payload, prev_hash, event_hash)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING seq`,
		w.chainID, e.EventType, e.CorrelationID, nullStr(e.IdempotencyKey),
		nullStr(e.AgentID), nullStr(e.Decision), nullStr(e.ReasonCode),
		nullInt(e.PolicyVersion), payloadJSON, prevHash, eventHash,
	).Scan(&seq)
	if err != nil {
		return "", 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", 0, err
	}
	return eventHash, seq, nil
}

// canonicalString is the documented, versioned canonical serialization used for
// hashing (SRS 11.4). Order is fixed and independent of map ordering.
func canonicalString(chainID string, e Event, payloadJSON, prevHash string) string {
	return fmt.Sprintf("v1|%s|%s|%s|%s|%s|%s|%d|%s|%s",
		chainID, e.EventType, e.CorrelationID, e.Decision, e.ReasonCode,
		e.AgentID, e.PolicyVersion, payloadJSON, prevHash)
}

func nullStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
func nullInt(n int64) interface{} {
	if n == 0 {
		return nil
	}
	return n
}
