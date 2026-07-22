// Package authn verifies agent workload credentials (dev JWT/HMAC stand-in for
// OIDC/SPIFFE) and maps the verified subject to a registered agent (FR-001,
// FR-002, FR-004). Identity is derived ONLY from the verified token, never the
// request body.
package authn

import (
	"context"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrNoAgent      = errors.New("no registered agent for subject")
)

// Agent is the trusted principal loaded from the registry.
type Agent struct {
	ID            string
	Status        string // pending | active | disabled
	RiskTier      string
	Environment   string
	BudgetPoolID  string
	PoolCurrency  string
	PolicyVersion int64
	WorkloadSub   string
}

// BudgetPoolCurrency returns the ISO 4217 currency of the assigned pool.
func (a *Agent) BudgetPoolCurrency() string { return a.PoolCurrency }

type Authenticator struct {
	secret []byte
	db     *pgxpool.Pool
}

func New(secret string, db *pgxpool.Pool) *Authenticator {
	return &Authenticator{secret: []byte(secret), db: db}
}

// Verify parses and validates the bearer token, then resolves the agent.
// Returns the trusted Agent or an error. The token's `sub` claim is authoritative.
func (a *Authenticator) Verify(ctx context.Context, bearer string) (*Agent, error) {
	if bearer == "" {
		return nil, ErrInvalidToken
	}
	tok, err := jwt.Parse(bearer, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return a.secret, nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithLeeway(5*time.Second))
	if err != nil || !tok.Valid {
		return nil, ErrInvalidToken
	}
	claims, ok := tok.Claims.(jwt.MapClaims)
	if !ok {
		return nil, ErrInvalidToken
	}
	sub, _ := claims["sub"].(string)
	if sub == "" {
		return nil, ErrInvalidToken
	}
	return a.lookupBySub(ctx, sub)
}

func (a *Authenticator) lookupBySub(ctx context.Context, sub string) (*Agent, error) {
	const q = `SELECT a.id, a.status, a.risk_tier, a.environment,
	                  COALESCE(a.budget_pool_id,''), COALESCE(a.policy_version,0), a.workload_sub,
	                  COALESCE(p.currency,'')
	           FROM agents a
	           LEFT JOIN budget_pools p ON p.id = a.budget_pool_id
	           WHERE a.workload_sub = $1`
	row := a.db.QueryRow(ctx, q, sub)
	var ag Agent
	if err := row.Scan(&ag.ID, &ag.Status, &ag.RiskTier, &ag.Environment,
		&ag.BudgetPoolID, &ag.PolicyVersion, &ag.WorkloadSub, &ag.PoolCurrency); err != nil {
		return nil, ErrNoAgent
	}
	return &ag, nil
}
