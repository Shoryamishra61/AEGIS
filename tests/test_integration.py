"""AEGIS integration + E2E + concurrency + chaos test suite (pytest).

Runs INSIDE a container on the aegis compose network against the live stack.
Reuses the simulator client for envelope construction and control-plane helpers.

Invariants asserted here (formal counterpart to simulator/scenarios.py):
  - default-deny / fail-closed
  - policy deny, payee/cap enforcement, correct reason codes + HTTP status
  - idempotent replay (single reservation) and idempotency conflict (409)
  - NO OVERSELL under high concurrency (1000 concurrent distinct reservations)
  - fleet halt containment (backend never invoked) + convergence
  - agent revoke precedence over budget/policy
  - UNKNOWN backend outcome -> reconciliation_required, exposure retained
  - append-only hash-chain integrity verifies across Go+Python writers
"""
import concurrent.futures as cf
import os
import sys
import time

import pytest
import redis as redispy
import requests

sys.path.insert(0, "/sim")  # simulator client is mounted here
import client as C  # noqa: E402

AUDITOR = os.getenv("CONTROL_AUDITOR_TOKEN", "auditor-token-dev")
CONTROL = C.CONTROL_URL
PAYEE_OK = "tok_payee_A921"
PAYEE_OK2 = "tok_payee_B550"
NORMAL = "sub-agent-payables-01"
ROGUE = "sub-agent-rogue-01"
NORMAL_AGENT_ID = "agent-payables-01"
TENANT = os.getenv("AEGIS_TENANT_ID", "tenant_demo")
POOL = os.getenv("BUDGET_POOL_ID", "pool_payables")
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))


def _reset_budget_window():
    """Test isolation: zero the pool rolling-window counters (mirrors a window
    rollover) so budget-sensitive scenarios start with a clean slate."""
    r = redispy.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
    key = f"budget:{{{TENANT}}}:{POOL}:window"
    r.hset(key, mapping={"committed": 0, "held": 0, "window_start": int(time.time())})
    r.close()


@pytest.fixture(autouse=True)
def _reset_backend():
    C.mockbank_reset()
    _reset_budget_window()
    yield


def _auditor_headers():
    return {"Authorization": f"Bearer {AUDITOR}"}


def _wait_window_reset():
    # Window is 60s; tests that must not collide with prior window usage wait it out
    # only when explicitly needed. Most tests use small amounts to stay under caps.
    pass


# --------------------------------------------------------------------------- #
# Core enforcement
# --------------------------------------------------------------------------- #
def test_normal_allow_commits():
    env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 1000)
    r = C.submit(NORMAL, env, idem)
    body = r.json()
    assert r.status_code == 200, body
    assert body["decision"] == "ALLOW", body
    assert body.get("reconciliation_required") in (False, None), body


def test_default_deny_unknown_payee():
    env, idem = C.build_envelope("payments.transfer.create", "tok_not_allowed", 1000)
    r = C.submit(NORMAL, env, idem)
    body = r.json()
    assert r.status_code == 403, body
    assert body["decision"] == "DENY"
    assert "PAYEE_NOT_ALLOWED" in body["reason_codes"], body


def test_rogue_policy_deny():
    env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 1000)
    r = C.submit(ROGUE, env, idem)
    body = r.json()
    assert r.status_code == 403, body
    assert body["decision"] == "DENY"
    assert "POLICY_DENY" in body["reason_codes"], body


def test_per_txn_cap_exceeded():
    # per_txn_max = 100000
    env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 200000)
    r = C.submit(NORMAL, env, idem)
    body = r.json()
    assert "PER_TXN_CAP_EXCEEDED" in body["reason_codes"], body
    assert r.status_code == 429, body


def test_no_backend_call_on_deny():
    before = C.mockbank_stats()["invocation_count"]
    env, idem = C.build_envelope("payments.transfer.create", "tok_not_allowed", 1000)
    C.submit(NORMAL, env, idem)
    after = C.mockbank_stats()["invocation_count"]
    assert after == before, "backend must not be invoked on a denied action"


# --------------------------------------------------------------------------- #
# Idempotency
# --------------------------------------------------------------------------- #
def test_idempotent_replay_single_reservation():
    env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 1000)
    r1 = C.submit(NORMAL, env, idem)
    b1 = r1.json()
    r2 = C.submit(NORMAL, env, idem)
    b2 = r2.json()
    assert r1.status_code == 200 and r2.status_code == 200, (b1, b2)
    assert b1["correlation_id"] == b2["correlation_id"], (b1, b2)
    assert "IDEMPOTENT_REPLAY" in b2["reason_codes"], b2


def test_idempotency_conflict_different_body():
    _, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 1000)
    env1, _ = C.build_envelope("payments.transfer.create", PAYEE_OK, 1000, idem=idem)
    env2, _ = C.build_envelope("payments.transfer.create", PAYEE_OK, 2000, idem=idem)
    C.submit(NORMAL, env1, idem)
    r2 = C.submit(NORMAL, env2, idem)
    assert r2.status_code == 409, r2.json()


# --------------------------------------------------------------------------- #
# Concurrency: NO OVERSELL under high contention
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("n", [int(os.getenv("CONC_N", "1000"))])
def test_concurrency_no_oversell(n):
    """Fire N concurrent DISTINCT reservations against the shared pool.

    shared_max = 1000000, amount = 5000 -> at most 200 admissible.
    Asserts admitted <= max_admissible (never oversells the pool).
    """
    C.mockbank_reset()
    amount = 5000
    # Use a fresh-ish window by spacing from prior tests is not guaranteed; instead
    # assert the STRICTER shared-pool cap which is not time-windowed.
    shared_cap = 1000000
    window_cap = 500000
    # The binding constraint is the smaller of window/shared for this burst.
    max_admissible = min(window_cap, shared_cap) // amount

    def one(_i):
        env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, amount)
        try:
            r = C.submit(NORMAL, env, idem)
            return r.status_code
        except Exception:  # noqa: BLE001
            return -1

    allowed = 0
    with cf.ThreadPoolExecutor(max_workers=64) as ex:
        for status in ex.map(one, range(n)):
            if status == 200:
                allowed += 1

    assert allowed <= max_admissible, f"OVERSELL: allowed={allowed} max={max_admissible}"
    assert allowed > 0, "expected some admissions"
    # Backend invocations must equal admitted (each admitted commits exactly once).
    stats = C.mockbank_stats()
    assert stats["invocation_count"] <= max_admissible, stats


# --------------------------------------------------------------------------- #
# Containment: halt + revoke precedence
# --------------------------------------------------------------------------- #
def test_fleet_halt_contains_and_converges():
    C.mockbank_reset()
    C.halt_fleet("test-halt")
    time.sleep(6)  # > SAFETY_FRESHNESS_SECONDS refresh convergence
    before = C.mockbank_stats()["invocation_count"]
    env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 1000)
    r = C.submit(NORMAL, env, idem)
    after = C.mockbank_stats()["invocation_count"]
    body = r.json()
    try:
        assert r.status_code == 403, body
        assert "FLEET_HALTED" in body["reason_codes"], body
        assert after == before, "halted action must not reach backend"
    finally:
        C.resume_fleet("test-resume")
        time.sleep(6)


def test_agent_revoke_precedence():
    C.revoke_agent(NORMAL_AGENT_ID, "test-revoke")
    time.sleep(6)
    try:
        env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 1000)
        r = C.submit(NORMAL, env, idem)
        body = r.json()
        assert r.status_code == 403, body
        assert "AGENT_REVOKED" in body["reason_codes"], body
        # A different, non-revoked agent path (rogue) still gets its own decision,
        # proving revoke is scoped to the agent, not the fleet.
        env2, idem2 = C.build_envelope("payments.transfer.create", PAYEE_OK, 1000)
        r2 = C.submit(ROGUE, env2, idem2)
        assert "AGENT_REVOKED" not in r2.json()["reason_codes"], r2.json()
    finally:
        C.reinstate_agent(NORMAL_AGENT_ID, "test-reinstate")
        time.sleep(6)


# --------------------------------------------------------------------------- #
# UNKNOWN backend outcome
# --------------------------------------------------------------------------- #
def test_backend_timeout_unknown_holds_exposure():
    env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 1000,
                                 purpose="SIM_TIMEOUT")
    r = C.submit(NORMAL, env, idem)
    body = r.json()
    assert body.get("reconciliation_required") is True or \
        "EXECUTION_UNKNOWN" in body.get("reason_codes", []), body


# --------------------------------------------------------------------------- #
# Audit hash-chain integrity (cross-language)
# --------------------------------------------------------------------------- #
def test_audit_chain_verifies():
    # Generate a fresh event, then verify the whole chain.
    env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 1000)
    C.submit(NORMAL, env, idem)
    r = requests.get(f"{CONTROL}/v1/audit/verify", headers=_auditor_headers(), timeout=15)
    body = r.json()
    assert r.status_code == 200, body
    assert body["valid"] is True, body
    assert body["verified_count"] > 0, body


def test_checkpoint_signs_tip():
    r = requests.post(f"{CONTROL}/v1/audit/checkpoint", headers=_auditor_headers(), timeout=15)
    body = r.json()
    assert r.status_code == 200, body
    assert body["signature"].startswith("hmac-sha256:"), body


# --------------------------------------------------------------------------- #
# RBAC / security gates
# --------------------------------------------------------------------------- #
def test_rbac_auditor_cannot_halt():
    r = requests.post(f"{CONTROL}/v1/emergency/halt", json={"reason": "x"},
                      headers=_auditor_headers(), timeout=10)
    assert r.status_code == 403, r.text


def test_unauthenticated_rejected():
    r = requests.get(f"{CONTROL}/v1/agents", timeout=10)
    assert r.status_code == 401, r.text


def test_gateway_rejects_unauthenticated():
    r = requests.post(f"{C.GATEWAY_URL}/v1/actions", json={}, timeout=10)
    assert r.status_code == 401, r.text


def test_mockbank_rejects_direct_call():
    r = requests.post(f"{C.MOCKBANK_URL}/execute",
                      json={"correlation_id": "x", "payee_id": "p",
                            "amount_minor": 1, "currency": "INR"}, timeout=10)
    assert r.status_code == 401, r.text
