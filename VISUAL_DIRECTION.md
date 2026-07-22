# AEGIS Visual Direction — The Control Ledger

## Product character

AEGIS is a financial control instrument. Normal state is calm, exact, and
paper-like; risk is unmistakable; audit is evidential. The interface uses ledger
rules, numbered stages, stamps, side annotations, and tabular numerals instead of
dashboard cards.

## Signature grammar

1. **Decision Spine** — Agent → Identity → Permission → Policy → Budget → Audit → Execution.
2. **Ledger rule** — thin horizontal rules connect labels, values, and evidence.
3. **Margin annotation** — role, reason, epoch, and correlation context sits in a narrow evidence margin.
4. **State field** — healthy teal is quiet; copper indicates exposure; red transforms the entire containment field.
5. **Proof surface** — hashes and checkpoints appear on dark ink surfaces only when cryptographic evidence is the task.

## Typography

- Operational UI: `Instrument Sans`, 400/500/600.
- Editorial moments: `Instrument Serif`, 500/600, restricted to login, page verdicts, and major containment transitions.
- Evidence and financial state: `IBM Plex Mono`, 400/500.
- Dense tables and forms never use serif.
- Financial, latency, sequence, and epoch values use tabular numerals.
- Fonts are self-hosted through package assets or loaded with explicit fallbacks;
  the visual system must remain legible if web fonts fail.

## Color tokens

| Role | Token | Value | Rationale |
|---|---|---:|---|
| Canvas | `ledger-paper` | `#F4F1EA` | Warm material field; avoids white SaaS canvas. |
| Raised sheet | `ledger-sheet` | `#FBF9F4` | Used selectively for work surfaces, not every group. |
| Primary ink | `ledger-ink` | `#0A1930` | High-contrast institutional navy. |
| Muted ink | `ledger-muted` | `#59616C` | AA body copy on paper. |
| Hairline | `ledger-rule` | `#CDC7BB` | Printed-ledger structure, not card outlines. |
| Action | `ledger-cobalt` | `#315CF6` | Policy/action focus and active Spine stage. |
| Healthy | `ledger-teal` | `#1C7C68` | Restrained operational confirmation. |
| Exposure | `ledger-copper` | `#B66A3C` | Held, pressure, and reconciliation. |
| Critical | `ledger-red` | `#C73A31` | Denial, revocation, and containment only. |
| Proof ink | `proof-field` | `#07111F` | Code, integrity proof, and halted-state focus. |

## Shape and elevation

- Default radius: 0–4px; 999px is reserved for tiny live indicators only.
- Sections are separated by rules, background fields, gutters, and alignment.
- Shadows are limited to overlays, command palette, and tour coachmarks.
- Buttons are rectangular control tabs with 2px radius; destructive controls use
  a strong field transformation, never a decorative red pill.

## Spacing

- Base unit: 4px; major composition rhythm: 12 / 20 / 32 / 52 / 84.
- Desktop uses a 12-column working grid with a persistent 72px ledger rail.
- Evidence views can reach 1440px; policy editor uses the full viewport width.
- Mobile converts spatial graphs into ordered, numbered proof lists.

## Motion

- Stage illumination: 160ms opacity/color transition; no simulated progress.
- Live movement occurs only when a real SSE/API state changes.
- Gateway propagation draws from fleet core to acknowledged node on epoch change.
- Halt transforms paper → proof-field/red in 240ms, with reduced-motion switching instantly.
- `prefers-reduced-motion` disables travel, scale, and pulsing; state remains explicit in text.

## Visualization language

- Decision Spine: connected numbered control gates with state text and evidence IDs.
- Fleet topology: central durable epoch connected to real gateway acknowledgements.
- Exposure river: segmented horizontal ledger where segment length represents
  available, held, committed, and Unknown exposure; values are repeated as text.
- Evidence Thread: vertical hash-linked chain with previous/current hash anchors.
- Permission envelope: nested authority bands from identity → actions → resources → caps.

## Dark surfaces

Allowed only for login, Monaco editor, demo opening, integrity proof, and halted
containment. Dark is semantic focus, not the product theme.
