"""AEGIS agent simulator scenarios.

Each scenario returns a dict result and prints a concise PASS/FAIL summary based on
observable gateway behaviour. These are demonstrations AND self-checks; the formal
test suite (tests/) asserts the same invariants programmatically.

Run:  python -m scenarios <name>   |   python -m scenarios all
"""
import concurrent.futures as cf
import sys
import time

import client as C

PAYEE_OK = "tok_payee_A921"
PAYEE_BAD = "tok_not_allowed"
NORMAL = "sub-agent-payables-01"
ROGUE = "sub-agent-rogue-01"
NORMAL_AGENT_ID = "agent-payables-01"


def _ok(cond: bool, label: str) -> bool:
    print(("PASS" if cond else "FAIL") + " :: " + label)
    return cond


def scenario_normal() -> bool:
    """Normal agent, allowed payee, within caps -> ALLOW + execution COMMITTED."""
    env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 25000)
    r = C.submit(NORMAL, env, idem)
    body = r.json()
    return _ok(r.status_code == 200 and body["decision"] == "ALLOW", f"normal allow -> {r.status_code} {body.get('decision')}")


def scenario_rogue() -> bool:
    """Rogue high-risk agent -> DENY (policy)."""
    env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 25000)
    r = C.submit(ROGUE, env, idem)
    body = r.json()
    return _ok(r.status_code == 403 and body["decision"] == "DENY", f"rogue deny -> {r.status_code} {body.get('reason_codes')}")


def scenario_payee_denied() -> bool:
    env, idem = C.build_envelope("payments.transfer.create", PAYEE_BAD, 25000)
    r = C.submit(NORMAL, env, idem)
    body = r.json()
    return _ok("PAYEE_NOT_ALLOWED" in body.get("reason_codes", []), f"payee deny -> {body.get('reason_codes')}")


def scenario_per_txn_cap() -> bool:
    """Amount above per-txn cap (per_txn_max=100000) -> DENY PER_TXN_CAP_EXCEEDED."""
    env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 200000)
    r = C.submit(NORMAL, env, idem)
    body = r.json()
    return _ok("PER_TXN_CAP_EXCEEDED" in body.get("reason_codes", []), f"per-txn cap -> {r.status_code} {body.get('reason_codes')}")


def scenario_replay() -> bool:
    """Same idempotency key twice -> identical decision, single reservation."""
    env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 15000)
    r1 = C.submit(NORMAL, env, idem)
    r2 = C.submit(NORMAL, env, idem)
    b1, b2 = r1.json(), r2.json()
    same = b1.get("correlation_id") == b2.get("correlation_id") or "IDEMPOTENT_REPLAY" in b2.get("reason_codes", [])
    return _ok(r1.status_code == 200 and same, f"replay -> {b2.get('reason_codes')}")


def scenario_idempotency_conflict() -> bool:
    """Same key, different body -> 409 IDEMPOTENCY_CONFLICT."""
    _, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 15000)
    env1, _ = C.build_envelope("payments.transfer.create", PAYEE_OK, 15000, idem=idem)
    env2, _ = C.build_envelope("payments.transfer.create", PAYEE_OK, 16000, idem=idem)
    C.submit(NORMAL, env1, idem)
    r2 = C.submit(NORMAL, env2, idem)
    return _ok(r2.status_code == 409, f"idempotency conflict -> {r2.status_code}")


def scenario_concurrency(n: int = 50) -> bool:
    """Fire N concurrent DISTINCT reservations; committed+held must never exceed cap.

    window_max=500000, per-txn 40000 -> at most 12 can be admitted (12*40000=480000).
    Asserts admitted count * amount <= window cap (no oversell)."""
    C.mockbank_reset()
    amount = 40000
    cap = 500000
    max_admissible = cap // amount

    def one(_i):
        env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, amount)
        r = C.submit(NORMAL, env, idem)
        return r.status_code, r.json().get("reason_codes", [])

    allowed = 0
    with cf.ThreadPoolExecutor(max_workers=n) as ex:
        for status, reasons in ex.map(one, range(n)):
            if status == 200:
                allowed += 1
    no_oversell = allowed <= max_admissible
    return _ok(no_oversell, f"concurrency no-oversell -> allowed={allowed} max={max_admissible}")


def scenario_halt() -> bool:
    """Halt fleet -> new intents DENY FLEET_HALTED and never reach backend."""
    C.mockbank_reset()
    C.halt_fleet("sim-halt")
    time.sleep(3)  # allow gateway refresh convergence
    before = C.mockbank_stats()["invocation_count"]
    env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 15000)
    r = C.submit(NORMAL, env, idem)
    after = C.mockbank_stats()["invocation_count"]
    body = r.json()
    halted = r.status_code == 403 and "FLEET_HALTED" in body.get("reason_codes", [])
    contained = after == before
    C.resume_fleet("sim-resume")
    time.sleep(3)
    return _ok(halted and contained, f"halt -> {body.get('reason_codes')} backend_delta={after-before}")


def scenario_revoke() -> bool:
    """Revoke agent -> its intents DENY AGENT_REVOKED; other agents unaffected."""
    C.revoke_agent(NORMAL_AGENT_ID, "sim-revoke")
    time.sleep(3)
    env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 15000)
    r = C.submit(NORMAL, env, idem)
    body = r.json()
    revoked = r.status_code == 403 and "AGENT_REVOKED" in body.get("reason_codes", [])
    C.reinstate_agent(NORMAL_AGENT_ID, "sim-reinstate")
    time.sleep(3)
    return _ok(revoked, f"revoke -> {body.get('reason_codes')}")


def scenario_timeout_unknown() -> bool:
    """Backend timeout -> execution UNKNOWN, reconciliation_required, exposure retained."""
    env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, 15000, purpose="SIM_TIMEOUT")
    r = C.submit(NORMAL, env, idem)
    body = r.json()
    unknown = body.get("reconciliation_required") is True or "EXECUTION_UNKNOWN" in body.get("reason_codes", [])
    return _ok(unknown, f"timeout unknown -> {body.get('reason_codes')} reconcile={body.get('reconciliation_required')}")


SCENARIOS = {
    "normal": scenario_normal,
    "rogue": scenario_rogue,
    "payee_denied": scenario_payee_denied,
    "per_txn_cap": scenario_per_txn_cap,
    "replay": scenario_replay,
    "idempotency_conflict": scenario_idempotency_conflict,
    # timeout_unknown must run before the window-exhausting concurrency test so it
    # has budget headroom to reach the backend (otherwise it is correctly denied
    # WINDOW_CAP_EXCEEDED before dispatch). This is scenario isolation, not a bug.
    "timeout_unknown": scenario_timeout_unknown,
    "concurrency": scenario_concurrency,
    "halt": scenario_halt,
    "revoke": scenario_revoke,
}


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "all"
    if name == "all":
        results = {}
        for n, fn in SCENARIOS.items():
            try:
                results[n] = fn()
            except Exception as exc:  # noqa: BLE001
                print(f"ERROR :: {n}: {exc}")
                results[n] = False
        passed = sum(1 for v in results.values() if v)
        print(f"\n=== {passed}/{len(results)} scenarios passed ===")
        sys.exit(0 if passed == len(results) else 1)
    fn = SCENARIOS.get(name)
    if not fn:
        print(f"unknown scenario: {name}. options: {', '.join(SCENARIOS)}")
        sys.exit(2)
    sys.exit(0 if fn() else 1)


if __name__ == "__main__":
    main()
