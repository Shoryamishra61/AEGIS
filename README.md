# AEGIS — Agent Enforcement & Governance Interception System

AEGIS is a **pre-execution enforcement gateway** for AI agents acting on
money-moving (and other high-consequence) APIs. Every agent intent is intercepted
and must pass a **default-deny, fail-closed** decision pipeline before any side
effect occurs. It provides atomic budget control, durable containment (fleet halt
and per-agent revocation), and a cross-language, append-only, hash-chained audit
trail that an independent verifier can validate.

This repository is the **P0 MVP** built to `AEGIS_SRS.md` (which takes precedence
over `AEGIS_PRD.md`), plus a selected set of P1 features. It runs entirely in
containers — **a clean clone needs only Docker + Docker Compose**.

---

## Live demo (no setup)

The operator dashboard is deployed as a **self-contained, interactive demo** on
GitHub Pages — every screen works in the browser against a faithful in-browser
simulation of the control plane (decision pipeline, budgets, containment,
SSE live stream, and a real SHA-256 audit hash chain you can verify):

> **https://shoryamishra61.github.io/AEGIS/**

Pick any role on the login screen and explore. The topbar shows a **DEMO** chip
whenever the simulation backend is active. To run the *real* stack instead, use
Docker Compose below.

---

## Quick start (one command)

```bash
docker compose up --build        # or: make up
```

Then open:

| Surface | URL |
|---------|-----|
| Operator dashboard | http://localhost:5173 |
| Control plane API + docs | http://localhost:8000/docs |
| Enforcement gateway | http://localhost:8080 |
| Mock banking backend | http://localhost:9090 |

> **Ports:** Postgres and Redis are published on host ports **55432** and **56379**
> to avoid colliding with locally-running instances. Internal service-to-service
> traffic uses the compose network (`postgres:5432`, `redis:6379`) and is
> unaffected. Change these in `docker-compose.yml` if needed.

### One command for everything else

```bash
make up       # build + start the full stack, wait for health
make test     # full pytest suite: integration + e2e + concurrency@1000 + chaos
make unit     # Go unit tests + OPA policy tests (in throwaway containers)
make demo     # run the agent simulator scenarios against the live stack
make perf     # 10k-intent performance harness -> docs/benchmark-results/
make scan     # security scans (secret / dependency / static) -> docs/security-scans/
make verify   # up -> unit -> test -> demo (end-to-end gate)
make down     # stop the stack (keep data)
make clean    # stop + delete volumes (full reset)
```

If you don't have `make`, the equivalents are:

```bash
docker compose up --build -d
docker compose --profile test run --rm --build tests
docker compose --profile demo run --rm simulator
docker compose --profile perf run --rm --build perf
bash scripts/unit.sh
bash scripts/scan.sh
```

---

## Architecture

```
 agent intent
     │  (workload JWT, Idempotency-Key)
     ▼
┌─────────────────────────── Enforcement Gateway (Go, distroless) ───────────────────────────┐
│ SRS 7.3 decision precedence (fail-closed at every step):                                    │
│  identity → containment(halt/revoke) → freshness → schema → policy(OPA) → approval          │
│           → budget(atomic Redis) → DURABLE AUDIT (before dispatch) → dispatch                │
└───────────┬───────────────────────────┬───────────────────────────┬────────────────────────┘
            │                           │                           │
      Embedded OPA                 Redis 7.2.5                 PostgreSQL 16.3
   (rego.v1, structured      atomic Lua reservation      append-only hash-chained
    decision, default-deny)   {tenant} single-slot        audit + durable epochs
                                                                    ▲
                                                                    │ epochs, config, verify
                              Control Plane (FastAPI) ──────────────┘
                              agents / budgets / policies / emergency /
                              gateways / audit-verify / checkpoint / SSE stream
                                        ▲
                              Operator Dashboard (React + TS, nginx)
```

Components:

- **`gateway/`** — Go enforcement gateway with **embedded OPA** (OPA 0.68.0,
  `rego.v1`). Owns the precedence pipeline; OPA decides *permission only*, the
  gateway owns *containment and budget* precedence. Distroless image with a
  self-healthcheck flag (`/gateway -healthcheck`, no shell in image).
- **`policies/`** — Rego authz bundle (`authz.rego`) + tests (`authz_test.rego`,
  14 cases). The gateway image embeds this file as the single source of truth.
- **`control-plane/`** — FastAPI control plane: config CRUD (optimistic
  concurrency), emergency halt/resume/revoke/reinstate, gateway registry, audit
  query + **cross-language chain verifier**, HMAC **checkpoint**, **policy
  simulation diff**, SSE stream, and the **break-glass CLI** (`python -m
  app.breakglass halt|resume|status`).
- **`db/`** — migrations (`0001_init.sql`, `0002_roles.sql`), least-privilege
  roles, `seed.sql`, idempotent `bootstrap.sh`.
- **`mock-bank/`** — protected backend; gateway-only credential, idempotency,
  invocation counter, `SIM_TIMEOUT`/`SIM_FAIL` fault hooks, `/stats` `/reset`.
- **`dashboard/`** — React 18 + strict TypeScript operator UI (nginx, `/api` proxy).
  In static deploys it runs against the in-browser demo backend
  (`src/demo/backend.ts`) — see *Deploying the dashboard* below.
- **`simulator/`** — normal + rogue agent scenarios (10 scenarios, self-checking).
- **`tests/`** — pytest integration/e2e/concurrency/chaos suite + `perf.py`.

---

## Core safety guarantees (and where they're proven)

| Guarantee | Mechanism | Proof |
|-----------|-----------|-------|
| **Default-deny / fail-closed** | OPA `default effect := "DENY"`; unknown reason codes → STOP + 403 | `policies/authz_test.rego`, `test_default_deny_unknown_payee` |
| **Integer money only** | `amount_minor` int64 / BIGINT everywhere; never floats | schema + DB types |
| **No oversell** | atomic Redis Lua reservation, keys colocated under `{tenant}` hash tag (single slot) | `test_concurrency_no_oversell[1000]`, perf 10k → exactly 500 admitted |
| **Idempotency** | header+body key must match; replay returns original; different body → 409 | `test_idempotent_replay_single_reservation`, `test_idempotency_conflict_different_body` |
| **Durable containment** | monotonic epochs in Postgres; Redis hot cache + 5s freshness deadline; periodic refresh guarantees convergence (Pub/Sub is accelerator-only) | `test_fleet_halt_contains_and_converges`, `test_pubsub_loss_still_converges_via_refresh` |
| **Pre-execution audit** | hash-chained decision written **before** dispatch; audit failure → compensating reservation RELEASE | `test_no_backend_call_on_deny`, gateway `server.go` |
| **UNKNOWN handling** | backend timeout/ambiguity never guesses success/failure; exposure held, `reconciliation_required=true` | `test_backend_timeout_unknown_holds_exposure`, chaos timeout storm |
| **Tamper-evident audit** | `event_hash = sha256(canonical || prev_hash)`, append-only trigger, independent verifier | `test_audit_chain_verifies` (156+ events, Go + Python writers) |

### Cross-language hash chain

The Go gateway and the Python control plane both append to one chain. Canonical
form is byte-identical across languages: Go marshals a sorted-key compact map;
the Python verifier re-parses and re-serializes with
`sort_keys=True, separators=(",",":")`. `GET /v1/audit/verify` recomputes the
whole chain and returns `{ "valid": true, "verified_count": N }`.

---

## Test results (verified in-container)

- **Go unit tests:** pass (action, policy, reason) — `make unit`
- **OPA policy tests:** 14/14 — `make unit`
- **Functional + concurrency + chaos:** **20/20** — `make test`
- **Simulator scenarios:** **10/10** — `make demo`
- **Performance:** 10,000 intents, 302.7 rps, p50 606 ms / p95 839 ms / p99
  1321 ms, **no-oversell = true**, 500 backend calls (= window cap ÷ amount).
  See [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md). Latency reflects Docker Desktop
  variance and a synchronous pre-dispatch audit write; **correctness gates are
  hardware-independent.**

APIs: gateway spec in [`docs/openapi-gateway.yaml`](docs/openapi-gateway.yaml);
control-plane spec auto-generated at `/openapi.json` (snapshot in
[`docs/openapi-control-plane.json`](docs/openapi-control-plane.json)).

---

## Demo walkthrough

```bash
make up
make demo    # normal ALLOW, rogue POLICY_DENY, payee/cap denials, replay,
             # idempotency conflict, UNKNOWN timeout, 1000-way no-oversell,
             # fleet halt containment, agent revoke
```

Break-glass halt (independent of the API), then verify convergence and chain:

```bash
docker compose exec control-plane python -m app.breakglass halt   --reason drill --actor oncall
curl -s localhost:8080/readyz                       # halt_epoch advances
docker compose exec control-plane python -m app.breakglass resume --reason clear --actor oncall
curl -s -H "Authorization: Bearer auditor-token-dev" localhost:8000/v1/audit/verify
```

---

## Security automation

`make scan` runs, all in containers (no host tooling):

- **Secret scan** — gitleaks over the repo (`docs/security-scans/gitleaks.json`).
  The only current finding is an *example token inside `AEGIS_SRS.md`* (a spec
  document), not a live credential.
- **Dependency audit** — `pip-audit` (Python) and `npm audit` (dashboard). Recorded
  advisories and MVP disposition in `docs/security-scans/pip-audit.txt`.
- **Static analysis** — `gosec` and `govulncheck` over the gateway.
- **Authorization** — runtime RBAC assertions in the test suite (auditor cannot
  halt → 403; unauthenticated → 401; mock-bank rejects non-gateway callers → 401).

Scans are **best-effort and non-gating** in the MVP (they report, they don't fail
the build). Findings and upgrade paths are recorded under `docs/security-scans/`.

---

## Dev credentials (MVP only)

RBAC is an OIDC stand-in via static dev bearer tokens:

| Role | Token | Capability |
|------|-------|------------|
| admin | `admin-token-dev` | full config + emergency control |
| operator | `operator-token-dev` | operational actions |
| auditor | `auditor-token-dev` | read audit, verify, checkpoint (no mutation) |

Agent workload credentials are HMAC-signed JWTs (secret in `.env.example`).
**These are development stand-ins and must be replaced in any real deployment.**

---

## Scope: what is and isn't in this MVP

### Included — P0 (complete)
Enforcement gateway + embedded OPA, Rego policies + tests, atomic Redis budget
lifecycle (RESERVED→DISPATCHED→COMMITTED/RELEASED/UNKNOWN), durable revocation +
fleet halt, Postgres audit trail + integrity verifier, FastAPI control plane,
React/TS dashboard, mock bank, normal + rogue simulator, Docker Compose,
migrations, seed, OpenAPI, tests (unit/integration/e2e/concurrency/chaos/perf).

### Included — selected P1
- **Hash-chain + independent verifier** (FR-044/045)
- **Break-glass halt CLI** (FR-037)
- **Policy simulation diff** (FR-017)
- **Basic security automation** (secret / dependency / static / authorization scans)

### Single-admin mode (explicit, audited)
The MVP runs in **explicitly labelled single-admin mode**. Approval-related
schemas/types are kept extensible, but **no partially-implemented approval path is
exposed**. Any `REQUIRE_APPROVAL` policy effect **fails closed** — the action is
denied and never dispatched. Every emergency/config mutation is audited.

### Deferred (documented, intentionally not built)
Approval workflow with bound approval tokens; dual-control / two-person auth;
ML / Isolation-Forest anomaly detection; external signed/WORM checkpoints;
Splunk/SIEM export; enterprise OIDC / SPIFFE-SPIRE / HSM; multi-region /
multi-tenant; cross-currency budget aggregation.

---

## Deploying the dashboard (GitHub Pages / Vercel)

The full stack (gateway, control plane, Postgres, Redis) requires Docker Compose
and cannot run on static hosting. The **operator dashboard** can be deployed
standalone: it is built with `VITE_DEMO_MODE=1`, which installs
[`dashboard/src/demo/backend.ts`](dashboard/src/demo/backend.ts) — an in-browser
simulation of the control plane with the full API surface, RBAC, optimistic
concurrency, an SSE stream and a genuine SHA-256 hash chain. The UI is fully
interactive (halt the fleet, revoke an agent, activate policy, verify the audit
chain); only the money movement itself is simulated, and a **DEMO** chip in the
topbar makes that unmistakable.

### GitHub Pages (automatic)

`.github/workflows/deploy-pages.yml` builds the dashboard on every push to
`main` that touches `dashboard/**` (or on demand via *Run workflow*) and deploys
it to Pages at `/AEGIS/`. One-time setup: **Settings → Pages → Source:
GitHub Actions**. The workflow handles the `/AEGIS/` base path, a `404.html` SPA
fallback for deep links, and `.nojekyll`.

### Vercel (alternative)

1. Import the repository into Vercel.
2. Set **Root Directory** to `dashboard`, **Build Command** to `npm run build`,
   **Output Directory** to `dist`.
3. Add environment variable `VITE_DEMO_MODE=1` (Production + Preview).
4. Deploy — Vercel handles SPA rewrites natively; no base-path flag is needed.

Either way, the dashboard talks to nothing at runtime: the demo backend is
bundled into the static site. To point the dashboard at a *real* control plane
instead, set `VITE_CONTROL_URL` and build without `VITE_DEMO_MODE` (CORS or a
same-origin proxy must then be configured on the control plane side).

---

## Pinned versions (reproducibility)

`postgres:16.3-bookworm`, `redis:7.2.5-bookworm`, `golang:1.22-bookworm`,
`python:3.11-slim-bookworm`, `node:20.16.0-bookworm`, `nginx:1.27.0-bookworm`,
`openpolicyagent/opa:0.68.0`, `gcr.io/distroless/static-debian12`. Python/Node/Go
dependencies are version-pinned in their respective manifests.

---

## Assumptions

- Docker Desktop / Compose is the only supported runtime for the MVP; latency is
  reported as-observed and not tuned (see `docs/BENCHMARKS.md`).
- Dev bearer tokens and the HMAC agent-signing secret stand in for a real IdP and
  workload identity system, which are deferred P1.
- The performance harness drives a single gateway endpoint; correctness gates are
  independent of replica count because the atomic Redis reservation is the single
  source of truth. Scale replicas with `docker compose up --scale gateway=N`.
