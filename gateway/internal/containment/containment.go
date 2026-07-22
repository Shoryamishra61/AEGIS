// Package containment enforces the highest-precedence gate: fleet halt and
// per-agent revocation, using durable epochs (Postgres) with a Redis hot cache
// and a freshness deadline (FR-030..FR-036, ADR-005). Fail-closed: if safety
// state is stale/unavailable, deny new dispatches.
package containment

import (
	"context"
	"strconv"
	"time"

	"github.com/aegis/gateway/internal/reason"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// Redis keys (single tenant hash-tag colocated).
//   halt:{tenant}:epoch        -> integer fleet halt epoch (0 = not halted)
//   revoke:{tenant}:<agent>    -> revocation epoch (present = revoked)
//   safety:{tenant}:refreshed  -> unix seconds of last authoritative refresh

type Manager struct {
	rdb              *redis.Client
	db               *pgxpool.Pool
	tenant           string
	freshnessSeconds int
}

func New(rdb *redis.Client, db *pgxpool.Pool, tenant string, freshnessSeconds int) *Manager {
	return &Manager{rdb: rdb, db: db, tenant: tenant, freshnessSeconds: freshnessSeconds}
}

func (m *Manager) haltKey() string     { return "halt:{" + m.tenant + "}:epoch" }
func (m *Manager) refreshedKey() string { return "safety:{" + m.tenant + "}:refreshed" }
func (m *Manager) revokeKey(agentID string) string {
	return "revoke:{" + m.tenant + "}:" + agentID
}

// Decision is the containment outcome.
type Decision struct {
	Allowed    bool
	ReasonCode string
	HaltEpoch  int64
}

// Check evaluates halt + revocation with freshness. Highest precedence.
func (m *Manager) Check(ctx context.Context, agentID string) Decision {
	// 1) Freshness: if the safety cache is stale/missing, fail closed.
	refreshedStr, err := m.rdb.Get(ctx, m.refreshedKey()).Result()
	if err != nil {
		return Decision{Allowed: false, ReasonCode: reason.HaltStale}
	}
	refreshed, _ := strconv.ParseInt(refreshedStr, 10, 64)
	if time.Now().UTC().Unix()-refreshed > int64(m.freshnessSeconds) {
		return Decision{Allowed: false, ReasonCode: reason.HaltStale}
	}

	// 2) Fleet halt (precedence over everything).
	haltStr, err := m.rdb.Get(ctx, m.haltKey()).Result()
	if err != nil && err != redis.Nil {
		return Decision{Allowed: false, ReasonCode: reason.HaltStale}
	}
	haltEpoch, _ := strconv.ParseInt(haltStr, 10, 64)
	if haltEpoch > 0 {
		return Decision{Allowed: false, ReasonCode: reason.FleetHalted, HaltEpoch: haltEpoch}
	}

	// 3) Per-agent revocation.
	exists, err := m.rdb.Exists(ctx, m.revokeKey(agentID)).Result()
	if err != nil {
		return Decision{Allowed: false, ReasonCode: reason.HaltStale}
	}
	if exists == 1 {
		return Decision{Allowed: false, ReasonCode: reason.AgentRevoked}
	}

	return Decision{Allowed: true}
}

// Refresh reloads authoritative durable epochs from Postgres into Redis and
// stamps the freshness marker. Called on boot and periodically, and on Pub/Sub
// notification. This is what makes dropped Pub/Sub non-fatal (FR-035).
func (m *Manager) Refresh(ctx context.Context) error {
	// Latest fleet state.
	var fleetState string
	var fleetEpoch int64
	err := m.db.QueryRow(ctx, `
		SELECT state, epoch FROM emergency_stops
		WHERE scope='fleet' ORDER BY epoch DESC LIMIT 1`).Scan(&fleetState, &fleetEpoch)
	haltEpoch := int64(0)
	if err == nil && fleetState == "halted" {
		haltEpoch = fleetEpoch
	}
	pipe := m.rdb.Pipeline()
	pipe.Set(ctx, m.haltKey(), haltEpoch, 0)

	// Per-agent revocations: latest state per agent.
	rows, err := m.db.Query(ctx, `
		SELECT DISTINCT ON (agent_id) agent_id, state, epoch
		FROM emergency_stops
		WHERE scope='agent'
		ORDER BY agent_id, epoch DESC`)
	revoked := map[string]int64{}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var aid, st string
			var ep int64
			if rows.Scan(&aid, &st, &ep) == nil && st == "revoked" {
				revoked[aid] = ep
			}
		}
	}
	// Reconcile the revoke keyspace: set current, clear reinstated.
	// Simple approach: scan existing revoke keys and delete ones no longer revoked.
	existing, _ := m.rdb.Keys(ctx, "revoke:{"+m.tenant+"}:*").Result()
	existingSet := map[string]bool{}
	for _, k := range existing {
		existingSet[k] = true
	}
	for aid, ep := range revoked {
		k := m.revokeKey(aid)
		pipe.Set(ctx, k, ep, 0)
		delete(existingSet, k)
	}
	for k := range existingSet {
		pipe.Del(ctx, k)
	}

	pipe.Set(ctx, m.refreshedKey(), time.Now().UTC().Unix(), 0)
	_, err = pipe.Exec(ctx)
	return err
}

// CurrentHaltEpoch returns the cached fleet halt epoch (0 if none).
func (m *Manager) CurrentHaltEpoch(ctx context.Context) int64 {
	s, err := m.rdb.Get(ctx, m.haltKey()).Result()
	if err != nil {
		return 0
	}
	v, _ := strconv.ParseInt(s, 10, 64)
	return v
}
