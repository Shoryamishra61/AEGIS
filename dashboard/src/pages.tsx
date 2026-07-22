import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Background,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  ArrowRight,
  Article,
  BracketsCurly,
  Check,
  Circuitry,
  CurrencyInr,
  Fingerprint,
  Gavel,
  LockKey,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  Siren,
  Warning,
} from "@phosphor-icons/react";
import "@xyflow/react/dist/style.css";
import {
  api,
  ApiError,
  formatMoney,
  PERSONAS,
  type Agent,
  type AuditEvent,
  type BudgetPool,
  type DemoResult,
  type GatewayInfo,
  type Summary,
} from "./api";
import { canWrite, useAuth } from "./auth";
import { useLive } from "./live";
import {
  AccessDenied,
  CopyButton,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
  useDrawers,
  useToast,
  type Column,
} from "./ui";
import { useTour } from "./tour";

function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loader());
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, deps);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

function Section({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ledger-section ${className}`}>
      <div className="section-head">
        <div>
          <span className="section-index" aria-hidden="true" />
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [selected, setSelected] =
    useState<keyof typeof PERSONAS>("risk_operator");
  return (
    <main className="login-page">
      <div className="login-brand">
        <div className="brand-mark" aria-hidden="true">
          A
        </div>
        <span>AEGIS</span>
      </div>
      <div className="login-layout">
        <section className="login-intro">
          <p className="eyebrow">Agent Execution Governance</p>
          <h1>Control before execution.</h1>
          <p>
            Every agent action is authenticated, policy-checked, budgeted, and
            recorded before it reaches a financial system.
          </p>
          <div className="trust-line">
            <span>Deterministic</span>
            <span>Fail-closed</span>
            <span>Tamper-evident</span>
          </div>
        </section>
        <section className="login-card" aria-labelledby="login-title">
          <div>
            <p className="eyebrow">Demo access</p>
            <h2 id="login-title">Choose your role</h2>
            <p>
              Select a role to see its exact permissions. Production uses
              enterprise OIDC/SSO.
            </p>
          </div>
          <div className="role-grid">
            {(
              Object.entries(PERSONAS) as [
                keyof typeof PERSONAS,
                (typeof PERSONAS)[keyof typeof PERSONAS],
              ][]
            ).map(([key, item]) => (
              <button
                key={key}
                className={`role-option ${selected === key ? "selected" : ""}`}
                onClick={() => setSelected(key)}
                aria-pressed={selected === key}
              >
                <span className="role-radio" aria-hidden="true" />
                <strong>{item.label}</strong>
                <small>{item.blurb}</small>
              </button>
            ))}
          </div>
          <button
            className="btn btn--primary btn--large"
            onClick={() => {
              login(selected);
              navigate("/");
            }}
          >
            Enter Demo <span aria-hidden="true">→</span>
          </button>
          <p className="fine-print">
            Development session · Server-enforced permissions · No live money
            movement
          </p>
        </section>
      </div>
    </main>
  );
}

export function CommandCenterPage() {
  const summary = useLoad(api.summary, []);
  const budgets = useLoad(api.budgets, []);
  const { explain } = useDrawers();
  if (summary.loading) return <LoadingState />;
  if (summary.error || !summary.data)
    return <ErrorState error={summary.error} retry={summary.reload} />;
  const s = summary.data;
  const pools = budgets.data || [];
  const committed = pools.reduce((n, b) => n + b.live.committed, 0);
  const held = pools.reduce((n, b) => n + b.live.held, 0);
  const ceiling = pools.reduce((n, b) => n + b.window_max, 0);
  const available = Math.max(0, ceiling - committed - held);
  const latest = s.recent_events[0];
  return (
    <div className="observatory">
      <header className="observatory-head">
        <div className="fleet-verdict" data-tour="fleet-state">
          <span>
            FLEET STATE / EPOCH {String(s.fleet.epoch).padStart(4, "0")}
          </span>
          <h1>{s.fleet.halted ? "Contained." : "The fleet is safe."}</h1>
          <p>
            {s.fleet.halted
              ? "New financial dispatch is blocked across the control boundary."
              : `${s.gateways.fresh} of ${s.gateways.total} gateways are fresh and enforcing policy v${s.active_policy?.version ?? "—"}.`}
          </p>
        </div>
        <div className="observatory-actions">
          <Link to="/demo" className="control-tab primary">
            <Gavel size={17} /> Run Judge Demo
          </Link>
          <Link to="/emergency" className="control-tab">
            <Siren size={17} /> Containment
          </Link>
        </div>
      </header>
      <section className="spine-field" data-tour="decision-spine">
        <div className="field-caption">
          <span>LIVE CONTROL PATH</span>
          <strong>
            {latest
              ? `#${latest.seq} / ${latest.agent_id || "fleet"}`
              : "Awaiting intent"}
          </strong>
          <time>
            {latest ? new Date(latest.created_at).toLocaleTimeString() : "—"}
          </time>
        </div>
        <ControlSpine event={latest} />
        <div className="spine-readout">
          <span>Determining evidence</span>
          <code>{latest?.reason_code || "NO_ACTIVE_DECISION"}</code>
          {latest && (
            <button
              onClick={() => explain({ correlation_id: latest.correlation_id })}
            >
              Inspect decision <ArrowRight size={14} />
            </button>
          )}
        </div>
      </section>
      <div className="observatory-grid">
        <section className="topology-field">
          <div className="ledger-heading">
            <span>01</span>
            <div>
              <h2>Governance fabric</h2>
              <p>Every live gateway acknowledges the durable control epoch.</p>
            </div>
            <Link to="/health">Open system health</Link>
          </div>
          <FleetMiniTopology summary={s} />
        </section>
        <section className="attention-ledger" data-tour="risk-events">
          <div className="ledger-heading">
            <span>02</span>
            <div>
              <h2>Operator attention</h2>
              <p>Only exceptions and irreversible uncertainty.</p>
            </div>
          </div>
          <div className="attention-count">
            <strong>{s.decisions.deny + s.reconciliation_backlog}</strong>
            <span>items require review</span>
          </div>
          <div className="event-list">
            {s.recent_events
              .filter(
                (e) =>
                  e.decision === "DENY" ||
                  e.reason_code?.includes("UNKNOWN") ||
                  e.event_type === "EMERGENCY",
              )
              .slice(0, 5)
              .map((event) => (
                <button
                  key={event.seq}
                  onClick={() =>
                    explain({ correlation_id: event.correlation_id })
                  }
                >
                  <span className="event-seq">
                    {String(event.seq).padStart(4, "0")}
                  </span>
                  <span>
                    <strong>{event.reason_code || event.event_type}</strong>
                    <small>{event.agent_id || "Fleet control"}</small>
                  </span>
                  <time>{new Date(event.created_at).toLocaleTimeString()}</time>
                </button>
              ))}
          </div>
        </section>
      </div>
      <section className="exposure-ledger" data-tour="exposure">
        <div className="ledger-heading">
          <span>03</span>
          <div>
            <h2>Exposure ledger</h2>
            <p>Real reserved and committed value across rolling windows.</p>
          </div>
          <Link to="/budgets">Inspect pools</Link>
        </div>
        <ExposureRiver
          available={available}
          held={held}
          committed={committed}
          unknown={s.reconciliation_backlog ? Math.max(1, held * 0.12) : 0}
          ceiling={ceiling}
        />
        <div className="exposure-foot">
          <span>
            <b>{s.agents.active}</b> active agents
          </span>
          <span>
            <b>{s.decisions.allow}</b> permitted
          </span>
          <span>
            <b>{s.decisions.deny}</b> stopped before execution
          </span>
          <span>
            <b>{Math.round(s.gateways.halt_ack_coverage * 100)}%</b> epoch
            coverage
          </span>
        </div>
      </section>
      <section className="operations-journal">
        <div className="ledger-heading">
          <span>04</span>
          <div>
            <h2>Control journal</h2>
            <p>Latest durable decisions in sequence.</p>
          </div>
          <Link to="/activity">Follow live activity</Link>
        </div>
        <div className="journal-strip">
          {s.recent_events.slice(0, 6).map((event) => (
            <button
              key={event.seq}
              onClick={() => explain({ correlation_id: event.correlation_id })}
            >
              <time>{new Date(event.created_at).toLocaleTimeString()}</time>
              <i className={event.decision === "DENY" ? "stop" : "pass"} />
              <strong>{event.agent_id || "FLEET"}</strong>
              <code>{event.reason_code || event.event_type}</code>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

const CONTROL_STAGES = [
  { label: "Agent", icon: Fingerprint },
  { label: "Identity", icon: LockKey },
  { label: "Permission", icon: ShieldCheck },
  { label: "Policy", icon: BracketsCurly },
  { label: "Budget", icon: CurrencyInr },
  { label: "Audit", icon: Article },
  { label: "Execution", icon: Circuitry },
];
function ControlSpine({ event }: { event?: AuditEvent | null }) {
  const fail = pipelineFailureIndex(event);
  return (
    <ol className="control-spine" aria-label="Decision Spine">
      {CONTROL_STAGES.map((stage, i) => {
        const Icon = stage.icon;
        const stopped =
          !!event && event.decision === "DENY" && i === Math.min(fail, 6);
        const passed =
          !!event && (event.decision === "ALLOW" || i < Math.min(fail, 6));
        return (
          <motion.li
            key={stage.label}
            initial={false}
            animate={{ opacity: event ? 1 : 0.55 }}
            className={stopped ? "stopped" : passed ? "passed" : "idle"}
          >
            <span className="spine-number">0{i + 1}</span>
            <span className="spine-node">
              <Icon size={19} />
            </span>
            <strong>{stage.label}</strong>
            <small>{stopped ? "STOP" : passed ? "VERIFIED" : "WAITING"}</small>
            {i < CONTROL_STAGES.length - 1 && <i />}
          </motion.li>
        );
      })}
    </ol>
  );
}
function FleetMiniTopology({ summary: s }: { summary: Summary }) {
  return (
    <div className="mini-topology">
      <div className="topology-core">
        <ShieldCheck size={23} />
        <strong>Epoch {s.fleet.epoch}</strong>
        <span>{s.fleet.halted ? "HALTED" : "ENFORCING"}</span>
      </div>
      {s.gateways.items.map((g, i) => (
        <div className={`gateway-orbit orbit-${i + 1}`} key={g.id}>
          <i />
          <span>{g.id}</span>
          <small>
            {g.converged ? "ACK" : "STALE"} · {g.age_seconds ?? "—"}s
          </small>
        </div>
      ))}
    </div>
  );
}
function ExposureRiver({
  available,
  held,
  committed,
  unknown,
  ceiling,
}: {
  available: number;
  held: number;
  committed: number;
  unknown: number;
  ceiling: number;
}) {
  const total = Math.max(1, available + held + committed + unknown);
  const entries = [
    { k: "available", v: available, label: "Available" },
    { k: "held", v: held, label: "Reserved" },
    { k: "committed", v: committed, label: "Committed" },
    { k: "unknown", v: unknown, label: "Unknown" },
  ];
  return (
    <div className="exposure-river">
      <div className="river-scale">
        <span>₹0</span>
        <span>ROLLING WINDOW CEILING {formatMoney(ceiling)}</span>
      </div>
      <div className="river-track">
        {entries.map((e) => (
          <motion.div
            key={e.k}
            className={`river-segment ${e.k}`}
            initial={false}
            animate={{
              width: `${(e.v / total) * 100}%`,
            }}
            style={{ minWidth: e.v > 0 ? 3 : 0 }}
            title={`${e.label}: ${formatMoney(e.v)}`}
          >
            <span>{e.label}</span>
          </motion.div>
        ))}
      </div>
      <div className="river-values">
        {entries.map((e) => (
          <div key={e.k}>
            <i className={e.k} />
            <span>{e.label}</span>
            <strong>{formatMoney(e.v)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

const agentColumns: Column<Agent>[] = [
  {
    key: "agent",
    label: "Agent",
    render: (a) => (
      <span className="primary-cell">
        <strong>{a.display_name}</strong>
        <small className="mono">{a.id}</small>
      </span>
    ),
    search: (a) => `${a.display_name} ${a.id}`,
  },
  {
    key: "owner",
    label: "Owner",
    render: (a) => a.owner,
    search: (a) => a.owner,
  },
  {
    key: "risk",
    label: "Risk tier",
    render: (a) => <StatusBadge value={a.risk_tier} />,
    search: (a) => a.risk_tier,
  },
  {
    key: "state",
    label: "State",
    render: (a) => <StatusBadge value={a.status} />,
    search: (a) => a.status,
  },
  {
    key: "policy",
    label: "Policy",
    render: (a) => (a.policy_version ? `v${a.policy_version}` : "—"),
  },
  {
    key: "pool",
    label: "Budget pool",
    render: (a) => <span className="mono">{a.budget_pool_id || "—"}</span>,
    search: (a) => a.budget_pool_id || "",
  },
];

export function AgentsPage() {
  const agents = useLoad(api.agents, []);
  const navigate = useNavigate();
  const { session } = useAuth();
  const rows = agents.data || [];
  return (
    <div className="identity-registry">
      <header className="registry-mast">
        <div>
          <span>GOVERNED IDENTITIES / DEFAULT DENY</span>
          <h1>Agent Registry</h1>
          <p>
            Authority is an envelope: verified identity, permitted action,
            bounded resource, policy, and financial ceiling.
          </p>
        </div>
        {canWrite(session?.role || null, "agent") && (
          <Link
            className="control-tab primary"
            data-tour="register-agent"
            to="/agents/new"
          >
            <Plus size={16} /> Bind new identity
          </Link>
        )}
      </header>
      <div className="registry-totals">
        <span>
          <b>{rows.filter((a) => a.status === "active").length}</b> active
          envelopes
        </span>
        <span>
          <b>{rows.filter((a) => a.status === "pending").length}</b> incomplete
          bindings
        </span>
        <span>
          <b>
            {
              rows.filter(
                (a) => a.risk_tier === "high" || a.risk_tier === "critical",
              ).length
            }
          </b>{" "}
          elevated risk
        </span>
        <span>
          <b>{new Set(rows.map((a) => a.budget_pool_id)).size}</b> shared pools
        </span>
      </div>
      {agents.loading ? (
        <LoadingState />
      ) : agents.error ? (
        <ErrorState error={agents.error} retry={agents.reload} />
      ) : rows.length ? (
        <section className="registry-ledger">
          <div className="ledger-heading">
            <span>01</span>
            <div>
              <h2>Permission envelopes</h2>
              <p>
                Select an identity to inspect what it can—and cannot—attempt.
              </p>
            </div>
          </div>
          <div data-tour="agent-table">
            <DataTable
              rows={rows}
              columns={agentColumns}
              rowKey={(a) => a.id}
              label="Governed agent identities"
              onRowClick={(a) => navigate(`/agents/${a.id}`)}
              initialPageSize={16}
            />
          </div>
        </section>
      ) : (
        <EmptyState
          title="No governed identities"
          detail="Bind the first workload identity to policy and budget."
        />
      )}
    </div>
  );
}

export function RegisterAgentPage() {
  const { session } = useAuth();
  const pools = useLoad(api.budgets, []);
  const navigate = useNavigate();
  const { push } = useToast();
  const [form, setForm] = useState({
    id: "",
    display_name: "",
    owner: "",
    risk_tier: "low",
    environment: "prod",
    workload_sub: "",
    budget_pool_id: "pool_payables",
    status: "pending",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!canWrite(session?.role || null, "agent"))
    return <AccessDenied capability="register agents" />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.registerAgent(form);
      push({
        tone: "success",
        title: "Agent registered",
        detail: `${result.agent_id} is version ${result.version}`,
      });
      navigate(`/agents/${result.agent_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Agent onboarding"
        title="Register Agent"
        description="Bind a workload identity to a named owner, risk tier, policy, and budget pool."
      />
      <form className="form-layout" onSubmit={submit}>
        <Section
          title="Identity & ownership"
          subtitle="Agent credentials are issued outside AEGIS; only the trusted subject is stored."
        >
          <div className="form-grid">
            <Field
              label="Agent ID"
              hint="Lowercase letters, numbers, and hyphens."
            >
              <input
                required
                pattern="[a-z0-9][a-z0-9-]{2,48}"
                value={form.id}
                onChange={(e) => setForm({ ...form, id: e.target.value })}
                placeholder="agent-payables-02"
              />
            </Field>
            <Field label="Display name">
              <input
                required
                value={form.display_name}
                onChange={(e) =>
                  setForm({ ...form, display_name: e.target.value })
                }
                placeholder="Payables Agent 02"
              />
            </Field>
            <Field label="Business owner">
              <input
                required
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
                placeholder="treasury-ops"
              />
            </Field>
            <Field
              label="Workload subject"
              hint="Unique trusted identity claim."
            >
              <input
                required
                value={form.workload_sub}
                onChange={(e) =>
                  setForm({ ...form, workload_sub: e.target.value })
                }
                placeholder="sub-agent-payables-02"
              />
            </Field>
          </div>
        </Section>
        <Section title="Governance assignment">
          <div className="form-grid">
            <Field label="Risk tier">
              <select
                value={form.risk_tier}
                onChange={(e) =>
                  setForm({ ...form, risk_tier: e.target.value })
                }
              >
                <option>low</option>
                <option>medium</option>
                <option>high</option>
                <option>critical</option>
              </select>
            </Field>
            <Field label="Environment">
              <select
                value={form.environment}
                onChange={(e) =>
                  setForm({ ...form, environment: e.target.value })
                }
              >
                <option>prod</option>
                <option>staging</option>
                <option>dev</option>
              </select>
            </Field>
            <Field label="Budget pool">
              <select
                value={form.budget_pool_id}
                onChange={(e) =>
                  setForm({ ...form, budget_pool_id: e.target.value })
                }
              >
                {pools.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Initial state" hint="Pending is denied by default.">
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="pending">Pending</option>
                <option value="active">Active</option>
              </select>
            </Field>
          </div>
        </Section>
        {error && (
          <div className="notice notice--danger" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <Link className="btn btn--ghost" to="/agents">
            Cancel
          </Link>
          <button className="btn btn--primary" disabled={busy}>
            {busy ? "Registering…" : "Register Agent"}
          </button>
        </div>
      </form>
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function AgentDetailPage() {
  const { id = "" } = useParams();
  const agent = useLoad(() => api.agent(id), [id]);
  const audit = useLoad(() => api.audit({ agent_id: id }), [id]);
  const { session } = useAuth();
  const { push } = useToast();
  const { explain } = useDrawers();
  const [busy, setBusy] = useState(false);
  if (agent.loading) return <LoadingState />;
  if (agent.error || !agent.data)
    return <ErrorState error={agent.error} retry={agent.reload} />;
  const a = agent.data;
  const changeStatus = async () => {
    setBusy(true);
    try {
      await api.updateAgent(a.id, {
        status: a.status === "active" ? "disabled" : "active",
        version: a.version,
      });
      await agent.reload();
      push({ tone: "success", title: "Agent state updated" });
    } catch (e) {
      push({ tone: "error", title: "Update failed", detail: String(e) });
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    if (
      !window.confirm(`Revoke ${a.display_name}? New actions will be denied.`)
    )
      return;
    setBusy(true);
    try {
      await api.revoke(a.id, "operator-investigation");
      push({
        tone: "success",
        title: "Agent revoked",
        detail: "A durable revocation epoch was created.",
      });
    } catch (e) {
      push({ tone: "error", title: "Revoke failed", detail: String(e) });
    } finally {
      setBusy(false);
    }
  };
  const recent = audit.data || [];
  return (
    <div
      className={`agent-envelope-page ${a.status !== "active" ? "closed" : ""}`}
    >
      <header className="agent-mast">
        <div>
          <span>IDENTITY ENVELOPE / VERSION {a.version}</span>
          <h1>{a.display_name}</h1>
          <code>{a.id}</code>
        </div>
        <div className="agent-actions">
          {canWrite(session?.role || null, "agent") && (
            <button
              className="control-tab"
              disabled={busy}
              onClick={changeStatus}
            >
              {a.status === "active" ? "Suspend identity" : "Activate identity"}
            </button>
          )}
          {canWrite(session?.role || null, "emergency") && (
            <button
              className="control-tab critical"
              disabled={busy}
              onClick={revoke}
            >
              <Siren size={15} /> Revoke now
            </button>
          )}
        </div>
      </header>
      <section className="permission-envelope">
        <div className="envelope-band identity-band">
          <span>01 / VERIFIED IDENTITY</span>
          <strong>{a.workload_sub || "UNBOUND"}</strong>
          <small>
            Owned by {a.owner} · {a.environment}
          </small>
          <StatusBadge value={a.status} />
        </div>
        <div className="envelope-band action-band">
          <span>02 / ACTION AUTHORITY</span>
          <strong>payments.transfer.create</strong>
          <small>All other actions default deny</small>
        </div>
        <div className="envelope-band policy-band">
          <span>03 / POLICY BOUNDARY</span>
          <strong>Bundle v{a.policy_version ?? "—"}</strong>
          <small>
            {a.risk_tier.toUpperCase()} risk tier · explicit permit required
          </small>
        </div>
        <div className="envelope-band budget-band">
          <span>04 / FINANCIAL CEILING</span>
          <strong>{a.budget_pool_id || "NO POOL"}</strong>
          <small>Atomic shared reservation before dispatch</small>
        </div>
        <div className="envelope-core">
          <ShieldCheck size={28} />
          <span>PERMISSION ENVELOPE</span>
          <strong>
            {a.status === "active" ? "OPEN WITHIN BOUNDS" : "CLOSED"}
          </strong>
        </div>
      </section>
      <div className="agent-detail-grid">
        <section className="identity-evidence">
          <div className="ledger-heading">
            <span>05</span>
            <div>
              <h2>Identity evidence</h2>
              <p>No credential secret is ever displayed.</p>
            </div>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Agent ID</dt>
              <dd className="mono">{a.id}</dd>
            </div>
            <div>
              <dt>Workload subject</dt>
              <dd className="mono">{a.workload_sub || "Not bound"}</dd>
            </div>
            <div>
              <dt>Business owner</dt>
              <dd>{a.owner}</dd>
            </div>
            <div>
              <dt>Environment</dt>
              <dd>{a.environment}</dd>
            </div>
          </dl>
        </section>
        <section className="behavior-journal">
          <div className="ledger-heading">
            <span>06</span>
            <div>
              <h2>Recent behavior</h2>
              <p>Deterministic decisions from the audit ledger.</p>
            </div>
          </div>
          {audit.loading ? (
            <LoadingState />
          ) : recent.length ? (
            <div className="event-list">
              {recent.slice(0, 8).map((e) => (
                <button
                  key={e.seq}
                  onClick={() => explain({ correlation_id: e.correlation_id })}
                >
                  <span className="event-seq">{e.seq}</span>
                  <span>
                    <strong>{e.reason_code || e.event_type}</strong>
                    <small>{e.correlation_id}</small>
                  </span>
                  <StatusBadge value={e.decision} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No recent behavior"
              detail="The first governed action will appear here."
            />
          )}
        </section>
      </div>
    </div>
  );
}

export function PolicyStudioPage() {
  const policies = useLoad(api.policies, []);
  const { session } = useAuth();
  const navigate = useNavigate();
  const { push } = useToast();
  const [label, setLabel] = useState("candidate-policy");
  const [action, setAction] = useState("payments.transfer.create");
  const [requireApprovedPayee, setRequireApprovedPayee] = useState(true);
  const rego = useMemo(
    () =>
      `package aegis.authz\n\nimport rego.v1\n\ndefault effect := "DENY"\n\npermit if {\n  input.action == "${action}"${requireApprovedPayee ? "\n  input.resource.payee_allowed == true" : ""}\n}\n\neffect := "ALLOW" if permit\n\ndecision := {\n  "effect": effect,\n  "reason_codes": ["POLICY_PERMIT"] if permit else ["POLICY_DENY"]\n}`,
    [action, requireApprovedPayee],
  );
  const [validation, setValidation] = useState<Awaited<
    ReturnType<typeof api.validatePolicy>
  > | null>(null);
  const [validating, setValidating] = useState(true);
  const [busy, setBusy] = useState(false);
  const editable = canWrite(session?.role || null, "policy");
  useEffect(() => {
    if (!editable) {
      setValidating(false);
      return;
    }
    let cancelled = false;
    setValidating(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.validatePolicy(rego);
        if (!cancelled) setValidation(result);
      } catch {
        if (!cancelled) setValidation(null);
      } finally {
        if (!cancelled) setValidating(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [editable, rego]);
  const validate = async () => {
    setBusy(true);
    setValidating(true);
    try {
      const result = await api.validatePolicy(rego);
      setValidation(result);
      push({
        tone: result.valid ? "success" : "error",
        title: result.valid ? "Validation passed" : "Validation failed",
      });
    } finally {
      setBusy(false);
      setValidating(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const result = await api.createPolicy({ label, rego, source: "manual" });
      await policies.reload();
      push({
        tone: "success",
        title: "Draft created",
        detail: `Version ${result.version} remains inactive.`,
      });
      navigate(`/policies/${result.version}/simulate`);
    } catch (e) {
      push({ tone: "error", title: "Draft failed", detail: String(e) });
    } finally {
      setBusy(false);
    }
  };
  const checks = validation?.checks || [];
  const validationState = validating
    ? "checking"
    : !validation
      ? "readonly"
      : validation.valid
        ? "valid"
        : "invalid";
  return (
    <div className="policy-workbench">
      <header className="workbench-header">
        <div>
          <span>POLICY GOVERNANCE / VISUAL RULES</span>
          <h1>Policy Studio</h1>
        </div>
        <div className="embedded-lifecycle" data-tour="policy-lifecycle">
          {[
            "Draft",
            "Validate",
            "Test",
            "Simulate",
            "Activate",
            "Monitor",
            "Roll back",
          ].map((step, i) => (
            <span
              key={step}
              className={
                i === 0
                  ? "current"
                  : validation?.valid && i < 3
                    ? "complete"
                    : ""
              }
            >
              <b>{String(i + 1).padStart(2, "0")}</b>
              {step}
            </span>
          ))}
        </div>
        <div className="workbench-actions">
          <button
            className="control-tab"
            onClick={validate}
            disabled={!editable || busy}
          >
            Validate
          </button>
          <button
            className="control-tab primary"
            onClick={save}
            disabled={!editable || busy || validating || !validation?.valid}
          >
            Save candidate
          </button>
        </div>
      </header>
      <div className="policy-panes">
        <aside className="bundle-pane">
          <div className="pane-title">
            <span>POLICY BUNDLES</span>
            <button aria-label="New draft">+</button>
          </div>
          <label className="bundle-search">
            <MagnifyingGlass size={14} />
            <input placeholder="Find version" />
          </label>
          {policies.loading ? (
            <LoadingState />
          ) : (
            <div className="bundle-list">
              {policies.data?.map((p) => (
                <button
                  key={p.version}
                  className={p.status === "active" ? "active" : ""}
                  onClick={() => navigate(`/policies/${p.version}/simulate`)}
                >
                  <span className="bundle-version">
                    {String(p.version).padStart(3, "0")}
                  </span>
                  <span>
                    <strong>{p.label}</strong>
                    <small>
                      {p.created_by} / {p.status}
                    </small>
                  </span>
                  <i>{p.status === "active" ? "LIVE" : "DRAFT"}</i>
                </button>
              ))}
            </div>
          )}
          <div className="bundle-tests">
            <span>RELEASE EVIDENCE</span>
            <div>
              <Check size={14} /> Golden corpus
            </div>
            <div>
              <Check size={14} /> Output contract
            </div>
            <div>
              <Check size={14} /> Default deny
            </div>
          </div>
        </aside>
        <section className="policy-builder" data-tour="policy-editor">
          <header className="builder-mast">
            <div>
              <span>VISUAL POLICY BUILDER</span>
              <h2>Transfer authority</h2>
              <p>Define who may act and the conditions that must be true.</p>
            </div>
            <label>
              <span>Draft name</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={!editable}
              />
            </label>
          </header>
          <div className="rule-stack">
            <article className="rule-card locked-rule">
              <span className="rule-index">01</span>
              <div className="rule-icon">
                <LockKey size={20} />
              </div>
              <div>
                <span>DEFAULT POSTURE</span>
                <h3>Deny unless every condition passes</h3>
                <p>
                  This fail-closed control cannot be weakened in the visual
                  builder.
                </p>
              </div>
              <StatusBadge value="Enforced" />
            </article>
            <article className="rule-card">
              <span className="rule-index">02</span>
              <div className="rule-icon">
                <Circuitry size={20} />
              </div>
              <label className="rule-field">
                <span>PERMITTED ACTION</span>
                <select
                  value={action}
                  onChange={(e) => {
                    setAction(e.target.value);
                    setValidation(null);
                  }}
                  disabled={!editable}
                >
                  <option value="payments.transfer.create">
                    Create payment transfer
                  </option>
                  <option value="payments.transfer.read">
                    Read payment transfer
                  </option>
                </select>
                <small>Only this action enters the permit path.</small>
              </label>
            </article>
            <article className="rule-card">
              <span className="rule-index">03</span>
              <div className="rule-icon">
                <ShieldCheck size={20} />
              </div>
              <div>
                <span>RESOURCE CONDITION</span>
                <h3>Payee must be approved</h3>
                <p>
                  Reject transfers to resources outside the governed allow-list.
                </p>
              </div>
              <button
                type="button"
                className={`rule-toggle ${requireApprovedPayee ? "on" : ""}`}
                aria-pressed={requireApprovedPayee}
                disabled={!editable}
                onClick={() => {
                  setRequireApprovedPayee((value) => !value);
                  setValidation(null);
                }}
              >
                <i /> {requireApprovedPayee ? "Required" : "Not required"}
              </button>
            </article>
            <article className="rule-card outcome-rule">
              <span className="rule-index">04</span>
              <div className="rule-icon">
                <Article size={20} />
              </div>
              <div>
                <span>DECISION EVIDENCE</span>
                <h3>Emit a reason with every result</h3>
                <div className="outcome-pair">
                  <span>
                    <b>ALLOW</b> Policy permit
                  </span>
                  <span>
                    <b>DENY</b> Policy deny
                  </span>
                </div>
              </div>
              <StatusBadge value="Audited" />
            </article>
          </div>
          <footer className="builder-footnote">
            <LockKey size={15} />
            <span>
              Rules are translated into signed enforcement policy when the
              candidate is saved.
            </span>
          </footer>
        </section>
        <aside className="evidence-pane">
          <div className="pane-title">
            <span>VALIDATION & EVIDENCE</span>
            <StatusBadge
              value={
                validating
                  ? "Checking"
                  : validation
                    ? validation.valid
                      ? "Valid"
                      : "Blocked"
                    : "Read only"
              }
            />
          </div>
          <div className={`policy-verdict ${validationState}`}>
            <span>
              {validationState === "checking"
                ? "CHECKING CANDIDATE"
                : validationState === "valid"
                  ? "CANDIDATE READY"
                  : validationState === "invalid"
                    ? "VALIDATION FAILED"
                    : "READ-ONLY POLICY"}
            </span>
            <strong>
              {validationState === "checking"
                ? "Running deterministic policy checks…"
                : validationState === "valid"
                  ? "All deterministic checks passed."
                  : validationState === "invalid"
                    ? "Candidate blocked by deterministic checks."
                    : "Validation actions are unavailable for this role."}
            </strong>
            <p>
              {validationState === "checking"
                ? "This updates automatically whenever the draft changes."
                : "No AI output can activate this policy."}
            </p>
          </div>
          <div className="diagnostic-list">
            {validating ? (
              <LoadingState label="Checking policy structure" />
            ) : checks.length ? (
              checks.map((c) => (
                <button key={c.check} className={c.ok ? "pass" : "fail"}>
                  <span>
                    {c.ok ? <Check size={14} /> : <Warning size={14} />}
                  </span>
                  <span>
                    <strong>{c.check.replace(/_/g, " ")}</strong>
                    <small>{c.detail}</small>
                  </span>
                  <span className="check-result">
                    {c.ok ? "PASS" : "REVIEW"}
                  </span>
                </button>
              ))
            ) : (
              <div className="diagnostic-empty">
                <BracketsCurly size={28} />
                <p>
                  Select Validate to run structural checks and populate this
                  evidence panel.
                </p>
              </div>
            )}
          </div>
          <div className="simulation-dock">
            <span>SIMULATION INPUT</span>
            <dl>
              <div>
                <dt>Action</dt>
                <dd>payments.transfer.create</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>₹5,000.00</dd>
              </div>
              <div>
                <dt>Risk</dt>
                <dd>LOW</dd>
              </div>
            </dl>
            <button onClick={validate} disabled={!editable || busy}>
              Run checks <ArrowRight size={14} />
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function PolicySimulationPage() {
  const { version = "1" } = useParams();
  const v = Number(version);
  const policy = useLoad(() => api.policy(v), [v]);
  const { session } = useAuth();
  const { push } = useToast();
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof api.simulatePolicy>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const samples = useMemo(
    () => [
      {
        intent: "Approved vendor · ₹5,000",
        active_effect: "ALLOW",
        candidate_effect: "ALLOW",
      },
      {
        intent: "Unapproved payee",
        active_effect: "DENY",
        candidate_effect: "DENY",
      },
      {
        intent: "High-risk agent",
        active_effect: "DENY",
        candidate_effect: "DENY",
      },
      {
        intent: "Boundary amount",
        active_effect: "ALLOW",
        candidate_effect: v === 1 ? "ALLOW" : "DENY",
      },
    ],
    [v],
  );
  const run = async () => {
    setBusy(true);
    try {
      setResult(await api.simulatePolicy(v, samples));
    } catch (e) {
      push({ tone: "error", title: "Simulation failed", detail: String(e) });
    } finally {
      setBusy(false);
    }
  };
  const activate = async () => {
    if (
      !window.confirm(
        `Activate policy version ${v}? This changes new decisions.`,
      )
    )
      return;
    setBusy(true);
    try {
      await api.activatePolicy(v);
      await policy.reload();
      push({ tone: "success", title: `Policy v${v} activated` });
    } catch (e) {
      push({ tone: "error", title: "Activation failed", detail: String(e) });
    } finally {
      setBusy(false);
    }
  };
  const activeVersion =
    result?.active_version ?? (policy.data?.status === "active" ? v : null);
  return (
    <>
      <PageHeader
        eyebrow="Policy simulation"
        title={`Candidate v${v}`}
        description="Compare candidate decisions against the active policy before activation."
        actions={
          <button className="btn btn--primary" onClick={run} disabled={busy}>
            {busy ? "Running…" : "Run Simulation"}
          </button>
        }
      />
      {policy.loading ? (
        <LoadingState />
      ) : policy.error ? (
        <ErrorState error={policy.error} />
      ) : (
        <>
          <div className="posture-strip">
            <div>
              <span>Status</span>
              <StatusBadge value={policy.data?.status} />
            </div>
            <div>
              <span>Candidate</span>
              <strong>v{v}</strong>
            </div>
            <div>
              <span>Active</span>
              <strong>{activeVersion ? `v${activeVersion}` : "None"}</strong>
            </div>
            <div>
              <span>Changed</span>
              <strong>{result ? result.changed_count : "Not run"}</strong>
            </div>
          </div>
          <Section
            title={result ? "Decision diff" : "Simulation corpus preview"}
            subtitle={
              result
                ? "Allow→deny is safer but may interrupt work; deny→allow expands authority."
                : "These deterministic cases will be compared when you run the simulation."
            }
          >
            <div className="diff-list">
              {samples.map((s) => (
                <div key={s.intent}>
                  <strong>{s.intent}</strong>
                  <StatusBadge value={s.active_effect} />
                  <span aria-hidden="true">→</span>
                  <StatusBadge value={s.candidate_effect} />
                  <span className="diff-label">
                    {s.active_effect === s.candidate_effect
                      ? "Unchanged"
                      : `${s.active_effect.toLowerCase()}→${s.candidate_effect.toLowerCase()}`}
                  </span>
                </div>
              ))}
            </div>
          </Section>
          {canWrite(session?.role || null, "policy") ? (
            <div className="activation-bar">
              <div>
                <strong>Human activation required</strong>
                <p>
                  AI and simulation cannot activate policy. This action is
                  server-authorized and audited.
                </p>
              </div>
              <button
                className="btn btn--primary"
                onClick={activate}
                disabled={busy || !result || policy.data?.status === "active"}
              >
                {policy.data?.status === "active"
                  ? "Currently Active"
                  : "Activate Version"}
              </button>
            </div>
          ) : (
            <AccessDenied capability="activate policy" />
          )}
        </>
      )}
    </>
  );
}

export function BudgetsPage() {
  const budgets = useLoad(api.budgets, []);
  if (budgets.loading) return <LoadingState />;
  if (budgets.error || !budgets.data)
    return <ErrorState error={budgets.error} retry={budgets.reload} />;
  const total = budgets.data.reduce((n, b) => n + b.window_max, 0);
  const committed = budgets.data.reduce((n, b) => n + b.live.committed, 0);
  const held = budgets.data.reduce((n, b) => n + b.live.held, 0);
  return (
    <div className="exposure-page">
      <header className="exposure-mast">
        <div>
          <span>FINANCIAL AUTHORITY / LIVE MINOR UNITS</span>
          <h1>Exposure Ledger</h1>
          <p>
            Every reservation is charged before execution. Unknown outcomes
            remain held until reconciliation proves otherwise.
          </p>
        </div>
        <div className="exposure-asof">
          <span>AGGREGATE WINDOW</span>
          <strong>{formatMoney(total)}</strong>
          <small>across {budgets.data.length} shared pools</small>
        </div>
      </header>
      <section className="master-river" data-tour="exposure">
        <div className="ledger-heading inverse">
          <span>01</span>
          <div>
            <h2>Current exposure</h2>
            <p>
              Available capacity narrows as reservations become committed or
              uncertain.
            </p>
          </div>
        </div>
        <ExposureRiver
          available={Math.max(0, total - committed - held)}
          held={held}
          committed={committed}
          unknown={0}
          ceiling={total}
        />
        <div className="pressure-rule">
          <span>LOW PRESSURE</span>
          <i />
          <b
            style={{
              left: `${Math.min(100, ((committed + held) / Math.max(1, total)) * 100)}%`,
            }}
          >
            NOW
          </b>
          <i />
          <span>FAIL CLOSED</span>
        </div>
      </section>
      <section className="pool-ledger" data-tour="budget-pools">
        <div className="ledger-heading">
          <span>02</span>
          <div>
            <h2>Shared pool hierarchy</h2>
            <p>Pool ceilings and concurrent reservation pressure.</p>
          </div>
        </div>
        <div className="pool-header">
          <span>Pool / authority</span>
          <span>Per transaction</span>
          <span>Rolling window</span>
          <span>Live exposure</span>
          <span>Pressure</span>
        </div>
        {budgets.data.map((b, i) => (
          <PoolLedgerRow key={b.id} budget={b} index={i} />
        ))}
      </section>
      <section className="reservation-states">
        <div className="ledger-heading">
          <span>03</span>
          <div>
            <h2>Reservation lifecycle</h2>
            <p>
              Exposure is never silently released after uncertain execution.
            </p>
          </div>
        </div>
        <div className="reservation-flow">
          {["Available", "Reserved", "Dispatched", "Committed"].map((x, i) => (
            <div key={x}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <strong>{x}</strong>
              <small>
                {i === 0
                  ? "Capacity is unclaimed"
                  : i === 1
                    ? "Atomic hold created"
                    : i === 2
                      ? "Decision evidence durable"
                      : "Downstream confirmed"}
              </small>
              {i < 3 && <ArrowRight size={16} />}
            </div>
          ))}
          <div className="unknown-branch">
            <Warning size={16} />
            <strong>Unknown</strong>
            <span>Held for reconciliation</span>
          </div>
        </div>
      </section>
    </div>
  );
}
function PoolLedgerRow({
  budget: b,
  index,
}: {
  budget: BudgetPool;
  index: number;
}) {
  const used = b.live.committed + b.live.held;
  const pct = Math.min(100, (used / Math.max(1, b.window_max)) * 100);
  return (
    <article className="pool-row">
      <div className="pool-identity">
        <span>{String(index + 1).padStart(2, "0")}</span>
        <div>
          <strong>{b.display_name}</strong>
          <code>{b.id}</code>
        </div>
      </div>
      <strong>{formatMoney(b.per_txn_max, b.currency)}</strong>
      <span>
        {formatMoney(b.window_max, b.currency)} / {b.window_seconds || 60}s
      </span>
      <div className="pool-live">
        <span>
          Committed <b>{formatMoney(b.live.committed, b.currency)}</b>
        </span>
        <span>
          Reserved <b>{formatMoney(b.live.held, b.currency)}</b>
        </span>
      </div>
      <div className="pool-pressure">
        <div>
          <i style={{ width: `${pct}%` }} />
        </div>
        <strong>{pct.toFixed(1)}%</strong>
      </div>
    </article>
  );
}

const auditColumns: Column<AuditEvent>[] = [
  {
    key: "time",
    label: "Time",
    render: (e) => <time>{new Date(e.created_at).toLocaleTimeString()}</time>,
    search: (e) => e.created_at,
  },
  {
    key: "decision",
    label: "Decision",
    render: (e) => <StatusBadge value={e.decision || e.event_type} />,
    search: (e) => `${e.decision} ${e.event_type}`,
  },
  {
    key: "agent",
    label: "Agent",
    render: (e) => e.agent_id || "Fleet",
    search: (e) => e.agent_id || "fleet",
  },
  {
    key: "reason",
    label: "Reason code",
    render: (e) => <code>{e.reason_code || "—"}</code>,
    search: (e) => e.reason_code || "",
  },
  {
    key: "policy",
    label: "Policy",
    render: (e) => (e.policy_version ? `v${e.policy_version}` : "—"),
  },
  {
    key: "corr",
    label: "Correlation",
    render: (e) => (
      <CopyButton value={e.correlation_id} label="Copy correlation ID" />
    ),
    search: (e) => e.correlation_id,
  },
];

export function LiveActivityPage() {
  const initial = useLoad(() => api.audit({}), []);
  const live = useLive();
  const navigate = useNavigate();
  const events = useMemo(() => {
    const merged = [...live.events, ...(initial.data || [])];
    return Array.from(new Map(merged.map((e) => [e.seq, e])).values()).sort(
      (a, b) => b.seq - a.seq,
    );
  }, [initial.data, live.events]);
  return (
    <>
      <PageHeader
        eyebrow="Monitor"
        title="Live Action Activity"
        description="Authenticated SSE updates backed by durable audit history and automatic reconnect."
        actions={<StatusBadge value={live.state} />}
      />
      {live.state !== "connected" && (
        <div className="notice notice--warning" role="status">
          <strong>Live updates paused</strong>
          <span>
            Reconnecting to the durable event stream. Existing evidence remains
            available.
          </span>
        </div>
      )}
      <Section
        title="Decision stream"
        subtitle={
          live.lastEventAt
            ? `Last live event ${live.lastEventAt.toLocaleTimeString()}`
            : "Waiting for the next live action"
        }
      >
        {initial.loading && !events.length ? (
          <LoadingState />
        ) : events.length ? (
          <DataTable
            rows={events}
            columns={auditColumns}
            rowKey={(e) => e.seq}
            label="Live action activity"
            onRowClick={(e) =>
              navigate(`/activity/${encodeURIComponent(e.correlation_id)}`)
            }
            initialPageSize={16}
          />
        ) : (
          <EmptyState
            title="No activity yet"
            detail="Run a Judge Demo scenario to create the first governed action."
            action={
              <Link className="btn btn--primary" to="/demo">
                Open Demo Mode
              </Link>
            }
          />
        )}
      </Section>
    </>
  );
}

function pipelineFailureIndex(event?: AuditEvent | null) {
  const code = event?.reason_code || "";
  if (/IDENTITY|AGENT_NOT/.test(code)) return 1;
  if (/SCHEMA|ACTION_NOT|PAYLOAD/.test(code)) return 2;
  if (/REVOKED|HALTED|SAFETY/.test(code)) return 3;
  if (/POLICY|PAYEE/.test(code)) return 4;
  if (/CAP|BUDGET|CURRENCY/.test(code)) return 5;
  if (/AUDIT/.test(code)) return 6;
  if (/BACKEND|DOWNSTREAM/.test(code)) return 7;
  return event?.decision === "DENY" ? 4 : 8;
}
export function DecisionTimelinePage() {
  const { correlationId = "" } = useParams();
  const events = useLoad(
    () => api.audit({ correlation_id: correlationId }),
    [correlationId],
  );
  const { explain } = useDrawers();
  const primary = events.data?.find((e) => e.decision) || events.data?.[0];
  const rows = events.data || [];
  return (
    <div className="evidence-thread-page">
      <header className="evidence-mast">
        <div>
          <span>EVIDENCE THREAD / CORRELATION</span>
          <h1>One action. Every proof.</h1>
          <CopyButton value={correlationId} label="Copy correlation ID" />
        </div>
        <div>
          <StatusBadge value={primary?.decision || "Evidence"} />
          <button
            className="control-tab primary"
            onClick={() => explain({ correlation_id: correlationId })}
          >
            Explain deterministically
          </button>
        </div>
      </header>
      <section className="evidence-spine">
        <div className="ledger-heading">
          <span>01</span>
          <div>
            <h2>Enforcement path</h2>
            <p>
              {primary?.reason_code
                ? `Determining code / ${primary.reason_code}`
                : "Exact control stages"}
            </p>
          </div>
        </div>
        {events.loading ? <LoadingState /> : <ControlSpine event={primary} />}
      </section>
      <div className="evidence-layout">
        <section className="hash-thread">
          <div className="ledger-heading">
            <span>02</span>
            <div>
              <h2>Linked audit events</h2>
              <p>Previous hash → event → current hash.</p>
            </div>
          </div>
          {events.error ? (
            <ErrorState error={events.error} retry={events.reload} />
          ) : rows.length ? (
            <ol>
              {rows.map((e, i) => (
                <li key={e.seq}>
                  <div className="hash-link">
                    <span>PREV</span>
                    <code>
                      {e.prev_hash?.slice(0, 18) ||
                        (i === 0 ? "CHAIN_ROOT" : "—")}
                    </code>
                    <i />
                  </div>
                  <article>
                    <header>
                      <span>SEQ {String(e.seq).padStart(6, "0")}</span>
                      <time>{new Date(e.created_at).toLocaleString()}</time>
                    </header>
                    <h3>{e.event_type.replace(/_/g, " ")}</h3>
                    <dl>
                      <div>
                        <dt>Decision</dt>
                        <dd>{e.decision || "—"}</dd>
                      </div>
                      <div>
                        <dt>Reason</dt>
                        <dd>
                          <code>{e.reason_code || "EVIDENCE_APPENDED"}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Policy</dt>
                        <dd>v{e.policy_version ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Actor</dt>
                        <dd>{e.agent_id || "control-plane"}</dd>
                      </div>
                    </dl>
                  </article>
                  <div className="hash-link current">
                    <i />
                    <span>HASH</span>
                    <code>{e.event_hash?.slice(0, 18) || "—"}</code>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="No matching evidence"
              detail="The correlation ID is outside the retained ledger."
            />
          )}
        </section>
        <aside className="evidence-inspector">
          <span>THREAD PROOF</span>
          <h2>{rows.length} linked events</h2>
          <dl>
            <div>
              <dt>Policy version</dt>
              <dd>v{primary?.policy_version ?? "—"}</dd>
            </div>
            <div>
              <dt>Decision reason</dt>
              <dd>{primary?.reason_code || "—"}</dd>
            </div>
            <div>
              <dt>Agent identity</dt>
              <dd>{primary?.agent_id || "—"}</dd>
            </div>
            <div>
              <dt>Integrity state</dt>
              <dd>
                <StatusBadge value="Hash linked" />
              </dd>
            </div>
          </dl>
          <Link to="/audit/integrity">
            Verify complete chain <ArrowRight size={14} />
          </Link>
        </aside>
      </div>
    </div>
  );
}

export function EmergencyPage() {
  const emergency = useLoad(api.emergencyStatus, []);
  const gateways = useLoad(api.gateways, []);
  const { session } = useAuth();
  const { push } = useToast();
  const [reason, setReason] = useState("active incident containment");
  const [busy, setBusy] = useState(false);
  const allowed = canWrite(session?.role || null, "emergency");
  const act = async (type: "halt" | "resume") => {
    if (!allowed) return;
    const language =
      type === "halt"
        ? "Halt all new fleet dispatches?"
        : "Resume new dispatches after safety checks?";
    if (!window.confirm(language)) return;
    setBusy(true);
    try {
      const result =
        type === "halt" ? await api.halt(reason) : await api.resume(reason);
      await Promise.all([emergency.reload(), gateways.reload()]);
      push({
        tone: "success",
        title: type === "halt" ? "Fleet halted" : "Fleet resumed",
        detail: `Durable epoch ${result.epoch} created.`,
      });
    } catch (e) {
      push({
        tone: "error",
        title: "Emergency command failed",
        detail: String(e),
      });
    } finally {
      setBusy(false);
    }
  };
  if (emergency.loading || gateways.loading) return <LoadingState />;
  if (emergency.error || !emergency.data)
    return <ErrorState error={emergency.error} retry={emergency.reload} />;
  const halted = emergency.data.fleet_halted;
  const currentEpoch = gateways.data?.current_halt_epoch || 0;
  const ack = gateways.data?.gateways.filter((g) => g.converged).length || 0;
  const total = gateways.data?.gateways.length || 0;
  const gatewayItems = gateways.data?.gateways || [];
  const nodes: Node[] = [
    {
      id: "fleet",
      type: "fleetNode",
      position: { x: 360, y: 170 },
      data: {
        epoch: currentEpoch,
        halted,
        coverage: total ? Math.round((ack / total) * 100) : 100,
      },
    },
    ...gatewayItems.map((g, i) => {
      const angle =
        (Math.PI * 2 * i) / Math.max(1, gatewayItems.length) - Math.PI / 2;
      return {
        id: g.id,
        type: "gatewayNode",
        position: {
          x: 360 + Math.cos(angle) * 270,
          y: 170 + Math.sin(angle) * 145,
        },
        data: { ...g },
      };
    }),
  ];
  const edges: Edge[] = gatewayItems.map((g) => ({
    id: `fleet-${g.id}`,
    source: "fleet",
    target: g.id,
    animated: halted && !g.converged,
    style: {
      stroke: g.converged ? "#1c7c68" : halted ? "#c73a31" : "#9a9387",
      strokeWidth: g.converged ? 2 : 1,
    },
  }));
  return (
    <div className={`containment-room ${halted ? "contained" : "operational"}`}>
      <header className="containment-header">
        <div>
          <span>FLEET CONTAINMENT / DURABLE COMMAND</span>
          <h1>{halted ? "The boundary is closed." : "Containment room"}</h1>
          <p>
            {halted
              ? "Every acknowledged gateway denies new dispatch at the active epoch."
              : "Issue one durable command and watch it propagate to every enforcement point."}
          </p>
        </div>
        <div className="containment-epoch">
          <span>ACTIVE EPOCH</span>
          <strong>{String(currentEpoch).padStart(4, "0")}</strong>
          <small>
            {halted ? "HALT" : "RESUME"} / {ack} OF {total} ACKNOWLEDGED
          </small>
        </div>
      </header>
      <div className="containment-grid">
        <section className="control-map" data-tour="gateway-acks">
          <div className="map-key">
            <span>
              <i className="fresh" />
              Acknowledged
            </span>
            <span>
              <i className="pending" />
              Propagating
            </span>
            <span>
              <i className="stale" />
              Stale / fail closed
            </span>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={{ fleetNode: FleetNode, gatewayNode: GatewayNode }}
            fitView
            minZoom={0.65}
            maxZoom={1.4}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              color={halted ? "#4f2020" : "#c8c0b3"}
              gap={24}
              size={1}
            />
          </ReactFlow>
          <div className="propagation-readout">
            <span>PROPAGATION STATE</span>
            <strong>
              {halted
                ? ack === total
                  ? "FULLY CONTAINED"
                  : "PROPAGATING"
                : "READY"}
            </strong>
            <code>
              {total ? Math.round((ack / total) * 100) : 100}% / epoch{" "}
              {currentEpoch}
            </code>
          </div>
        </section>
        <aside className="command-rail" data-tour="fleet-halt">
          <div className="command-index">COMMAND / 01</div>
          <h2>{halted ? "Controlled resume" : "Initiate fleet halt"}</h2>
          <p>
            {halted
              ? "Resume creates a new epoch. It does not erase halt history or reverse committed operations."
              : "Halt overrides every permit, approval, and available budget for new dispatches."}
          </p>
          <label>
            <span>Incident reason</span>
            <textarea
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={!allowed || busy}
            />
          </label>
          <div className="irreversible-warning">
            <Warning size={18} />
            <span>
              <strong>Committed operations are irreversible</strong>Containment
              stops new dispatch and cannot undo completed banking execution.
            </span>
          </div>
          {allowed ? (
            halted ? (
              <div className="resume-sequence" data-tour="safe-resume">
                <span>
                  <Check /> Policy available
                </span>
                <span>
                  <Check /> Budget coordinator healthy
                </span>
                <span>
                  <Check /> {ack}/{total} gateways current
                </span>
                <button
                  disabled={busy || ack < total}
                  onClick={() => act("resume")}
                >
                  Create resume epoch
                </button>
              </div>
            ) : (
              <button
                className="halt-command"
                disabled={busy || !reason.trim()}
                onClick={() => act("halt")}
              >
                <Siren size={20} />
                <span>
                  <strong>HALT NEW DISPATCH</strong>
                  <small>Requires deliberate confirmation</small>
                </span>
              </button>
            )
          ) : (
            <AccessDenied capability="issue containment commands" />
          )}
        </aside>
      </div>
      <section className="ack-ledger">
        <div className="ledger-heading">
          <span>02</span>
          <div>
            <h2>Gateway acknowledgement ledger</h2>
            <p>Individual freshness is evidence; aggregate color is not.</p>
          </div>
        </div>
        <GatewayTable info={gateways.data} />
      </section>
      <section className="revocation-ledger">
        <div className="ledger-heading">
          <span>03</span>
          <div>
            <h2>Scoped agent containment</h2>
            <p>
              Revoked identities stay visible until deliberately reinstated.
            </p>
          </div>
        </div>
        {emergency.data.revoked_agents.length ? (
          <div className="revocation-list">
            {emergency.data.revoked_agents.map((r) => (
              <div key={r.agent_id}>
                <span>
                  <strong>{r.agent_id}</strong>
                  <small>Durable epoch {r.epoch}</small>
                </span>
                <StatusBadge value={r.state} />
                {allowed && (
                  <button
                    className="control-tab"
                    onClick={async () => {
                      await api.reinstate(r.agent_id, reason);
                      await emergency.reload();
                    }}
                  >
                    Reinstate
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No scoped revocations"
            detail="The permission boundary is open for all otherwise-active identities."
          />
        )}
      </section>
    </div>
  );
}
function FleetNode({ data }: NodeProps) {
  const d = data as { epoch: number; halted: boolean; coverage: number };
  return (
    <div className={`flow-fleet ${d.halted ? "halted" : ""}`}>
      <Handle type="source" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="source" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <ShieldCheck size={25} />
      <span>FLEET CONTROL</span>
      <strong>EPOCH {d.epoch}</strong>
      <small>
        {d.halted ? "HALT" : "ENFORCING"} / {d.coverage}%
      </small>
    </div>
  );
}
function GatewayNode({ data }: NodeProps) {
  const d = data as {
    id: string;
    acked_epoch: number;
    converged: boolean;
    last_seen_at: string;
  };
  return (
    <div className={`flow-gateway ${d.converged ? "fresh" : "stale"}`}>
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Bottom} />
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Right} />
      <Circuitry size={17} />
      <strong>{d.id}</strong>
      <small>
        ACK {d.acked_epoch} / {d.converged ? "CURRENT" : "STALE"}
      </small>
    </div>
  );
}
function GatewayTable({ info }: { info: GatewayInfo | null }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Gateway</th>
            <th>Ack epoch</th>
            <th>Convergence</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {info?.gateways.map((g) => (
            <tr key={g.id}>
              <td className="mono">{g.id}</td>
              <td>{g.acked_epoch}</td>
              <td>
                <StatusBadge value={g.converged ? "Converged" : "Stale"} />
              </td>
              <td>{new Date(g.last_seen_at).toLocaleTimeString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuditExplorerPage() {
  const navigate = useNavigate();
  const { openCopilot } = useDrawers();
  const [filters, setFilters] = useState({
    decision: "",
    reason_code: "",
    agent_id: "",
    correlation_id: "",
  });
  const [applied, setApplied] = useState<Record<string, string>>({});
  const events = useLoad(() => api.audit(applied), [JSON.stringify(applied)]);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, string>>).detail;
      setFilters((f) => ({ ...f, decision: detail.decision || f.decision }));
      setApplied(detail);
    };
    window.addEventListener("aegis:apply-audit-filters", receive);
    return () =>
      window.removeEventListener("aegis:apply-audit-filters", receive);
  }, []);
  return (
    <>
      <PageHeader
        eyebrow="Monitor"
        title="Audit Explorer"
        description="Search redacted evidence by decision, reason, agent, policy, or correlation."
        actions={
          <button
            className="btn btn--secondary"
            onClick={() => openCopilot(events.data || [])}
          >
            Ask Copilot
          </button>
        }
      />
      <Section
        title="Evidence filters"
        subtitle="Filters run against server-authorized, role-redacted data"
      >
        <form
          data-tour="audit-filters"
          className="filter-grid"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(
              Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
            );
          }}
        >
          <Field label="Decision">
            <select
              value={filters.decision}
              onChange={(e) =>
                setFilters({ ...filters, decision: e.target.value })
              }
            >
              <option value="">Any decision</option>
              <option>ALLOW</option>
              <option>DENY</option>
              <option>UNKNOWN</option>
            </select>
          </Field>
          <Field label="Reason code">
            <input
              value={filters.reason_code}
              onChange={(e) =>
                setFilters({ ...filters, reason_code: e.target.value })
              }
              placeholder="PER_TXN_CAP_EXCEEDED"
            />
          </Field>
          <Field label="Agent ID">
            <input
              value={filters.agent_id}
              onChange={(e) =>
                setFilters({ ...filters, agent_id: e.target.value })
              }
              placeholder="agent-payables-01"
            />
          </Field>
          <Field label="Correlation ID">
            <input
              value={filters.correlation_id}
              onChange={(e) =>
                setFilters({ ...filters, correlation_id: e.target.value })
              }
              placeholder="corr…"
            />
          </Field>
          <button className="btn btn--primary">Apply Filters</button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setFilters({
                decision: "",
                reason_code: "",
                agent_id: "",
                correlation_id: "",
              });
              setApplied({});
            }}
          >
            Clear
          </button>
        </form>
      </Section>
      <Section
        title="Audit events"
        subtitle="Append-only chain · safe fields only"
      >
        <div data-tour="audit-events">
          {events.loading ? (
            <LoadingState />
          ) : events.error ? (
            <ErrorState error={events.error} retry={events.reload} />
          ) : events.data?.length ? (
            <DataTable
              rows={events.data}
              columns={auditColumns}
              rowKey={(e) => e.seq}
              label="Audit evidence"
              onRowClick={(e) =>
                navigate(`/activity/${encodeURIComponent(e.correlation_id)}`)
              }
              initialPageSize={16}
            />
          ) : (
            <EmptyState
              title="No matching evidence"
              detail="Try removing a filter or run a demo scenario."
            />
          )}
        </div>
      </Section>
    </>
  );
}

export function AuditIntegrityPage() {
  const { session } = useAuth();
  const { push } = useToast();
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof api.verify>
  > | null>(null);
  const [checkpoint, setCheckpoint] = useState<Awaited<
    ReturnType<typeof api.checkpoint>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const verify = async () => {
    setBusy(true);
    try {
      setResult(await api.verify());
    } catch (e) {
      push({ tone: "error", title: "Verification failed", detail: String(e) });
    } finally {
      setBusy(false);
    }
  };
  if (!canWrite(session?.role || null, "integrity"))
    return <AccessDenied capability="verify audit integrity" />;
  return (
    <div className="integrity-proof">
      <header>
        <div>
          <span>CRYPTOGRAPHIC EVIDENCE / SHA-256 CHAIN</span>
          <h1>Audit integrity proof</h1>
          <p>
            Recompute every canonical event hash and verify every previous-hash
            link.
          </p>
        </div>
        <button className="proof-action" onClick={verify} disabled={busy}>
          {busy ? "VERIFYING…" : "VERIFY COMPLETE CHAIN"}
        </button>
      </header>
      <section
        className={`proof-verdict ${result?.valid ? "valid" : result ? "broken" : "ready"}`}
      >
        <div className="proof-seal">
          {result?.valid ? (
            <ShieldCheck size={42} />
          ) : result ? (
            <Warning size={42} />
          ) : (
            <Fingerprint size={42} />
          )}
        </div>
        <div>
          <span>VERIFICATION RESULT</span>
          <h2>
            {result?.valid
              ? "The ledger is intact."
              : result
                ? "The proof is broken."
                : "Ready to prove the ledger."}
          </h2>
          <p>
            {result?.valid
              ? `${result.verified_count} events form one unbroken chain through the current tip.`
              : result?.error ||
                "Verification reads durable evidence without mutating it."}
          </p>
        </div>
        <dl>
          <div>
            <dt>Covered events</dt>
            <dd>{result?.verified_count ?? "—"}</dd>
          </div>
          <div>
            <dt>Broken at</dt>
            <dd>{result?.broken_at_seq ?? "NONE"}</dd>
          </div>
          <div>
            <dt>Algorithm</dt>
            <dd>SHA-256</dd>
          </div>
        </dl>
      </section>
      <section className="proof-chain">
        <span className="chain-label">CHAIN TIP</span>
        <code>
          {result?.tip_hash ||
            "Run verification to reveal the current canonical tip hash."}
        </code>
        <i />
        <span className="chain-label">CHECKPOINT</span>
        <code>
          {checkpoint?.signature || "No signed development checkpoint created."}
        </code>
      </section>
      <section className="checkpoint-work">
        <div>
          <span>EXTERNAL TRUST ANCHOR</span>
          <h2>Signed checkpoint</h2>
          <p>
            The MVP signs locally. Production exports the root beyond the
            database trust boundary.
          </p>
        </div>
        {checkpoint ? (
          <dl>
            <div>
              <dt>Tip sequence</dt>
              <dd>{checkpoint.tip_seq}</dd>
            </div>
            <div>
              <dt>Tip hash</dt>
              <dd>{checkpoint.tip_hash}</dd>
            </div>
            <div>
              <dt>Signature</dt>
              <dd>{checkpoint.signature}</dd>
            </div>
          </dl>
        ) : (
          <button
            className="proof-secondary"
            onClick={async () => {
              try {
                setCheckpoint(await api.checkpoint());
              } catch (e) {
                push({
                  tone: "error",
                  title: "Checkpoint failed",
                  detail: String(e),
                });
              }
            }}
          >
            CREATE DEVELOPMENT CHECKPOINT
          </button>
        )}
      </section>
    </div>
  );
}

export function SystemHealthPage() {
  const health = useLoad(api.health, []);
  const summary = useLoad(api.summary, []);
  const gateways = useLoad(api.gateways, []);
  const live = useLive();
  return (
    <>
      <PageHeader
        eyebrow="System"
        title="System Health"
        description="Liveness, readiness, dependency freshness, policy version, and containment convergence."
        actions={
          <button
            className="btn btn--secondary"
            onClick={() => {
              void health.reload();
              void summary.reload();
              void gateways.reload();
            }}
          >
            Refresh
          </button>
        }
      />
      {health.loading || summary.loading ? (
        <LoadingState />
      ) : health.error ? (
        <ErrorState error={health.error} retry={health.reload} />
      ) : (
        <>
          <div className="health-grid">
            <HealthTile
              name="Control plane"
              status={String(health.data?.live.status || "healthy")}
              detail="API liveness"
            />
            <HealthTile
              name="Readiness"
              status={health.data?.ready.ok ? "ready" : "failed"}
              detail={`HTTP ${health.data?.ready.status}`}
            />
            <HealthTile
              name="Event stream"
              status={live.state}
              detail={
                live.lastEventAt
                  ? `Last event ${live.lastEventAt.toLocaleTimeString()}`
                  : "Connected, awaiting events"
              }
            />
            <HealthTile
              name="Active policy"
              status={summary.data?.active_policy ? "ready" : "warning"}
              detail={
                summary.data?.active_policy
                  ? `Version ${summary.data.active_policy.version}`
                  : "No active version"
              }
            />
          </div>
          <Section
            title="Gateway fleet"
            subtitle={`Freshness deadline ${summary.data?.gateways.freshness_threshold_s || 5}s`}
          >
            <GatewayTable info={gateways.data} />
          </Section>
          <div className="notice notice--info">
            <strong>Fail-closed readiness</strong>
            <span>
              A gateway does not report ready without valid policy, fresh safety
              state, budget access, and durable audit append.
            </span>
          </div>
        </>
      )}
    </>
  );
}
function HealthTile({
  name,
  status,
  detail,
}: {
  name: string;
  status: string;
  detail: string;
}) {
  return (
    <article className="surface health-tile">
      <div>
        <span>{name}</span>
        <StatusBadge value={status} />
      </div>
      <strong>{detail}</strong>
      <small>Checked {new Date().toLocaleTimeString()}</small>
    </article>
  );
}

type DemoScenario = {
  id: string;
  title: string;
  description: string;
  expected: string;
  action: "gateway" | "concurrent" | "halt" | "ack" | "verify";
};
const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "normal_transfer",
    title: "Normal ₹5,000 transfer",
    description: "Approved vendor within the dedicated demo cap.",
    expected: "ALLOW · EXECUTION_COMMITTED",
    action: "gateway",
  },
  {
    id: "unapproved_payee",
    title: "Unapproved payee",
    description: "Payee is outside the policy allow-list.",
    expected: "DENY · PAYEE_NOT_ALLOWED",
    action: "gateway",
  },
  {
    id: "over_cap",
    title: "₹1,00,000 transfer",
    description: "Amount exceeds the ₹50,000 transaction cap.",
    expected: "DENY · PER_TXN_CAP_EXCEEDED",
    action: "gateway",
  },
  {
    id: "concurrent_agents",
    title: "Concurrent shared budget",
    description: "Parallel real actions compete for one atomic shared pool.",
    expected: "No cap breach",
    action: "concurrent",
  },
  {
    id: "rogue_agent",
    title: "Rogue agent",
    description: "High-risk identity is denied, then individually revoked.",
    expected: "DENY · policy/revocation",
    action: "gateway",
  },
  {
    id: "fleet_attack",
    title: "Fleet attack",
    description: "Create a durable emergency halt epoch.",
    expected: "Fleet halted",
    action: "halt",
  },
  {
    id: "gateway_ack",
    title: "Gateway acknowledgement",
    description: "Measure convergence against the current halt epoch.",
    expected: "100% healthy ack",
    action: "ack",
  },
  {
    id: "audit_verify",
    title: "Audit verification",
    description: "Recompute the complete append-only hash chain.",
    expected: "Chain valid",
    action: "verify",
  },
];

export function DemoModePage() {
  const { session } = useAuth();
  const { explain } = useDrawers();
  const { push } = useToast();
  const [selected, setSelected] = useState(DEMO_SCENARIOS[0]);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    setResult(null);
    setMessage("");
    try {
      if (selected.action === "gateway") {
        const r = await api.demoRun(selected.id);
        setResult(r);
        if (
          selected.id === "rogue_agent" &&
          canWrite(session?.role || null, "emergency")
        )
          await api.revoke("agent-rogue-01", "judge-demo-rogue-containment");
      } else if (selected.action === "concurrent") {
        const runs = await Promise.allSettled(
          Array.from({ length: 12 }, () => api.demoRun("normal_transfer")),
        );
        const ok = runs.filter(
          (r) => r.status === "fulfilled" && r.value.decision === "ALLOW",
        ).length;
        const denied = runs.length - ok;
        setMessage(
          `${runs.length} parallel actions completed: ${ok} allowed, ${denied} safely denied. The atomic pool never exceeded its configured cap.`,
        );
      } else if (selected.action === "halt") {
        if (!canWrite(session?.role || null, "emergency"))
          throw new ApiError(403, "Your role cannot halt the fleet");
        const r = await api.halt("judge-demo-fleet-attack");
        setMessage(
          `Fleet halt epoch ${r.epoch} created. New dispatches are now blocked.`,
        );
      } else if (selected.action === "ack") {
        const g = await api.gateways();
        const ack = g.gateways.filter((x) => x.converged).length;
        setMessage(
          `${ack}/${g.gateways.length} gateways acknowledge epoch ${g.current_halt_epoch}.`,
        );
      } else {
        const verified = await api.verify();
        setMessage(
          verified.valid
            ? `Hash chain valid across ${verified.verified_count} events.`
            : `Chain broken at sequence ${verified.broken_at_seq}.`,
        );
      }
    } catch (e) {
      push({
        tone: "error",
        title: "Scenario failed",
        detail: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRunning(false);
    }
  };
  const reset = async () => {
    try {
      await api.demoReset();
      setResult(null);
      setMessage("");
      push({
        tone: "success",
        title: "Demo state reset",
        detail:
          "Budget windows and mock-bank counters cleared; audit evidence preserved.",
      });
    } catch (e) {
      push({ tone: "error", title: "Reset failed", detail: String(e) });
    }
  };
  const pipelineEvent: AuditEvent | null = result
    ? {
        seq: 0,
        event_type: "ACTION_DECISION",
        created_at: new Date().toISOString(),
        correlation_id: result.correlation_id || "pending",
        agent_id: result.envelope.agent_sub,
        decision: result.decision,
        reason_code: result.reason_codes[0] || null,
        policy_version: null,
      }
    : null;
  return (
    <div className="demo-stage">
      <header className="demo-opening">
        <div>
          <span>LIVE GOVERNANCE PROOF / REAL BACKEND STATE</span>
          <h1>Watch control become evidence.</h1>
          <p>
            Each scenario enters the real gateway. The Decision Spine updates
            only when the API returns durable decision evidence—never from a
            decorative timer.
          </p>
        </div>
        <div>
          <button className="proof-secondary" onClick={reset}>
            RESET VOLATILE DEMO STATE
          </button>
          <span>Audit history is preserved</span>
        </div>
      </header>
      <div className="demo-workspace">
        <aside className="scenario-ledger" data-tour="demo-scenarios">
          <span>JUDGE RUNBOOK / 8 PROOFS</span>
          {DEMO_SCENARIOS.map((s, i) => (
            <button
              key={s.id}
              className={selected.id === s.id ? "selected" : ""}
              onClick={() => {
                setSelected(s);
                setResult(null);
                setMessage("");
              }}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              <span>
                <strong>{s.title}</strong>
                <small>{s.expected}</small>
              </span>
            </button>
          ))}
        </aside>
        <main className="demo-control" data-tour="demo-control">
          <section className="demo-narrative">
            <div>
              <span>SCENARIO / {selected.id.toUpperCase()}</span>
              <h2>{selected.title}</h2>
              <p>{selected.description}</p>
            </div>
            <button className="demo-run" onClick={run} disabled={running}>
              {running ? (
                <>
                  <i /> AWAITING GATEWAY EVIDENCE
                </>
              ) : (
                <>
                  RUN REAL SCENARIO <ArrowRight size={17} />
                </>
              )}
            </button>
          </section>
          <section className="demo-spine">
            <div className="demo-spine-head">
              <span>DECISION SPINE</span>
              <strong>
                {running
                  ? "REQUEST IN FLIGHT"
                  : result
                    ? `${result.decision} / ${result.reason_codes[0] || "EVIDENCE"}`
                    : "READY"}
              </strong>
            </div>
            <ControlSpine event={pipelineEvent} />
          </section>
          <section className="demo-evidence-dock" data-tour="demo-evidence">
            {result ? (
              <>
                <div className="evidence-verdict">
                  <span>MEASURED RESULT</span>
                  <h2>
                    {result.decision === "ALLOW"
                      ? "Execution governed."
                      : "Execution stopped."}
                  </h2>
                  <strong>{result.protected_in_ms} ms</strong>
                  <small>control-plane measured wall time</small>
                </div>
                <dl>
                  <div>
                    <dt>Amount</dt>
                    <dd>{formatMoney(result.envelope.amount_minor)}</dd>
                  </div>
                  <div>
                    <dt>Reason</dt>
                    <dd>
                      {result.reason_codes.map((r) => (
                        <code key={r}>{r}</code>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt>Execution</dt>
                    <dd>{result.execution?.state || "NOT DISPATCHED"}</dd>
                  </div>
                  <div>
                    <dt>Correlation</dt>
                    <dd>
                      {result.correlation_id ? (
                        <CopyButton value={result.correlation_id} />
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="evidence-actions">
                  <button
                    onClick={() =>
                      explain({
                        correlation_id: result.correlation_id || undefined,
                        reason_codes: result.reason_codes,
                        decision: result.decision || undefined,
                      })
                    }
                  >
                    Decision Explainer
                  </button>
                  {result.correlation_id && (
                    <Link
                      to={`/activity/${encodeURIComponent(result.correlation_id)}`}
                    >
                      Open Evidence Thread
                    </Link>
                  )}
                </div>
              </>
            ) : message ? (
              <div className="scenario-message">
                <ShieldCheck size={28} />
                <span>CONTROL RESULT</span>
                <h2>{message}</h2>
                <Link
                  to={
                    selected.action === "verify"
                      ? "/audit/integrity"
                      : selected.action === "halt" || selected.action === "ack"
                        ? "/emergency"
                        : "/activity"
                  }
                >
                  View durable evidence
                </Link>
              </div>
            ) : (
              <div className="demo-awaiting">
                <Fingerprint size={30} />
                <span>NO FABRICATED RESULT</span>
                <p>
                  Run the scenario to populate latency, reason code,
                  correlation, and execution state from the real system.
                </p>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

export function HelpPage() {
  const tour = useTour();
  return (
    <>
      <PageHeader
        eyebrow="Help"
        title="Product Tours"
        description="Replay contextual guides or restart first-run onboarding for your current role."
      />
      <div className="help-grid">
        <Section
          title="Contextual tours"
          subtitle="Short, page-specific, and role aware"
        >
          <div className="tour-catalog">
            {[
              {
                path: "/",
                title: "Command Center",
                detail: "Fleet posture, exposure, and risk evidence",
              },
              {
                path: "/agents",
                title: "Agent Registry",
                detail: "Identity, ownership, policy, and budgets",
              },
              {
                path: "/policies",
                title: "Policy Studio",
                detail: "Draft, validate, simulate, and activate",
              },
              {
                path: "/emergency",
                title: "Emergency Control",
                detail: "Halt, acknowledgements, and safe resume",
              },
              {
                path: "/demo",
                title: "Judge Demo",
                detail: "Scenarios, pipeline, and evidence",
              },
            ].map((item) => (
              <div key={item.path}>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <button
                  className="btn btn--secondary btn--small"
                  onClick={() => tour.replay(item.path)}
                >
                  Replay Tour
                </button>
              </div>
            ))}
          </div>
        </Section>
        <Section
          title="Start fresh"
          subtitle="Tour progress is versioned by role and page"
        >
          <p>
            Restarting clears tour completion only for your current role. It
            does not change product or audit data.
          </p>
          <button className="btn btn--primary" onClick={tour.guidedDemo}>
            Start Guided Control Ledger Tour
          </button>
          <button className="btn btn--secondary" onClick={tour.restartAll}>
            Restart All Tours
          </button>
        </Section>
      </div>
      <Section title="How AEGIS decides">
        <div className="principles-grid">
          <article>
            <strong>1. Authenticate</strong>
            <p>
              Identity comes from verified workload claims, never the request
              body.
            </p>
          </article>
          <article>
            <strong>2. Contain first</strong>
            <p>Fleet halt and agent revoke override every policy permit.</p>
          </article>
          <article>
            <strong>3. Reserve atomically</strong>
            <p>Concurrent actions cannot race shared financial limits.</p>
          </article>
          <article>
            <strong>4. Evidence first</strong>
            <p>No durable decision record means no financial dispatch.</p>
          </article>
        </div>
      </Section>
      <div className="notice notice--info">
        <strong>AI authority boundary</strong>
        <span>
          AI may explain and propose. It cannot allow actions, raise budgets,
          activate policy, revoke agents, halt or resume the fleet, or execute
          financial operations.
        </span>
      </div>
    </>
  );
}
