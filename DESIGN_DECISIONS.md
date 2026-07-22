# AEGIS Design Decisions

## Command Center directions considered

### Direction A — Ledger Observatory (selected)

- Composition: asymmetric 12-column canvas; safety verdict in the left margin,
  live Decision Spine across the center, topology at right, exposure ledger and
  compact operational journal below.
- Strength: the first viewport answers safety, flow, exposure, and attention in one scan.
- Product identity: strongest use of the Control Ledger and recurring Spine.
- Trade-off: demands careful responsive reflow; cannot be composed from generic cards.

### Direction B — Control Map

- Composition: fleet topology dominates the viewport; Decision Spine paths enter
  and leave a central gateway map; attention queue becomes a right rail.
- Strength: exceptional incident and propagation comprehension.
- Trade-off: normal financial exposure becomes secondary, and sparse gateway
  data makes the map feel over-scaled in the MVP. Rejected as the default but
  adopted for Emergency Control.

### Direction C — Execution Journal

- Composition: vertical live journal where each action expands into a horizontal
  Spine; exposure and attention appear as annotated ledger columns.
- Strength: excellent causality and audit continuity.
- Trade-off: the fleet-level answer is slower to scan and live activity can push
  important safety context below the fold. Rejected as Command Center, adopted
  for Audit and Live Activity.

## Selected direction rationale

Ledger Observatory best satisfies the four first-viewport questions without a
KPI grid. It establishes the Decision Spine as the visual thesis, keeps topology
meaningful, and gives exposure a financial rather than decorative form.

## Decision records

### D-01 — Decision Spine occupies the visual center

- User job: know whether and where an action is being governed.
- Priority: live stage and determining reason before aggregate metrics.
- Placement: central horizontal axis follows reading direction.
- Type: Instrument Sans labels; mono stage evidence.
- Color: cobalt active, teal pass, red stop, copper Unknown; never color-only.
- Interaction: stage selects matching evidence; keyboard arrows traverse stages.
- Alternative: KPI overview. Rejected because it proves observation, not interception.
- Accessibility: ordered list semantics and full text state on mobile.

### D-02 — Safety verdict is editorial, not a badge

- User job: answer “is the fleet safe?” instantly.
- Priority: highest.
- Placement: upper-left ledger margin where scanning begins.
- Type: Instrument Serif for the verdict; tabular mono epoch below.
- Color: deep ink in normal operation; full red/proof transformation when halted.
- Interaction: opens Emergency Control; no hidden hover meaning.
- Alternative: green/red pill. Rejected as too small and generic.
- Accessibility: state is explicit text and announced assertively on change.

### D-03 — Exposure is a ledger river

- User job: distinguish available, reserved, committed, and Unknown exposure.
- Priority: equal to decision throughput, above decorative trends.
- Placement: directly beneath the Spine to connect authorization to money state.
- Type: mono values with aligned units and rolling-window annotations.
- Color: paper/teal/copper/ink segments with patterns and labels.
- Interaction: selecting a pool reveals contributing agents.
- Alternative: repeated cards/progress bars. Rejected because pools cannot be compared.
- Accessibility: adjacent numeric table and non-color segment labels.

### D-04 — Emergency uses topology and a command sequence

- User job: stop dispatch and prove propagation.
- Priority: fleet state → command → acknowledgement → resume prerequisites.
- Placement: topology fills the containment room; command rail stays separate.
- Type: serif containment verdict; mono gateway/epoch evidence.
- Color: normal paper; requested/propagating copper; contained red/proof field.
- Interaction: reason → deliberate confirmation → real API command; animation follows acknowledgements.
- Alternative: form + donut. Rejected because it hides individual convergence.
- Accessibility: nodes duplicate as an ordered gateway list; emergency controls remain reachable during tours.

### D-05 — Policy Studio is a three-pane workbench

- User job: edit, validate, simulate, and activate with evidence in one context.
- Priority: source and diagnostics primary; lifecycle is embedded in pane headers.
- Placement: bundles left, editor center, evidence right.
- Type: mono editor; sans controls; serif prohibited in dense work areas.
- Color: dark only for editor; errors use line markers and text.
- Interaction: validation populates diagnostics; simulation populates right pane; activation remains explicit.
- Alternative: stacked cards + textarea. Rejected because it fragments cause and result.
- Accessibility: panes become tabs below 900px; diagnostics link to line numbers.

### D-06 — Evidence Thread exposes hash lineage

- User job: reconstruct and prove one action.
- Priority: correlation → causal events → hashes → checkpoint.
- Placement: main thread with evidence inspector margin.
- Type: mono for identifiers/hashes; sans narrative.
- Color: proof field only for hash/checkpoint section.
- Interaction: event selection updates inspector and deterministic explanation.
- Alternative: audit table alone. Rejected because integrity relationships stay implicit.
- Accessibility: thread uses ordered-list semantics; hashes remain copyable text.

## Token decisions

- Typography: Instrument Sans / Instrument Serif / IBM Plex Mono.
- Corners: `0, 2, 4, 8`; 8 only for overlays.
- Borders: ledger rules of 1px; 2px for selected/critical controls.
- Elevation: none / overlay / dialog only.
- Motion: 120ms focus, 160ms state, 240ms containment; real state only.
- Data: teal pass, cobalt policy/action, copper exposure/Unknown, red containment.
