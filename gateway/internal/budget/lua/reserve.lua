-- AEGIS atomic budget reservation.
-- KEYS and ARGV are passed by the Go budget coordinator. All keys share the same
-- {tenant} hash tag so this executes atomically on one slot (single-instance MVP;
-- production must colocate or use a dedicated coordinator, see ADR-004 / FR-029).
--
-- KEYS[1] = idem key     idem:{tenant}:<agent>:<key_hash>
-- KEYS[2] = per-txn/window/shared budget hash: budget:{tenant}:<pool>:window
--           stored as hash fields: limit_minor, per_txn_max, shared_pool_max,
--                                  committed, held, window_seconds, window_start
-- KEYS[3] = reservation key   reservation:{tenant}:<reservation_id>
--
-- ARGV[1] = request_hash (sha256 of canonical body)
-- ARGV[2] = amount_minor (integer, as string)
-- ARGV[3] = currency
-- ARGV[4] = budget_currency (expected)
-- ARGV[5] = reservation_id (server-generated)
-- ARGV[6] = now_unix (server UTC seconds)
-- ARGV[7] = correlation_id
--
-- Returns a flat array: { status, reason, reservation_id, correlation_id }
--   status: RESERVED | REPLAY | CONFLICT | DENY
--   reason: reason code string (empty for RESERVED/REPLAY unless applicable)

local idem_key      = KEYS[1]
local budget_key    = KEYS[2]
local res_key       = KEYS[3]

local request_hash  = ARGV[1]
local amount        = tonumber(ARGV[2])
local currency      = ARGV[3]
local budget_ccy    = ARGV[4]
local reservation   = ARGV[5]
local now           = tonumber(ARGV[6])
local correlation   = ARGV[7]

-- ---- Idempotency check -------------------------------------------------------
if redis.call('EXISTS', idem_key) == 1 then
  local stored_hash = redis.call('HGET', idem_key, 'request_hash')
  if stored_hash ~= request_hash then
    return { 'CONFLICT', 'IDEMPOTENCY_CONFLICT', '', '' }
  end
  local prev_res  = redis.call('HGET', idem_key, 'reservation_id')
  local prev_corr = redis.call('HGET', idem_key, 'correlation_id')
  return { 'REPLAY', 'IDEMPOTENT_REPLAY', prev_res or '', prev_corr or '' }
end

-- ---- Validate amount ---------------------------------------------------------
if amount == nil then
  return { 'DENY', 'INVALID_AMOUNT', '', '' }
end
-- integer + positive
if amount ~= math.floor(amount) or amount <= 0 then
  return { 'DENY', 'INVALID_AMOUNT', '', '' }
end
-- signed 64-bit ceiling guard
if amount > 9223372036854775807 then
  return { 'DENY', 'AMOUNT_OVERFLOW', '', '' }
end

-- ---- Currency match ----------------------------------------------------------
if currency ~= budget_ccy then
  return { 'DENY', 'CURRENCY_BUDGET_MISMATCH', '', '' }
end

-- ---- Load budget state -------------------------------------------------------
if redis.call('EXISTS', budget_key) == 0 then
  return { 'DENY', 'BUDGET_STATE_UNAVAILABLE', '', '' }
end

local limit_minor    = tonumber(redis.call('HGET', budget_key, 'limit_minor'))
local per_txn_max    = tonumber(redis.call('HGET', budget_key, 'per_txn_max'))
local shared_max     = tonumber(redis.call('HGET', budget_key, 'shared_pool_max'))
local committed      = tonumber(redis.call('HGET', budget_key, 'committed')) or 0
local held           = tonumber(redis.call('HGET', budget_key, 'held')) or 0
local window_seconds = tonumber(redis.call('HGET', budget_key, 'window_seconds'))
local window_start   = tonumber(redis.call('HGET', budget_key, 'window_start')) or now

-- ---- Rolling window reset (fixed window semantics for MVP determinism) --------
-- If the window elapsed, reset the windowed committed/held counters to 0.
-- Unknown/dispatched exposure is tracked via held (it is only released on
-- reconciliation), so a window reset never drops still-held exposure.
if window_seconds and (now - window_start) >= window_seconds then
  window_start = now
  committed = 0
  redis.call('HSET', budget_key, 'committed', 0, 'window_start', window_start)
end

-- ---- Cap checks (per-txn, window, shared) ------------------------------------
if per_txn_max and amount > per_txn_max then
  return { 'DENY', 'PER_TXN_CAP_EXCEEDED', '', '' }
end

local exposure = committed + held
if limit_minor and (exposure + amount) > limit_minor then
  return { 'DENY', 'WINDOW_CAP_EXCEEDED', '', '' }
end
if shared_max and (exposure + amount) > shared_max then
  return { 'DENY', 'SHARED_POOL_CAP_EXCEEDED', '', '' }
end

-- ---- Commit the reservation (increment held) ---------------------------------
redis.call('HINCRBY', budget_key, 'held', amount)

-- reservation record
redis.call('HSET', res_key,
  'state', 'RESERVED',
  'amount', amount,
  'budget_key', budget_key,
  'currency', currency,
  'request_hash', request_hash,
  'correlation_id', correlation,
  'created_at', now)

-- idempotency record (hot copy; durable copy lives in Postgres)
redis.call('HSET', idem_key,
  'request_hash', request_hash,
  'reservation_id', reservation,
  'correlation_id', correlation,
  'created_at', now)
-- keep idem records for 24h
redis.call('EXPIRE', idem_key, 86400)

return { 'RESERVED', '', reservation, correlation }
