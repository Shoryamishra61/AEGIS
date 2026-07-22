-- AEGIS reservation transition: commit / release / unknown.
-- Atomic and idempotent. Repeated terminal transitions return the stored result.
--
-- KEYS[1] = reservation key   reservation:{tenant}:<reservation_id>
-- KEYS[2] = budget hash key    budget:{tenant}:<pool>:window
-- ARGV[1] = target state: COMMITTED | RELEASED | UNKNOWN | DISPATCHED
-- ARGV[2] = now_unix
--
-- Returns { status, current_state }
--   status: OK | NOOP | ILLEGAL | MISSING

local res_key    = KEYS[1]
local budget_key = KEYS[2]
local target     = ARGV[1]
local now        = tonumber(ARGV[2])

if redis.call('EXISTS', res_key) == 0 then
  return { 'MISSING', '' }
end

local state  = redis.call('HGET', res_key, 'state')
local amount = tonumber(redis.call('HGET', res_key, 'amount')) or 0

-- Idempotent terminal transitions: if already in target, no-op.
if state == target then
  return { 'NOOP', state }
end

-- Legal transitions (state machine per SRS 7.2):
--   RESERVED   -> DISPATCHED | RELEASED
--   DISPATCHED -> COMMITTED | RELEASED | UNKNOWN
--   UNKNOWN    -> COMMITTED | RELEASED   (reconciliation)
local function illegal()
  return { 'ILLEGAL', state }
end

if target == 'DISPATCHED' then
  if state ~= 'RESERVED' then return illegal() end
  redis.call('HSET', res_key, 'state', 'DISPATCHED', 'dispatched_at', now)
  return { 'OK', 'DISPATCHED' }
end

if target == 'RELEASED' then
  -- releasing subtracts held exposure; allowed from RESERVED, DISPATCHED, UNKNOWN
  if state ~= 'RESERVED' and state ~= 'DISPATCHED' and state ~= 'UNKNOWN' then return illegal() end
  redis.call('HINCRBY', budget_key, 'held', -amount)
  redis.call('HSET', res_key, 'state', 'RELEASED', 'finalized_at', now)
  return { 'OK', 'RELEASED' }
end

if target == 'COMMITTED' then
  -- committing moves held -> committed; allowed from DISPATCHED or UNKNOWN
  if state ~= 'DISPATCHED' and state ~= 'UNKNOWN' then return illegal() end
  redis.call('HINCRBY', budget_key, 'held', -amount)
  redis.call('HINCRBY', budget_key, 'committed', amount)
  redis.call('HSET', res_key, 'state', 'COMMITTED', 'finalized_at', now)
  return { 'OK', 'COMMITTED' }
end

if target == 'UNKNOWN' then
  -- unknown retains held exposure; only reachable from DISPATCHED
  if state ~= 'DISPATCHED' then return illegal() end
  redis.call('HSET', res_key, 'state', 'UNKNOWN', 'unknown_since', now)
  return { 'OK', 'UNKNOWN' }
end

return illegal()
