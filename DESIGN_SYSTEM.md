# AEGIS — Design System

Light-first, premium, minimal. Warm neutrals, restrained navy/blue/teal accents,
red reserved strictly for denial / revocation / emergency. 8px spacing grid.
~80% structure / 20% content. WCAG 2.2 AA. Dark mode is out of scope for MVP.

These tokens are implemented in `dashboard/src/styles/tokens.css` and consumed by
component CSS. Names below match the CSS custom properties.

## 1. Color tokens

### Surfaces (warm white / light grey)
| Token | Value | Use |
|-------|-------|-----|
| `--surface-canvas` | `#F7F7F5` | App background (warm white) |
| `--surface-raised` | `#FFFFFF` | Cards, panels, tables |
| `--surface-sunken` | `#F1F1EE` | Inset areas, code blocks |
| `--surface-hover` | `#F4F5F7` | Row/nav hover |

### Text
| Token | Value | Contrast on canvas |
|-------|-------|--------------------|
| `--text-primary` | `#1A1D21` | 15.8:1 (AAA) |
| `--text-secondary` | `#5B6470` | 5.4:1 (AA) |
| `--text-tertiary` | `#8A929E` | 3.1:1 (AA large / non-text) |
| `--text-inverse` | `#FFFFFF` | on accent fills |

### Borders / lines
| Token | Value |
|-------|-------|
| `--border-subtle` | `#E7E7E3` |
| `--border-default` | `#DADBD6` |
| `--border-strong` | `#C3C6CC` |

### Accents (restrained navy / blue / teal)
| Token | Value | Use |
|-------|-------|-----|
| `--navy-900` | `#12233F` | Headings, primary text accents |
| `--brand-700` | `#1E4FA3` | Primary action, links (7.0:1 on white) |
| `--brand-600` | `#2C63C4` | Primary hover |
| `--brand-50` | `#EAF1FC` | Selected nav / info tint |
| `--teal-600` | `#0E7C86` | Secondary accent, "verified" |
| `--teal-50` | `#E4F4F5` | Teal tint |

### Semantic status (red only for stop states)
| Token | Value | Meaning |
|-------|-------|---------|
| `--ok-700` / `--ok-50` | `#1D7A45` / `#E6F4EC` | ALLOW / committed / healthy |
| `--warn-700` / `--warn-50` | `#9A6A00` / `#FBF1DA` | WAIT / cap / stale / UNKNOWN backlog |
| `--danger-700` / `--danger-50` | `#B3261E` / `#FBE9E7` | DENY / revoke / halt / emergency |
| `--info-700` / `--info-50` | `#1E4FA3` / `#EAF1FC` | neutral informational |

Red (`--danger-*`) is **never** used decoratively — only for DENY, REQUIRE_APPROVAL
(fail-closed), revoke, fleet halt, chain-broken, and access-denied.

## 2. Typography

System font stack (no web-font dependency, fast, native feel):
`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`.
Monospace (IDs, hashes, Rego): `"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`.

| Token | Size / line / weight | Use |
|-------|----------------------|-----|
| `--fs-display` | 28 / 34 / 600 | Page title (rare) |
| `--fs-h1` | 22 / 28 / 600 | Page headers |
| `--fs-h2` | 17 / 24 / 600 | Section headers |
| `--fs-body` | 14 / 21 / 400 | Body |
| `--fs-label` | 13 / 18 / 500 | Labels, table headers (uppercase, tracking .04em) |
| `--fs-caption` | 12 / 16 / 400 | Captions, metadata |
| `--fs-mono` | 12.5 / 20 / 450 | IDs, hashes, code |

Labels are short — **2–4 words**. Numbers use tabular figures (`font-variant-numeric: tabular-nums`).

## 3. Spacing, radius, elevation, motion (8px grid)

- Space scale: `--s1:4 --s2:8 --s3:12 --s4:16 --s5:24 --s6:32 --s7:48 --s8:64`.
- Radius: `--r-sm:6 --r-md:10 --r-lg:14 --r-pill:999`.
- Elevation (subtle only):
  - `--shadow-sm: 0 1px 2px rgba(18,35,63,.06)`
  - `--shadow-md: 0 4px 12px rgba(18,35,63,.08)`
  - `--shadow-pop: 0 8px 28px rgba(18,35,63,.12)` (drawers, dialogs)
- Motion: `--ease: cubic-bezier(.2,.7,.2,1)`; durations `--t-fast:120ms --t:180ms --t-slow:260ms`.
  Respect `prefers-reduced-motion` (disable transforms, keep opacity).

## 4. Components

### Buttons
- `.btn` base; variants `.btn--primary` (brand-700 fill), `.btn--secondary`
  (surface + border), `.btn--ghost` (text), `.btn--danger` (danger-700 fill, used
  only for halt/revoke and always with confirm). Sizes `--sm`, default.
- States: hover, active, focus-visible (2px `--brand-700` ring, 2px offset),
  disabled (40% + not-allowed), loading (spinner, keeps width).

### Status badges (`.badge`)
Map decision/state → color: ALLOW/active/committed → ok; WAIT/cap/stale/pending →
warn; DENY/revoked/halted/broken → danger; info otherwise. Dot + short label.

### Tables (`.table`)
- Sticky header, `--fs-label` uppercase headers, 44px rows, zebra via `--surface-hover`
  on hover only (not permanent stripes), right-aligned numeric columns (tabular).
- Built-in search, filter chips, column sort, pagination (25/50/100).
- Row → detail via click; correlation id column has copy button.

### Forms
- Labels above inputs; helper + error text below. Inputs 40px, `--r-md`, border
  `--border-default`, focus ring brand. Inline validation. Money inputs show the
  currency and operate in **minor units** with a human display (₹1,000.00 ↔ 100000).

### Dialogs & Drawers
- Dialog: centered, `--shadow-pop`, max-width 480–640, focus-trapped, Esc closes
  (except destructive confirmations require explicit button). Backdrop `rgba(18,35,63,.32)`.
- Drawer: right side, 420–560px, for Decision Explainer & AI Copilot; focus-trapped,
  Esc closes, does not block the header Emergency control.

### Charts (meaningful only)
- Exposure bar (reserved/committed/unknown vs cap), allow/deny area over time,
  policy latency p50/p95 line, gateway freshness/coverage gauge. Minimal axes,
  no 3D, no gratuitous color. Colors from semantic tokens.

### Decision pipeline (signature component)
- Horizontal stepper of 8 stages (identity → schema → containment → policy →
  budget → audit → execute → outcome). Each stage: idle / active (pulse, honors
  reduced-motion) / pass (ok) / fail (danger) / unknown (warn). Fail short-circuits
  and the failing stage shows the reason code.

### Skeletons / Empty / Error / Stale / Offline / Denied
- Skeleton: shimmer blocks matching final layout (no spinners for page loads).
- Empty: icon + one sentence + primary action.
- Error: danger tint, message, "Retry", correlation/trace if available.
- Stale: amber "Data may be delayed — last updated Xs ago" banner (freshness).
- Offline: SSE lost → amber banner "Live updates paused — reconnecting".
- Access-denied: lock glyph + "Your role (X) can't perform this" + what role can.

## 5. Iconography
Inline SVG, 1.5px stroke, 20px grid, rounded joins (a small local set — shield,
agent, policy, budget, activity, timeline, emergency, audit, verify, health,
help, play, copy, chevrons, check, x, alert). No icon font dependency.

## 6. Accessibility (WCAG 2.2 AA)
- All text meets AA contrast (values noted above). Focus-visible on every
  interactive element. Full keyboard operability (nav, tables, dialogs, tours).
- Dialogs/drawers/tours: focus trap, `aria-modal`, labelled, Esc to close, focus
  restored on close. Live regions (`aria-live=polite`) for toasts and SSE updates;
  emergency state changes use `aria-live=assertive`.
- Tours: `role=dialog`, step announced, keyboard Next/Back/Skip/Esc, never trap
  the Emergency control, never auto-run during an active fleet emergency.
- Targets ≥ 24×24px (2.2 AA 2.5.8). Reduced-motion honored throughout.

## 7. Tour tokens
- Spotlight backdrop `rgba(18,35,63,.55)`; highlighted target gets 3px `--brand-600`
  ring + `--shadow-pop`, `--r-md`. Tooltip card `--surface-raised`, max 320px,
  progress "N of M", buttons Back / Skip / Next|Finish.
- Storage key: `aegis-tour:{role}:{page}:{version}`. Completion is per role+page+version.
