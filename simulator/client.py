"""Shared client for the AEGIS agent simulator.

Mints dev agent JWTs (HMAC, matching the gateway's AGENT_JWT_HMAC_SECRET) and
submits canonical action envelopes to the gateway. Also provides control-plane
helpers for halt/revoke used by chaos scenarios.
"""
import os
import time
import uuid

import jwt
import requests

GATEWAY_URL = os.getenv("GATEWAY_URL", "http://gateway:8080")
CONTROL_URL = os.getenv("CONTROL_URL", "http://control-plane:8000")
MOCKBANK_URL = os.getenv("MOCKBANK_URL", "http://mock-bank:9090")
AGENT_SECRET = os.getenv("AGENT_JWT_HMAC_SECRET", "dev-agent-signing-secret-change-me")
ADMIN_TOKEN = os.getenv("CONTROL_ADMIN_TOKEN", "admin-token-dev")


def mint_agent_token(sub: str, ttl_seconds: int = 300) -> str:
    now = int(time.time())
    payload = {"sub": sub, "iat": now, "exp": now + ttl_seconds}
    return jwt.encode(payload, AGENT_SECRET, algorithm="HS256")


def new_idempotency_key() -> str:
    return "idem_" + uuid.uuid4().hex


def build_envelope(action: str, payee: str, amount_minor: int, currency: str = "INR",
                   idem: str | None = None, purpose: str = "VENDOR",
                   resource_id: str = "acct-primary") -> tuple[dict, str]:
    idem = idem or new_idempotency_key()
    env = {
        "api_version": "v1",
        "action_id": "act_" + uuid.uuid4().hex,
        "idempotency_key": idem,
        "action": action,
        "resource": {"type": "payment_account", "id": resource_id},
        "arguments": {
            "payee_id": payee,
            "amount_minor": amount_minor,
            "currency": currency,
            "purpose_code": purpose,
        },
    }
    return env, idem


def submit(sub: str, env: dict, idem: str, token: str | None = None) -> requests.Response:
    token = token or mint_agent_token(sub)
    return requests.post(
        f"{GATEWAY_URL}/v1/actions",
        json=env,
        headers={
            "Authorization": f"Bearer {token}",
            "Idempotency-Key": idem,
            "Content-Type": "application/json",
        },
        timeout=10,
    )


# --- Control-plane helpers (chaos scenarios) ---
def _admin_headers() -> dict:
    return {"Authorization": f"Bearer {ADMIN_TOKEN}", "Content-Type": "application/json"}


def halt_fleet(reason: str = "sim-halt") -> requests.Response:
    return requests.post(f"{CONTROL_URL}/v1/emergency/halt", json={"reason": reason},
                         headers=_admin_headers(), timeout=10)


def resume_fleet(reason: str = "sim-resume") -> requests.Response:
    return requests.post(f"{CONTROL_URL}/v1/emergency/resume", json={"reason": reason},
                         headers=_admin_headers(), timeout=10)


def revoke_agent(agent_id: str, reason: str = "sim-revoke") -> requests.Response:
    return requests.post(f"{CONTROL_URL}/v1/emergency/revoke",
                         json={"agent_id": agent_id, "reason": reason},
                         headers=_admin_headers(), timeout=10)


def reinstate_agent(agent_id: str, reason: str = "sim-reinstate") -> requests.Response:
    return requests.post(f"{CONTROL_URL}/v1/emergency/reinstate",
                         json={"agent_id": agent_id, "reason": reason},
                         headers=_admin_headers(), timeout=10)


def mockbank_stats() -> dict:
    return requests.get(f"{MOCKBANK_URL}/stats", timeout=10).json()


def mockbank_reset() -> None:
    requests.post(f"{MOCKBANK_URL}/reset", timeout=10)
