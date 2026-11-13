// In-browser demo backend for the AEGIS dashboard.
//
// Static deployments (GitHub Pages / Vercel) have no control plane, gateway,
// Postgres or Redis behind them. When demo mode is active this module
// intercepts the dashboard's fetches and answers them from an in-memory store
// that mirrors the control-plane API surface — including a genuine SHA-256
// hash chain (same canonical form as the Go gateway and Python control plane
// writers), an SSE stream, RBAC, optimistic-concurrency 409s and atomic-style
// budget arithmetic. The full UI — including audit chain verification — works
// against it; every screen is a faithful simulation, never a hardcoded mock.

import type {
  Agent,
  AiStatus,
  AuditEvent,
  BudgetPool,
  DemoResult,
  EmergencyStatus,
  GatewayInfo,
  PolicyVersion,
  Role,
  Summary,
} from "../api";

// ---------------------------------------------------------------- detection

// Evaluated once at module load: SPA navigation (e.g. login redirect) strips
// the ?demo query param, so the verdict must be sticky — and it survives
// reloads via sessionStorage so a deep link doesn't silently drop demo mode.
const DEMO_DETECTED = (() => {
  try {
    if (import.meta.env.VITE_DEMO_MODE === "1") return true;
    if (/\.github\.io$/.test(window.location.hostname)) return true;
    if (new URLSearchParams(window.location.search).has("demo")) {
      sessionStorage.setItem("aegis_demo", "1");
      return true;
    }
    return sessionStorage.getItem("aegis_demo") === "1";
  } catch {
    return false;
  }
})();

export function isDemoMode(): boolean {
  return DEMO_DETECTED;
}

// ---------------------------------------------------------------- store

interface Store {
  agents: Agent[];
  budgets: BudgetPool[];
  policies: PolicyVersion[];
  activePolicyVersion: number;
  emergency: EmergencyStatus;
  haltEpoch: number;
  gateways: GatewayInfo;
  audit: AuditEvent[];
  chainBase: string; // prev_hash of the oldest retained event
  seq: number;
  reconciliation: Set<number>; // UNKNOWN decision seqs awaiting reconciliation
}

const ALLOW_PAYEES = ["VND-1001", "VND-1002", "VND-1003"];

const AGENTS: Agent[] = [
  { id: "agent-treasury-01", display_name: "Treasury Sweep", owner: "finance@demo.bank", risk_tier: "medium", environment: "prod", status: "active", workload_sub: "svc/treasury-sweep", budget_pool_id: "bp-treasury", policy_version: 1, version: 3, created_at: iso(-46 * 864e5), updated_at: iso(-2 * 864e5) },
  { id: "agent-vendor-01", display_name: "Vendor Paybot", owner: "finance@demo.bank", risk_tier: "medium", environment: "prod", status: "active", workload_sub: "svc/vendor-paybot", budget_pool_id: "bp-vendor", policy_version: 1, version: 5, created_at: iso(-31 * 864e5), updated_at: iso(-864e5) },
  { id: "agent-ops-01", display_name: "Invoice Reconciler", owner: "ops@demo.bank", risk_tier: "low", environment: "prod", status: "active", workload_sub: "svc/invoice-reconciler", budget_pool_id: "bp-ops", policy_version: 1, version: 2, created_at: iso(-21 * 864e5), updated_at: iso(-5 * 864e5) },
  { id: "agent-rogue-01", display_name: "Unregistered Scraper", owner: "unknown", risk_tier: "high", environment: "prod", status: "active", workload_sub: "ext/scraper-unknown", budget_pool_id: "bp-vendor", policy_version: 1, version: 1, created_at: iso(-36e5), updated_at: iso(-36e5) },
  { id: "agent-digest-01", display_name: "Report Digest", owner: "analytics@demo.bank", risk_tier: "low", environment: "staging", status: "pending", workload_sub: "svc/report-digest", budget_pool_id: "bp-ops", policy_version: null, version: 1, created_at: iso(-72e5), updated_at: iso(-72e5) },
];

const BUDGETS: BudgetPool[] = [
  { id: "bp-treasury", display_name: "Treasury Operations", currency: "INR", per_txn_max: 500_000, window_max: 8_000_000, window_seconds: 60, shared_pool_max: 20_000_000, live: { committed: 1_450_000, held: 100_000 } },
  { id: "bp-vendor", display_name: "Vendor Payouts", currency: "INR", per_txn_max: 5_000_000, window_max: 20_000_000, window_seconds: 60, shared_pool_max: 50_000_000, live: { committed: 6_250_000, held: 500_000 } },
  { id: "bp-ops", display_name: "Operational Expenses", currency: "INR", per_txn_max: 200_000, window_max: 1_000_000, window_seconds: 60, shared_pool_max: 2_000_000, live: { committed: 180_000, held: 20_000 } },
];

const POLICIES: PolicyVersion[] = [
  {
    version: 1,
    label: "Baseline allow-list",
    status: "active",
    created_by: "policy_admin",
    created_at: iso(-14 * 864e5),
    activated_at: iso(-14 * 864e5),
    rego_module: `package aegis.authz

import rego.v1

default effect := "DENY"

effect := "ALLOW" if {
  input.agent.risk_tier != "high"
  input.agent.status == "active"
  input.envelope.payee_id in data.payees.allowlist
  input.envelope.amount_minor <= data.caps.per_txn_max
}`,
    data_json: {
      payees: { allowlist: ALLOW_PAYEES },
      caps: { per_txn_max: 5_000_000 },
      deny: { risk_tiers: ["high"] },
    },
  },
  {
    version: 2,
    label: "Tightened vendor caps",
    status: "draft",
    created_by: "policy_admin",
    created_at: iso(-26 * 36e5),
    activated_at: null,
    rego_module: `package aegis.authz

import rego.v1

default effect := "DENY"

effect := "ALLOW" if {
  input.agent.risk_tier != "high"
  input.agent.status == "active"
  input.envelope.payee_id in data.payees.allowlist
  input.envelope.amount_minor <= data.caps.per_txn_max
}`,
    data_json: {
      payees: { allowlist: ALLOW_PAYEES },
      caps: { per_txn_max: 100_000 },
      deny: { risk_tiers: ["high"] },
    },
  },
];

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function seedStore(): Store {
  return {
    agents: structuredClone(AGENTS),
    budgets: structuredClone(BUDGETS),
    policies: structuredClone(POLICIES),
    activePolicyVersion: 1,
    emergency: { fleet_halted: false, fleet: null, revoked_agents: [] },
    haltEpoch: 0,
    gateways: {
      current_halt_epoch: 0,
      gateways: [
        { id: "gw-edge-01", last_seen_at: new Date().toISOString(), acked_epoch: 0, converged: true },
        { id: "gw-edge-02", last_seen_at: new Date().toISOString(), acked_epoch: 0, converged: true },
      ],
    },
    audit: [],
    chainBase: "",
    seq: 0,
    reconciliation: new Set(),
  };
}

let store: Store | null = null;
let hydrating: Promise<Store> | null = null;

async function getStore(): Promise<Store> {
  if (store) return store;
  if (!hydrating) {
    hydrating = (async () => {
      const s = seedStore();
      await seedAudit(s);
      store = s;
      return s;
    })();
  }
  return hydrating;
}

async function resetStore(): Promise<Store> {
  store = null;
  hydrating = null;
  return getStore();
}

// ---------------------------------------------------------------- hash chain

// Canonical form: sorted-key, compact JSON — byte-identical to what the Go
// gateway and Python control plane write, so the audit screen behaves like
// the real cross-language chain.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : 1,
        ),
      );
    }
    return v;
  });
}

function hashable(e: AuditEvent): Record<string, unknown> {
  return {
    seq: e.seq,
    event_type: e.event_type,
    correlation_id: e.correlation_id,
    agent_id: e.agent_id,
    decision: e.decision,
    reason_code: e.reason_code,
    policy_version: e.policy_version ?? null,
    payload: e.payload ?? {},
    prev_hash: e.prev_hash,
    created_at: e.created_at,
  };
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const MAX_AUDIT_EVENTS = 400;

interface EventSeed {
  event_type: string;
  correlation_id?: string;
  agent_id?: string | null;
  decision?: string | null;
  reason_code?: string | null;
  payload?: Record<string, unknown>;
}

async function append(s: Store, seed: EventSeed, at?: Date): Promise<AuditEvent> {
  s.seq += 1;
  const event: AuditEvent = {
    seq: s.seq,
    event_type: seed.event_type,
    correlation_id: seed.correlation_id ?? newCorrelationId(),
    agent_id: seed.agent_id ?? null,
    decision: seed.decision ?? null,
    reason_code: seed.reason_code ?? null,
    policy_version: s.activePolicyVersion,
    payload: seed.payload ?? {},
    prev_hash: s.chainBase,
    created_at: (at ?? new Date()).toISOString(),
  };
  event.prev_hash = s.audit.length ? s.audit[s.audit.length - 1].event_hash ?? s.chainBase : s.chainBase;
  event.event_hash = await sha256Hex(canonical(hashable(event)));
  s.audit.push(event);
  if (s.audit.length > MAX_AUDIT_EVENTS) {
    s.audit = s.audit.slice(-MAX_AUDIT_EVENTS);
    s.chainBase = s.audit[0].prev_hash ?? "";
  }
  return event;
}

function newCorrelationId(): string {
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `cor-${hex()}${hex()}${hex()}`;
}

async function seedAudit(s: Store): Promise<void> {
  const now = Date.now();
  const t = (min: number) => new Date(now - min * 60_000);
  await append(s, { event_type: "AGENT_REGISTERED", agent_id: "agent-treasury-01", payload: { owner: "finance@demo.bank", risk_tier: "medium" } }, t(214));
  await append(s, { event_type: "POLICY_ACTIVATED", payload: { version: 1, label: "Baseline allow-list" } }, t(196));
  await append(s, { event_type: "ACTION_DECISION", agent_id: "agent-treasury-01", decision: "ALLOW", reason_code: null, payload: { payee_id: "VND-1002", amount_minor: 1_250_000, purpose_code: "TREASURY_SWEEP" } }, t(188));
  await append(s, { event_type: "BUDGET_COMMITTED", agent_id: "agent-treasury-01", payload: { budget_pool_id: "bp-treasury", amount_minor: 1_250_000 } }, t(188));
  await append(s, { event_type: "ACTION_DECISION", agent_id: "agent-vendor-01", decision: "ALLOW", payload: { payee_id: "VND-1001", amount_minor: 750_000, purpose_code: "VENDOR_PAYOUT" } }, t(151));
  await append(s, { event_type: "BUDGET_COMMITTED", agent_id: "agent-vendor-01", payload: { budget_pool_id: "bp-vendor", amount_minor: 750_000 } }, t(151));
  await append(s, { event_type: "ACTION_DECISION", agent_id: "agent-ops-01", decision: "ALLOW", payload: { payee_id: "VND-1003", amount_minor: 95_000, purpose_code: "OPS_EXPENSE" } }, t(122));
  await append(s, { event_type: "BUDGET_COMMITTED", agent_id: "agent-ops-01", payload: { budget_pool_id: "bp-ops", amount_minor: 95_000 } }, t(122));
  await append(s, { event_type: "ACTION_DECISION", agent_id: "agent-vendor-01", decision: "DENY", reason_code: "PAYEE_NOT_ALLOWED", payload: { payee_id: "VND-8888", amount_minor: 300_000, purpose_code: "VENDOR_PAYOUT" } }, t(97));
  await append(s, { event_type: "AGENT_UPDATED", agent_id: "agent-digest-01", payload: { status: "pending" } }, t(80));
  await append(s, { event_type: "ACTION_DECISION", agent_id: "agent-rogue-01", decision: "DENY", reason_code: "POLICY_DENY", payload: { payee_id: "VND-1001", amount_minor: 4_900_000, purpose_code: "VENDOR_PAYOUT" } }, t(64));
  await append(s, { event_type: "ACTION_DECISION", agent_id: "agent-vendor-01", decision: "DENY", reason_code: "PER_TXN_CAP_EXCEEDED", payload: { payee_id: "VND-1001", amount_minor: 10_000_000, purpose_code: "VENDOR_PAYOUT" } }, t(55));
  await append(s, { event_type: "CHECKPOINT", payload: { tip_seq: 12, writer: "control-plane" } }, t(51));
  await append(s, { event_type: "ACTION_DECISION", agent_id: "agent-treasury-01", decision: "UNKNOWN", reason_code: "BACKEND_TIMEOUT", payload: { payee_id: "VND-1002", amount_minor: 500_000, purpose_code: "TREASURY_SWEEP", execution_state: "UNKNOWN", reconciliation_required: true } }, t(38));
  s.reconciliation.add(s.seq);
  await append(s, { event_type: "ACTION_DECISION", agent_id: "agent-ops-01", decision: "ALLOW", payload: { payee_id: "VND-1003", amount_minor: 85_000, purpose_code: "OPS_EXPENSE" } }, t(26));
  await append(s, { event_type: "BUDGET_COMMITTED", agent_id: "agent-ops-01", payload: { budget_pool_id: "bp-ops", amount_minor: 85_000 } }, t(26));
  await append(s, { event_type: "ACTION_DECISION", agent_id: "agent-rogue-01", decision: "DENY", reason_code: "PAYEE_NOT_ALLOWED", payload: { payee_id: "VND-4242", amount_minor: 9_000, purpose_code: "VENDOR_PAYOUT" } }, t(19));
  await append(s, { event_type: "AGENT_REGISTERED", agent_id: "agent-rogue-01", payload: { owner: "unknown", risk_tier: "high", flagged: true } }, t(12));
  await append(s, { event_type: "ACTION_DECISION", agent_id: "agent-vendor-01", decision: "ALLOW", payload: { payee_id: "VND-1001", amount_minor: 250_000, purpose_code: "VENDOR_PAYOUT" } }, t(9));
  await append(s, { event_type: "BUDGET_COMMITTED", agent_id: "agent-vendor-01", payload: { budget_pool_id: "bp-vendor", amount_minor: 250_000 } }, t(9));
  await append(s, { event_type: "ACTION_DECISION", agent_id: "agent-treasury-01", decision: "ALLOW", payload: { payee_id: "VND-1002", amount_minor: 200_000, purpose_code: "TREASURY_SWEEP" } }, t(4));
  await append(s, { event_type: "BUDGET_COMMITTED", agent_id: "agent-treasury-01", payload: { budget_pool_id: "bp-treasury", amount_minor: 200_000 } }, t(4));
}

// ---------------------------------------------------------------- rbac

const ROLE_TOKENS: Record<string, Role> = {
  "admin-token-dev": "admin",
  "operator-token-dev": "operator",
  "auditor-token-dev": "auditor",
};

function roleOf(init?: RequestInit): Role | null {
  const raw = init?.headers;
  let auth = "";
  if (raw instanceof Headers) auth = raw.get("Authorization") || "";
  else if (raw && typeof raw === "object") auth = (raw as Record<string, string>)["Authorization"] || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return ROLE_TOKENS[token] ?? null;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

const JSON_HEADERS = { "Content-Type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function fail(e: unknown): Response {
  if (e instanceof HttpError) return json({ detail: e.message }, e.status);
  const message = e instanceof Error ? e.message : String(e);
  console.error("[aegis-demo] handler failed:", e);
  return json({ detail: `demo backend error: ${message}` }, 500);
}

function requireRole(role: Role | null, allowed: Role[]): void {
  if (!role) throw new HttpError(401, "authentication required");
  if (!allowed.includes(role))
    throw new HttpError(403, `forbidden: requires ${allowed.join(" or ")} role`);
}

// ---------------------------------------------------------------- decisions

interface Envelope {
  payee_id: string;
  amount_minor: number;
  purpose_code: string;
}

function decide(s: Store, agent: Agent, env: Envelope): { decision: "ALLOW" | "DENY" | "UNKNOWN"; reason: string | null } {
  const policy = s.policies.find((p) => p.version === s.activePolicyVersion);
  const data = (policy?.data_json ?? {}) as {
    payees?: { allowlist?: string[] };
    caps?: { per_txn_max?: number };
    deny?: { risk_tiers?: string[] };
  };
  if (s.emergency.fleet_halted) return { decision: "DENY", reason: "FLEET_HALTED" };
  if (s.emergency.revoked_agents.some((r) => r.agent_id === agent.id))
    return { decision: "DENY", reason: "IDENTITY_REVOKED" };
  if (agent.status !== "active") return { decision: "DENY", reason: "AGENT_NOT_ACTIVE" };
  if ((data.deny?.risk_tiers ?? []).includes(agent.risk_tier))
    return { decision: "DENY", reason: "POLICY_DENY" };
  if (!(data.payees?.allowlist ?? []).includes(env.payee_id))
    return { decision: "DENY", reason: "PAYEE_NOT_ALLOWED" };
  const pool = s.budgets.find((b) => b.id === agent.budget_pool_id);
  if (pool) {
    if (env.amount_minor > pool.per_txn_max)
      return { decision: "DENY", reason: "PER_TXN_CAP_EXCEEDED" };
    if (pool.live.committed + pool.live.held + env.amount_minor > pool.window_max)
      return { decision: "DENY", reason: "BUDGET_WINDOW_EXCEEDED" };
  }
  return { decision: "ALLOW", reason: null };
}

async function executeDecision(s: Store, agentId: string, env: Envelope): Promise<Response> {
  const agent = s.agents.find((a) => a.id === agentId);
  if (!agent) throw new HttpError(403, "identity unknown: agent not registered");
  const started = performance.now();
  const verdict = decide(s, agent, env);
  const correlationId = newCorrelationId();
  const payload: Record<string, unknown> = { ...env, budget_pool_id: agent.budget_pool_id };
  if (verdict.decision === "ALLOW" && agentId === "agent-treasury-01" && Math.random() < 0.06) {
    // Rare backend timeout — the gateway never guesses, exposure is held.
    payload.execution_state = "UNKNOWN";
    payload.reconciliation_required = true;
    await append(s, {
      event_type: "ACTION_DECISION",
      correlation_id: correlationId,
      agent_id: agentId,
      decision: "UNKNOWN",
      reason_code: "BACKEND_TIMEOUT",
      payload,
    });
    s.reconciliation.add(s.seq);
    return json(demoResult(correlationId, 200, started, "UNKNOWN", ["BACKEND_TIMEOUT"], null, true));
  }
  await append(s, {
    event_type: "ACTION_DECISION",
    correlation_id: correlationId,
    agent_id: agentId,
    decision: verdict.decision,
    reason_code: verdict.reason,
    payload,
  });
  if (verdict.decision === "ALLOW") {
    const pool = s.budgets.find((b) => b.id === agent.budget_pool_id);
    if (pool) {
      pool.live.held = Math.max(0, pool.live.held - env.amount_minor);
      pool.live.committed += env.amount_minor;
    }
    await append(s, {
      event_type: "BUDGET_COMMITTED",
      correlation_id: correlationId,
      agent_id: agentId,
      payload: { budget_pool_id: agent.budget_pool_id, amount_minor: env.amount_minor, execution_state: "EXECUTION_COMMITTED" },
    });
    return json(
      demoResult(correlationId, 200, started, "ALLOW", [], {
        state: "EXECUTION_COMMITTED",
        backend_reference: `TXN-${Math.floor(100000 + Math.random() * 900000)}`,
      }, false),
    );
  }
  return json(demoResult(correlationId, 403, started, "DENY", [verdict.reason ?? "POLICY_DENY"], null, null));
}

function demoResult(
  correlationId: string,
  httpStatus: number,
  started: number,
  decision: DemoResult["decision"],
  reasonCodes: string[],
  execution: DemoResult["execution"],
  reconciliationRequired: boolean | null,
): DemoResult {
  return {
    scenario: "demo",
    http_status: httpStatus,
    protected_in_ms: Math.round(performance.now() - started) + 140 + Math.floor(Math.random() * 260),
    correlation_id: correlationId,
    decision,
    reason_codes: reasonCodes,
    advice: null,
    execution,
    reconciliation_required: reconciliationRequired,
    envelope: { payee_id: "VND-1001", amount_minor: 250_000, purpose_code: "VENDOR_PAYOUT", agent_sub: "svc/vendor-paybot" },
  };
}

// ---------------------------------------------------------------- gateway ack

function scheduleAck(s: Store, epoch: number): void {
  window.setTimeout(() => {
    for (const g of s.gateways.gateways) {
      g.acked_epoch = epoch;
      g.converged = true;
      g.last_seen_at = new Date().toISOString();
    }
    s.gateways.current_halt_epoch = epoch;
  }, 1_800);
}

// ---------------------------------------------------------------- handlers

async function handleApi(method: string, path: string, init?: RequestInit): Promise<Response> {
  const s = await getStore();
  const role = roleOf(init);
  const seg = path.replace(/^\/+/, "").split("/");
  const v = seg[0] === "v1" ? seg.slice(1) : seg;
  const [resource, second, third] = v;
  const body = (): Record<string, unknown> => {
    try {
      return JSON.parse((init?.body as string) || "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  };

  // health + meta (unauthenticated)
  if (resource === "healthz") return json({ status: "ok", service: "aegis-control-plane", demo: true });
  if (resource === "readyz") return json({ status: "ready", halt_epoch: s.haltEpoch, fleet_halted: s.emergency.fleet_halted, demo: true });
  if (resource === "meta")
    return json({
      single_admin_mode: true,
      single_admin_notice: "Single-admin mode: approval effects fail closed. Dev tokens stand in for OIDC.",
      demo: true,
    });

  // read-only surfaces (any role)
  if (resource === "summary") return json(summary(s));
  if (resource === "agents" && method === "GET" && !second) return json(s.agents);
  if (resource === "agents" && method === "GET" && second) {
    const agent = s.agents.find((a) => a.id === second);
    if (!agent) throw new HttpError(404, "agent not found");
    return json(agent);
  }
  if (resource === "budgets") return json(s.budgets);
  if (resource === "policies" && method === "GET" && !second) return json(s.policies);
  if (resource === "policies" && method === "GET" && second) {
    const p = s.policies.find((x) => x.version === Number(second));
    if (!p) throw new HttpError(404, "policy version not found");
    return json(p);
  }
  if (resource === "emergency" && second === "status") return json(s.emergency);
  if (resource === "gateways") return json(s.gateways);
  if (resource === "audit" && second === "events" && method === "GET") {
    const q = new URLSearchParams(path.split("?")[1] || "");
    let events = [...s.audit].sort((a, b) => b.seq - a.seq);
    if (q.get("decision")) events = events.filter((e) => e.decision === q.get("decision"));
    if (q.get("agent_id")) events = events.filter((e) => e.agent_id === q.get("agent_id"));
    if (q.get("reason_code")) events = events.filter((e) => e.reason_code === q.get("reason_code"));
    if (q.get("correlation_id")) events = events.filter((e) => e.correlation_id === q.get("correlation_id"));
    if (q.get("event_type")) events = events.filter((e) => e.event_type === q.get("event_type"));
    const limit = Number(q.get("limit") || 200);
    return json(events.slice(0, limit));
  }
  if (resource === "audit" && second === "verify" && (method === "GET" || method === "POST")) {
    // Recompute the whole chain exactly like the control-plane verifier:
    // per-event hash over the canonical form, plus linkage to the previous hash.
    let prev = s.chainBase;
    let valid = true;
    let verified = 0;
    let tip = s.chainBase;
    for (const e of s.audit) {
      const recomputed = await sha256Hex(canonical(hashable(e)));
      if (recomputed !== e.event_hash || e.prev_hash !== prev) {
        valid = false;
        break;
      }
      prev = e.event_hash ?? "";
      tip = e.event_hash ?? "";
      verified += 1;
    }
    return json({ valid, verified_count: verified, broken_at_seq: valid ? undefined : s.audit[verified]?.seq ?? undefined, tip_hash: tip });
  }
  if (resource === "audit" && second === "checkpoint" && method === "POST") {
    requireRole(role, ["admin", "operator", "auditor"]);
    const tip = s.audit[s.audit.length - 1];
    const signature = `demo-hmac:${(tip?.event_hash || s.chainBase).slice(0, 24)}`;
    await append(s, { event_type: "CHECKPOINT", payload: { tip_seq: tip?.seq ?? 0, writer: "dashboard-demo" } });
    return json({ tip_seq: tip?.seq ?? 0, tip_hash: tip?.event_hash || s.chainBase, signature });
  }
  if (resource === "ai" && second === "status") {
    return json({
      provider_configured: false,
      provider: "demo",
      mode: "deterministic",
      capabilities: { explain: true, summarize: false },
      message: "Demo build: deterministic reason-code explanations only.",
    } satisfies AiStatus);
  }

  // writes
  if (resource === "agents" && method === "POST") {
    requireRole(role, ["admin"]);
    const b = body();
    const id = String(b.id || "");
    if (!id) throw new HttpError(422, "id is required");
    if (s.agents.some((a) => a.id === id)) throw new HttpError(409, `agent ${id} already exists`);
    const agent: Agent = {
      id,
      display_name: String(b.display_name || id),
      owner: String(b.owner || "unknown"),
      risk_tier: String(b.risk_tier || "low"),
      environment: String(b.environment || "prod"),
      status: String(b.status || "pending"),
      workload_sub: String(b.workload_sub || ""),
      budget_pool_id: (b.budget_pool_id as string) || null,
      policy_version: null,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    s.agents.push(agent);
    await append(s, { event_type: "AGENT_REGISTERED", agent_id: id, payload: { owner: agent.owner, risk_tier: agent.risk_tier, environment: agent.environment } });
    return json({ agent_id: id, version: 1 }, 201);
  }
  if (resource === "agents" && method === "PATCH" && second) {
    requireRole(role, ["admin"]);
    const agent = s.agents.find((a) => a.id === second);
    if (!agent) throw new HttpError(404, "agent not found");
    const b = body();
    if (typeof b.version === "number" && b.version !== agent.version)
      throw new HttpError(409, `stale write: expected version ${agent.version}, got ${b.version}`);
    if (typeof b.status === "string") agent.status = b.status;
    if (typeof b.risk_tier === "string") agent.risk_tier = b.risk_tier;
    agent.version += 1;
    agent.updated_at = new Date().toISOString();
    await append(s, { event_type: "AGENT_UPDATED", agent_id: agent.id, payload: { status: agent.status, risk_tier: agent.risk_tier, version: agent.version } });
    return new Response(null, { status: 204 });
  }
  if (resource === "policies" && method === "POST") {
    requireRole(role, ["admin"]);
    const b = body();
    const version = Math.max(...s.policies.map((p) => p.version)) + 1;
    const policy: PolicyVersion = {
      version,
      label: String(b.label || `Draft v${version}`),
      status: "draft",
      created_by: "policy_admin",
      created_at: new Date().toISOString(),
      activated_at: null,
      rego_module: typeof b.rego === "string" ? b.rego : undefined,
      data_json: (b.data_json as Record<string, unknown>) || undefined,
    };
    s.policies.push(policy);
    await append(s, { event_type: "POLICY_CREATED", payload: { version, label: policy.label } });
    return json({ version, activated: false, note: "draft created; activation is a separate audited action" }, 201);
  }
  if (resource === "policies" && second === "validate" && method === "POST") {
    requireRole(role, ["admin"]);
    const rego = String(body().rego || "");
    const checks = [
      { check: "package declaration", ok: /package\s+\w+/.test(rego), detail: "must declare a package" },
      { check: "default deny", ok: /default\s+effect\s+:=\s*"DENY"/.test(rego), detail: "fail-closed requires default effect DENY" },
      { check: "rego.v1 import", ok: /import\s+rego\.v1/.test(rego), detail: "policies target rego.v1" },
      { check: "no float amounts", ok: !/\bfloat\b/.test(rego), detail: "money is integer minor units only" },
    ];
    return json({ valid: checks.every((c) => c.ok), checks, note: "validated in-browser against MVP policy rules" });
  }
  if (resource === "policies" && third === "activate" && method === "POST") {
    requireRole(role, ["admin"]);
    const p = s.policies.find((x) => x.version === Number(second));
    if (!p) throw new HttpError(404, "policy version not found");
    p.status = "active";
    p.activated_at = new Date().toISOString();
    s.activePolicyVersion = p.version;
    for (const other of s.policies) if (other.version !== p.version && other.status === "active") other.status = "superseded";
    await append(s, { event_type: "POLICY_ACTIVATED", payload: { version: p.version, label: p.label } });
    return json({ version: p.version, note: `policy v${p.version} active across gateways` });
  }
  if (resource === "policies" && third === "simulate" && method === "POST") {
    requireRole(role, ["admin", "operator", "auditor"]);
    const p = s.policies.find((x) => x.version === Number(second));
    if (!p) throw new HttpError(404, "policy version not found");
    const data = (p.data_json ?? {}) as { caps?: { per_txn_max?: number } };
    const cap = data.caps?.per_txn_max ?? 5_000_000;
    const samples = (Array.isArray(body().samples) ? body().samples : []) as {
      intent: string;
      active_effect: string;
      candidate_effect: string;
      amount_minor?: number;
    }[];
    let changed = 0;
    const diff = samples.map((sample) => {
      const big = typeof sample.amount_minor === "number" && sample.amount_minor > cap;
      const candidate = big ? "DENY" : sample.candidate_effect;
      if (candidate !== sample.active_effect) changed += 1;
      return { ...sample, candidate_effect: candidate };
    });
    return json({
      candidate_version: p.version,
      active_version: s.activePolicyVersion,
      changed_count: changed,
      diff,
    });
  }
  if (resource === "emergency" && method === "POST") {
    requireRole(role, ["admin", "operator"]);
    const b = body();
    const reason = String(b.reason || "unspecified");
    if (second === "halt") {
      s.haltEpoch += 1;
      s.emergency = { fleet_halted: true, fleet: { reason, epoch: s.haltEpoch, halted_at: new Date().toISOString() }, revoked_agents: s.emergency.revoked_agents };
      s.gateways.current_halt_epoch = s.haltEpoch;
      for (const g of s.gateways.gateways) g.converged = false;
      scheduleAck(s, s.haltEpoch);
      await append(s, { event_type: "EMERGENCY", payload: { action: "halt", reason, epoch: s.haltEpoch } });
      return json({ epoch: s.haltEpoch });
    }
    if (second === "resume") {
      s.haltEpoch += 1;
      s.emergency = { fleet_halted: false, fleet: null, revoked_agents: s.emergency.revoked_agents };
      for (const g of s.gateways.gateways) g.converged = true;
      await append(s, { event_type: "EMERGENCY", payload: { action: "resume", reason, epoch: s.haltEpoch } });
      return json({ epoch: s.haltEpoch });
    }
    if (second === "revoke") {
      const agentId = String(b.agent_id || "");
      if (!s.agents.some((a) => a.id === agentId)) throw new HttpError(404, "agent not found");
      s.haltEpoch += 1;
      if (!s.emergency.revoked_agents.some((r) => r.agent_id === agentId))
        s.emergency.revoked_agents.push({ agent_id: agentId, state: "revoked", epoch: s.haltEpoch });
      const agent = s.agents.find((a) => a.id === agentId);
      if (agent) agent.status = "revoked";
      await append(s, { event_type: "EMERGENCY", agent_id: agentId, payload: { action: "revoke", reason, epoch: s.haltEpoch } });
      return json({ epoch: s.haltEpoch });
    }
    if (second === "reinstate") {
      const agentId = String(b.agent_id || "");
      s.haltEpoch += 1;
      s.emergency.revoked_agents = s.emergency.revoked_agents.filter((r) => r.agent_id !== agentId);
      const agent = s.agents.find((a) => a.id === agentId);
      if (agent && agent.status === "revoked") agent.status = "active";
      await append(s, { event_type: "EMERGENCY", agent_id: agentId, payload: { action: "reinstate", reason, epoch: s.haltEpoch } });
      return json({ epoch: s.haltEpoch });
    }
  }
  if (resource === "demo" && second === "run" && method === "POST") {
    requireRole(role, ["admin", "operator"]);
    const scenario = String(body().scenario || "");
    const envelopes: Record<string, { agent: string; env: Envelope }> = {
      normal_transfer: { agent: "agent-vendor-01", env: { payee_id: "VND-1001", amount_minor: 250_000, purpose_code: "VENDOR_PAYOUT" } },
      unapproved_payee: { agent: "agent-vendor-01", env: { payee_id: "VND-9999", amount_minor: 120_000, purpose_code: "VENDOR_PAYOUT" } },
      over_cap: { agent: "agent-vendor-01", env: { payee_id: "VND-1001", amount_minor: 10_000_000, purpose_code: "VENDOR_PAYOUT" } },
      rogue_agent: { agent: "agent-rogue-01", env: { payee_id: "VND-1001", amount_minor: 4_900_000, purpose_code: "VENDOR_PAYOUT" } },
    };
    const chosen = envelopes[scenario] ?? envelopes.normal_transfer;
    return executeDecision(s, chosen.agent, chosen.env);
  }
  if (resource === "demo" && second === "reset" && method === "POST") {
    requireRole(role, ["admin", "operator"]);
    const fresh = await resetStore();
    return json({ status: "reset", seq: fresh.seq });
  }

  throw new HttpError(404, `no demo handler for ${method} ${path}`);
}

function summary(s: Store): Summary {
  const decisions = s.audit.filter((e) => e.event_type === "ACTION_DECISION" && e.decision);
  const active = s.agents.filter((a) => a.status === "active").length;
  const pending = s.agents.filter((a) => a.status === "pending").length;
  const disabled = s.agents.filter((a) => a.status === "disabled").length;
  const revoked = s.agents.filter((a) => a.status === "revoked").length;
  const activePolicy = s.policies.find((p) => p.version === s.activePolicyVersion);
  return {
    agents: { active, pending, disabled, revoked, total: s.agents.length },
    fleet: { halted: s.emergency.fleet_halted, state: s.emergency.fleet_halted ? "HALTED" : "ACTIVE", epoch: s.haltEpoch },
    decisions: {
      allow: decisions.filter((e) => e.decision === "ALLOW").length,
      deny: decisions.filter((e) => e.decision === "DENY").length,
      total: decisions.length,
    },
    active_policy: activePolicy ? { version: activePolicy.version, label: activePolicy.label } : null,
    reconciliation_backlog: s.reconciliation.size,
    gateways: {
      total: s.gateways.gateways.length,
      fresh: s.gateways.gateways.length,
      converged: s.gateways.gateways.filter((g) => g.converged).length,
      freshness_threshold_s: 5,
      halt_ack_coverage: s.gateways.gateways.length
        ? s.gateways.gateways.filter((g) => g.acked_epoch >= s.gateways.current_halt_epoch).length / s.gateways.gateways.length
        : 0,
      items: s.gateways.gateways.map((g) => ({
        id: g.id,
        acked_epoch: g.acked_epoch,
        age_seconds: Math.max(0, Math.round((Date.now() - new Date(g.last_seen_at).getTime()) / 1000)),
        converged: g.converged,
      })),
    },
    recent_events: [...s.audit].sort((a, b) => b.seq - a.seq).slice(0, 8),
  };
}

// ---------------------------------------------------------------- SSE stream

function streamResponse(): Response {
  const encoder = new TextEncoder();
  let timer: number | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastSeq = store ? store.seq : 0;
      const push = () => {
        const s = store;
        if (!s) return;
        for (const e of s.audit) {
          if (e.seq > lastSeq) {
            lastSeq = e.seq;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
          }
        }
      };
      timer = window.setInterval(push, 1_000);
    },
    cancel() {
      if (timer !== undefined) window.clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

// Ambient fleet traffic so Live Activity and the Command Center feel alive.
function ensureAmbientTraffic(): void {
  if (ambientTimer !== undefined) return;
  ambientTimer = window.setInterval(() => {
    void tickAmbient();
  }, 3_400);
}

let ambientTimer: number | undefined;

async function tickAmbient(): Promise<void> {
  const s = store;
  if (!s) return;
  for (const g of s.gateways.gateways) g.last_seen_at = new Date().toISOString();
  if (Math.random() < 0.3) return; // sometimes the fleet is quiet
  const candidates = s.agents.filter((a) => a.status === "active" && a.id !== "agent-rogue-01");
  const agent = candidates[Math.floor(Math.random() * candidates.length)];
  if (!agent) return;
  const payee = Math.random() < 0.88 ? "VND-1001" : "VND-1002";
  const amounts = [85_000, 120_000, 250_000, 400_000, 1_250_000];
  const env: Envelope = {
    payee_id: payee,
    amount_minor: amounts[Math.floor(Math.random() * amounts.length)],
    purpose_code: agent.budget_pool_id === "bp-treasury" ? "TREASURY_SWEEP" : agent.budget_pool_id === "bp-ops" ? "OPS_EXPENSE" : "VENDOR_PAYOUT",
  };
  const verdict = decide(s, agent, env);
  const correlationId = newCorrelationId();
  await append(s, {
    event_type: "ACTION_DECISION",
    correlation_id: correlationId,
    agent_id: agent.id,
    decision: verdict.decision,
    reason_code: verdict.reason,
    payload: { ...env, budget_pool_id: agent.budget_pool_id },
  });
  if (verdict.decision === "ALLOW") {
    const pool = s.budgets.find((b) => b.id === agent.budget_pool_id);
    if (pool) pool.live.committed += env.amount_minor;
  }
}

// ---------------------------------------------------------------- install

let installed = false;
let realFetch: typeof fetch = (...args) => fetch(...args);

// Tagged so we can detect the wrapper being clobbered by embedding
// environments that re-install their own fetch shim.
const DEMO_FETCH_MARKER = "__aegisDemoFetch";

const demoFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const pathname = new URL(url, window.location.origin).pathname;
  const path = pathname.replace(/^\/api/, "");
  if (path === "/v1/stream") {
    if (!roleOf(init)) return json({ detail: "authentication required" }, 401);
    return streamResponse();
  }
  if (/^\/(v1|healthz|readyz)/.test(path)) {
    await getStore();
    ensureAmbientTraffic();
    const method = (init?.method || (typeof input === "object" && !(input instanceof URL) ? input.method : "GET")).toUpperCase();
    try {
      return await handleApi(method, path, init);
    } catch (e) {
      return fail(e);
    }
  }
  return realFetch(input, init);
};

function patchFetch(): void {
  const current = window.fetch as typeof fetch & { [DEMO_FETCH_MARKER]?: boolean };
  if (current[DEMO_FETCH_MARKER]) return;
  window.fetch = demoFetch;
}

(demoFetch as unknown as Record<string, unknown>)[DEMO_FETCH_MARKER] = true;

export function installDemoBackend(): void {
  if (installed) return;
  installed = true;
  realFetch = window.fetch.bind(window);
  patchFetch();
  // Re-assert the demo wrapper if another shim takes the slot later.
  window.setInterval(patchFetch, 2_000);
}
