import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./auth";

export type TourStep = { selector: string; title: string; text: string };
type TourDefinition = { page: string; steps: TourStep[] };

const TOUR_VERSION = "3";
const GUIDED_PATHS = [
  "/",
  "/agents",
  "/policies",
  "/budgets",
  "/audit",
  "/emergency",
  "/demo",
];
const DEFINITIONS: Record<string, TourDefinition> = {
  "/": {
    page: "command",
    steps: [
      {
        selector: '[data-tour="fleet-state"]',
        title: "Fleet state",
        text: "See containment, policy, and live fleet posture at a glance.",
      },
      {
        selector: '[data-tour="exposure"]',
        title: "Exposure",
        text: "Committed, held, and unknown amounts stay distinct.",
      },
      {
        selector: '[data-tour="risk-events"]',
        title: "Risk events",
        text: "Open any decision to inspect reason codes and evidence.",
      },
    ],
  },
  "/agents": {
    page: "agents",
    steps: [
      {
        selector: '[data-tour="agent-table"]',
        title: "Agent registry",
        text: "Every agent has an owner, risk tier, policy, and budget assignment.",
      },
      {
        selector: '[data-tour="register-agent"]',
        title: "Register agent",
        text: "Policy Administrators can onboard a new governed workload here.",
      },
    ],
  },
  "/policies": {
    page: "policies",
    steps: [
      {
        selector: '[data-tour="policy-lifecycle"]',
        title: "Policy lifecycle",
        text: "Draft, validate, simulate, and explicitly activate versioned policy.",
      },
      {
        selector: '[data-tour="policy-editor"]',
        title: "Safe draft",
        text: "Drafts remain untrusted until validation and human activation.",
      },
    ],
  },
  "/budgets": {
    page: "budgets",
    steps: [
      {
        selector: '[data-tour="exposure"]',
        title: "Exposure river",
        text: "Read available, reserved, committed, and unknown value as separate financial states.",
      },
      {
        selector: '[data-tour="budget-pools"]',
        title: "Shared authority",
        text: "Inspect each pool ceiling and its live reservation pressure.",
      },
    ],
  },
  "/audit": {
    page: "audit",
    steps: [
      {
        selector: '[data-tour="audit-filters"]',
        title: "Evidence filters",
        text: "Search the authorized evidence surface without exposing unsafe payloads.",
      },
      {
        selector: '[data-tour="audit-events"]',
        title: "Linked evidence",
        text: "Open a correlation to reconstruct one action across the decision spine.",
      },
    ],
  },
  "/emergency": {
    page: "emergency",
    steps: [
      {
        selector: '[data-tour="fleet-halt"]',
        title: "Fleet halt",
        text: "Stop new dispatches with one durable, audited epoch.",
      },
      {
        selector: '[data-tour="gateway-acks"]',
        title: "Acknowledgements",
        text: "Confirm every live gateway has applied the current epoch.",
      },
      {
        selector: '[data-tour="safe-resume"]',
        title: "Safe resume",
        text: "Resume is separate and never reverses committed transactions.",
      },
    ],
  },
  "/demo": {
    page: "demo",
    steps: [
      {
        selector: '[data-tour="demo-scenarios"]',
        title: "Judge scenarios",
        text: "Each scenario triggers the real gateway, not a UI-only mock.",
      },
      {
        selector: '[data-tour="demo-control"]',
        title: "Decision evidence",
        text: "The completed result exposes its real enforcement outcome and exact reason code.",
      },
      {
        selector: '[data-tour="demo-evidence"]',
        title: "Measured evidence",
        text: "Latency and correlation IDs come from the live result.",
      },
    ],
  },
};

type TourContextValue = {
  replay: (path?: string) => void;
  restartAll: () => void;
  guidedDemo: () => void;
};
const TourContext = createContext<TourContextValue | null>(null);

function storageKey(role: string, page: string) {
  return `aegis-tour:${role}:${page}:${TOUR_VERSION}`;
}

export function TourProvider({
  children,
  fleetHalted = false,
}: {
  children: ReactNode;
  fleetHalted?: boolean;
}) {
  const { session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [active, setActive] = useState<TourDefinition | null>(null);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const start = useCallback(
    (path = location.pathname, force = false) => {
      const exact =
        DEFINITIONS[path] || (path.startsWith("/agents/") ? undefined : null);
      if (!exact || !session || fleetHalted) return;
      if (!force && localStorage.getItem(storageKey(session.role, exact.page)))
        return;
      const available = exact.steps.filter((step) =>
        document.querySelector(step.selector),
      );
      if (!available.length) return;
      setActive({ ...exact, steps: available });
      setIndex(0);
    },
    [fleetHalted, location.pathname, session],
  );

  useEffect(() => {
    if (!session || fleetHalted) {
      setActive(null);
      return;
    }
    const forced = sessionStorage.getItem("aegis-tour:force");
    const timer = window.setTimeout(() => {
      start(location.pathname, forced === location.pathname);
      if (forced === location.pathname)
        sessionStorage.removeItem("aegis-tour:force");
    }, 700);
    return () => window.clearTimeout(timer);
  }, [fleetHalted, location.pathname, session, start]);

  useEffect(() => {
    if (!active) return;
    const update = () => {
      const el = document.querySelector(active.steps[index]?.selector);
      setRect(el?.getBoundingClientRect() || null);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [active, index]);

  const finish = (advanceGuided = true) => {
    if (active && session)
      localStorage.setItem(storageKey(session.role, active.page), "complete");
    setActive(null);
    const queued = sessionStorage.getItem("aegis-tour:guided");
    if (!queued) return;
    if (!advanceGuided) {
      sessionStorage.removeItem("aegis-tour:guided");
      return;
    }
    const remaining = JSON.parse(queued) as string[];
    const next = remaining.shift();
    if (!next) {
      sessionStorage.removeItem("aegis-tour:guided");
      return;
    }
    sessionStorage.setItem("aegis-tour:guided", JSON.stringify(remaining));
    sessionStorage.setItem("aegis-tour:force", next);
    navigate(next);
  };
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
      if (e.key === "ArrowRight")
        setIndex((i) => Math.min(active.steps.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const value = useMemo<TourContextValue>(
    () => ({
      replay: (path = location.pathname) => {
        if (path === location.pathname) start(path, true);
        else {
          sessionStorage.setItem("aegis-tour:force", path);
          navigate(path);
        }
      },
      restartAll: () => {
        if (!session) return;
        Object.keys(localStorage)
          .filter((k) => k.startsWith(`aegis-tour:${session.role}:`))
          .forEach((k) => localStorage.removeItem(k));
        start(location.pathname, true);
      },
      guidedDemo: () => {
        const [first, ...remaining] = GUIDED_PATHS;
        sessionStorage.setItem("aegis-tour:guided", JSON.stringify(remaining));
        sessionStorage.setItem("aegis-tour:force", first);
        if (location.pathname === first) start(first, true);
        else navigate(first);
      },
    }),
    [location.pathname, navigate, session, start],
  );
  const step = active?.steps[index];
  return (
    <TourContext.Provider value={value}>
      {children}
      {active && step && rect && (
        <div
          className="tour-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
        >
          <div
            className="tour-shade tour-shade--top"
            style={{ height: Math.max(0, rect.top - 6) }}
          />
          <div
            className="tour-shade tour-shade--left"
            style={{
              top: rect.top - 6,
              width: Math.max(0, rect.left - 6),
              height: rect.height + 12,
            }}
          />
          <div
            className="tour-shade tour-shade--right"
            style={{
              top: rect.top - 6,
              left: rect.right + 6,
              height: rect.height + 12,
            }}
          />
          <div
            className="tour-shade tour-shade--bottom"
            style={{ top: rect.bottom + 6 }}
          />
          <div
            className="tour-spotlight"
            style={{
              top: rect.top - 6,
              left: rect.left - 6,
              width: rect.width + 12,
              height: rect.height + 12,
            }}
          />
          <div
            className="tour-card"
            style={{
              top: Math.min(
                window.innerHeight - 250,
                Math.max(16, rect.bottom + 18),
              ),
              left: Math.min(window.innerWidth - 340, Math.max(16, rect.left)),
            }}
          >
            <span className="eyebrow">
              {index + 1} of {active.steps.length}
            </span>
            <h2 id="tour-title">{step.title}</h2>
            <p>{step.text}</p>
            <div className="row-between">
              <button className="btn btn--ghost" onClick={() => finish(false)}>
                Skip
              </button>
              <div className="button-row">
                <button
                  className="btn btn--secondary"
                  disabled={index === 0}
                  onClick={() => setIndex((i) => i - 1)}
                >
                  Back
                </button>
                <button
                  className="btn btn--primary"
                  onClick={() =>
                    index === active.steps.length - 1
                      ? finish(true)
                      : setIndex((i) => i + 1)
                  }
                >
                  {index === active.steps.length - 1 ? "Finish" : "Next"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </TourContext.Provider>
  );
}

export function useTour() {
  const value = useContext(TourContext);
  if (!value) throw new Error("useTour must be used inside TourProvider");
  return value;
}
