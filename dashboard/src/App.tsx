import { useEffect, useMemo, useState } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Command } from "cmdk";
import {
  Article,
  Bank,
  BracketsCurly,
  CirclesThreePlus,
  Gauge,
  Gavel,
  Lifebuoy,
  MagnifyingGlass,
  Plus,
  Pulse,
  ShieldCheck,
  Siren,
  UsersThree,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { api, PERSONAS, type EmergencyStatus, type Persona } from "./api";
import { canWrite, useAuth } from "./auth";
import { LiveProvider, useLive } from "./live";
import { TourProvider } from "./tour";
import {
  AgentDetailPage,
  AgentsPage,
  AuditExplorerPage,
  AuditIntegrityPage,
  BudgetsPage,
  CommandCenterPage,
  DecisionTimelinePage,
  DemoModePage,
  EmergencyPage,
  HelpPage,
  LiveActivityPage,
  LoginPage,
  PolicySimulationPage,
  PolicyStudioPage,
  RegisterAgentPage,
  SystemHealthPage,
} from "./pages";

type NavItem = {
  to: string;
  label: string;
  icon: Icon;
  write?: "agent" | "emergency";
};
const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [{ to: "/", label: "Command Center", icon: Gauge }],
  },
  {
    label: "Monitor",
    items: [
      { to: "/activity", label: "Live Activity", icon: Pulse },
      { to: "/audit", label: "Audit Explorer", icon: MagnifyingGlass },
      { to: "/audit/integrity", label: "Audit Integrity", icon: ShieldCheck },
    ],
  },
  {
    label: "Govern",
    items: [
      { to: "/agents", label: "Agents", icon: UsersThree },
      {
        to: "/agents/new",
        label: "Register Agent",
        icon: Plus,
        write: "agent",
      },
      { to: "/policies", label: "Policy Studio", icon: BracketsCurly },
      { to: "/budgets", label: "Exposure Ledger", icon: Bank },
    ],
  },
  {
    label: "Contain",
    items: [
      { to: "/emergency", label: "Emergency", icon: Siren, write: "emergency" },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/health", label: "System Health", icon: CirclesThreePlus },
      { to: "/demo", label: "Demo Mode", icon: Gavel },
      { to: "/help", label: "Help & Tours", icon: Lifebuoy },
    ],
  },
];

export function App() {
  const { session } = useAuth();
  if (!session)
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  return (
    <LiveProvider>
      <AuthenticatedApp />
    </LiveProvider>
  );
}

function AuthenticatedApp() {
  const [emergency, setEmergency] = useState<EmergencyStatus | null>(null);
  useEffect(() => {
    const load = () =>
      api
        .emergencyStatus()
        .then(setEmergency)
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 4000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <TourProvider fleetHalted={!!emergency?.fleet_halted}>
      <Shell emergency={emergency} />
    </TourProvider>
  );
}

function Shell({ emergency }: { emergency: EmergencyStatus | null }) {
  const { session, logout, switchPersona } = useAuth();
  const live = useLive();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  useEffect(() => {
    setMobileOpen(false);
    document.getElementById("main-content")?.focus();
  }, [location.pathname]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const nav = useMemo(
    () =>
      NAV.map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => !item.write || canWrite(session?.role || null, item.write),
        ),
      })).filter((group) => group.items.length),
    [session?.role],
  );
  const routeClass = `route-${location.pathname === "/" ? "command" : location.pathname.split("/").filter(Boolean)[0] || "command"}`;
  return (
    <div
      className={`app-shell ${emergency?.fleet_halted ? "shell-halted" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside
        className={`sidebar ${mobileOpen ? "open" : ""}`}
        aria-label="Primary navigation"
      >
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">
            A
          </div>
          <span>AEGIS</span>
        </div>
        <nav>
          {nav.map((group) => (
            <div className="nav-group" key={group.label}>
              <span>{group.label}</span>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    aria-label={item.label}
                    data-label={item.label}
                    className={({ isActive }) => (isActive ? "active" : "")}
                  >
                    <Icon size={20} weight="regular" />
                    <b>{item.label}</b>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <Article size={18} />
          <small>Control Ledger</small>
        </div>
      </aside>
      {mobileOpen && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <div className="app-frame">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            ☰
          </button>
          <div className="topbar-wordmark">
            <strong>THE CONTROL LEDGER</strong>
            <span>Tenant / Demo Bank</span>
          </div>
          <button
            className="command-trigger"
            onClick={() => setCommandOpen(true)}
          >
            <MagnifyingGlass size={15} /> Find a control <kbd>Ctrl K</kbd>
          </button>
          <div className="topbar-actions">
            <span className="live-state">
              <i
                className={
                  live.state === "connected"
                    ? "live-dot"
                    : "live-dot live-dot--warn"
                }
              />
              {live.state}
            </span>
            <NavLink
              to="/emergency"
              className={`emergency-link ${emergency?.fleet_halted ? "halted" : ""}`}
            >
              <Siren size={16} />
              {emergency?.fleet_halted ? "CONTAINED" : "Emergency"}
            </NavLink>
            <label className="role-switcher">
              <span className="sr-only">Current demonstration role</span>
              <select
                value={session?.persona}
                onChange={(e) => switchPersona(e.target.value as Persona)}
              >
                {(
                  Object.entries(PERSONAS) as [
                    Persona,
                    (typeof PERSONAS)[Persona],
                  ][]
                ).map(([key, p]) => (
                  <option key={key} value={key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="avatar-button"
              title="Log out"
              aria-label={`Log out ${session?.label}`}
              onClick={logout}
            >
              {session?.label
                .split(" ")
                .map((s) => s[0])
                .join("")}
            </button>
          </div>
        </header>
        <main
          id="main-content"
          className={`main-content ${routeClass}`}
          tabIndex={-1}
        >
          <Routes>
            <Route path="/" element={<CommandCenterPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/agents/new" element={<RegisterAgentPage />} />
            <Route path="/agents/:id" element={<AgentDetailPage />} />
            <Route path="/policies" element={<PolicyStudioPage />} />
            <Route
              path="/policies/:version/simulate"
              element={<PolicySimulationPage />}
            />
            <Route path="/budgets" element={<BudgetsPage />} />
            <Route path="/activity" element={<LiveActivityPage />} />
            <Route
              path="/activity/:correlationId"
              element={<DecisionTimelinePage />}
            />
            <Route path="/emergency" element={<EmergencyPage />} />
            <Route path="/audit" element={<AuditExplorerPage />} />
            <Route path="/audit/integrity" element={<AuditIntegrityPage />} />
            <Route path="/health" element={<SystemHealthPage />} />
            <Route path="/demo" element={<DemoModePage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      {commandOpen && (
        <div
          className="command-backdrop"
          onMouseDown={() => setCommandOpen(false)}
        >
          <Command
            className="command-menu"
            label="AEGIS command palette"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="command-input">
              <MagnifyingGlass size={18} />
              <Command.Input
                autoFocus
                placeholder="Navigate controls, evidence, and agents…"
              />
              <button onClick={() => setCommandOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <Command.List>
              <Command.Empty>No matching control.</Command.Empty>
              {nav.map((group) => (
                <Command.Group key={group.label} heading={group.label}>
                  {group.items.map((item) => (
                    <Command.Item
                      key={item.to}
                      value={item.label}
                      onSelect={() => {
                        navigate(item.to);
                        setCommandOpen(false);
                      }}
                    >
                      <item.icon size={17} />
                      {item.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </div>
      )}
    </div>
  );
}
