# AEGIS Performance & Chaos Benchmark Report

All runs execute **inside containers** on the `aegis` Docker Compose network. No
host Go/Python/Node toolchain is used. Raw machine JSON is in
[`perf-report.json`](./perf-report.json).

## Test topology

| Item | Value |
|------|-------|
| Orchestration | Docker Compose (single host) |
| Gateway replicas | 1 (single endpoint) |
| Backend | mock-bank (in-network) |
| Budget store | Redis 7.2.5 (atomic Lua reservation, single hash-tag slot) |
| Audit store | PostgreSQL 16.3 (append-only hash chain, synchronous pre-dispatch write) |
| Driver | `tests/perf.py`, 200 concurrent workers (ThreadPoolExecutor) |

### Hardware (container-observed)

| Item | Value |
|------|-------|
| Kernel | Linux 6.6.x WSL2 (Docker Desktop) |
| Arch | x86_64 |
| Logical CPUs (VM) | 16 |
| Memory (Docker VM) | ~8 GiB |

> **Docker Desktop variance note (per requirements):** absolute latency under
> Docker Desktop on WSL2 is materially higher and noisier than bare metal because
> of the VM networking path and the synchronous per-request Postgres audit write.
> Latency numbers below are **recorded as-observed, not tuned or fabricated**. The
> **correctness gates are hardware-independent** and are the pass/fail criteria.

## Performance run — 10,000 intents

| Metric | Result |
|--------|--------|
| Sample size | 10,000 intents |
| Concurrency | 200 |
| Wall time | 33.04 s |
| Throughput | **302.7 req/s** |
| Latency p50 | 606.3 ms |
| Latency p95 | 838.7 ms |
| Latency p99 | 1321.3 ms |
| Latency max | 1886.3 ms |
| Transport errors | 0 |
| Admitted (200) | 500 |
| Denied (429, WINDOW_CAP_EXCEEDED) | 9,500 |

### Correctness gates (the actual pass criteria)

| Gate | Result |
|------|--------|
| **No oversell** | ✅ true |
| Backend invocations | **500** |
| Expected admissions | window_cap 500,000 ÷ amount 1,000 = **500** |

The pool's 60 s rolling window cap is 500,000 minor units; at 1,000/txn exactly
**500** reservations are admissible. Under 10,000 concurrent attempts the atomic
Redis reservation admitted **exactly 500** and the backend was invoked **exactly
500** times — **zero oversell, zero double-spend** under heavy contention. Every
one of the remaining 9,500 was correctly denied `WINDOW_CAP_EXCEEDED` *before*
dispatch.

## Concurrency correctness — 1,000 concurrent distinct reservations

From `tests/test_integration.py::test_concurrency_no_oversell[1000]` (part of the
20/20 suite): 1,000 concurrent distinct intents against the shared pool admit no
more than the mathematically admissible count, and backend invocations never
exceed admitted reservations. **PASS.**

## Chaos results

From `tests/test_chaos.py` (all PASS):

| Scenario | Invariant asserted | Result |
|----------|--------------------|--------|
| Pub/Sub loss | Gateway converges to halted state via periodic Postgres refresh alone (Pub/Sub is accelerator-only, FR-035). Waited strictly for the refresh interval, ignoring any push. | ✅ converged, `FLEET_HALTED` |
| Backend timeout storm | Every ambiguous outcome is `UNKNOWN` with held exposure + `reconciliation_required`; never a guessed success. Audit chain still verifies afterwards. | ✅ 8/8 UNKNOWN, chain valid |
| Backend hard-fail | Deterministic failure releases the reservation; never reports COMMITTED. | ✅ released |

## How to reproduce

```bash
make up            # start the full stack (one command)
make perf          # 10k-intent performance harness -> docs/benchmark-results/
make test          # 20/20 functional + concurrency@1000 + chaos suite
```

## Interpreting latency vs. correctness

AEGIS deliberately performs a **synchronous, durable, hash-chained audit write
before every dispatch** and a **single-slot atomic budget reservation**. These are
the safety guarantees; they serialize the hot path and, under Docker Desktop, cost
hundreds of ms per request. On production infrastructure (dedicated Postgres/Redis,
no VM hop) the same code path is far faster, but **the correctness gates — no
oversell, fail-closed containment, UNKNOWN handling, chain integrity — hold
identically regardless of hardware**, which is what this report certifies.
