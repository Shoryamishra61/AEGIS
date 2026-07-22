"""Break-glass fleet halt CLI (P1 FR-037).

Independent of the dashboard/API auth path: writes the durable halt epoch directly
to Postgres and sets the Redis hot cache + notify. Use when the control-plane API is
unavailable. Every break-glass action is audited (append to the hash chain).

Usage (inside the control-plane image / network):
    python -m app.breakglass halt   --reason "incident-123" --actor oncall
    python -m app.breakglass resume --reason "cleared-123"   --actor oncall
    python -m app.breakglass status
"""
import argparse
import asyncio
import json
import time

import asyncpg
import redis.asyncio as aioredis

from .audit_chain import GENESIS, compute_event_hash
from .config import settings


async def _append_audit(con, *, event_type, correlation_id, decision, reason_code, payload):
    prev = await con.fetchval(
        "SELECT event_hash FROM audit_events WHERE chain_id='default' ORDER BY seq DESC LIMIT 1")
    prev_hash = prev or GENESIS
    row = {"event_type": event_type, "correlation_id": correlation_id, "decision": decision,
           "reason_code": reason_code, "agent_id": "", "policy_version": 0,
           "payload": payload, "prev_hash": prev_hash}
    event_hash = compute_event_hash("default", row)
    await con.execute(
        """INSERT INTO audit_events (chain_id,event_type,correlation_id,idempotency_key,agent_id,
             decision,reason_code,policy_version,payload,prev_hash,event_hash)
           VALUES ('default',$1,$2,NULL,NULL,$3,$4,NULL,$5::jsonb,$6,$7)""",
        event_type, correlation_id, decision, reason_code,
        json.dumps(payload, separators=(",", ":"), sort_keys=True), prev_hash, event_hash)


async def _halt(reason: str, actor: str, resume: bool):
    con = await asyncpg.connect(settings.pg_dsn())
    r = aioredis.Redis(host=settings.redis_host, port=settings.redis_port, decode_responses=True)
    try:
        state = "resumed" if resume else "halted"
        async with con.transaction():
            epoch = await con.fetchval(
                "INSERT INTO emergency_stops (scope,agent_id,state,reason,actor) "
                "VALUES ('fleet',NULL,$1,$2,$3) RETURNING epoch", state, reason, f"breakglass:{actor}")
            await _append_audit(con, event_type="EMERGENCY", correlation_id=f"breakglass-{state}-{epoch}",
                                decision=("FLEET_RESUME" if resume else "FLEET_HALT"),
                                reason_code=("FLEET_RESUMED" if resume else "FLEET_HALTED"),
                                payload={"actor": f"breakglass:{actor}", "reason": reason, "epoch": epoch,
                                         "break_glass": True})
        await r.set(f"halt:{{{settings.tenant_id}}}:epoch", 0 if resume else epoch)
        await r.set(f"safety:{{{settings.tenant_id}}}:refreshed", int(time.time()))
        await r.publish(db_channel(), json.dumps({"type": ("resume" if resume else "halt"), "epoch": epoch}))
        print(f"[break-glass] fleet {state} epoch={epoch} actor={actor}")
    finally:
        await con.close()
        await r.aclose()


async def _status():
    con = await asyncpg.connect(settings.pg_dsn())
    try:
        row = await con.fetchrow(
            "SELECT state,epoch,reason,actor,created_at FROM emergency_stops "
            "WHERE scope='fleet' ORDER BY epoch DESC LIMIT 1")
        print(json.dumps({k: (str(v)) for k, v in dict(row).items()} if row else {"state": "none"}, indent=2))
    finally:
        await con.close()


def db_channel() -> str:
    return f"control:{{{settings.tenant_id}}}:events"


def main():
    p = argparse.ArgumentParser(description="AEGIS break-glass halt CLI")
    sub = p.add_subparsers(dest="cmd", required=True)
    h = sub.add_parser("halt"); h.add_argument("--reason", required=True); h.add_argument("--actor", default="oncall")
    rs = sub.add_parser("resume"); rs.add_argument("--reason", required=True); rs.add_argument("--actor", default="oncall")
    sub.add_parser("status")
    args = p.parse_args()
    if args.cmd == "halt":
        asyncio.run(_halt(args.reason, args.actor, resume=False))
    elif args.cmd == "resume":
        asyncio.run(_halt(args.reason, args.actor, resume=True))
    else:
        asyncio.run(_status())


if __name__ == "__main__":
    main()
