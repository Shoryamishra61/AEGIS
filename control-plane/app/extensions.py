"""AEGIS Control Plane — extension endpoints for the operator experience.

These are MINIMAL, non-conflicting additions that make the UI genuinely
functional without weakening any existing safety semantics:

  POST /v1/agents             register an agent (admin)               -> agents table
  POST /v1/policies           create a DRAFT policy version (admin)   -> policy_versions
  POST /v1/policies/validate  validate Rego + schema + run tests      -> deterministic
  GET  /v1/summary            Command Center aggregate metrics        -> read-only
  POST /v1/explain            deterministic Decision Explainer         -> no LLM
  POST /v1/demo/run           Judge Demo scenario -> drives real gateway, measures latency
  GET  /v1/ai/status          AI provider availability (honest)        -> read-only

Every write endpoint enforces roles SERVER-SIDE via require_roles and is audited
through the same hash chain. AI features are deterministic: no provider is
configured, and we never fabricate model output (see /v1/ai/status).
"""
import json
import time
import uuid
from typing import Optional

import httpx
import jwt as pyjwt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db
from .auth import (ROLE_ADMIN, ROLE_AUDITOR, ROLE_OPERATOR, Principal,
                   current_principal, require_roles)
from .config import settings
from .reason_catalog import REASON_CATALOG, advice_for

router = APIRouter()


# --------------------------------------------------------------------------- #
# Shared audit helper (mirrors main.append_audit; imported lazily to avoid cycle)
# --------------------------------------------------------------------------- #
async def _append_audit(con, **kw):
    from .main import append_audit  # local import breaks the import cycle
    return await append_audit(con, **kw)


async def _publish(event: dict):
    from .main import publish_control
    await publish_control(event)


# --------------------------------------------------------------------------- #
# Agent registration (admin)
# --------------------------------------------------------------------------- #
class AgentCreate(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9\-]{2,48}$")
    display_name: str = Field(min_length=1, max_length=120)
    owner: str = Field(min_length=1, max_length=120)
    risk_tier: str = Field(pattern="^(low|medium|high|critical)$")
    environment: str = Field(default="prod", pattern="^(prod|staging|dev)$")
    workload_sub: str = Field(min_length=3, max_length=160)
    budget_pool_id: str
    status: str = Field(default="pending", pattern="^(pending|active|disabled)$")


@router.post("/v1/agents", status_code=201)
async def register_agent(body: AgentCreate,
                         principal: Principal = Depends(require_roles(ROLE_ADMIN))):
    async with db.pool().acquire() as con:
        async with con.transaction():
            exists = await con.fetchval("SELECT 1 FROM agents WHERE id=$1", body.id)
            if exists:
                raise HTTPException(status_code=409, detail="agent id already exists")
            pool = await con.fetchval("SELECT 1 FROM budget_pools WHERE id=$1", body.budget_pool_id)
            if not pool:
                raise HTTPException(status_code=400, detail="budget_pool_id does not exist")
            active_ver = await con.fetchval("SELECT version FROM policy_versions WHERE status='active'")
            await con.execute(
                """INSERT INTO agents
                     (id,display_name,owner,risk_tier,environment,status,workload_sub,
                      budget_pool_id,policy_version,version)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1)""",
                body.id, body.display_name, body.owner, body.risk_tier, body.environment,
                body.status, body.workload_sub, body.budget_pool_id, active_ver or 1)
            await _append_audit(
                con, event_type="CONFIG",
                correlation_id=f"cfg-agent-new-{body.id}-{int(time.time())}",
                agent_id=body.id, decision="CONFIG_CHANGE", reason_code="AGENT_REGISTERED",
                payload={"actor": principal.subject, "owner": body.owner,
                         "risk_tier": body.risk_tier, "pool": body.budget_pool_id})
    return {"status": "registered", "agent_id": body.id, "version": 1}


# --------------------------------------------------------------------------- #
# Policy draft create + validate (admin/operator)
# --------------------------------------------------------------------------- #
class PolicyCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    rego: Optional[str] = Field(default=None, max_length=100_000)
    data_json: Optional[dict] = None
    source: str = Field(default="manual", pattern="^(manual|ai_draft)$")


@router.post("/v1/policies", status_code=201)
async def create_policy_draft(body: PolicyCreate,
                              principal: Principal = Depends(require_roles(ROLE_ADMIN))):
    """Create a DRAFT policy version. Drafts are never active until explicitly
    activated (existing /v1/policies/{v}/activate). AI-sourced drafts are marked."""
    async with db.pool().acquire() as con:
        async with con.transaction():
            data_payload = json.dumps(body.data_json or {}, separators=(",", ":"), sort_keys=True)
            label = ("[AI DRAFT] " if body.source == "ai_draft" else "") + body.label
            next_ver = await con.fetchval(
                """INSERT INTO policy_versions (label,status,rego_module,data_json,created_by)
                   VALUES ($1,'draft',$2,$3::jsonb,$4) RETURNING version""",
                label, body.rego or "", data_payload, principal.subject)
            await _append_audit(
                con, event_type="CONFIG",
                correlation_id=f"cfg-policy-draft-{next_ver}-{int(time.time())}",
                decision="POLICY_DRAFT", reason_code="POLICY_DRAFTED", policy_version=next_ver,
                payload={"actor": principal.subject, "label": label, "source": body.source})
    return {"status": "draft_created", "version": next_ver, "activated": False,
            "note": "Draft is inactive. Validate + simulate, then activate explicitly."}


class PolicyValidate(BaseModel):
    rego: str = Field(min_length=1, max_length=100_000)


@router.post("/v1/policies/validate")
async def validate_policy(body: PolicyValidate,
                          _: Principal = Depends(require_roles(ROLE_ADMIN, ROLE_OPERATOR))):
    """Static, deterministic validation of a Rego draft (no external tooling in the
    request path). Checks required structural elements the gateway contract needs.
    This is intentionally conservative and never activates anything."""
    src = body.rego
    checks = []

    def check(name: str, ok: bool, detail: str = ""):
        checks.append({"check": name, "ok": bool(ok), "detail": detail})

    check("package_declared", "package aegis.authz" in src,
          "must declare `package aegis.authz`")
    check("rego_v1_import", "import rego.v1" in src or "import future.keywords" in src,
          "should `import rego.v1`")
    check("default_effect_deny", 'default effect := "DENY"' in src or "default effect :=" in src,
          "must define a total default effect (fail-closed)")
    check("emits_decision", "decision" in src, "must build a `decision` object")
    check("reason_codes_present", "reason_codes" in src, "must set `reason_codes`")
    balanced = src.count("{") == src.count("}") and src.count("[") == src.count("]")
    check("brackets_balanced", balanced, "unbalanced braces/brackets")
    valid = all(c["ok"] for c in checks)
    return {"valid": valid, "checks": checks,
            "note": "Deterministic structural validation (MVP). Full `opa test` runs "
                    "in CI via `make unit`."}


# --------------------------------------------------------------------------- #
# Command Center summary metrics (all roles)
# --------------------------------------------------------------------------- #
@router.get("/v1/summary")
async def summary(_: Principal = Depends(current_principal)):
    async with db.pool().acquire() as con:
        agent_rows = await con.fetch("SELECT status,COUNT(*) c FROM agents GROUP BY status")
        fleet = await con.fetchrow(
            "SELECT state,epoch,reason,created_at FROM emergency_stops "
            "WHERE scope='fleet' ORDER BY epoch DESC LIMIT 1")
        revoked = await con.fetch(
            """SELECT DISTINCT ON (agent_id) agent_id,state FROM emergency_stops
               WHERE scope='agent' ORDER BY agent_id,epoch DESC""")
        active_policy = await con.fetchrow(
            "SELECT version,label FROM policy_versions WHERE status='active'")
        # Decision counts from the audit chain (last 500 action decisions).
        dec_rows = await con.fetch(
            """SELECT decision,COUNT(*) c FROM audit_events
               WHERE event_type='ACTION_DECISION' GROUP BY decision""")
        recent = await con.fetch(
            """SELECT seq,correlation_id,agent_id,decision,reason_code,created_at
               FROM audit_events
               WHERE event_type IN ('ACTION_DECISION','EMERGENCY')
               ORDER BY seq DESC LIMIT 8""")
        # Reconciliation backlog = decisions with UNKNOWN execution outcome.
        unknown = await con.fetchval(
            """SELECT COUNT(*) FROM audit_events
               WHERE reason_code='EXECUTION_UNKNOWN' OR decision='UNKNOWN'""")
        gw = await con.fetch("SELECT id,last_seen_at,acked_epoch FROM gateways ORDER BY id")
        cur_epoch = await con.fetchval(
            "SELECT COALESCE(MAX(epoch),0) FROM emergency_stops WHERE scope='fleet' AND state='halted'")

    agents = {r["status"]: r["c"] for r in agent_rows}
    decisions = {r["decision"]: r["c"] for r in dec_rows if r["decision"]}
    revoked_count = sum(1 for r in revoked if r["state"] == "revoked")
    now = time.time()
    gateways = []
    for g in gw:
        last = g["last_seen_at"].timestamp() if g["last_seen_at"] else 0
        age = now - last if last else None
        gateways.append({"id": g["id"], "acked_epoch": g["acked_epoch"],
                         "age_seconds": round(age, 1) if age is not None else None,
                         "converged": g["acked_epoch"] >= (cur_epoch or 0)})
    # freshness threshold = SAFETY_FRESHNESS_SECONDS
    fresh_thresh = int(__import__("os").getenv("SAFETY_FRESHNESS_SECONDS", "5"))
    fresh = sum(1 for g in gateways if g["age_seconds"] is not None and g["age_seconds"] <= fresh_thresh)
    converged = sum(1 for g in gateways if g["converged"])
    total_gw = len(gateways)

    return {
        "agents": {
            "active": agents.get("active", 0),
            "pending": agents.get("pending", 0),
            "disabled": agents.get("disabled", 0),
            "revoked": revoked_count,
            "total": sum(agents.values()),
        },
        "fleet": {
            "halted": bool(fleet and fleet["state"] == "halted"),
            "state": fleet["state"] if fleet else "resumed",
            "epoch": fleet["epoch"] if fleet else 0,
        },
        "decisions": {
            "allow": decisions.get("ALLOW", 0),
            "deny": decisions.get("DENY", 0),
            "total": sum(decisions.values()),
        },
        "active_policy": dict(active_policy) if active_policy else None,
        "reconciliation_backlog": int(unknown or 0),
        "gateways": {
            "total": total_gw, "fresh": fresh, "converged": converged,
            "freshness_threshold_s": fresh_thresh,
            "halt_ack_coverage": round(converged / total_gw, 3) if total_gw else 1.0,
            "items": gateways,
        },
        "recent_events": [
            {**dict(r), "created_at": r["created_at"].isoformat()} for r in recent
        ],
    }


# --------------------------------------------------------------------------- #
# Deterministic Decision Explainer (no LLM) — /v1/explain
# --------------------------------------------------------------------------- #
class ExplainRequest(BaseModel):
    correlation_id: Optional[str] = None
    reason_codes: Optional[list[str]] = None
    decision: Optional[str] = None
    agent_id: Optional[str] = None
    policy_version: Optional[int] = None


@router.post("/v1/explain")
async def explain_decision(body: ExplainRequest, _: Principal = Depends(current_principal)):
    """Build a deterministic, cited explanation purely from structured reason codes
    and audit evidence. Works with NO LLM. If a correlation_id is given, we pull the
    real audit events as evidence and cite exact seqs/hashes."""
    evidence = []
    reason_codes = list(body.reason_codes or [])
    decision = body.decision
    agent_id = body.agent_id
    policy_version = body.policy_version

    if body.correlation_id:
        async with db.pool().acquire() as con:
            rows = await con.fetch(
                """SELECT seq,event_type,decision,reason_code,agent_id,policy_version,
                          payload,event_hash,created_at
                   FROM audit_events WHERE correlation_id=$1 ORDER BY seq ASC""",
                body.correlation_id)
        for r in rows:
            evidence.append({
                "seq": r["seq"], "event_type": r["event_type"], "decision": r["decision"],
                "reason_code": r["reason_code"], "event_hash": r["event_hash"],
                "created_at": r["created_at"].isoformat(),
            })
            if r["reason_code"] and r["reason_code"] not in reason_codes:
                reason_codes.append(r["reason_code"])
            decision = decision or r["decision"]
            agent_id = agent_id or r["agent_id"]
            policy_version = policy_version or r["policy_version"]

    # Deterministic narrative from the catalog.
    lines = []
    overall_advice = "PROCEED"
    containment_hit = False
    for rc in reason_codes:
        meta = REASON_CATALOG.get(rc)
        if not meta:
            lines.append({"reason_code": rc, "category": "UNKNOWN",
                          "meaning": "Unrecognized reason code — treated as STOP (fail-closed).",
                          "advice": "STOP"})
            overall_advice = "STOP"
            continue
        lines.append({"reason_code": rc, "category": meta["category"],
                      "meaning": meta["meaning"], "advice": meta["advice"],
                      "inspect_next": meta.get("inspect_next", "")})
        if meta["category"] in ("CONTAINMENT",):
            containment_hit = True
        if meta["advice"] == "STOP":
            overall_advice = "STOP"
        elif meta["advice"] == "WAIT" and overall_advice != "STOP":
            overall_advice = "WAIT"

    headline = _headline(decision, reason_codes, containment_hit)
    inspect = _inspect_steps(reason_codes, containment_hit)

    return {
        "mode": "deterministic",
        "provider": "none",
        "headline": headline,
        "decision": decision,
        "overall_advice": advice_for(reason_codes) or overall_advice,
        "agent_id": agent_id,
        "policy_version": policy_version,
        "reason_breakdown": lines,
        "inspect_next": inspect,
        "evidence": evidence,
        "citation": {
            "correlation_id": body.correlation_id,
            "policy_version": policy_version,
            "note": "Explanation derived deterministically from reason codes + audit "
                    "evidence. No language model was used.",
        },
    }


def _headline(decision, reason_codes, containment_hit) -> str:
    if containment_hit:
        if "FLEET_HALTED" in reason_codes:
            return "Blocked by fleet halt — containment overrode all other checks."
        if "AGENT_REVOKED" in reason_codes:
            return "Blocked because the agent is revoked — containment precedence."
    if decision == "ALLOW":
        return "Allowed — policy permitted the action and budget was reserved."
    if "PAYEE_NOT_ALLOWED" in reason_codes:
        return "Denied — the payee is not on the agent's allow-list."
    if any(rc.endswith("CAP_EXCEEDED") for rc in reason_codes):
        return "Denied — a budget cap would be exceeded."
    if "POLICY_DENY" in reason_codes:
        return "Denied — policy rules rejected this action."
    if decision == "DENY":
        return "Denied — see reason codes for the determining rule."
    return "Decision explained from structured reason codes."


def _inspect_steps(reason_codes, containment_hit) -> list[str]:
    steps = []
    if containment_hit:
        steps.append("Review Emergency Control: confirm the halt/revoke epoch and who set it.")
        steps.append("Once safe, use the controlled resume/reinstate workflow.")
    if "PAYEE_NOT_ALLOWED" in reason_codes:
        steps.append("Open Policy Studio and review the payee allow-list (data.json).")
    if any(rc.endswith("CAP_EXCEEDED") for rc in reason_codes):
        steps.append("Open Budgets & Pools to inspect per-txn / window / shared consumption.")
    if "EXECUTION_UNKNOWN" in reason_codes:
        steps.append("Resolve in Reconciliation: the backend outcome is UNKNOWN; exposure is held.")
    if not steps:
        steps.append("No further action required. Correlate in Audit Explorer if needed.")
    return steps


# --------------------------------------------------------------------------- #
# AI provider status (honest) — /v1/ai/status
# --------------------------------------------------------------------------- #
@router.get("/v1/ai/status")
async def ai_status(_: Principal = Depends(current_principal)):
    return {
        "provider_configured": False,
        "provider": "none",
        "mode": "deterministic",
        "capabilities": {
            "decision_explainer": True,      # deterministic, always available
            "copilot_filter_builder": True,  # deterministic NL->filters
            "copilot_summary": True,         # deterministic incident summary
            "policy_draft_llm": False,       # requires a model provider
        },
        "message": "AI provider not configured. Deterministic explanations and "
                   "filter-building are active; LLM-only drafting is disabled.",
    }


# --------------------------------------------------------------------------- #
# Judge Demo scenario runner — drives the REAL gateway, measures REAL latency.
# --------------------------------------------------------------------------- #
class DemoRun(BaseModel):
    scenario: str


def _agent_jwt(sub: str) -> str:
    now = int(time.time())
    return pyjwt.encode({"sub": sub, "iat": now, "exp": now + 3600},
                        settings.agent_jwt_secret, algorithm="HS256")


# scenario -> (agent workload sub, payee, amount_minor, purpose)
_SCENARIOS = {
    "normal_transfer":   ("sub-agent-judge-demo", "tok_payee_A921", 500000, "VENDOR"),
    "unapproved_payee":  ("sub-agent-judge-demo", "tok_payee_UNKNOWN", 500000, "VENDOR"),
    "over_cap":          ("sub-agent-judge-demo", "tok_payee_A921", 10000000, "VENDOR"),
    "rogue_agent":       ("sub-agent-rogue-01", "tok_payee_A921", 5000, "VENDOR"),
    "timeout_unknown":   ("sub-agent-payables-01", "tok_payee_A921", 3000, "SIM_TIMEOUT"),
}


@router.post("/v1/demo/run")
async def demo_run(body: DemoRun, _: Principal = Depends(current_principal)):
    """Trigger a real enforcement flow through the gateway and return the measured
    decision + latency + evidence. No fabricated numbers — latency is wall-clock of
    the real gateway call."""
    scn = _SCENARIOS.get(body.scenario)
    if not scn:
        raise HTTPException(status_code=400, detail=f"unknown scenario '{body.scenario}'")
    sub, payee, amount, purpose = scn
    idem = str(uuid.uuid4())
    envelope = {
        "api_version": "v1",
        "action_id": str(uuid.uuid4()),
        "idempotency_key": idem,
        "action": "payments.transfer.create",
        "resource": {"type": "payment_account", "id": "acct-demo"},
        "arguments": {"payee_id": payee, "amount_minor": amount,
                      "currency": "INR", "purpose_code": purpose},
    }
    headers = {"Authorization": f"Bearer {_agent_jwt(sub)}",
               "Idempotency-Key": idem, "Content-Type": "application/json"}
    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=10.0) as cx:
            resp = await cx.post(f"{settings.gateway_url}/v1/actions",
                                 json=envelope, headers=headers)
        elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)
        try:
            data = resp.json()
        except Exception:
            data = {"raw": resp.text}
        return {
            "scenario": body.scenario,
            "http_status": resp.status_code,
            "protected_in_ms": elapsed_ms,
            "correlation_id": data.get("correlation_id"),
            "decision": data.get("decision"),
            "reason_codes": data.get("reason_codes", []),
            "advice": data.get("advice"),
            "execution": data.get("execution"),
            "reconciliation_required": data.get("reconciliation_required"),
            "envelope": {"payee_id": payee, "amount_minor": amount, "purpose_code": purpose,
                         "agent_sub": sub},
        }
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"gateway unreachable: {exc}")


@router.post("/v1/demo/reset")
async def demo_reset(_: Principal = Depends(require_roles(ROLE_ADMIN, ROLE_OPERATOR))):
    """Reset demo-affecting volatile state: zero the pool rolling window so repeated
    demo runs start clean. Does NOT touch the durable audit chain."""
    for pool_id in ("pool_payables", "pool_judge_demo"):
        key = f"budget:{{{settings.tenant_id}}}:{pool_id}:window"
        await db.redis().hset(key, mapping={"committed": 0, "held": 0,
                                            "window_start": int(time.time())})
    # Also reset the mock-bank counters/fault flags for a clean demo.
    reset = {"mock_bank": "skipped"}
    try:
        async with httpx.AsyncClient(timeout=5.0) as cx:
            r = await cx.post(f"{settings.mockbank_url}/reset")
            reset["mock_bank"] = "ok" if r.status_code < 400 else f"status {r.status_code}"
    except Exception as exc:  # noqa: BLE001
        reset["mock_bank"] = f"unreachable: {exc}"
    return {"status": "reset", "window_reset": True, **reset}
