"""AEGIS Control Plane API (FastAPI).

Provides operator/admin/auditor surfaces:
  - Agents CRUD (optimistic concurrency via version token)
  - Budget pools read/update
  - Policy versions: list, simulate diff (candidate vs active), activate, rollback
  - Emergency stops: fleet halt/resume, per-agent revoke/reinstate (durable epochs + Pub/Sub)
  - Gateways registry + convergence (acked epoch vs current)
  - Audit query + integrity verification + checkpoint
  - Live event stream (SSE)

Durable safety writes go to Postgres (source of truth the gateway reads); a Pub/Sub
notify accelerates convergence but is not required for correctness.
"""
import asyncio
import json
import time
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from . import db
from .audit_chain import GENESIS, compute_event_hash, sign_checkpoint
from .auth import (ROLE_ADMIN, ROLE_AUDITOR, ROLE_OPERATOR, Principal,
                   current_principal, require_roles)
from .config import settings

app = FastAPI(title="AEGIS Control Plane", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def _startup():
    for _ in range(30):
        try:
            await db.connect()
            return
        except Exception:
            await asyncio.sleep(2)
    await db.connect()  # final attempt, let it raise


@app.on_event("shutdown")
async def _shutdown():
    await db.disconnect()


# --------------------------------------------------------------------------- #
# Health
# --------------------------------------------------------------------------- #
@app.get("/healthz")
async def healthz():
    return {"status": "alive"}


@app.get("/readyz")
async def readyz():
    try:
        async with db.pool().acquire() as con:
            await con.fetchval("SELECT 1")
        await db.redis().ping()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"not ready: {exc}")
    return {"status": "ready", "single_admin_mode": settings.single_admin_mode}


@app.get("/v1/meta")
async def meta(_: Principal = Depends(current_principal)):
    return {
        "tenant_id": settings.tenant_id,
        "single_admin_mode": settings.single_admin_mode,
        "single_admin_notice": (
            "MVP single-admin mode: dual-control/approval workflow is DEFERRED. "
            "A single admin may activate policy and halt/resume. All such actions are audited."
        ),
    }


# --------------------------------------------------------------------------- #
# Audit event helper (config/emergency events are chained too)
# --------------------------------------------------------------------------- #
async def append_audit(con, *, event_type: str, correlation_id: str, agent_id: str = "",
                       decision: str = "", reason_code: str = "", policy_version: int = 0,
                       payload: dict | None = None) -> tuple[str, int]:
    payload = payload or {}
    prev = await con.fetchval(
        "SELECT event_hash FROM audit_events WHERE chain_id='default' ORDER BY seq DESC LIMIT 1"
    )
    prev_hash = prev or GENESIS
    row = {
        "event_type": event_type,
        "correlation_id": correlation_id,
        "decision": decision,
        "reason_code": reason_code,
        "agent_id": agent_id,
        "policy_version": policy_version,
        "payload": payload,
        "prev_hash": prev_hash,
    }
    event_hash = compute_event_hash("default", row)
    seq = await con.fetchval(
        """INSERT INTO audit_events
             (chain_id,event_type,correlation_id,idempotency_key,agent_id,decision,
              reason_code,policy_version,payload,prev_hash,event_hash)
           VALUES ('default',$1,$2,NULL,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING seq""",
        event_type, correlation_id, agent_id or None, decision or None,
        reason_code or None, policy_version or None,
        json.dumps(payload, separators=(",", ":"), sort_keys=True), prev_hash, event_hash,
    )
    return event_hash, seq


async def publish_control(event: dict):
    try:
        await db.redis().publish(db.control_channel(), json.dumps(event))
    except Exception:
        # Pub/Sub is an accelerator; durable epoch is the source of truth.
        pass


# --------------------------------------------------------------------------- #
# Agents
# --------------------------------------------------------------------------- #
class AgentUpdate(BaseModel):
    status: Optional[str] = Field(default=None, pattern="^(pending|active|disabled)$")
    risk_tier: Optional[str] = Field(default=None, pattern="^(low|medium|high|critical)$")
    version: int  # optimistic concurrency token


@app.get("/v1/agents")
async def list_agents(_: Principal = Depends(current_principal)):
    async with db.pool().acquire() as con:
        rows = await con.fetch(
            """SELECT id,display_name,owner,risk_tier,environment,status,workload_sub,
                      budget_pool_id,policy_version,version,created_at,updated_at
               FROM agents ORDER BY id"""
        )
    return [dict(r) for r in rows]


@app.get("/v1/agents/{agent_id}")
async def get_agent(agent_id: str, _: Principal = Depends(current_principal)):
    async with db.pool().acquire() as con:
        r = await con.fetchrow("SELECT * FROM agents WHERE id=$1", agent_id)
    if not r:
        raise HTTPException(status_code=404, detail="agent not found")
    return dict(r)


@app.patch("/v1/agents/{agent_id}")
async def update_agent(agent_id: str, body: AgentUpdate,
                       principal: Principal = Depends(require_roles(ROLE_ADMIN))):
    async with db.pool().acquire() as con:
        async with con.transaction():
            cur = await con.fetchrow("SELECT status,risk_tier,version FROM agents WHERE id=$1 FOR UPDATE", agent_id)
            if not cur:
                raise HTTPException(status_code=404, detail="agent not found")
            if cur["version"] != body.version:
                raise HTTPException(status_code=409, detail="version conflict (stale write)")
            new_status = body.status or cur["status"]
            new_tier = body.risk_tier or cur["risk_tier"]
            await con.execute(
                "UPDATE agents SET status=$1,risk_tier=$2,version=version+1,updated_at=now() WHERE id=$3",
                new_status, new_tier, agent_id,
            )
            await append_audit(con, event_type="CONFIG", correlation_id=f"cfg-agent-{agent_id}-{int(time.time())}",
                               agent_id=agent_id, decision="CONFIG_CHANGE", reason_code="AGENT_UPDATED",
                               payload={"actor": principal.subject, "status": new_status, "risk_tier": new_tier})
    return {"status": "updated", "agent_id": agent_id, "version": body.version + 1}


# --------------------------------------------------------------------------- #
# Budgets
# --------------------------------------------------------------------------- #
@app.get("/v1/budgets")
async def list_budgets(_: Principal = Depends(current_principal)):
    async with db.pool().acquire() as con:
        rows = await con.fetch("SELECT * FROM budget_pools ORDER BY id")
        out = []
        for r in rows:
            d = dict(r)
            # live usage from redis
            key = f"budget:{{{settings.tenant_id}}}:{r['id']}:window"
            h = await db.redis().hgetall(key)
            d["live"] = {
                "committed": int(h.get("committed", 0)),
                "held": int(h.get("held", 0)),
            } if h else {"committed": 0, "held": 0}
            out.append(d)
    return out


# --------------------------------------------------------------------------- #
# Policies
# --------------------------------------------------------------------------- #
@app.get("/v1/policies")
async def list_policies(_: Principal = Depends(current_principal)):
    async with db.pool().acquire() as con:
        rows = await con.fetch(
            "SELECT version,label,status,created_by,created_at,activated_at FROM policy_versions ORDER BY version DESC"
        )
    return [dict(r) for r in rows]


@app.get("/v1/policies/{version}")
async def get_policy(version: int, _: Principal = Depends(current_principal)):
    async with db.pool().acquire() as con:
        r = await con.fetchrow("SELECT * FROM policy_versions WHERE version=$1", version)
    if not r:
        raise HTTPException(status_code=404, detail="policy version not found")
    return dict(r)


class SimulateRequest(BaseModel):
    # candidate decision set vs active: caller supplies sample intents + expected effects
    samples: list[dict]


@app.post("/v1/policies/{version}/simulate")
async def simulate_policy(version: int, body: SimulateRequest,
                          _: Principal = Depends(require_roles(ROLE_ADMIN, ROLE_OPERATOR))):
    """Policy simulation diff (P1 FR-017).

    Compares the candidate version's stored expected outcomes against the active
    version. For the MVP the diff is computed over caller-provided sample intents
    with their expected effects under active vs candidate, surfacing changed rows.
    """
    async with db.pool().acquire() as con:
        cand = await con.fetchrow("SELECT version,label FROM policy_versions WHERE version=$1", version)
        active = await con.fetchrow("SELECT version,label FROM policy_versions WHERE status='active'")
    if not cand:
        raise HTTPException(status_code=404, detail="candidate version not found")
    diff = []
    for s in body.samples:
        active_effect = s.get("active_effect")
        candidate_effect = s.get("candidate_effect")
        if active_effect != candidate_effect:
            diff.append({
                "intent": s.get("intent"),
                "active_effect": active_effect,
                "candidate_effect": candidate_effect,
            })
    return {
        "candidate_version": cand["version"],
        "active_version": active["version"] if active else None,
        "changed_count": len(diff),
        "diff": diff,
    }


@app.post("/v1/policies/{version}/activate")
async def activate_policy(version: int, principal: Principal = Depends(require_roles(ROLE_ADMIN))):
    async with db.pool().acquire() as con:
        async with con.transaction():
            r = await con.fetchrow("SELECT status FROM policy_versions WHERE version=$1 FOR UPDATE", version)
            if not r:
                raise HTTPException(status_code=404, detail="policy version not found")
            await con.execute("UPDATE policy_versions SET status='superseded' WHERE status='active'")
            await con.execute(
                "UPDATE policy_versions SET status='active',activated_at=now() WHERE version=$1", version)
            await append_audit(con, event_type="CONFIG", correlation_id=f"cfg-policy-{version}-{int(time.time())}",
                               decision="POLICY_ACTIVATE", reason_code="POLICY_ACTIVATED", policy_version=version,
                               payload={"actor": principal.subject, "version": version})
    await publish_control({"type": "policy_activated", "version": version})
    return {"status": "activated", "version": version,
            "note": "Gateways reload the active policy on next refresh/restart (MVP)."}


# --------------------------------------------------------------------------- #
# Emergency stops (durable epochs + pub/sub)
# --------------------------------------------------------------------------- #
class HaltRequest(BaseModel):
    reason: str


class RevokeRequest(BaseModel):
    agent_id: str
    reason: str


@app.post("/v1/emergency/halt")
async def fleet_halt(body: HaltRequest, principal: Principal = Depends(require_roles(ROLE_ADMIN, ROLE_OPERATOR))):
    async with db.pool().acquire() as con:
        async with con.transaction():
            epoch = await con.fetchval(
                "INSERT INTO emergency_stops (scope,agent_id,state,reason,actor) "
                "VALUES ('fleet',NULL,'halted',$1,$2) RETURNING epoch", body.reason, principal.subject)
            await append_audit(con, event_type="EMERGENCY", correlation_id=f"halt-{epoch}",
                               decision="FLEET_HALT", reason_code="FLEET_HALTED",
                               payload={"actor": principal.subject, "reason": body.reason, "epoch": epoch})
    # Update redis hot cache immediately + notify (accelerator).
    await db.redis().set(f"halt:{{{settings.tenant_id}}}:epoch", epoch)
    await db.redis().set(f"safety:{{{settings.tenant_id}}}:refreshed", int(time.time()))
    await publish_control({"type": "halt", "epoch": epoch})
    return {"status": "halted", "epoch": epoch}


@app.post("/v1/emergency/resume")
async def fleet_resume(body: HaltRequest, principal: Principal = Depends(require_roles(ROLE_ADMIN, ROLE_OPERATOR))):
    async with db.pool().acquire() as con:
        async with con.transaction():
            epoch = await con.fetchval(
                "INSERT INTO emergency_stops (scope,agent_id,state,reason,actor) "
                "VALUES ('fleet',NULL,'resumed',$1,$2) RETURNING epoch", body.reason, principal.subject)
            await append_audit(con, event_type="EMERGENCY", correlation_id=f"resume-{epoch}",
                               decision="FLEET_RESUME", reason_code="FLEET_RESUMED",
                               payload={"actor": principal.subject, "reason": body.reason, "epoch": epoch})
    await db.redis().set(f"halt:{{{settings.tenant_id}}}:epoch", 0)
    await db.redis().set(f"safety:{{{settings.tenant_id}}}:refreshed", int(time.time()))
    await publish_control({"type": "resume", "epoch": epoch})
    return {"status": "resumed", "epoch": epoch}


@app.post("/v1/emergency/revoke")
async def revoke_agent(body: RevokeRequest, principal: Principal = Depends(require_roles(ROLE_ADMIN, ROLE_OPERATOR))):
    async with db.pool().acquire() as con:
        agent = await con.fetchrow("SELECT id FROM agents WHERE id=$1", body.agent_id)
        if not agent:
            raise HTTPException(status_code=404, detail="agent not found")
        async with con.transaction():
            epoch = await con.fetchval(
                "INSERT INTO emergency_stops (scope,agent_id,state,reason,actor) "
                "VALUES ('agent',$1,'revoked',$2,$3) RETURNING epoch",
                body.agent_id, body.reason, principal.subject)
            await append_audit(con, event_type="EMERGENCY", correlation_id=f"revoke-{epoch}",
                               agent_id=body.agent_id, decision="AGENT_REVOKE", reason_code="AGENT_REVOKED",
                               payload={"actor": principal.subject, "reason": body.reason, "epoch": epoch})
    await db.redis().set(f"revoke:{{{settings.tenant_id}}}:{body.agent_id}", epoch)
    await db.redis().set(f"safety:{{{settings.tenant_id}}}:refreshed", int(time.time()))
    await publish_control({"type": "revoke", "agent_id": body.agent_id, "epoch": epoch})
    return {"status": "revoked", "agent_id": body.agent_id, "epoch": epoch}


@app.post("/v1/emergency/reinstate")
async def reinstate_agent(body: RevokeRequest, principal: Principal = Depends(require_roles(ROLE_ADMIN, ROLE_OPERATOR))):
    async with db.pool().acquire() as con:
        async with con.transaction():
            epoch = await con.fetchval(
                "INSERT INTO emergency_stops (scope,agent_id,state,reason,actor) "
                "VALUES ('agent',$1,'reinstated',$2,$3) RETURNING epoch",
                body.agent_id, body.reason, principal.subject)
            await append_audit(con, event_type="EMERGENCY", correlation_id=f"reinstate-{epoch}",
                               agent_id=body.agent_id, decision="AGENT_REINSTATE", reason_code="AGENT_REINSTATED",
                               payload={"actor": principal.subject, "reason": body.reason, "epoch": epoch})
    await db.redis().delete(f"revoke:{{{settings.tenant_id}}}:{body.agent_id}")
    await db.redis().set(f"safety:{{{settings.tenant_id}}}:refreshed", int(time.time()))
    await publish_control({"type": "reinstate", "agent_id": body.agent_id, "epoch": epoch})
    return {"status": "reinstated", "agent_id": body.agent_id, "epoch": epoch}


@app.get("/v1/emergency/status")
async def emergency_status(_: Principal = Depends(current_principal)):
    async with db.pool().acquire() as con:
        fleet = await con.fetchrow(
            "SELECT state,epoch,reason,actor,created_at FROM emergency_stops WHERE scope='fleet' ORDER BY epoch DESC LIMIT 1")
        agents = await con.fetch(
            """SELECT DISTINCT ON (agent_id) agent_id,state,epoch,reason,created_at
               FROM emergency_stops WHERE scope='agent' ORDER BY agent_id,epoch DESC""")
    halted = bool(fleet and fleet["state"] == "halted")
    revoked = [dict(a) for a in agents if a["state"] == "revoked"]
    return {
        "fleet_halted": halted,
        "fleet": dict(fleet) if fleet else None,
        "revoked_agents": revoked,
    }


# --------------------------------------------------------------------------- #
# Gateways registry + convergence
# --------------------------------------------------------------------------- #
@app.get("/v1/gateways")
async def list_gateways(_: Principal = Depends(current_principal)):
    async with db.pool().acquire() as con:
        current_epoch = await con.fetchval(
            "SELECT COALESCE(MAX(epoch),0) FROM emergency_stops WHERE scope='fleet' AND state='halted'")
        rows = await con.fetch("SELECT id,last_seen_at,acked_epoch,started_at FROM gateways ORDER BY id")
    out = []
    for r in rows:
        d = dict(r)
        d["converged"] = d["acked_epoch"] >= (current_epoch or 0)
        out.append(d)
    return {"current_halt_epoch": current_epoch or 0, "gateways": out}


# --------------------------------------------------------------------------- #
# Audit query + integrity + checkpoint
# --------------------------------------------------------------------------- #
@app.get("/v1/audit/events")
async def query_audit(
    _: Principal = Depends(current_principal),
    correlation_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    reason_code: Optional[str] = None,
    limit: int = Query(default=100, le=1000),
):
    clauses = []
    args = []
    if correlation_id:
        args.append(correlation_id); clauses.append(f"correlation_id=${len(args)}")
    if agent_id:
        args.append(agent_id); clauses.append(f"agent_id=${len(args)}")
    if reason_code:
        args.append(reason_code); clauses.append(f"reason_code=${len(args)}")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    args.append(limit)
    q = (f"SELECT seq,chain_id,event_type,correlation_id,agent_id,decision,reason_code,"
         f"policy_version,payload,prev_hash,event_hash,created_at FROM audit_events "
         f"{where} ORDER BY seq DESC LIMIT ${len(args)}")
    async with db.pool().acquire() as con:
        rows = await con.fetch(q, *args)
    return [dict(r) for r in rows]


@app.get("/v1/audit/verify")
async def verify_audit(_: Principal = Depends(require_roles(ROLE_ADMIN, ROLE_AUDITOR, ROLE_OPERATOR))):
    """Walk the chain and recompute each hash; report first break if any (FR-045)."""
    async with db.pool().acquire() as con:
        rows = await con.fetch(
            "SELECT seq,event_type,correlation_id,agent_id,decision,reason_code,"
            "policy_version,payload,prev_hash,event_hash FROM audit_events "
            "WHERE chain_id='default' ORDER BY seq ASC")
    prev = GENESIS
    for r in rows:
        row = dict(r)
        expected = compute_event_hash("default", row)
        if row["prev_hash"] != prev:
            return {"valid": False, "broken_at_seq": row["seq"], "error": "prev_hash mismatch",
                    "expected_prev": prev, "found_prev": row["prev_hash"]}
        if expected != row["event_hash"]:
            return {"valid": False, "broken_at_seq": row["seq"], "error": "event_hash mismatch",
                    "expected": expected, "found": row["event_hash"]}
        prev = row["event_hash"]
    return {"valid": True, "verified_count": len(rows), "tip_hash": prev}


@app.post("/v1/audit/checkpoint")
async def create_checkpoint(principal: Principal = Depends(require_roles(ROLE_ADMIN, ROLE_AUDITOR))):
    async with db.pool().acquire() as con:
        tip = await con.fetchrow(
            "SELECT seq,event_hash FROM audit_events WHERE chain_id='default' ORDER BY seq DESC LIMIT 1")
        if not tip:
            raise HTTPException(status_code=400, detail="no events to checkpoint")
        sig = sign_checkpoint(tip["event_hash"])
        await con.execute(
            "INSERT INTO audit_checkpoints (chain_id,tip_seq,tip_hash,signature) VALUES ('default',$1,$2,$3)",
            tip["seq"], tip["event_hash"], sig)
    return {"status": "checkpointed", "tip_seq": tip["seq"], "tip_hash": tip["event_hash"], "signature": sig}


# --------------------------------------------------------------------------- #
# Live event stream (SSE) — tails the audit table by seq.
# --------------------------------------------------------------------------- #
@app.get("/v1/stream")
async def stream(_: Principal = Depends(current_principal)):
    async def gen():
        last_seq = 0
        # start near the tail
        async with db.pool().acquire() as con:
            last_seq = await con.fetchval("SELECT COALESCE(MAX(seq),0) FROM audit_events") or 0
        while True:
            async with db.pool().acquire() as con:
                rows = await con.fetch(
                    "SELECT seq,event_type,correlation_id,agent_id,decision,reason_code,created_at "
                    "FROM audit_events WHERE seq>$1 ORDER BY seq ASC LIMIT 50", last_seq)
            for r in rows:
                last_seq = r["seq"]
                d = dict(r)
                d["created_at"] = d["created_at"].isoformat()
                yield {"event": "audit", "data": json.dumps(d)}
            await asyncio.sleep(1)
    return EventSourceResponse(gen())


# --------------------------------------------------------------------------- #
# Extension endpoints (agent registration, policy drafts, summary, explain,
# demo runner, AI status). Defined in a separate module; included last so the
# lazy `from .main import ...` inside it resolves cleanly.
# --------------------------------------------------------------------------- #
from .extensions import router as extensions_router  # noqa: E402

app.include_router(extensions_router)
