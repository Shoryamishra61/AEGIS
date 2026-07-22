# AEGIS mock banking API.
# Purpose: a protected backend that ONLY the gateway may call. It proves containment
# (a halted/revoked action must never reach here) via an invocation counter, supports
# idempotent execution, and can simulate failure/timeout for chaos scenarios.
#
# Security: requires the gateway-only credential header. An agent-presented token must
# never be accepted (the mock bank has no notion of agent identity).
import asyncio
import os
import time
from typing import Dict

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

GATEWAY_CREDENTIAL = os.getenv("BACKEND_GATEWAY_CREDENTIAL", "gw-only-shared-secret")

app = FastAPI(title="AEGIS Mock Bank", version="1.0.0")

# In-memory state (single process; fine for the demo).
_invocation_count = 0
_executions: Dict[str, dict] = {}  # idempotency_key -> stored result
_lock = asyncio.Lock()


class ExecuteRequest(BaseModel):
    correlation_id: str
    payee_id: str
    amount_minor: int
    currency: str
    sim_mode: str | None = None


@app.get("/healthz")
async def healthz():
    return {"status": "alive"}


@app.get("/readyz")
async def readyz():
    return {"status": "ready"}


@app.get("/stats")
async def stats():
    # Exposed so tests can assert containment (dispatch never reached backend).
    return {"invocation_count": _invocation_count, "executions": len(_executions)}


@app.post("/reset")
async def reset():
    global _invocation_count, _executions
    async with _lock:
        _invocation_count = 0
        _executions = {}
    return {"status": "reset"}


@app.post("/execute")
async def execute(
    req: ExecuteRequest,
    request: Request,
    x_gateway_credential: str | None = Header(default=None),
    idempotency_key: str | None = Header(default=None),
):
    global _invocation_count

    # Gateway-only credential. Reject anything else (defence-in-depth: the backend
    # must be unreachable except via the gateway).
    if x_gateway_credential != GATEWAY_CREDENTIAL:
        raise HTTPException(status_code=401, detail="gateway credential required")

    if not idempotency_key:
        raise HTTPException(status_code=422, detail="idempotency key required")

    # Count every authenticated invocation that reaches execution intent.
    async with _lock:
        _invocation_count += 1

        # Idempotent replay: return the stored result without re-executing.
        if idempotency_key in _executions:
            stored = _executions[idempotency_key]
            return JSONResponse(status_code=stored["status"], content=stored["body"])

    # Simulate behaviours for chaos/e2e scenarios via sim_mode (from purpose_code).
    mode = (req.sim_mode or "").upper()
    if mode == "SIM_TIMEOUT":
        # Sleep beyond the gateway's client timeout to force UNKNOWN.
        await asyncio.sleep(5)
        # If gateway already timed out, this response is ignored.
        return JSONResponse(status_code=504, content={"error": "timeout"})
    if mode == "SIM_FAIL":
        body = {"error": "rejected", "correlation_id": req.correlation_id}
        async with _lock:
            _executions[idempotency_key] = {"status": 422, "body": body}
        return JSONResponse(status_code=422, content=body)

    # Normal success.
    backend_reference = f"bank-{int(time.time()*1000)}-{idempotency_key[:8]}"
    body = {
        "status": "executed",
        "backend_reference": backend_reference,
        "correlation_id": req.correlation_id,
        "amount_minor": req.amount_minor,
        "currency": req.currency,
    }
    async with _lock:
        _executions[idempotency_key] = {"status": 200, "body": body}
    return JSONResponse(status_code=200, content=body)
