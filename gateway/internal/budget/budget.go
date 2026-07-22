// Package budget is the Redis-backed atomic budget coordinator. It loads the
// reservation Lua scripts and exposes Reserve + state transitions
// (FR-020..FR-029, ADR-004). All money is integer minor units.
package budget

import (
	"context"
	_ "embed"
	"errors"
	"time"

	"github.com/aegis/gateway/internal/reason"
	"github.com/oklog/ulid/v2"
	"github.com/redis/go-redis/v9"
)

//go:embed lua/reserve.lua
var reserveScriptSrc string

//go:embed lua/transition.lua
var transitionScriptSrc string

type Coordinator struct {
	rdb        *redis.Client
	tenant     string
	reserve    *redis.Script
	transition *redis.Script
}

func New(rdb *redis.Client, tenant string) *Coordinator {
	return &Coordinator{
		rdb:        rdb,
		tenant:     tenant,
		reserve:    redis.NewScript(reserveScriptSrc),
		transition: redis.NewScript(transitionScriptSrc),
	}
}

// ReserveResult captures the atomic reservation outcome.
type ReserveResult struct {
	Status        string // RESERVED | REPLAY | CONFLICT | DENY
	ReasonCode    string
	ReservationID string
	CorrelationID string
}

func (c *Coordinator) idemKey(agentID, keyHash string) string {
	return "idem:{" + c.tenant + "}:" + agentID + ":" + keyHash
}
func (c *Coordinator) budgetKey(poolID string) string {
	return "budget:{" + c.tenant + "}:" + poolID + ":window"
}
func (c *Coordinator) reservationKey(id string) string {
	return "reservation:{" + c.tenant + "}:" + id
}

// EnsureBudget initialises a budget window hash if absent (idempotent). Called by
// the boot loader from Postgres pool config.
func (c *Coordinator) EnsureBudget(ctx context.Context, poolID string, limitMinor, perTxnMax, sharedMax int64, windowSeconds int, currency string) error {
	key := c.budgetKey(poolID)
	now := time.Now().UTC().Unix()
	// HSETNX-style init: only set fields if the hash does not already exist.
	exists, err := c.rdb.Exists(ctx, key).Result()
	if err != nil {
		return err
	}
	if exists == 1 {
		// refresh the caps/limits (config may have changed) but preserve counters
		return c.rdb.HSet(ctx, key,
			"limit_minor", limitMinor,
			"per_txn_max", perTxnMax,
			"shared_pool_max", sharedMax,
			"window_seconds", windowSeconds,
			"currency", currency,
		).Err()
	}
	return c.rdb.HSet(ctx, key,
		"limit_minor", limitMinor,
		"per_txn_max", perTxnMax,
		"shared_pool_max", sharedMax,
		"committed", 0,
		"held", 0,
		"window_seconds", windowSeconds,
		"window_start", now,
		"currency", currency,
	).Err()
}

// Reserve atomically reserves against all applicable caps.
func (c *Coordinator) Reserve(ctx context.Context, agentID, keyHash, requestHash string, amount int64, currency, budgetCurrency, poolID, correlationID string) (*ReserveResult, error) {
	resID := "res_" + ulid.Make().String()
	keys := []string{
		c.idemKey(agentID, keyHash),
		c.budgetKey(poolID),
		c.reservationKey(resID),
	}
	args := []interface{}{
		requestHash,
		amount,
		currency,
		budgetCurrency,
		resID,
		time.Now().UTC().Unix(),
		correlationID,
	}
	raw, err := c.reserve.Run(ctx, c.rdb, keys, args...).Result()
	if err != nil {
		return nil, err
	}
	arr, ok := raw.([]interface{})
	if !ok || len(arr) < 4 {
		return nil, errors.New("unexpected reserve reply")
	}
	res := &ReserveResult{
		Status:        toStr(arr[0]),
		ReasonCode:    toStr(arr[1]),
		ReservationID: toStr(arr[2]),
		CorrelationID: toStr(arr[3]),
	}
	if res.Status == "RESERVED" {
		res.ReservationID = resID
		res.CorrelationID = correlationID
	}
	return res, nil
}

// Transition moves a reservation to a new state atomically.
// target: DISPATCHED | COMMITTED | RELEASED | UNKNOWN
func (c *Coordinator) Transition(ctx context.Context, reservationID, poolID, target string) (string, string, error) {
	keys := []string{
		c.reservationKey(reservationID),
		c.budgetKey(poolID),
	}
	raw, err := c.transition.Run(ctx, c.rdb, keys, target, time.Now().UTC().Unix()).Result()
	if err != nil {
		return "", "", err
	}
	arr, ok := raw.([]interface{})
	if !ok || len(arr) < 2 {
		return "", "", errors.New("unexpected transition reply")
	}
	return toStr(arr[0]), toStr(arr[1]), nil
}

// MapDenyReason maps a Lua deny reason string to the canonical reason code.
func MapDenyReason(s string) string {
	switch s {
	case "INVALID_AMOUNT":
		return reason.InvalidAmount
	case "AMOUNT_OVERFLOW":
		return reason.AmountOverflow
	case "CURRENCY_BUDGET_MISMATCH":
		return reason.CurrencyBudgetMismatch
	case "PER_TXN_CAP_EXCEEDED":
		return reason.PerTxnCapExceeded
	case "WINDOW_CAP_EXCEEDED":
		return reason.WindowCapExceeded
	case "SHARED_POOL_CAP_EXCEEDED":
		return reason.SharedPoolCapExceeded
	case "BUDGET_STATE_UNAVAILABLE":
		return reason.BudgetStateUnavailable
	case "IDEMPOTENCY_CONFLICT":
		return reason.IdempotencyConflict
	default:
		return s
	}
}

func toStr(v interface{}) string {
	switch t := v.(type) {
	case string:
		return t
	case []byte:
		return string(t)
	case nil:
		return ""
	default:
		return ""
	}
}
