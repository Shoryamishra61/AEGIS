# AEGIS

## Governance Layer for Financial Agents

### Product Requirements Document + Software Requirements Specification

Version 1.0 | 22 July 2026 | Round 1 / MVP implementation baseline

**Working expansion:** Agent Execution Governance & Integrity System

**Product thesis:** No autonomous financial action reaches an execution system unless a deterministic gateway has authenticated the agent, evaluated the exact action against an approved policy version, reserved the required budget atomically, and created durable evidence of the decision.

> **Recommended decision:** Build a small, enforceable vertical slice: Go enforcement gateway + embedded OPA; FastAPI control plane; Redis atomic budget reservations and durable halt epochs; PostgreSQL append-only audit evidence; React operator console; Python agent simulator. Keep all AI/ML outside the authorization hot path.

**Document owner:** Product and Systems Architecture

**Reviewers required:** Product, Security, Risk/Compliance, Backend, Frontend, QA, SRE

**Status:** Approved design recommendation; benchmark and organization-specific controls remain subject to validation.

## Document control and reading conventions

This specification is intentionally explicit about what is known, inferred, assumed, and recommended.

| Tag | Meaning | Treatment |
|---|---|---|
| **[C] Confirmed** | Stated by the challenge brief or an authoritative cited source. | May create a mandatory requirement. |
| **[I] Inferred** | Reasonably derived from the problem but not explicitly stated. | Validate with stakeholders; may be included in MVP when low-risk. |
| **[A] Assumption** | Necessary to make the design implementable with missing information. | Marked **[VALIDATION REQUIRED]** and isolated for reversal. |
| **[R] Recommendation** | Engineering or product choice made after trade-off analysis. | Accepted as the baseline unless an ADR trigger occurs. |

Requirement priority uses **P0** (release-blocking/Must), **P1** (Should), **P2** (Could), and **P3** (Won't in this release). “MVP” means a locally deployable, demonstrable system; it does not mean production certification.

## 1. Executive summary

### 1.1 Outcome

**[C]** The challenge requires granular per-agent permissions, dynamic spend caps, real-time agent and fleet revocation, an operator dashboard, a complete action log, and measurable policy accuracy, latency, and auditability. The system must actively stop prohibited actions; passive monitoring is insufficient.

**[R]** AEGIS will be an inline, zero-trust **Action Governance Gateway** between autonomous agents and protected financial tools. Agents are treated as untrusted callers. An action is forwarded only after five gates succeed: identity, schema, revocation state, policy decision, and atomic budget reservation. A durable audit decision is recorded before dispatch.

**[R]** The MVP should prove one sharp claim: a normal financial agent continues operating, a prompt-injected or malfunctioning agent is denied before a high-value transfer, a concurrent budget-race cannot exceed its cap, and a fleet halt prevents all new dispatches while producing operator-visible acknowledgements and audit evidence.

### 1.2 The recommended product

- **Enforcement data plane:** Go gateway with an embedded OPA evaluator and a canonical action envelope.
- **Policy model:** Default-deny hybrid RBAC + ABAC using agent identity, action, resource, amount, currency, risk tier, purpose, delegation, environment, and time context.
- **Budget model:** Redis server-side atomic reservation, followed by commit, release, or unknown/reconciliation states. Monetary values use integer minor units; never floating point.
- **Revocation model:** Durable, monotonic halt/revocation epochs persisted in authoritative state; Redis Streams for recoverable delivery and acknowledgements; Pub/Sub only for low-latency notification.
- **Evidence model:** PostgreSQL append-only event records, per-tenant hash links, restricted mutation, verification jobs, and signed checkpoints in production. This is **tamper-evident**, not magically immutable.
- **Control plane:** FastAPI configuration service and React operator console for agents, policy lifecycle, budgets, live decisions, revocation, and emergency halt.
- **AI role:** Optional asynchronous anomaly alerting only. No LLM or ML model may grant permission, increase a cap, resume a halted fleet, or directly execute a financial action.

### 1.3 What makes the design credible

- Enforcement occurs before the protected API, and the protected API is network-restricted to accept only gateway-authenticated traffic.
- Concurrency is handled by a reservation state machine rather than a non-atomic “check then decrement.”
- Kill-switch safety does not depend on lossy Pub/Sub delivery.
- “Full audit log” is implemented as an execution prerequisite; a high-impact action is not forwarded if its decision cannot be durably journaled.
- Performance claims are split into policy-compute latency, total governance overhead, and revocation convergence. Every target is tied to a repeatable benchmark rather than asserted as a vendor fact.

### 1.4 MVP proof and headline targets

| Metric | MVP acceptance target | Status |
|---|---|---|
| Unauthorized forwarding | 0 of at least 10,000 adversarial/negative test actions | [A] **[VALIDATION REQUIRED]** |
| Policy evaluation | p99 ≤ 5 ms at 500 evaluations/s on declared hardware | [A] target, not a pre-existing fact |
| Added gateway overhead | p99 ≤ 25 ms at 100 actions/s, excluding downstream API time | [A] target |
| Fleet-halt notification | p99 ≤ 100 ms across 20 local simulated gateways | [A] demo target |
| Durable halt convergence | 100% active gateways acknowledge the halt epoch within 1 second | [A] acceptance target |
| Audit completeness | 100% of accepted intents have decision and terminal/unknown outcome records in a 10,000-action test | [A] target |
| Budget correctness | 0 cap breaches under at least 1,000 concurrent attempts against one shared pool | [A] target |

## 2. Report synthesis

### 2.1 Source hierarchy

| Source | Role in this document | Authority |
|---|---|---|
| S1 — Challenge brief supplied by the user | Product scope, required tasks, submission deliverables | Primary source of truth |
| S2 — Consolidated AEGIS/Sentinel reports supplied by the user | Candidate architecture, metrics, risks, five-day plan | Secondary; claims validated before adoption |
| S3 — `Pasted text(33).txt` | Required analysis and document structure | Process requirement |
| S4 — NIST AI RMF 1.0 and Playbook | Risk-governance vocabulary and lifecycle alignment | Authoritative voluntary framework |
| S5 — Open Policy Agent documentation | Policy-engine behavior, bundles, decision logs, external-data boundaries | Authoritative technical source |
| S6 — Cedar Policy Language documentation | Authorization semantics and validation alternative | Authoritative technical source |
| S7 — Redis documentation | Atomic script behavior and Pub/Sub delivery semantics | Authoritative technical source |
| S8 — PostgreSQL documentation | Database access-control primitives | Authoritative technical source |

### 2.2 Synthesis decisions

| Input claim or direction | Disposition | Reason |
|---|---|---|
| Deterministic gate between agent and financial API | **Retain** | Directly addresses active enforcement and reduces dependence on probabilistic model behavior. |
| Full MCP proxy in the MVP | **Narrow** | Implement a canonical HTTP/JSON action envelope and one MCP adapter only if time permits; do not claim full protocol compatibility without conformance tests. |
| Cedar is categorically superior and automatically formally verifies policies | **Correct** | Cedar provides default-deny/forbid-overrides semantics and schema validation, but correctness still depends on schema, policy intent, entity data, and integration behavior. |
| Use Cedar and OPA together | **Reject for MVP** | Two policy runtimes increase surface area and weaken the five-day feasibility story. |
| Go gateway + embedded OPA | **Select** | One runtime, mature Go embedding, structured decisions, local operation, and straightforward testability. |
| Redis Lua check/decrement | **Upgrade** | Use reserve → dispatch → commit/release/unknown; a one-step decrement cannot correctly handle downstream failure or uncertainty. |
| Redis Pub/Sub is the kill switch | **Correct** | Redis documents at-most-once delivery; Pub/Sub is an accelerator, not the authoritative safety mechanism. |
| Hash-chained PostgreSQL is immutable | **Correct** | A chain detects some tampering but a privileged actor can rewrite a complete chain. Append-only controls, external signed checkpoints, and verification are needed for stronger evidence. |
| Audit logging can be asynchronous while guaranteeing every intent is logged | **Resolve** | Persist the authorization decision before dispatch. Outcome updates may be asynchronous only when already durably queued. |
| Isolation Forest automatically triggers circuit breakers | **Defer** | False positives could stop legitimate financial activity. MVP anomaly detection is alert-only; automatic action requires a separately governed rule and evidence. |
| Fail closed for all dependency failures | **Refine** | Fail closed for new high-impact actions when identity, policy, revocation freshness, budget, or audit prerequisites are unavailable. Preserve read-only observability and break-glass halt operations. |
| “Sub-5 ms” as total request overhead | **Separate** | Policy compute may meet that target; Redis and durable PostgreSQL I/O make total overhead a different benchmark. |

### 2.3 First-principles product model

AEGIS is not a fraud model, a chatbot guardrail, or a dashboard. It is a **reference monitor** for agent actions. For the monitor to be meaningful, it must be:

- **Complete:** every protected action traverses the gateway; direct backend access is blocked.
- **Tamper-resistant:** agents cannot alter policies, budget state, identity claims, or audit evidence.
- **Small and testable:** the authorization and budget hot path has bounded, deterministic behavior.
- **Fail-safe:** missing or stale safety state cannot turn into implicit permission.
- **Explainable:** every decision exposes a stable reason code, policy version, and evidence pointer.

## 3. Confirmed facts

1. **[C/S1]** The solution must scope each agent’s allowed actions with configurable granular controls.
2. **[C/S1]** Dynamic spend caps and budget limits must be enforced in real time across deployed agents.
3. **[C/S1]** Operators need per-agent revocation and an emergency fleet stop.
4. **[C/S1]** The operator interface must configure policies, monitor activity, and review audit logs.
5. **[C/S1]** The system must be tested for policy accuracy, low-latency impact, and auditability.
6. **[C/S1]** Required submission artifacts include a project description, presentation, video/link, and relevant supporting files.
7. **[C/S1]** The technology stack is open; OPA, Splunk, and NIST AI RMF are references, not mandatory dependencies.
8. **[C/S4]** NIST AI RMF organizes risk-management outcomes into Govern, Map, Measure, and Manage, with governance cross-cutting the lifecycle. Alignment is voluntary and context-specific; it is not a certification.
9. **[C/S5]** OPA is a general-purpose policy engine and does not provide a complete control plane out of the box.
10. **[C/S7]** Redis server-side scripts execute atomically relative to other Redis activity, while Redis Pub/Sub uses at-most-once delivery.

## 4. Assumptions and validation needs

| ID | Assumption | Why needed now | Validation / reversal path |
|---|---|---|---|
| A-01 | The Round 1 MVP has approximately five build days. | Drives ruthless vertical-slice scope. | Confirm deadline and team size; scale plan if different. |
| A-02 | The demo is single-tenant and single-region. | Keeps revocation and hash-chain semantics testable. | Add tenant and region partitions after the MVP. |
| A-03 | No live bank or card-network API is available. | Requires a mock protected backend. | Replace adapter only; governance contract remains stable. |
| A-04 | Agents call a canonical JSON action API; an MCP adapter is optional. | Avoids unsupported “full MCP” claims. | Confirm target agent frameworks and protocol versions. |
| A-05 | Each protected backend accepts an idempotency key or exposes reconciliation. | Required for safe timeout handling. | If false, classify actions as non-retriable and require manual reconciliation. |
| A-06 | Budget currency is ISO 4217 and caps are evaluated only within the same currency in MVP. | Prevents incorrect FX aggregation. | Add trusted, versioned FX snapshots later. |
| A-07 | Operator identity is represented by development OIDC/JWT claims in the demo. | Allows role enforcement without building an identity provider. | Integrate the bank’s IdP in production. |
| A-08 | Demo scale is 20 gateways, 1,000 registered agents, and 100 sustained actions/s. | Defines benchmark conditions. | Replace with organization workload model. |
| A-09 | Default demo audit retention is 30 days. | Enables a working retention job. | Legal, records, and privacy teams must set production retention. |
| A-10 | PostgreSQL and Redis run locally via Docker Compose for the demo. | Ensures data independence. | Replace with managed or clustered services in hardening. |

All assumptions are **[VALIDATION REQUIRED]**. None should be presented as a customer commitment.

## 5. Contradictions and unresolved questions

### 5.1 Resolved contradictions

- **Policy engine:** OPA is the MVP implementation; Cedar remains a documented alternative. The policy interface is provider-neutral enough to permit later evaluation, but no dual runtime is built now.
- **Latency:** “policy compute,” “governance overhead,” and “end-to-end action latency” are measured separately.
- **Kill switch:** the emergency event is persisted as an epoch; Pub/Sub reduces notification delay but is never the sole source of truth.
- **Auditability:** the document claims tamper-evidence, not absolute immutability. Stronger non-repudiation requires signed checkpoints outside the database trust boundary.
- **AI anomaly response:** alerts may recommend containment; only deterministic policy/operator commands can change enforcement state.

### 5.2 Open questions that affect production, not the demo

- Which jurisdictions, records-retention schedules, data-residency rules, and regulatory control catalogs apply?
- What exact financial actions, resources, and risk tiers form the authorization vocabulary?
- What is the required multi-region behavior during network partition?
- Which systems are authoritative for agent identity, human delegation, payee allowlists, and account state?
- Which actions support cancellation, rollback, idempotency, and outcome reconciliation?
- Is a two-person rule required for policy activation, budget increases, fleet resume, or all three?
- What availability and recovery objectives are acceptable for safety infrastructure that intentionally fails closed?

## 6. Refined problem statement

**[R] Testable definition:** Given an authenticated autonomous agent that proposes a financial tool action, the bank needs an inline control that, before dispatch, deterministically decides whether that exact principal may perform that action on that resource under the current context; atomically reserves applicable budget; rejects revoked or halted principals; and records reviewable evidence. The control must prevent bypass, behave safely under concurrency and dependency failure, expose operator controls, and demonstrate bounded latency and complete audit coverage under declared test conditions.

### 6.1 Root causes

- LLM reasoning is probabilistic and can be influenced by prompt injection, stale context, hallucination, or tool misuse.
- Ordinary API authentication proves caller identity but usually does not express agent-specific action, resource, amount, purpose, delegation, or shared budget constraints.
- Post-hoc monitoring detects harm after execution and cannot serve as a prevention control.
- Concurrent agents can exhaust shared limits unless spend is reserved atomically.
- Distributed revocation can be delayed or lost if implemented only as a transient message.
- Conventional application logs may leak sensitive data, omit denied intents, or be mutable without detectable evidence.

### 6.2 Product boundary

AEGIS governs the **authority to attempt an action**. It does not decide whether an investment is wise, whether a transaction is fraudulent, or whether a customer is creditworthy. Those decisions remain with the appropriate banking systems and human governance.

## 7. Objectives and non-objectives

### 7.1 Objectives

1. **O-01 — Prevent unauthorized execution:** No protected action is forwarded without a valid allow decision for the active policy version.
2. **O-02 — Bound financial exposure:** Enforce per-action, time-window, agent, and shared-pool caps without race-condition overspend.
3. **O-03 — Contain incidents:** Revoke one agent or halt the fleet through a durable, observable state transition.
4. **O-04 — Produce decision evidence:** Record the intent, normalized context, decision, rule/reason, policy version, reservation, dispatch, and outcome without storing prohibited secrets.
5. **O-05 — Enable safe operations:** Allow authorized operators to simulate, activate, roll back, and inspect policies; configure budgets; and verify halt convergence.
6. **O-06 — Prove behavior:** Ship adversarial, concurrency, failure, latency, and audit-completeness tests with reproducible results.
7. **O-07 — Preserve evolvability:** Keep agent adapters, policy evaluation, budget coordination, and protected backends behind narrow interfaces.

### 7.2 Non-objectives

- Replacing enterprise IAM, fraud/AML, sanctions screening, approval systems, or the core financial ledger.
- Letting an LLM make final authorization, cap-increase, resume, or execution decisions.
- Claiming legal/regulatory certification from NIST AI RMF alignment.
- Supporting every MCP transport or agent framework in the MVP.
- Guaranteeing rollback of an already committed financial transaction.
- Multi-region active-active consistency, cross-currency aggregation, hardware-rooted signing, or production WORM retention in Round 1.
- Training a production anomaly model on synthetic demo data.

## 8. Stakeholders and personas

### 8.1 Stakeholder map

| Stakeholder | Primary need | Decision authority | Key evidence |
|---|---|---|---|
| Chief Risk Officer / Risk Operator | Bound exposure and stop unsafe automation | Risk limits and emergency action | Live state, cap utilization, halt acknowledgements |
| Policy Administrator | Express and safely deploy permissions | Policy drafting, simulation, rollback | Validation results, diffs, policy version |
| Security Operations | Detect abuse and investigate incidents | Revoke credentials, open incidents | Denials, identity, anomaly and integrity alerts |
| Agent Developer | Integrate actions without ambiguous failures | Agent adapter and retry behavior | Stable API, reason codes, sandbox simulator |
| Auditor / Compliance Reviewer | Reconstruct who did what, why, and under which policy | Evidence review and export | Complete event chain, verification report |
| Platform/SRE | Keep the data plane safe and observable | Deployment and recovery | Health, dependency freshness, SLOs, runbooks |
| Approver / Business Owner | Review held high-risk actions | Transaction approval where applicable | Original intent, policy result, business context |

### 8.2 Primary personas

**[I] Priya, Risk Operations Lead.** Priya oversees dozens of specialized agents. She needs a reliable view of status and exposure, an immediate halt control, and proof that every gateway has converged. Her biggest fear is a green dashboard while stale gateways continue dispatching.

**[I] Arjun, Policy Engineer.** Arjun translates business controls into policy. He needs typed input schemas, dry-run simulation against recorded/synthetic actions, diffs, test coverage, approval, version pinning, and one-click rollback.

**[I] Meera, Security Investigator.** Meera needs to trace a suspicious action across identity, decision, reservation, downstream outcome, and operator changes without exposing full account identifiers.

**[I] Dev, Agent Engineer.** Dev needs deterministic errors that tell the agent whether to stop, request human approval, wait for a limit reset, or reconcile an unknown downstream result. He must never “retry until it works” after a policy denial.

## 9. User journeys and use cases

### 9.1 Journey J-01 — Onboard an agent safely

1. A Policy Administrator registers an agent identity, owner, risk tier, environment, allowed action families, and budget pool.
2. The administrator selects or creates a policy template and cap configuration.
3. AEGIS validates schema and policy, runs golden positive/negative cases, and produces an impact simulation.
4. The approved version is activated and assigned an immutable version ID.
5. The agent receives a scoped credential outside AEGIS; the gateway maps verified claims to the registered principal.
6. The dashboard shows Active only after configuration, policy, budget, and identity checks pass.

**Acceptance:** an unregistered or partially configured agent remains denied by default.

### 9.2 Journey J-02 — Execute a permitted action

1. The agent submits an action with a unique idempotency key.
2. The gateway authenticates the caller and normalizes the action envelope.
3. Halt/revocation freshness, permission policy, and limits are evaluated.
4. A budget reservation is created atomically.
5. The allow decision is durably audited; the reservation becomes Dispatched.
6. The action is forwarded with the same idempotency key.
7. Success commits the reservation; a definitive pre-execution failure releases it; a timeout becomes Unknown and retains exposure pending reconciliation.

### 9.3 Journey J-03 — Block a rogue high-value transfer

The simulator injects a request for an unapproved payee and an amount above the per-transaction limit. AEGIS returns Deny with stable reason codes, does not create a spend reservation, never calls the protected backend, and displays the event in the operator feed.

### 9.4 Journey J-04 — Stop one agent

A Security Operator revokes the agent, creating a new revocation epoch. Connected gateways receive the notification, refresh durable state, acknowledge the epoch, and deny new actions from that agent. Existing irreversible actions are not claimed to be undone; cancellable work receives best-effort cancellation.

### 9.5 Journey J-05 — Halt and safely resume the fleet

An authorized Risk Operator activates the fleet halt. The control plane persists a monotonic epoch and publishes recoverable and low-latency notifications. Every gateway denies new dispatches and reports acknowledgement. Resume is a distinct command; production requires dual authorization, while the demo may use a clearly labeled single-admin assumption.

### 9.6 Journey J-06 — Investigate and verify evidence

An auditor filters by agent, action, decision, time, reason code, policy version, and correlation ID; inspects the event lineage; exports a redacted evidence package; and runs integrity verification against chain and checkpoint data.

### 9.7 Use-case catalog

| ID | Use case | Primary actor | Expected result |
|---|---|---|---|
| UC-01 | Register/disable an agent | Policy Admin | Principal lifecycle is versioned and audited. |
| UC-02 | Create, validate, simulate, activate, roll back policy | Policy Admin | Only tested, authorized policy reaches data plane. |
| UC-03 | Configure per-action/time-window/shared cap | Risk Operator | Versioned cap enforced before dispatch. |
| UC-04 | Authorize and execute action | Agent | Allowed action is reserved, audited, dispatched, finalized. |
| UC-05 | Deny by permission | Agent | No downstream call; exact reason and version recorded. |
| UC-06 | Deny by cap | Agent | No overspend; reset/remaining metadata returned safely. |
| UC-07 | Revoke one agent | Security Operator | New requests denied; convergence visible. |
| UC-08 | Halt fleet | Risk Operator | New dispatches stop; acknowledgements tracked. |
| UC-09 | Resume fleet | Authorized operators | New epoch issued; safety prerequisites revalidated. |
| UC-10 | Review/export audit | Auditor | Redacted, verifiable evidence package produced. |
| UC-11 | Run simulator/benchmark | QA/Engineer | Repeatable correctness and latency report generated. |
| UC-12 | Receive anomaly/integrity alert | Security Operator | Alert is triaged; no ML-originated permission change. |

## 10. Complete Product Requirements Document

### 10.1 Product vision

Make autonomous financial systems governable by construction: every action has bounded authority, bounded exposure, immediate containment, and reviewable evidence.

### 10.2 Product principles

- **Determinism over persuasion:** authorization is code and state, not model judgment.
- **Prevention over observation:** deny before execution; never confuse alerts with controls.
- **Least privilege and default deny:** absence, ambiguity, staleness, or evaluation error does not grant access.
- **State machines over counters:** budgets and revocations use explicit lifecycle semantics.
- **Evidence before action:** no durable decision record, no financial dispatch.
- **Safe degradation:** observability may degrade; enforcement may not silently open.
- **Truthful claims:** distinguish local benchmarks from production SLOs and tamper-evidence from immutability.

### 10.3 Jobs to be done

1. When deploying a new autonomous agent, a bank must precisely limit what it may do so one credential does not imply broad financial authority.
2. When many agents consume the same budget, the bank must prevent aggregate overspend even under concurrency.
3. When suspicious behavior or an incident occurs, an operator must stop further dispatches and verify which enforcement points received the command.
4. When a decision is challenged, an investigator must reconstruct input, policy, limit state, operator changes, and outcome without revealing unnecessary PII.
5. When policy changes, administrators must know which historical actions would change result before rollout.
6. When dependencies fail, platform teams must know whether the system denied, queued, reconciled, or became stale.

### 10.4 MVP product scope

#### Must — P0

- Agent registry with owner, status, risk tier, environment, and policy/budget assignments.
- Canonical action envelope and mock protected financial API.
- Deterministic permission evaluation with default deny and stable reason codes.
- Versioned OPA policy bundle with validation, tests, activation, and rollback.
- Per-transaction, rolling/fixed-window, agent, and shared-pool limits.
- Atomic budget reservation and explicit outcome lifecycle.
- Per-agent revoke and fleet halt using durable epochs and gateway acknowledgements.
- Durable redacted audit events for allowed and denied intents, config changes, halt commands, and outcomes.
- Operator console for status, limits, activity, policy versions, halt, and audit search.
- Agent simulator covering normal, rogue, replay, concurrency, and timeout scenarios.
- Automated accuracy, cap-race, revocation, audit-completeness, and latency reports.

#### Should — P1

- Policy dry-run against synthetic/historical redacted events and decision-diff report.
- Dual authorization for cap increase, policy activation, and fleet resume.
- Break-glass halt CLI independent of the main dashboard.
- Hash-chain verification and periodic signed checkpoint export.
- Live gateway freshness and halt-acknowledgement panel.
- Human Approval Required as a structured non-terminal decision effect.
- Deterministic PII tokenization for known fields and deny-on-unknown sensitive schema.
- Rule/velocity anomaly alerts and optional Isolation Forest comparison.

#### Could — P2

- OIDC/enterprise SSO integration, SPIFFE/SPIRE workload identity, and mTLS everywhere.
- Splunk/Loki export adapters, WORM object retention, SIEM case creation.
- Multi-tenant isolation, regional policy replicas, and multi-region halt protocol.
- Cross-currency budgets with signed rate snapshots.
- Cedar provider proof-of-concept behind the authorization interface.
- Policy recommendations generated by an LLM, always requiring validation and human approval.

#### Won’t — P3 for Round 1

- Live money movement, autonomous policy authoring, ML-driven auto-halt, fraud scoring, sanctions/KYC decisions, or production compliance certification.

### 10.5 Impact-versus-effort prioritization

| Capability | Impact | Effort | Risk reduction | MVP decision |
|---|---|---|---|---|
| Inline default-deny gateway | Very high | Medium | Very high | Build first |
| Atomic budget reservation | Very high | Medium | Very high | Build first |
| Durable halt epoch + ack | Very high | Medium | Very high | Build first |
| Full audit decision before dispatch | Very high | Medium | Very high | Build first |
| Policy simulation/diff | High | Medium | High | P1 after core |
| Polished dashboard | High demo value | Medium | Medium | Build focused views |
| Isolation Forest | Low without real data | Medium | Uncertain | Defer/alert-only |
| Multi-region active-active | High production value | Very high | High | Post-MVP |
| SPIFFE/Keycloak/Vault full stack | Medium demo value | High | High production value | Interface/design only |

### 10.6 User stories and acceptance criteria

#### US-01 — Register an agent

As a Policy Administrator, I want to register an agent with an owner, workload identity, risk tier, environment, policy, and budget pool so that authority is explicit.

**Acceptance:** duplicate identity binding is rejected; missing policy/budget assignments keep status Pending; all changes create audit events; only authorized roles can activate.

#### US-02 — Enforce granular action permission

As a Risk Owner, I want permissions based on principal, action, resource, and context so that “can call transfers” does not imply “can transfer any amount to any payee.”

**Acceptance:** a request without an explicit permit is denied; explicit deny overrides allow in the decision contract; resource/payee and amount conditions are tested at boundaries.

#### US-03 — Enforce an atomic budget

As a Risk Operator, I want all concurrent requests to reserve budget atomically so agents cannot race a shared limit.

**Acceptance:** 1,000 concurrent attempts cannot push reserved + committed exposure above the configured cap; duplicate idempotency keys return the original reservation/decision.

#### US-04 — Handle downstream uncertainty

As an Agent Engineer, I want timeouts to return a non-retriable Unknown state so that retries cannot duplicate a possibly executed transaction.

**Acceptance:** a post-dispatch timeout retains reserved exposure, emits `EXECUTION_UNKNOWN`, and requires reconciliation; it is never automatically released merely because a client timed out.

#### US-05 — Revoke an agent

As a Security Operator, I want to revoke one agent and see convergence so containment is verifiable.

**Acceptance:** a new epoch is durable, all active gateways acknowledge or are shown stale, new requests return `AGENT_REVOKED`, and the command records actor, scope, reason, and time.

#### US-06 — Halt the fleet

As a Risk Operator, I want a prominent emergency control to stop new agent dispatches.

**Acceptance:** halt has higher precedence than all permits; Pub/Sub loss does not prevent recovery; gateways deny when halt-state freshness expires; the UI reports acknowledgement coverage.

#### US-07 — Resume safely

As a Risk Executive, I want resumption to be deliberate so an incident is not accidentally reopened.

**Acceptance:** resume is a new auditable command, not deletion of halt history; production mode enforces dual authorization; health and policy freshness checks must pass.

#### US-08 — Simulate policy change

As a Policy Administrator, I want to compare candidate and active policies over a test corpus before activation.

**Acceptance:** report shows allow→deny, deny→allow, unchanged, errors, uncovered action types, and test coverage; evaluation errors block activation.

#### US-09 — Investigate an action

As an Auditor, I want one correlation view from intent through outcome.

**Acceptance:** the view displays normalized/redacted input, agent identity reference, decision, reason, policy/cap versions, reservation, dispatch/outcome, integrity status, and operator events.

#### US-10 — Preserve PII boundaries

As a Privacy Reviewer, I want logs to exclude prohibited secrets and minimize identifiers.

**Acceptance:** auth tokens, PANs, secrets, and raw full account identifiers never persist; known identifiers are tokenized/masked; schema failure on a sensitive action denies the request.

#### US-11 — Diagnose dependency failure

As an SRE, I want explicit health/freshness states so I can distinguish a safe deny from an application bug.

**Acceptance:** health endpoints separate liveness from readiness; metrics identify policy, revocation, Redis, audit, and downstream failures; sensitive internals are not disclosed to agents.

#### US-12 — Run a winning demo

As a judge, I want visible proof that AEGIS enforces controls rather than merely displays them.

**Acceptance:** the demo shows permitted actions, over-cap and unapproved-payee denials, concurrent budget safety, agent revocation, fleet halt acknowledgements, and a verified audit trail with measured latency.

### 10.7 Product edge cases

- Amount equals the cap exactly; zero or negative amount; amount exceeds integer bounds; unsupported decimal precision.
- Same idempotency key with the same body versus a different body.
- Concurrent requests consume per-agent and shared limits simultaneously.
- Policy changes between authorization and dispatch; the active version is pinned for the request.
- Agent is revoked after reservation but before dispatch; gateway rechecks epoch and releases the undispatched reservation.
- Fleet halt occurs while downstream action is in flight; only cancellable actions may be cancelled, and irreversible completion remains auditable.
- Gateway misses a Pub/Sub notification; durable epoch refresh and freshness timeout still stop dispatch.
- Redis restarts; state reload and fail-closed readiness prevent open enforcement.
- PostgreSQL audit write fails after reservation; reservation is released if not dispatched and action is denied.
- Gateway crashes after marking Dispatched but before/after the network call; reservation becomes reconcilable, never silently reusable.
- Downstream returns late after client timeout; idempotency and reconciliation attach the eventual outcome.
- Operator attempts resume while some gateways are stale; production mode blocks or explicitly records risk acceptance.
- Raw payload contains a new sensitive field not covered by redaction; schema allowlisting prevents persistence and may deny high-risk actions.
- Hash-chain verification fails; investigation/export is flagged and an integrity alert is created.
- Clock skew; budget windows use authoritative server time in UTC, not caller timestamps.

### 10.8 Product analytics and telemetry

Required metrics include decision counts by safe reason code, allow/deny/hold ratio, policy evaluation latency, total governance overhead, Redis reservation latency, audit-write latency, downstream latency, cap utilization, reservations by state/age, halt epoch and acknowledgement coverage, stale gateways, policy version adoption, evaluation errors, redaction failures, audit verification failures, and reconciliation backlog.

No metric label may contain raw account, payee, customer, prompt, token, or unbounded agent-provided strings. High-cardinality correlation identifiers belong in logs/traces under controlled access, not metric labels.

### 10.9 Rollout strategy

1. **Shadow mode:** evaluate and log decisions, but only against a mock/sandbox backend. Compare expected and observed policy results.
2. **Canary enforce:** enforce low-risk/read-only action families for a small agent set; keep instant rollback to last known-good policy.
3. **Bounded financial pilot:** enforce selected financial actions with conservative caps and human approval.
4. **Scaled enforcement:** expand agents/actions only after accuracy, audit, failover, and incident drills meet gates.
5. **Production hardening:** multi-region design, enterprise identity, WORM checkpoints, regulatory mapping, and independent security review.

### 10.10 PRD success criteria

- All P0 journeys are demonstrable end to end without manual database changes.
- Every P0 denial prevents a protected-backend call and returns a stable machine-readable reason.
- Correctness tests meet the targets in Section 1.4 on declared hardware.
- The fleet halt remains effective when the Pub/Sub notification is intentionally dropped.
- The submission contains architecture, project description, presentation, repository/link, test report, and a 3–5 minute proof video.

### 10.11 Dependencies and constraints

#### Product dependencies

- A workload identity or signed development credential that the gateway can verify.
- A protected backend that rejects direct agent traffic and honors gateway identity.
- A documented action vocabulary and schema for every governed tool.
- OPA policy bundles and a test corpus tied to business intent.
- Redis for live budget and revocation state, plus PostgreSQL for configuration and evidence.
- An outcome or reconciliation interface for dispatched financial actions.
- Named owners for each agent, policy, budget pool, and emergency command.

#### MVP constraints

- Five-day delivery assumption, local Docker deployment, synthetic data, one tenant, one region, and no live financial integration.
- The MVP demonstrates safety properties under declared test conditions; it does not prove internet-scale, multi-region, or regulated-production readiness.
- In-flight irreversible actions cannot be “unexecuted” by a kill switch. AEGIS stops new dispatches and attempts cancellation only where the downstream contract supports it.
- Shared budget atomicity across Redis Cluster shards is not assumed. The demo uses one instance; a production shard design must colocate all keys changed by one reservation or use a dedicated budget coordinator.

### 10.12 Product risks and mitigations

| Risk | Likelihood / impact | Mitigation | Release evidence |
|---|---|---|---|
| A direct route bypasses the gateway | Medium / Critical | Private backend network, gateway-only credential, negative bypass test | Direct simulator call is rejected |
| Policy intent is encoded incorrectly | Medium / Critical | Typed schema, golden tests, deny-by-default, simulation diff, approval/rollback | 100% P0 action families covered by positive and negative tests |
| Concurrent agents overspend | High / Critical | Atomic reservation across all applicable caps, idempotency, stress test | Zero breach in concurrency test |
| Kill notification is lost | Medium / Critical | Durable epoch, recoverable stream, freshness TTL, Pub/Sub only as accelerator | Dropped-notification chaos test passes |
| Audit database fails | Medium / High | No durable decision record means no dispatch; surface fail-closed reason | Dependency-failure test passes |
| Timeout causes a duplicate transaction | Medium / Critical | Preserve Unknown exposure, downstream idempotency, reconciliation, no blind retry | Late-response and replay tests pass |
| Sensitive values leak to logs | Medium / Critical | Allowlisted schemas, deterministic masking/tokenization, log scanning | Secret/PII canary test finds zero prohibited values |
| Operator misuses resume or cap increase | Low / Critical | RBAC, separation of duties, dual control in production, full audit | Authorization-negative tests pass |
| “AI” feature distracts from enforcement | High / Medium | Keep anomaly ML optional and alert-only; demo deterministic controls first | Demo script order and architecture review |
| Latency claim is unsubstantiated | Medium / High | Publish hardware, dataset, percentiles, warm/cold runs, failure rates | Reproducible benchmark report |

### 10.13 Five-day MVP execution roadmap

| Day | Highest-risk outcome | Engineering work | Definition of done |
|---|---|---|---|
| 1 | Prove policy semantics | Freeze action envelope and reason codes; build Go gateway skeleton; embed OPA; author schema, policy, and golden tests | Registered normal action allowed; five negative cases denied; no default allow path |
| 2 | Prove budget correctness | Implement Redis reservation state machine, all cap types, integer money, idempotency, concurrency harness | 1,000 concurrent attempts cannot breach the shared cap |
| 3 | Prove containment and evidence | Implement revocation/halt epochs, stream + Pub/Sub notification, gateway ack, PostgreSQL audit events, hash verification, mock backend | Dropped Pub/Sub still halts; decision is durable before dispatch; audit chain verifies |
| 4 | Prove operability | Build FastAPI control plane, WebSocket/SSE event feed, React views, role checks, simulator scenarios | Operator can inspect, revoke, halt, resume, and trace an action without DB access |
| 5 | Prove the claims | Run correctness, chaos, latency, accessibility, and audit tests; fix release blockers; record video; finalize deck/project description | All P0 gates pass and results are reproducible from one command |

#### Workstream ownership

- **Gateway/Policy:** backend or platform engineer.
- **Budgets/State:** backend engineer with concurrency focus.
- **Control plane/Audit:** backend engineer; may be the same owner in a small team.
- **Dashboard:** frontend engineer/designer.
- **Simulator/QA/Benchmark:** QA or ML engineer acting as adversarial test owner.
- **Security review and narrative:** security-minded engineer plus product lead.

### 10.14 Submission deliverables checklist

- [ ] Project description stating the threat, user, deterministic gate, measurable proof, limitations, and production path.
- [ ] Architecture diagram separating agent, enforcement data plane, control plane, protected backend, and evidence plane.
- [ ] PRD (`AEGIS_PRD.md`) and implementation SRS (`AEGIS_SRS.md`).
- [ ] Source repository with local one-command startup and seeded demo data.
- [ ] Go gateway, OPA policies/tests, Redis budget logic, audit verifier, FastAPI control plane, React console, and Python simulator.
- [ ] Automated correctness, concurrency, chaos, latency, and audit-completeness report.
- [ ] Presentation focused on problem → enforcement mechanism → proof → production path.
- [ ] 3–5 minute video: normal action → rogue denial → budget race → per-agent revoke → fleet halt → verified evidence.
- [ ] Link validation and a fallback local recording/screenshots in case the hosted demo fails.

### 10.15 Strategic differentiation

| Differentiator | User value | Technical mechanism | Replication difficulty | Validation experiment |
|---|---|---|---|---|
| Transactional authority, not prompt guardrails | Harm is stopped before execution | Inline gateway plus protected-backend isolation | Medium; requires integration discipline | Bypass and unauthorized-forwarding tests |
| Exposure-aware authorization | Caps remain correct across a fleet | Atomic multi-cap reservation and explicit uncertainty states | High; edge cases are subtle | Concurrent and timeout fault injection |
| Verifiable containment | Operators know whether the fleet actually stopped | Durable epochs, stale-cache deny, gateway acknowledgements | Medium-high | Lost-message and disconnected-gateway drill |
| Decision provenance | Investigations reconstruct exact policy and state | Versioned decision context, event lineage, integrity verification | Medium-high | Random audit sample and chain tamper test |
| Policy change safety | Teams see semantic impact before deployment | Golden tests, replay simulation, allow/deny diff, rollback | Medium | Mutant policy suite and regression gates |
| Domain evaluation corpus | Controls improve from incidents without giving AI authority | Financial action taxonomy, abuse cases, trajectory fixtures | High over time | Coverage growth and escaped-defect rate |

Features that are **not** defensible differentiation by themselves: a red button without convergence proof, a generic monitoring dashboard, a vendor logo wall, an uncalibrated anomaly chart, or unsupported “mathematically guaranteed” language.

### 10.16 Final product acceptance gate

The MVP is accepted only if all of the following are true:

1. Every protected backend route used in the demo rejects direct agent calls.
2. Every P0 action type has at least one allow, deny, boundary, malformed, replay, and revoked/halted test.
3. No tested policy error, missing field, stale safety state, or dependency failure produces implicit allow.
4. Budget concurrency and Unknown/reconciliation tests pass without exposure exceeding a cap.
5. Halt takes precedence over permission and cap state; all active gateways acknowledge or appear stale/blocked.
6. Every accepted intent has a durable decision record before dispatch and a terminal or Unknown outcome.
7. Redaction scans find no prohibited token, secret, PAN, or full account identifier.
8. Published latency and accuracy numbers include workload, hardware, percentile, sample count, and error rate.
9. The demo and documentation state the boundaries: single region/tenant, synthetic backend, no legal certification, no rollback of committed actions.
10. A fresh reviewer can start the system, run the test suite, and reproduce the demo using documented commands.

## References

- **S1:** Governance Layer for Financial Agents — challenge brief supplied in the task.
- **S2:** Consolidated AEGIS / Sentinel Mesh solution reports supplied in the task.
- **S3:** `Pasted text(33).txt` — requested PRD/SRS analysis method and output contract.
- **S4:** NIST, *AI Risk Management Framework 1.0* and Playbook: https://www.nist.gov/itl/ai-risk-management-framework and https://airc.nist.gov/airmf-resources/playbook/
- **S5:** Open Policy Agent documentation: https://www.openpolicyagent.org/docs/ ; bundles: https://www.openpolicyagent.org/docs/management-bundles ; decision logs: https://www.openpolicyagent.org/docs/management-decision-logs
- **S6:** Cedar authorization and validation: https://docs.cedarpolicy.com/auth/authorization.html and https://docs.cedarpolicy.com/policies/validation.html
- **S7:** Redis atomic scripting and Pub/Sub delivery: https://redis.io/docs/latest/develop/programmability/eval-intro/ and https://redis.io/docs/latest/develop/pubsub/
- **S8:** PostgreSQL documentation: https://www.postgresql.org/docs/current/
