---
name: SLK Operations
description: NESR's slickline operations hub — one job record seen through three lenses, dark by default, colour only where it carries meaning.
colors:
  ink-night: "#0b121a"
  panel: "#111820"
  panel-raised: "#161d27"
  panel-pressed: "#1e2630"
  well: "#0e131a"
  rule: "#232c37"
  rule-strong: "#323d4a"
  rule-input: "#5f6c7c"
  chalk: "#e8ecf1"
  chalk-muted: "#9aa4b1"
  chalk-subtle: "#8591a0"
  accent-chalk: "#e6e9ee"
  accent-chalk-hover: "#ffffff"
  on-accent: "#0b121a"
  focus-blue: "#8ab4f8"
  status-planned: "#6aa8ff"
  status-ongoing: "#f5c542"
  status-done: "#3ecf8e"
  status-danger: "#ff7b7b"
  status-danger-solid: "#e5484d"
  status-blocked: "#c08a55"
  sev-negligible: "#3ecf8e"
  sev-light: "#5fd0de"
  sev-serious: "#f5c542"
  sev-major: "#ff9f43"
  sev-catastrophic: "#ff6b6b"
  paper: "#f5f7fa"
  paper-panel: "#ffffff"
  paper-ink: "#111821"
typography:
  display:
    fontFamily: "Manrope, Inter, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 800
    lineHeight: "44px"
  headline:
    fontFamily: "Manrope, Inter, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: "34px"
  kpi:
    fontFamily: "Manrope, Inter, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: "40px"
  title:
    fontFamily: "Manrope, Inter, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: "28px"
  body-lead:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: "24px"
  body:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  body-small:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
  caption:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
  label:
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: "14px"
    letterSpacing: "0.06em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent-chalk}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body-small}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.accent-chalk-hover}"
    textColor: "{colors.on-accent}"
  button-secondary:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.panel-pressed}"
  button-ghost:
    textColor: "{colors.chalk-muted}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-danger:
    textColor: "{colors.status-danger}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  input:
    backgroundColor: "{colors.well}"
    textColor: "{colors.chalk}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.lg}"
    padding: "16px"
  subnav-pill:
    textColor: "{colors.chalk-muted}"
    typography: "{typography.body-small}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "32px"
  subnav-pill-active:
    backgroundColor: "{colors.accent-chalk}"
    textColor: "{colors.on-accent}"
  status-pill:
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
    height: "22px"
---

# Design System: SLK Operations

## Overview

**Creative North Star: "One Job Record, Three Lenses"**

SLK Operations is a single record per slickline job, and the interface changes lens with the person reading it:
- **The Control Room** is the office's view (schedule, dashboards, reconciliation, attendance sheets). It is dense, calm and dark, built so a full fleet reads at a glance and colour appears only when something needs attention.
- **The Field Logbook** is the wellsite's view (job stages, JRA, job log, attachments). It is plain, sturdy and legible, with large targets and short labels, filled in outdoors on a phone or tablet over weak signal.
- **The Signed Record** is the view of approvals, reports and PDFs. It is precise and evidential: values, signatures and fingerprints are set in monospace, and nothing decorative competes with the facts.

The three lenses share one world: a near-black night palette (paper-light on demand), chalk-white type, a monochrome accent, and a strict status palette. Density is high but never cramped: 14px body text, 36px controls on desk and 44px in field pages, and section labels in small monospace capitals that work like the ruled headings of a logbook. The accent stays neutral on purpose. NESR's brand colour is not in the repository yet; when it arrives it joins as a brand accent, and the monochrome action colour stays (owner decision, 2026-10-26).

Rejected: the original WL Operations Hub's look, emoji icons and colours (none are reused), and any decoration that would make a field user hunt for the next field.

**Key Characteristics:**
- Dark by default with a full light theme; both are tokens, never hard-coded hex in components.
- A monochrome accent (chalk on night, ink on paper) for actions; colour is reserved for status, severity and risk.
- Monospace capitals for section labels, units, IDs, timestamps and fingerprints; Manrope for page and stage titles; Inter for everything people read and type.
- Cards are lifted by shadow alone, with no outline; inner divisions use 1px rules.
- Every state has a word next to its colour; colour is never the only signal.

## Colors

A night-instrument palette: blue-black surfaces in four steps, chalk-white text in three, and a status palette that only speaks when something is planned, running, done, blocked or at risk.

### Primary
- **Chalk Accent** (accent-chalk): the action colour. Primary buttons, the active section pill, progress fills. On the light theme it inverts to Paper Ink (paper-ink), so the primary action is always the highest-contrast thing on screen.

### Neutral
- **Ink Night** (ink-night): the page background, the darkest step.
- **Panel** (panel): cards and the stage card body, one tone up from the page.
- **Panel Raised / Panel Pressed** (panel-raised, panel-pressed): hover rows, secondary buttons, the active group tab, skeletons and tracks.
- **Well** (well): the inside of inputs, a step *below* the panel, so fields read as recessed.
- **Rule / Rule Strong / Rule Input** (rule, rule-strong, rule-input): 1px dividers, bordered controls and pills, and the input outline (the strongest, so empty fields stay findable in sunlight).
- **Chalk / Chalk Muted / Chalk Subtle** (chalk, chalk-muted, chalk-subtle): primary text, secondary text and labels, placeholders and metadata.
- **Paper, Paper Panel, Paper Ink** (paper, paper-panel, paper-ink): the light theme's page, card and text.

### Status (functional, not decorative)
- **Planned Blue** (status-planned), **Running Amber** (status-ongoing), **Done Green** (status-done), **Alert Red** (status-danger, with status-danger-solid for confirm dialogs), **Blocked Clay** (status-blocked): job status, banners and pills. Each has a deep "subtle" tint for the pill or banner background (for example #13233b behind Planned Blue).
- **Severity ladder** for 8 Min. Facts (sev-negligible → sev-light → sev-serious → sev-major → sev-catastrophic): a teal-to-red scale on solid pills with dark text.
- **Focus Blue** (focus-blue): keyboard focus rings only.

### Named Rules
**The Colour Means Something Rule.** Hue appears only to carry status, severity, risk or focus. Everything else is night, panel and chalk. A screen with no problems is almost monochrome.

**The Words Beside Colour Rule.** Every coloured state also says its name ("PLANNED", "Exemption Required", "+5"). Field users read in glare and some are colour-blind.

## Typography

**Display Font:** Manrope (with Inter, system-ui)
**Body Font:** Inter (with system-ui, Segoe UI, Roboto)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, Menlo)

**Character:** Manrope's wide, heavy capitals give page and stage titles the weight of a stencilled header. Inter carries every sentence and value people read or type. JetBrains Mono is the logbook's ruling pen: labels, units, IDs and evidence. All three are loaded from Google Fonts (`index.html`) and are SIL Open Font License.

### Hierarchy
- **Display** (800, 40px / 44px, uppercase): rare, for sign-in and empty full-page moments.
- **Headline** (800, 28px / 34px, uppercase): the page title (`PageTitle`): JOB RISK ASSESSMENT, KNOWLEDGE HUB.
- **KPI** (700, 36px / 40px): the single number in a stat tile or the JRA risk index.
- **Title** (700, 20px / 28px, Manrope): stage names (DESIGN, PREPARATION…), card and dialog titles.
- **Body lead** (500, 16px / 24px): emphasised lines and dialog intros.
- **Body** (400, 14px / 20px): the default for text, table cells and inputs.
- **Body small / Caption** (400, 13px / 18px and 500, 12px / 16px): hints, metadata, button text at small size.
- **Label** (600, 11px / 14px, 0.06em, uppercase, mono): field labels, section rules (WELL, SIGN-OFF), status pills, column heads.

### Named Rules
**The Mono Is Evidence Rule.** Monospace is for things that are measured, identified or proven: labels, units (ft, psi, ppm), tickets, timestamps, fingerprints, form codes (QAF14021 Rev 3). Never for decoration or prose.

**The Uppercase Is Structure Rule.** Uppercase belongs to the page headline, stage titles and mono labels. Sentences, buttons and messages stay in sentence case.

## Layout

The app shell is two header rows (brand, country switch, WIREGUARD sync, Riyadh clock, account) over the group tabs, then a pill row for the section's pages, then content in a 20px gutter (16px on phones) up to 1600px wide.

- **Forms** are 1–4 column grids (`md:2`, `xl:4`) with 16–20px gaps. Sections are separated by mono label rules rather than nested boxes.
- **The job editor** puts a four-step stage strip (number · percent, title, one-line purpose, progress bar) over one stage card at a time, with Attachments as the final card on every stage.
- **Spacing** follows a 4px grid (4, 8, 12, 16, 20, 24, 32, 48).
- **Breakpoints** are 640, 768, 1024, 1280 and 1536px. On small screens, grids collapse to one column, secondary header items (name, clock, password link) hide, the tab rows scroll sideways, and wide tables scroll inside their card.
- **Touch targets:** desk controls are 32–36px today. Field pages are meant to reach 44px (the lg size). That is a target, not yet applied everywhere.

### Named Rules
**The One Card Per Concern Rule.** A stage, a panel or a dialog is one card. Inside it, structure comes from label rules and 1px dividers, never from a card within a card.

## Elevation & Depth

Lifted, by owner decision (2026-10-26). Cards float off the page on a soft, offset shadow and carry no outline. On dark, the shadow is helped by a faint top highlight and the panel's one-step tonal lift; on light, the shadow does the work alone. Popovers, menus and dialogs use a deeper shadow. Everything else (rows, inputs, pills, inner sections) stays flat and is divided by 1px rules.

### Shadow Vocabulary
- **Card lift, dark** (`box-shadow: 0 1px 0 rgba(255,255,255,.05) inset, 0 2px 6px rgba(0,0,0,.40), 0 10px 24px rgba(0,0,0,.32)`): every card.
- **Card lift, light** (`box-shadow: 0 1px 2px rgba(16,24,40,.06), 0 6px 16px rgba(16,24,40,.08), 0 16px 32px rgba(16,24,40,.06)`): every card on the light theme.
- **Pop** (`box-shadow: 0 16px 40px rgba(0,0,0,.45)`; light `0 12px 32px rgba(16,24,40,.16)`): dialogs, dropdowns, the signature popover, the help assistant drawer.

### Named Rules
**The Declare Depth Once Rule.** A surface is either lifted by shadow (cards, overlays) or divided by a 1px rule (everything inside them). Never both on the same element.

## Shapes

Gently rounded and consistent. Cards and dialogs use 12px corners; buttons, banners and dropdowns 8px; inputs 6px; small tags 4px. Pills (999px) are reserved for small controls: section tabs, status and severity pills, and the help assistant's round button. Dashed 1px outlines mean "not yet" or "locked" (empty states, lock hints, missing 8MF); solid rules mean "this exists". Unit blocks on the schedule use a diagonal hatch, the one textured surface in the system, because it marks a real "unavailable" span on a time chart.

## Components

Precise and quiet: controls look like tools, not decorations.

### Buttons
- **Shape:** gently rounded (8px).
- **Primary:** Chalk Accent fill, night text. 36px tall, 14px side padding, 13–14px semibold. On light, ink fill with white text.
- **Hover / Focus:** hover steps to pure white (or lifted ink on light) over the fast transition (120ms). Keyboard focus shows a 2px Focus Blue ring with a 2px offset. Loading shows a spinner inside the button and keeps the label.
- **Secondary:** raised panel with a strong rule outline.
- **Ghost:** no fill, muted text that brightens on hover; used for toolbar and icon actions.
- **Danger:** outlined in Alert Red; the solid red version appears only inside confirm dialogs.
- **Sizes:** sm 32px, md 36px, lg 44px (lg uses Manrope bold, for field pages).

### Chips and Pills
- **Status pill:** 22px tall, mono label capitals, the status colour on its deep tint with a 40% outline. Canceled is struck through.
- **Severity pill:** solid severity colour with dark text; "No 8MF" is a dashed outline.
- **Section pills:** outlined and muted; the active one is filled Chalk Accent.
- **Role badges:** tiny mono capitals on Planned Blue's tint (PREP, CREW, SDM) beside field labels, showing who fills the field.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Panel (Paper Panel on light).
- **Shadow Strategy:** card lift (see Elevation & Depth); no outline.
- **Internal Padding:** 16px; field-heavy stage cards use 20px row gaps.

### Inputs / Fields
- **Style:** Well background (one step darker than the card), a 1px Rule Input outline, 6px corners, 36px tall. The label is a mono capital above, with an optional role badge and a red asterisk when required. Units sit inside the right edge in mono.
- **Focus:** the outline turns Focus Blue, plus the global focus ring.
- **Error / Disabled:** an error turns the outline red and puts an icon and message under the field. Disabled fields fade to 60%; a locked section shows a dashed lock hint saying why and when it opens.

### Navigation
- **Group tabs:** 36px outlined tabs; the active group is filled Panel Pressed with a strong rule.
- **Section pills:** the second row (see Chips).
- **Mobile:** both rows scroll horizontally; nothing wraps into a hamburger.

### Banners
- **Style:** tinted background in the tone's subtle colour, tone-coloured text and icon, an optional action at the right.
- **Tones:** info, warning, danger (`role="alert"`) and success.
- **Known exception:** banners still carry a 3px tone-coloured left edge (`border-l-3`). It predates The Declare Depth Once Rule and the side-stripe ban; replace it with the tinted fill alone when banners are next touched.

### Signature Badge (signature component)
The Signed Record lens in one line:
- a shield icon, then "Digitally signed by NAME (Role) · date";
- the server's live verdict ("Signature valid", "Changed after signing", "Does not verify", "Withdrawn"), in Done Green or Alert Red;
- the first 12 characters of the SHA-256 fingerprint in mono, with the full value on hover;
- earlier signatures listed in a collapsible.

### Stage Strip (signature component)
Four equal cards across the top of a job: a mono "01 · 17%", a Manrope stage title, a one-line purpose, and a 4px progress bar. The active stage gets the strong rule and Panel Raised. Done stages fill the bar Done Green.

## Do's and Don'ts

### Do:
- **Do** reference tokens (`bg-surface`, `text-text-muted`, `rounded-lg`, `shadow-card`), never raw hex, so the light theme and NESR's future brand colour can swap in one place.
- **Do** put a word next to every coloured state (status pills, risk points "+5", "Exemption Required").
- **Do** use mono capitals for labels, units, IDs, timestamps and fingerprints, and Inter for anything people read or type.
- **Do** give field pages (job stages, JRA, job log, attachments) 44px touch targets and the strongest input outline (Rule Input).
- **Do** lift cards with the card shadow and divide their insides with 1px rules.
- **Do** show "why" on every locked or disabled control (lock hint, tooltip, or hint text under the field).

### Don't:
- **Don't** add a 1px outline to a card that already has the card shadow, and don't nest cards.
- **Don't** introduce new hues for decoration; colour is for status, severity, risk and focus only.
- **Don't** reuse anything from the original WL Operations Hub: colours, emoji icons, copy or assets.
- **Don't** add coloured side stripes thicker than 1px to cards, list items or callouts (the banner edge is a known exception to remove).
- **Don't** use monospace for prose or as a "technical" costume.
- **Don't** invent NESR brand values. Use NESR's logo, colours and type only when NESR supplies them.
