// AEGIS gateway entrypoint. Boots dependencies, loads the active policy version
// and budget config, registers itself, refreshes containment state, subscribes to
// control Pub/Sub, and serves the enforcement API. Fail-closed readiness.
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	"github.com/aegis/gateway/internal/audit"
	"github.com/aegis/gateway/internal/authn"
	"github.com/aegis/gateway/internal/backend"
	"github.com/aegis/gateway/internal/budget"
	"github.com/aegis/gateway/internal/config"
	"github.com/aegis/gateway/internal/containment"
	"github.com/aegis/gateway/internal/policy"
	"github.com/aegis/gateway/internal/server"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()

	// Distroless-friendly self healthcheck: `/gateway -healthcheck` hits /readyz.
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		resp, err := http.Get("http://127.0.0.1:" + itoa(cfg.GatewayPort) + "/readyz")
		if err != nil || resp.StatusCode != 200 {
			os.Exit(1)
		}
		os.Exit(0)
	}

	// --- Postgres ---
	var db *pgxpool.Pool
	var err error
	for i := 0; i < 30; i++ {
		db, err = pgxpool.New(ctx, cfg.PGDSN())
		if err == nil {
			if pingErr := db.Ping(ctx); pingErr == nil {
				break
			}
		}
		log.Printf("[gateway] waiting for postgres (%d): %v", i, err)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		log.Fatalf("[gateway] postgres unavailable: %v", err)
	}
	defer db.Close()

	// --- Redis ---
	rdb := redis.NewClient(&redis.Options{Addr: cfg.RedisAddr()})
	for i := 0; i < 30; i++ {
		if pingErr := rdb.Ping(ctx).Err(); pingErr == nil {
			break
		}
		log.Printf("[gateway] waiting for redis (%d)", i)
		time.Sleep(2 * time.Second)
	}

	// --- Load active policy version + data (from Postgres system of record) ---
	var polVer int64
	var dataJSON []byte
	err = db.QueryRow(ctx, `SELECT version, data_json FROM policy_versions WHERE status='active' ORDER BY version DESC LIMIT 1`).Scan(&polVer, &dataJSON)
	if err != nil {
		log.Fatalf("[gateway] no active policy version: %v", err)
	}
	allowedPayees := extractPayees(dataJSON)
	pol, err := policy.New(ctx, polVer, allowedPayees)
	if err != nil {
		log.Fatalf("[gateway] policy load failed: %v", err)
	}
	log.Printf("[gateway] active policy version %d loaded (%d allowed payees)", polVer, len(allowedPayees))

	// --- Budget coordinator + init pools ---
	bud := budget.New(rdb, cfg.TenantID)
	if err := initBudgets(ctx, db, bud); err != nil {
		log.Fatalf("[gateway] budget init failed: %v", err)
	}

	// --- Containment: refresh authoritative epochs before ready ---
	cm := containment.New(rdb, db, cfg.TenantID, cfg.FreshnessSeconds)
	if err := cm.Refresh(ctx); err != nil {
		log.Fatalf("[gateway] containment refresh failed: %v", err)
	}

	// --- Audit + backend + authn ---
	aud := audit.NewWriter(db, "default")
	be := backend.New(cfg.BackendBaseURL, cfg.BackendGatewayCredential)
	auth := authn.New(cfg.AgentJWTSecret, db)

	// --- Register gateway + heartbeat + periodic refresh ---
	registerGateway(ctx, db, cfg.GatewayID)
	go refreshLoop(ctx, cm, db, cfg.GatewayID)
	go subscribeControl(ctx, rdb, cfg.TenantID, cm)

	ready := &atomic.Bool{}
	ready.Store(true)

	srv := server.New(server.Deps{
		Auth:        auth,
		Containment: cm,
		Policy:      pol,
		Budget:      bud,
		Audit:       aud,
		Backend:     be,
		GatewayID:   cfg.GatewayID,
		Ready:       ready,
	})

	addr := ":" + itoa(cfg.GatewayPort)
	log.Printf("[gateway] %s listening on %s", cfg.GatewayID, addr)
	if err := http.ListenAndServe(addr, srv.Routes()); err != nil {
		log.Fatalf("[gateway] server error: %v", err)
	}
}

func initBudgets(ctx context.Context, db *pgxpool.Pool, bud *budget.Coordinator) error {
	rows, err := db.Query(ctx, `SELECT id, currency, per_txn_max, window_max, shared_pool_max, window_seconds FROM budget_pools`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, ccy string
		var perTxn, windowMax, sharedMax int64
		var windowSeconds int
		if err := rows.Scan(&id, &ccy, &perTxn, &windowMax, &sharedMax, &windowSeconds); err != nil {
			return err
		}
		if err := bud.EnsureBudget(ctx, id, windowMax, perTxn, sharedMax, windowSeconds, ccy); err != nil {
			return err
		}
		log.Printf("[gateway] budget pool %s initialised (%s per_txn=%d window=%d shared=%d)", id, ccy, perTxn, windowMax, sharedMax)
	}
	return nil
}

func registerGateway(ctx context.Context, db *pgxpool.Pool, id string) {
	_, err := db.Exec(ctx, `
		INSERT INTO gateways (id, last_seen_at, started_at)
		VALUES ($1, now(), now())
		ON CONFLICT (id) DO UPDATE SET last_seen_at=now(), started_at=now()`, id)
	if err != nil {
		log.Printf("[gateway] register warning: %v", err)
	}
}

func refreshLoop(ctx context.Context, cm *containment.Manager, db *pgxpool.Pool, id string) {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for range t.C {
		if err := cm.Refresh(ctx); err != nil {
			log.Printf("[gateway] refresh error: %v", err)
		}
		// heartbeat + ack current halt epoch
		epoch := cm.CurrentHaltEpoch(ctx)
		_, _ = db.Exec(ctx, `UPDATE gateways SET last_seen_at=now(), acked_epoch=$2 WHERE id=$1`, id, epoch)
	}
}

// subscribeControl accelerates halt/revoke application via Pub/Sub. Pub/Sub is an
// accelerator only; refreshLoop guarantees eventual convergence if messages drop.
func subscribeControl(ctx context.Context, rdb *redis.Client, tenant string, cm *containment.Manager) {
	sub := rdb.Subscribe(ctx, "control:{"+tenant+"}:events")
	ch := sub.Channel()
	for range ch {
		if err := cm.Refresh(ctx); err != nil {
			log.Printf("[gateway] pubsub refresh error: %v", err)
		}
	}
}

func extractPayees(dataJSON []byte) []string {
	type d struct {
		AllowedPayees []string `json:"allowed_payees"`
	}
	var parsed d
	_ = json.Unmarshal(dataJSON, &parsed)
	return parsed.AllowedPayees
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [12]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
