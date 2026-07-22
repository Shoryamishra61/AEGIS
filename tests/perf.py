"""AEGIS performance harness.

Drives a configurable number of concurrent workers issuing decision requests at the
gateway and records: throughput, latency percentiles (p50/p95/p99), error rate,
and correctness gates (no oversell, backend invocations <= admitted).

It writes a JSON + human-readable report to /reports so results are captured with
hardware/topology/sample-size context (populated by the runner).

Usage (inside the test-runner container on the aegis network):
    python perf.py --intents 10000 --concurrency 200 --gateways 1

NOTE on "20 gateways": the gateway is horizontally scalable and stateless w.r.t.
budget (all reservations are atomic in Redis under a single hash-tag slot). To
exercise N gateway replicas, start the stack with `docker compose up --scale
gateway=N` behind a client that round-robins; in this single-endpoint harness we
record the ACTUAL topology used (see report.topology) rather than fabricate a
20-replica number. Correctness gates hold regardless of replica count because the
atomic reservation is the single source of truth.
"""
import argparse
import concurrent.futures as cf
import json
import os
import platform
import statistics
import sys
import time

sys.path.insert(0, "/sim")
import client as C  # noqa: E402

PAYEE_OK = "tok_payee_A921"
NORMAL = "sub-agent-payables-01"


def _percentile(sorted_vals, pct):
    if not sorted_vals:
        return 0.0
    k = (len(sorted_vals) - 1) * (pct / 100.0)
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    if f == c:
        return sorted_vals[f]
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


def run(intents: int, concurrency: int, amount: int, gateways: int, topology: str):
    C.mockbank_reset()
    latencies_ms = []
    statuses = {}
    lock_token = NORMAL

    def one(_i):
        env, idem = C.build_envelope("payments.transfer.create", PAYEE_OK, amount)
        t0 = time.perf_counter()
        try:
            r = C.submit(lock_token, env, idem)
            dt = (time.perf_counter() - t0) * 1000.0
            return r.status_code, dt
        except Exception:  # noqa: BLE001
            return -1, (time.perf_counter() - t0) * 1000.0

    t_start = time.perf_counter()
    with cf.ThreadPoolExecutor(max_workers=concurrency) as ex:
        for status, dt in ex.map(one, range(intents)):
            statuses[status] = statuses.get(status, 0) + 1
            latencies_ms.append(dt)
    wall = time.perf_counter() - t_start

    latencies_ms.sort()
    admitted = statuses.get(200, 0)
    denied = sum(v for k, v in statuses.items() if k not in (200, -1))
    errors = statuses.get(-1, 0)
    stats = C.mockbank_stats()

    # Correctness gate: backend invocations must never exceed admitted reservations.
    no_oversell = stats["invocation_count"] <= admitted if admitted else True

    report = {
        "harness": "aegis-perf",
        "sample_size_intents": intents,
        "concurrency": concurrency,
        "amount_minor": amount,
        "gateway_replicas": gateways,
        "topology": topology,
        "hardware": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "cpu_count": os.cpu_count(),
            "note": "Docker Desktop VM; container-observed. Latency variance under "
                    "Docker Desktop is expected and does not affect correctness gates.",
        },
        "results": {
            "wall_seconds": round(wall, 3),
            "throughput_rps": round(intents / wall, 1) if wall else 0,
            "status_breakdown": statuses,
            "admitted_200": admitted,
            "denied_4xx": denied,
            "transport_errors": errors,
            "latency_ms": {
                "p50": round(_percentile(latencies_ms, 50), 2),
                "p95": round(_percentile(latencies_ms, 95), 2),
                "p99": round(_percentile(latencies_ms, 99), 2),
                "max": round(latencies_ms[-1], 2) if latencies_ms else 0,
                "mean": round(statistics.mean(latencies_ms), 2) if latencies_ms else 0,
            },
        },
        "correctness_gates": {
            "backend_invocations": stats["invocation_count"],
            "no_oversell": no_oversell,
        },
    }
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--intents", type=int, default=int(os.getenv("PERF_INTENTS", "10000")))
    ap.add_argument("--concurrency", type=int, default=int(os.getenv("PERF_CONC", "200")))
    ap.add_argument("--amount", type=int, default=int(os.getenv("PERF_AMOUNT", "1000")))
    ap.add_argument("--gateways", type=int, default=int(os.getenv("PERF_GATEWAYS", "1")))
    ap.add_argument("--topology", default=os.getenv("PERF_TOPOLOGY",
                                                    "single gateway endpoint (compose)"))
    ap.add_argument("--out", default="/reports/perf-report.json")
    args = ap.parse_args()

    rpt = run(args.intents, args.concurrency, args.amount, args.gateways, args.topology)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(rpt, f, indent=2)

    r = rpt["results"]
    print(json.dumps(rpt, indent=2))
    print(f"\n[perf] intents={rpt['sample_size_intents']} conc={rpt['concurrency']} "
          f"rps={r['throughput_rps']} p50={r['latency_ms']['p50']}ms "
          f"p95={r['latency_ms']['p95']}ms p99={r['latency_ms']['p99']}ms "
          f"no_oversell={rpt['correctness_gates']['no_oversell']}")
    # Correctness gate is the hard failure; latency is recorded, not gated.
    sys.exit(0 if rpt["correctness_gates"]["no_oversell"] else 1)


if __name__ == "__main__":
    main()
