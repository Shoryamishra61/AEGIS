import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type AiStatus, type AuditEvent, type ExplainResult } from "./api";
import { flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";

type Toast = { id: number; tone: "success" | "error" | "info"; title: string; detail?: string };
type ToastContextValue = { push: (toast: Omit<Toast, "id">) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = ++nextId.current;
    setToasts((items) => [...items, { ...toast, id }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4200);
  }, []);
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-region" aria-live="polite" aria-label="Notifications">
        {toasts.map((toast) => (
          <div className={`toast toast--${toast.tone}`} key={toast.id}>
            <strong>{toast.title}</strong>{toast.detail && <span>{toast.detail}</span>}
            <button className="icon-button" aria-label="Dismiss notification" onClick={() => setToasts((items) => items.filter((item) => item.id !== toast.id))}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value;
}

export function StatusBadge({ value }: { value?: string | null }) {
  const normalized = (value || "unknown").toLowerCase();
  const tone = /allow|active|healthy|operational|committed|valid|ready|connected|resumed|pass/.test(normalized)
    ? "positive"
    : /deny|revoked|halted|broken|error|failed|critical/.test(normalized)
      ? "negative"
      : /pending|unknown|stale|held|warning|partial|reconnecting/.test(normalized)
        ? "warning"
        : "neutral";
  return <span className={`status status--${tone}`}><span aria-hidden="true" />{value || "Unknown"}</span>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

export function LoadingState({ label = "Loading live data" }: { label?: string }) {
  return <div className="state-card" role="status" aria-label={label}><div className="skeleton skeleton--wide" /><div className="skeleton" /><div className="skeleton skeleton--short" /></div>;
}
export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="state-card state-card--center"><div className="state-icon" aria-hidden="true">○</div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const detail = error instanceof Error ? error.message : String(error);
  return <div className="state-card state-card--error" role="alert"><strong>Unable to load</strong><p>{detail}</p>{retry && <button className="btn btn--secondary" onClick={retry}>Retry</button>}</div>;
}
export function AccessDenied({ capability }: { capability: string }) {
  return <div className="state-card state-card--center"><div className="state-icon" aria-hidden="true">⊘</div><h3>Access denied</h3><p>Your current role cannot {capability}. The API also enforces this permission.</p></div>;
}

export type Column<T> = { key: string; label: string; render: (row: T) => ReactNode; search?: (row: T) => string; align?: "right" };
export function DataTable<T>({ rows, columns, rowKey, onRowClick, label, initialPageSize = 8 }: { rows: T[]; columns: Column<T>[]; rowKey: (row: T) => string | number; onRowClick?: (row: T) => void; label: string; initialPageSize?: number }) {
  const [query, setQuery] = useState("");
  const definitions = useMemo<ColumnDef<T>[]>(() => columns.map((col) => ({ id: col.key, header: col.label, cell: ({ row }) => col.render(row.original), accessorFn: col.search || ((row) => String(col.render(row) ?? "")), meta: { align: col.align } })), [columns]);
  const table = useReactTable({ data: rows, columns: definitions, state: { globalFilter: query }, onGlobalFilterChange: setQuery, globalFilterFn: (row, _column, value) => columns.some((col) => (col.search?.(row.original) || String(col.render(row.original) ?? "")).toLowerCase().includes(String(value).toLowerCase())), getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(), getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize: initialPageSize } }, getRowId: (row) => String(rowKey(row)) });
  const filteredCount = table.getFilteredRowModel().rows.length;
  return <div className="data-table-wrap">
    <div className="table-toolbar"><label className="search-field"><span className="sr-only">Search {label}</span><span aria-hidden="true">⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${label.toLowerCase()}`} /></label><span className="table-count">{filteredCount} ledger entries</span></div>
    <div className="table-scroll"><table className="data-table"><caption className="sr-only">{label}</caption><thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map((row) => <tr key={row.id} tabIndex={onRowClick ? 0 : undefined} className={onRowClick ? "clickable" : ""} onClick={() => onRowClick?.(row.original)} onKeyDown={(e) => { if (onRowClick && (e.key === "Enter" || e.key === " ")) onRowClick(row.original); }}>{row.getVisibleCells().map((cell) => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div>
    <div className="pagination"><label>Rows <select value={table.getState().pagination.pageSize} onChange={(e) => table.setPageSize(Number(e.target.value))}><option>8</option><option>16</option><option>32</option></select></label><span>Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}</span><button className="icon-button" aria-label="Previous page" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>←</button><button className="icon-button" aria-label="Next page" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>→</button></div>
  </div>;
}

type DrawerContextValue = { explain: (input: { correlation_id?: string; reason_codes?: string[]; decision?: string; agent_id?: string; policy_version?: number }) => void; openCopilot: (events?: AuditEvent[]) => void };
const DrawerContext = createContext<DrawerContextValue | null>(null);

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<"explain" | "copilot" | null>(null);
  const [explanation, setExplanation] = useState<ExplainResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<AuditEvent[]>([]);
  const [question, setQuestion] = useState("");
  const [proposed, setProposed] = useState<Record<string, string> | null>(null);
  const close = () => setKind(null);
  useEffect(() => {
    if (!kind) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kind]);
  const explain = async (input: Parameters<DrawerContextValue["explain"]>[0]) => {
    setKind("explain"); setLoading(true); setExplanation(null);
    try { setExplanation(await api.explain(input)); } finally { setLoading(false); }
  };
  const openCopilot = async (events: AuditEvent[] = []) => {
    setSelectedEvents(events); setKind("copilot"); setAi(await api.aiStatus().catch(() => null));
  };
  const buildFilters = () => {
    const q = question.toLowerCase();
    const filters: Record<string, string> = {};
    if (/denied|deny|blocked/.test(q)) filters.decision = "DENY";
    if (/allow|approved/.test(q)) filters.decision = "ALLOW";
    const amount = q.match(/(?:₹|rs\.?\s*)([\d,]+)/i)?.[1];
    if (amount) filters.amount_above = amount.replace(/,/g, "");
    if (/today/.test(q)) filters.time_range = "today";
    if (/high.?risk/.test(q)) filters.risk_tier = "high";
    setProposed(filters);
  };
  return <DrawerContext.Provider value={{ explain, openCopilot }}>{children}{kind && <div className="drawer-backdrop" onMouseDown={close}><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onMouseDown={(e) => e.stopPropagation()}><div className="drawer-head"><div><p className="eyebrow">{kind === "explain" ? "Deterministic evidence" : "Read-only assistant"}</p><h2 id="drawer-title">{kind === "explain" ? "Decision Explainer" : "AI Risk Copilot"}</h2></div><button className="icon-button" onClick={close} aria-label="Close drawer">×</button></div>
  {kind === "explain" ? <div className="drawer-body">{loading ? <LoadingState /> : explanation ? <><div className="explain-hero"><StatusBadge value={explanation.decision} /><h3>{explanation.headline}</h3><p>Next action: <strong>{explanation.overall_advice}</strong></p></div><dl className="evidence-kv"><div><dt>Agent</dt><dd>{explanation.agent_id || "—"}</dd></div><div><dt>Policy</dt><dd>v{explanation.policy_version ?? "—"}</dd></div><div><dt>Correlation</dt><dd className="mono">{explanation.citation.correlation_id || "—"}</dd></div></dl><h3>Reason evidence</h3>{explanation.reason_breakdown.map((r) => <div className="reason-card" key={r.reason_code}><code>{r.reason_code}</code><p>{r.meaning}</p><span>{r.advice}</span></div>)}<h3>Inspect next</h3><ol>{explanation.inspect_next.map((step) => <li key={step}>{step}</li>)}</ol><p className="fine-print">{explanation.citation.note}</p></> : <ErrorState error="Explanation unavailable" />}</div>
  : <div className="drawer-body"><div className="notice notice--info"><strong>{ai?.message || "Checking AI provider…"}</strong><p>Copilot cannot change policy, budgets, agents, or emergency state.</p></div>{selectedEvents.length > 0 && <div className="selection-summary"><strong>{selectedEvents.length} event{selectedEvents.length === 1 ? "" : "s"} in context</strong><p>{selectedEvents.filter((e) => e.decision === "DENY").length} denied · {selectedEvents.filter((e) => e.decision === "ALLOW").length} allowed</p></div>}<label className="field"><span>Audit question</span><textarea rows={4} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Show denied transfers above ₹50,000 from high-risk agents today." /></label><button className="btn btn--primary" onClick={buildFilters} disabled={!question.trim()}>Propose filters</button>{proposed && <div className="filter-proposal"><div className="row-between"><strong>Proposed filters</strong><StatusBadge value="Needs confirmation" /></div>{Object.keys(proposed).length ? <dl>{Object.entries(proposed).map(([k, v]) => <div key={k}><dt>{k.replace(/_/g, " ")}</dt><dd>{v}</dd></div>)}</dl> : <p>No safe structured filters recognized. Refine the question.</p>}<button className="btn btn--secondary" onClick={() => { window.dispatchEvent(new CustomEvent("aegis:apply-audit-filters", { detail: proposed })); close(); }} disabled={!Object.keys(proposed).length}>Confirm & open audit</button></div>}<button className="btn btn--secondary" disabled title="Requires a configured model provider">Generate incident brief</button></div>}</aside></div>}</DrawerContext.Provider>;
}

export function useDrawers() {
  const value = useContext(DrawerContext);
  if (!value) throw new Error("useDrawers must be used inside DrawerProvider");
  return value;
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const { push } = useToast();
  return <button className="copy-button" title={`${label}: ${value}`} aria-label={`${label} ${value}`} onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(value); push({ tone: "success", title: "Copied", detail: value }); }}>{value.slice(0, 12)}…</button>;
}
