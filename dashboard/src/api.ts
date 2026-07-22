// Typed API client for the AEGIS control plane.
// - Token + base URL come from localStorage / build env.
// - All money is integer MINOR units (never floats).
// - Rich error type so the UI can render 401/403/409/stale states truthfully.

export type Role = "admin" | "operator" | "auditor";

// Product personas (presentation) -> backend role/token (authoritative).
export type Persona = "policy_admin" | "risk_operator" | "auditor" | "viewer";

const BASE = (import.meta.env.VITE_CONTROL_URL as string) || "/api";

const TOKEN_KEY = "aegis_token";
const PERSONA_KEY = "aegis_persona";

export const PERSONAS: Record<
  Persona,
  { label: string; role: Role; token: string; blurb: string }
> = {
  policy_admin: {
    label: "Policy Author",
    role: "admin",
    token: "admin-token-dev",
    blurb: "Author & activate policy, register agents, manage budgets.",
  },
  risk_operator: {
    label: "Risk Operator",
    role: "operator",
    token: "operator-token-dev",
    blurb: "Monitor activity, simulate policy, revoke agents.",
  },
  auditor: {
    label: "Auditor",
    role: "auditor",
    token: "auditor-token-dev",
    blurb: "Read-only audit exploration & chain verification.",
  },
  viewer: {
    label: "Viewer",
    role: "auditor",
    token: "auditor-token-dev",
    blurb: "Observe fleet posture and decisions without mutation authority.",
  },
};

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}
export function getPersona(): Persona | null {
  const p = localStorage.getItem(PERSONA_KEY) as Persona | null;
  return p && PERSONAS[p] ? p : null;
}
export function getRole(): Role | null {
  const p = getPersona();
  return p ? PERSONAS[p].role : null;
}
export function login(persona: Persona) {
  localStorage.setItem(PERSONA_KEY, persona);
  localStorage.setItem(TOKEN_KEY, PERSONAS[persona].token);
}
export function logout() {
  localStorage.removeItem(PERSONA_KEY);
  localStorage.removeItem(TOKEN_KEY);
}
export function isAuthed(): boolean {
  return !!getPersona() && !!getToken();
}

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(`${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`,
        ...(init?.headers || {}),
      },
    });
  } catch (e) {
    throw new ApiError(0, "network error — control plane unreachable");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body);
    } catch {
      /* keep statusText */
    }
    if (res.status === 401) window.dispatchEvent(new Event("aegis:session-expired"));
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as Promise<T>;
}

// ---------------------------------------------------------------- types
export interface Agent {
  id: string;
  display_name: string;
  owner: string;
  risk_tier: string;
  environment: string;
  status: string;
  workload_sub?: string;
  budget_pool_id: string | null;
  policy_version: number | null;
  version: number;
  created_at?: string;
  updated_at?: string;
}

export interface BudgetPool {
  id: string;
  display_name: string;
  currency: string;
  per_txn_max: number;
  window_max: number;
  window_seconds?: number;
  shared_pool_max: number;
  live: { committed: number; held: number };
}

export interface PolicyVersion {
  version: number;
  label: string;
  status: string;
  created_by: string;
  created_at?: string;
  activated_at?: string | null;
  rego_module?: string;
  data_json?: Record<string, unknown>;
}

export interface EmergencyStatus {
  fleet_halted: boolean;
  fleet: Record<string, unknown> | null;
  revoked_agents: { agent_id: string; state: string; epoch: number }[];
}

export interface GatewayInfo {
  current_halt_epoch: number;
  gateways: { id: string; last_seen_at: string; acked_epoch: number; converged: boolean }[];
}

export interface AuditEvent {
  seq: number;
  event_type: string;
  correlation_id: string;
  agent_id: string | null;
  decision: string | null;
  reason_code: string | null;
  policy_version?: number | null;
  payload?: Record<string, unknown>;
  prev_hash?: string;
  event_hash?: string;
  created_at: string;
}

export interface Summary {
  agents: { active: number; pending: number; disabled: number; revoked: number; total: number };
  fleet: { halted: boolean; state: string; epoch: number };
  decisions: { allow: number; deny: number; total: number };
  active_policy: { version: number; label: string } | null;
  reconciliation_backlog: number;
  gateways: {
    total: number;
    fresh: number;
    converged: number;
    freshness_threshold_s: number;
    halt_ack_coverage: number;
    items: { id: string; acked_epoch: number; age_seconds: number | null; converged: boolean }[];
  };
  recent_events: AuditEvent[];
}

export interface ExplainResult {
  mode: string;
  provider: string;
  headline: string;
  decision: string | null;
  overall_advice: string;
  agent_id: string | null;
  policy_version: number | null;
  reason_breakdown: {
    reason_code: string;
    category: string;
    meaning: string;
    advice: string;
    inspect_next?: string;
  }[];
  inspect_next: string[];
  evidence: { seq: number; event_type: string; reason_code: string | null; event_hash: string; created_at: string }[];
  citation: { correlation_id?: string | null; policy_version?: number | null; note: string };
}

export interface DemoResult {
  scenario: string;
  http_status: number;
  protected_in_ms: number;
  correlation_id: string | null;
  decision: string | null;
  reason_codes: string[];
  advice: string | null;
  execution: { state?: string; backend_reference?: string } | null;
  reconciliation_required: boolean | null;
  envelope: { payee_id: string; amount_minor: number; purpose_code: string; agent_sub: string };
}

export interface AiStatus {
  provider_configured: boolean;
  provider: string;
  mode: string;
  capabilities: Record<string, boolean>;
  message: string;
}

// ---------------------------------------------------------------- api
export const api = {
  health: async () => {
    const [live, ready] = await Promise.all([
      fetch(`${BASE}/healthz`).then((r) => r.json() as Promise<Record<string, unknown>>),
      fetch(`${BASE}/readyz`).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() as Record<string, unknown> })),
    ]);
    return { live, ready };
  },
  meta: () => req<{ single_admin_mode: boolean; single_admin_notice: string }>("/v1/meta"),
  summary: () => req<Summary>("/v1/summary"),

  agents: () => req<Agent[]>("/v1/agents"),
  agent: (id: string) => req<Agent>(`/v1/agents/${id}`),
  registerAgent: (body: {
    id: string;
    display_name: string;
    owner: string;
    risk_tier: string;
    environment: string;
    workload_sub: string;
    budget_pool_id: string;
    status: string;
  }) => req<{ agent_id: string; version: number }>("/v1/agents", { method: "POST", body: JSON.stringify(body) }),
  updateAgent: (id: string, body: { status?: string; risk_tier?: string; version: number }) =>
    req(`/v1/agents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  budgets: () => req<BudgetPool[]>("/v1/budgets"),

  policies: () => req<PolicyVersion[]>("/v1/policies"),
  policy: (v: number) => req<PolicyVersion>(`/v1/policies/${v}`),
  createPolicy: (body: { label: string; rego?: string; data_json?: Record<string, unknown>; source?: string }) =>
    req<{ version: number; activated: boolean; note: string }>("/v1/policies", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  validatePolicy: (rego: string) =>
    req<{ valid: boolean; checks: { check: string; ok: boolean; detail: string }[]; note: string }>(
      "/v1/policies/validate",
      { method: "POST", body: JSON.stringify({ rego }) }
    ),
  activatePolicy: (v: number) => req<{ version: number; note: string }>(`/v1/policies/${v}/activate`, { method: "POST" }),
  simulatePolicy: (v: number, samples: unknown[]) =>
    req<{ candidate_version: number; active_version: number | null; changed_count: number; diff: unknown[] }>(
      `/v1/policies/${v}/simulate`,
      { method: "POST", body: JSON.stringify({ samples }) }
    ),

  emergencyStatus: () => req<EmergencyStatus>("/v1/emergency/status"),
  halt: (reason: string) => req<{ epoch: number }>("/v1/emergency/halt", { method: "POST", body: JSON.stringify({ reason }) }),
  resume: (reason: string) => req<{ epoch: number }>("/v1/emergency/resume", { method: "POST", body: JSON.stringify({ reason }) }),
  revoke: (agent_id: string, reason: string) =>
    req<{ epoch: number }>("/v1/emergency/revoke", { method: "POST", body: JSON.stringify({ agent_id, reason }) }),
  reinstate: (agent_id: string, reason: string) =>
    req<{ epoch: number }>("/v1/emergency/reinstate", { method: "POST", body: JSON.stringify({ agent_id, reason }) }),

  gateways: () => req<GatewayInfo>("/v1/gateways"),

  audit: (params: Record<string, string>) => {
    const q = new URLSearchParams(params).toString();
    return req<AuditEvent[]>(`/v1/audit/events${q ? "?" + q : ""}`);
  },
  verify: () =>
    req<{ valid: boolean; verified_count?: number; broken_at_seq?: number; tip_hash?: string; error?: string }>(
      "/v1/audit/verify"
    ),
  checkpoint: () => req<{ tip_seq: number; tip_hash: string; signature: string }>("/v1/audit/checkpoint", { method: "POST" }),

  explain: (body: {
    correlation_id?: string;
    reason_codes?: string[];
    decision?: string;
    agent_id?: string;
    policy_version?: number;
  }) => req<ExplainResult>("/v1/explain", { method: "POST", body: JSON.stringify(body) }),

  aiStatus: () => req<AiStatus>("/v1/ai/status"),

  demoRun: (scenario: string) => req<DemoResult>("/v1/demo/run", { method: "POST", body: JSON.stringify({ scenario }) }),
  demoReset: () => req<{ status: string }>("/v1/demo/reset", { method: "POST" }),
};

export function streamUrl(): string {
  return `${BASE}/v1/stream`;
}

// ---------------------------------------------------------------- money
// Integer minor units <-> human display. INR uses 2 minor digits (paise).
export function formatMoney(minor: number, currency = "INR"): string {
  const major = minor / 100;
  const symbol = currency === "INR" ? "₹" : "";
  return `${symbol}${major.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function parseMoneyToMinor(input: string): number {
  const n = Number(input.replace(/[^0-9.]/g, ""));
  return Math.round(n * 100);
}
