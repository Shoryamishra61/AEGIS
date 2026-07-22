# AEGIS UI Audit — Rejected Baseline

Date: 22 July 2026  
Authority: `AEGIS_SRS.md` → attached redesign brief → `AEGIS_PRD.md`

## Executive finding

The current frontend is functionally broad but visually interchangeable with a
generic SaaS admin template. Its repeated formula—page header, KPI tiles, rounded
white surfaces, pills, and two-column cards—flattens the difference between
monitoring, policy engineering, containment, financial exposure, and evidence.
The redesign must change information architecture and spatial behavior, not only
color tokens.

## Surface audit

| Surface | Current problem | Operational consequence | Required correction |
|---|---|---|---|
| Global shell | Permanent navy rail plus uniform page headers makes every route feel identical. | Operators cannot infer task mode from page structure. | Narrow ledger rail, contextual work header, task-specific canvas composition. |
| Command Center | Four KPI cards and two generic panels. | Does not answer what is moving through enforcement or where risk sits. | Decision Spine as primary object; topology, exposure, and attention integrated around it. |
| Emergency | Form + acknowledgement percentage. | Looks administrative, not like a high-stakes propagation system. | Containment room with central fleet state, gateway nodes, epoch path, and deliberate command sequence. |
| Policy Studio | Textarea beside a version list. | Diagnostics, tests, simulation, and activation feel disconnected. | True three-pane engineering workspace with editor, diagnostics, evidence, and lifecycle embedded in the work. |
| Budgets | Repeated cards with small progress bars. | Shared-pool pressure, held exposure, and Unknown state are hard to compare. | Exposure Ledger with hierarchical pools and a segmented exposure river. |
| Audit | Search form plus table. | Hash lineage and decision causality are invisible. | Evidence Thread linking intent, policy, budget mutation, outcome, and cryptographic hashes. |
| Agents | Flat registry table. | Agent authority is presented as metadata, not a bounded permission envelope. | Registry remains dense; detail becomes an authority envelope with policy, resources, caps, and behavior. |
| Demo | Scenario sidebar and generic result card. | The product story is described rather than spatially narrated. | Cinematic opening transitioning to the live Decision Spine, driven only by backend state. |
| Login | Clean but generic role picker. | No memorable thesis or controlled-product identity. | Dark ledger-room opening with editorial type and a single “Enter Demo Workspace” action. |

## Repetition inventory to remove

- `surface` as the default wrapper for every section.
- Four-up KPI grids as the default first viewport.
- Pills for all state; use ledger stamps, inline state text, and topology signals.
- Uniform 10–14px radii and shadows on every boundary.
- Donut/ring charts for safety coverage.
- Horizontal lifecycle steppers disconnected from the work they govern.
- Headline/subtitle/action composition repeated identically on all routes.

## Functional elements to preserve

- All 16 routes and the role-aware navigation model.
- Server-enforced `admin`, `operator`, and `auditor` roles and four demo personas.
- Authenticated SSE with reconnect state.
- Deterministic Decision Explainer and provider-disabled behavior.
- Exact correlation IDs, policy versions, reason codes, minor-unit money, epochs,
  gateway acknowledgements, and audit-chain verification.
- Loading, empty, error, stale, offline, access-denied, revoked, and halted states.

## Reference observations

| Exact page / interaction | Principle learned | AEGIS application | Do not copy | Trade-off |
|---|---|---|---|---|
| Apple Human Interface Guidelines — hierarchy, layout, accessibility | Hierarchy should elevate content rather than add decoration; layouts must adapt. | Large editorial safety verdicts and deliberate whitespace around the Decision Spine. | Platform chrome, Liquid Glass aesthetic, consumer-app softness. | More whitespace reduces raw density; dense evidence views remain compact. |
| Stripe Workbench — Inspector, Logs timeline, resizable workbench | Related object, logs, and events stay in one investigatory context. | Evidence Thread and Policy Studio keep source, result, and evidence visible together. | Stripe visual styling and bottom taskbar. | Multi-pane views require responsive collapse rules. |
| Linear Concepts / command menu / peek | One action is reachable by button, keyboard, and contextual command; preview preserves place. | Command palette and evidence preview; Esc restores context. | Issue-tracker metaphors and ultra-low information density. | Keyboard paths add implementation and testing cost. |
| Ramp spend controls and shared funds | Qualitative policy and quantitative limits are simultaneous pre-transaction controls. | Exposure Ledger pairs policy boundary with per-txn/window/shared pool state. | Card-product metaphors and consumer finance illustrations. | Bespoke exposure visualization needs explicit labels for accessibility. |
| Vanta Audit and continuous monitoring | Evidence status is continuous, scoped, and reviewable at the source. | Integrity view shows covered range, checkpoint, and exact break location. | Compliance framework scorecards unrelated to action governance. | More evidential detail can intimidate casual viewers; progressive disclosure is required. |
| Drata Continuous Compliance | Controls and evidence are mapped and continuously monitored. | Each Evidence Thread event states which control stage produced it. | Compliance-marketing dashboards. | Requires consistent reason/category mapping. |
| Palantir Object Explorer — graph, preview, linked objects | Operational objects become understandable through explicit links and contextual previews. | Gateway topology and agent permission envelope show meaningful relationships. | Dense ontology chrome or decoration-only node graphs. | Graph layouts must collapse into ordered lists on small screens. |
| IBM Carbon data patterns | Dense enterprise data needs predictable alignment, focus, and non-color status. | Audit tables keep tabular alignment, keyboard focus, and text state. | Default Carbon visual appearance. | Stricter alignment reduces decorative freedom in tables. |
| Eightfold Talent Intelligence product workflow | Complex enterprise signals should resolve into a human decision with transparent context. | Copilot and Decision Explainer cite deterministic evidence and suggest the next inspection. | AI-first authority language. | Advisory labeling occupies persistent space by design. |

## Audit acceptance gate

The redesign passes only when the product remains recognizable without its logo:
the Decision Spine, ledger rules, permission envelopes, exposure river, and
Evidence Thread must establish a distinct AEGIS visual grammar.
