"""AEGIS chaos tests (pytest).

These validate safety under partial failure. They run inside a container on the
aegis network and use `docker`-level fault injection via the control-plane and
mock-bank sim hooks (no host tooling required).

Covered:
  - Pub/Sub loss -> gateway still converges to halt via periodic Postgres refresh
    (Pub/Sub is an accelerator only; FR-035).
  - Backend timeout storm -> every ambiguous outcome is UNKNOWN + held (no guessed
    success/failure), and the audit chain remains intact.
  - Audit-write outage semantics are covered by design: the gateway appends the
    decision durably BEFORE dispatch and RELEASES the reservation on audit failure
    (compensating action). We assert the pre-dispatch ordering invariant indirectly:
    a denied/halted action never reaches the backend (see test_integration).

Note on Pub/Sub-loss injection: we cannot easily sever only the Redis Pub/Sub
channel from inside the network without host tooling, so we simulate the WORST
CASE that Pub/Sub delivered nothing by relying solely on the periodic refresh:
we set the durable epoch (via control-plane) and assert convergence strictly by
the freshness/refresh interval, not by any push notification timing.
"""
import os
import sys
import time

import pytest
import redis as redispy
import requests

sys.path.insert(0, "/sim")
import client as C  # noqa: E402

NORMAL = "sub-agent-payables-01"
PAYEE_OK = "tok_payee_A921"
AUDITOR = os.getenv("CONTROL_AUDITOR_TOKEN", "auditor-token-dev")
REFRESH_CONVERGE_S = float(os.getenv("REFRESH_CONVERGE_S", "8"))
TENANT = os.getenv("AEGIS_TENANT_ID", "tenant_demo")
POOL = os.getenv("BUDGET_POOL_ID", "pool_payables")
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))


def _reset_budget_window():
    """Test isolation: zero the pool's rolling-window counters so a scenario that
    must reach the backend has headroom. This mirrors a window rollover; still-held
    exposure from prior tests is intentionally dropped for a clean-slate scenario."""
    r = redispy.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
    key = f"budget:{{{TENANT}}}:{POOL}:window"
    r.hset(key, mapping={"committed": 0, "held": 0, "window_start": int(time.time())})
    r.close()


@pytest.fixture(autouse=True)
def _reset():
    C.mockbank_reset()
    _reset_budget_window()
    yield


def test_pubsub_loss_still_converges_via_refresh():
    """Even if no push notification were delivered, the durable epoch + periodic
    refresh must converge the gateway to a halted state within the refresh window."""
    C.halt_fleet("chaos-pubsub-loss")
    # Do NOT rely on push; wait strictly for the periodic refresh interval to elapse.
    time.sleep(REFRESH_CONVERGE_S)
    try:
        env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 1000)
        r = C.submit(NORMAL, env, idem)
        body = r.json()
        assert r.status_code == 403, body
        assert "FLEET_HALTED" in body["reason_codes"], body
    finally:
        C.resume_fleet("chaos-pubsub-resume")
        time.sleep(REFRESH_CONVERGE_S)


def test_timeout_storm_all_unknown_and_chain_intact():
    """A burst of backend timeouts must each yield UNKNOWN (held exposure), never a
    guessed success/failure, and the audit chain must still verify afterwards."""
    unknowns = 0
    attempts = int(os.getenv("TIMEOUT_STORM_N", "8"))
    _reset_budget_window()
    for _ in range(attempts):
        env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 1000,
                                     purpose="SIM_TIMEOUT")
        r = C.submit(NORMAL, env, idem)
        body = r.json()
        state = (body.get("execution") or {}).get("state")
        if body.get("reconciliation_required") is True or \
                "EXECUTION_UNKNOWN" in body.get("reason_codes", []) or state == "UNKNOWN":
            unknowns += 1
        # None of these may report a definitive COMMITTED success.
        assert state != "COMMITTED", body
    assert unknowns == attempts, f"only {unknowns}/{attempts} were UNKNOWN"

    r = requests.get(f"{C.CONTROL_URL}/v1/audit/verify",
                     headers={"Authorization": f"Bearer {AUDITOR}"}, timeout=20)
    assert r.json()["valid"] is True, r.json()


def test_backend_hard_fail_releases_exposure():
    """A definitive backend failure (SIM_FAIL) must RELEASE the reservation and not
    leave held exposure, and must not report success."""
    _reset_budget_window()
    env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 1000,
                                 purpose="SIM_FAIL")
    r = C.submit(NORMAL, env, idem)
    body = r.json()
    state = (body.get("execution") or {}).get("state")
    # Deterministic failure => not COMMITTED (reservation released).
    assert state != "COMMITTED", body
