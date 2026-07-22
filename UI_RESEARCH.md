# AEGIS — UI Research & Information Architecture

> Reference analysis for the AEGIS operator experience. References are used as
> **inspiration only** — no layouts, assets, or branding are copied. Everything
> below maps back to the SRS (source of truth): reason codes, roles, state
> machines, decision precedence, and failure semantics.

## 1. Reference set

| Product | URL | Why it's relevant to AEGIS |
|---------|-----|----------------------------|
| Apple (Human Interface) | https://developer.apple.com/design/ | Hierarchy, whitespace, restraint, interaction clarity |
| Eightfold AI | https://eightfold.ai/ | Enterprise AI workflows, explainability framing |
| Stripe Dashboard | https://dashboard.stripe.com / https://stripe.com/docs | Dense financial/developer info made legible; reason/decline codes |
| Ramp | https://ramp.com/ | Premium finance dashboard, spend controls, policy limits |
| Mercury | https://mercury.com/ | Calm financial surfaces, approvals, account states |
| Linear | https://linear.app/ | Navigation speed, keyboard-first, polished micro-interactions |
| Wise | https://wise.com/ | Transparent money movement, fees/limits shown honestly |
| Vercel | https://vercel.com/dashboard | System health/observability, deployment/status timelines |
| Figma | https://figma.com/ | Contextual onboarding, spotlight tours, collaboration cues |

## 2. Useful interaction patterns observed

- **Stripe** — every declined charge carries a machine code + human explanation +
  "what to do next." Correlation IDs are first-class and copyable. → AEGIS mirrors
  this with reason codes + `advice` + `correlation_id` everywhere.
- **Ramp / Mercury** — spend controls are shown as *limits with live consumption*
  (bar to cap), not abstract numbers. Denials cite the rule that fired. → AEGIS
  Budgets page shows per-txn / window / shared caps with live `committed`/`held`.
- **Linear** — command palette + keyboard nav, instant view switches, optimistic
  yet reversible actions, progress shown inline. → AEGIS uses fast left-rail nav,
  `⌘K`-style quick nav, and version-token optimistic updates with 409 handling.
- **Vercel** — health as a first glance (green/amber/red), event timeline with
  precise timestamps, "last updated Xs ago" freshness. → AEGIS Command Center and
  System Health show gateway freshness, halt coverage, latency.
- **Figma** — first-run spotlight tours that dim the screen and explain one thing
  at a time, resumable, never nagging. → AEGIS tour engine (versioned per role/page).
- **Wise** — never hides fees/limits; shows the exact figure and why. → AEGIS shows
  the exact cap and the exact overage on `*_CAP_EXCEEDED`.
- **Apple** — one primary action per view; secondary actions demoted; generous
  spacing; type carries hierarchy instead of borders/boxes.

## 3. What AEGIS adopts

- Reason-code-first decision surfaces (Stripe-style) with copyable correlation IDs.
- Limit-with-live-consumption budget visualization (Ramp/Mercury).
- A prominent, always-reachable **Emergency** affordance (never buried, never
  blocked by tours or modals) — safety outranks polish.
- A **decision pipeline visualization** (SRS §7.3 precedence) as the signature
  view — identity → schema → containment → policy → budget → audit → execute.
- Health-at-a-glance with **gateway freshness** and **halt acknowledgement
  coverage** (Vercel-style observability applied to a safety fabric).
- Contextual, versioned, resumable tours (Figma-style), gated on data-ready.
- Keyboard accessibility and speed (Linear).

## 4. What AEGIS avoids (explicit)

- Generic admin-template shells, card soup, glassmorphism, neon, decorative
  gradients, permanent dark backgrounds, overdramatic animation. (Per brief.)
- **Meaningless charts** — every chart answers an operator question (exposure,
  allow/deny rate, latency, freshness). No vanity sparklines.
- **AI in the hot path** — the copilot/explainer are read-only and advisory; they
  can never allow/deny, change budgets, activate policy, revoke, or halt/resume.
- **Fabricated data or metrics** — every number comes from a real API; performance
  claims ("protected in X ms") are measured from the live system, never hardcoded.
- **Authorization by hidden buttons** — the server enforces roles on every call;
  the UI only *reflects* permissions.

## 5. Resulting Information Architecture

Top-level navigation (grouped, role-filtered):

```
OVERVIEW
  • Command Center           /                    all roles
MONITOR
  • Live Activity            /activity            all roles
  • Decision Timeline        /activity/:corr      all roles
  • Audit Explorer           /audit               all roles
  • Audit Integrity          /audit/integrity     auditor, admin, operator
GOVERN
  • Agents                   /agents              all roles (write: admin)
  • Agent Detail             /agents/:id
  • Register Agent           /agents/new          admin (Policy/Risk personas)
  • Policy Studio            /policies            all (write/activate: admin)
  • Policy Simulation        /policies/:v/simulate  admin, operator
  • Budgets & Pools          /budgets             all roles
CONTAIN
  • Emergency Control        /emergency           admin, operator (Security persona)
SYSTEM
  • System Health            /health              all roles
  • Demo Mode                /demo                all roles
HELP
  • Help & Tours             /help                all roles
```

### Persona → backend role mapping (4 personas, 3 real tokens)

The SRS/backend enforces **3 roles** (`admin`, `operator`, `auditor`) via dev
bearer tokens. The four product personas map onto these, and the **server remains
authoritative** — the UI never grants access the token lacks:

| Persona (PRD) | Backend role/token | Primary surfaces |
|---------------|--------------------|------------------|
| Policy Administrator | `admin` (`admin-token-dev`) | Policy Studio, activate, agent registration, budgets |
| Risk Operator | `operator` (`operator-token-dev`) | Command Center, activity, simulate, revoke |
| Security Operator | `operator` (`operator-token-dev`) | Emergency Control, halt/resume, revoke, integrity |
| Auditor | `auditor` (`auditor-token-dev`) | Audit Explorer, Integrity Verification (read-only) |

> Personas are a presentation layer over the real roles. If a persona attempts an
> action its underlying token can't perform, the API returns 403 and the UI shows
> a truthful **access-denied** state — not a hidden button.

### Cross-cutting surfaces (available in context, not as pages)

- **Decision Explainer** — drawer on any action/decision (deterministic).
- **AI Risk Copilot** — read-only drawer; deterministic mode when no LLM provider
  is configured (shows "AI provider not configured" and disables LLM-only actions).
- **Product Tours** — spotlight overlay, launched contextually / from Help.
- **Emergency affordance** — persistent header control, always reachable.

## 6. Backend contract mapping (no invented conflicting endpoints)

Existing (source of truth) endpoints consumed by the UI:

- Agents: `GET /v1/agents`, `GET /v1/agents/{id}`, `PATCH /v1/agents/{id}`
- Budgets: `GET /v1/budgets`
- Policies: `GET /v1/policies`, `GET /v1/policies/{v}`,
  `POST /v1/policies/{v}/simulate`, `POST /v1/policies/{v}/activate`
- Emergency: `POST /v1/emergency/{halt,resume,revoke,reinstate}`,
  `GET /v1/emergency/status`
- Gateways: `GET /v1/gateways`
- Audit: `GET /v1/audit/events`, `GET /v1/audit/verify`,
  `POST /v1/audit/checkpoint`
- Stream: `GET /v1/stream` (SSE)
- Meta: `GET /v1/meta`, health: `/healthz`, `/readyz`
- Gateway enforcement: `POST /v1/actions` (via a control-plane demo proxy so the
  browser doesn't need to mint agent JWTs).

New **minimal, non-conflicting** endpoints added for genuine functionality
(documented in the backend, role-enforced server-side):

- `POST /v1/agents` — register an agent (admin) — persists to `agents`.
- `POST /v1/policies` — create a **draft** policy version (admin).
- `POST /v1/policies/validate` — validate Rego/schema + run policy tests (admin/operator).
- `GET  /v1/summary` — Command Center aggregate metrics (all roles).
- `POST /v1/explain` — deterministic Decision Explainer from a correlation id / reason set.
- `POST /v1/demo/run` — Judge Demo scenario trigger that drives the real gateway
  and returns measured latency + evidence (all roles).

These extend the surface; they do **not** change or weaken any existing safety
semantics, and each reuses the same audit chain and role guards.
