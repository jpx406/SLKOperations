---
name: SLK Operations
description: NESR's slickline operations hub — one job record seen through three lenses; dark Control Room on desks, high-contrast Sunlight with large touch controls on tablets; colour only where it carries meaning.
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
  accent-chalk: "#c8d400"
  accent-chalk-hover: "#d8e32a"
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
  sun-page: "#e9eef3"
  sun-card: "#ffffff"
  sun-raised: "#f1f5f9"
  sun-ink: "#0f172a"
  sun-ink-muted: "#334155"
  sun-ink-subtle: "#3f4b5c"
  sun-field-outline: "#475569"
  sun-card-edge: "#6b7889"
  sun-rule: "#cbd5e1"
  sun-focus: "#1d4ed8"
  sun-planned: "#1d4ed8"
  sun-ongoing: "#facc15"
  sun-done: "#15803d"
  sun-danger: "#7f1d1d"
  sun-amber-ink: "#713f12"
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
  body-touch:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
  label-touch:
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
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
  button-primary-sunlight:
    backgroundColor: "{colors.sun-ink}"
    textColor: "{colors.sun-card}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "44px"
  card-sunlight:
    backgroundColor: "{colors.sun-card}"
    textColor: "{colors.sun-ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  input-touch:
    backgroundColor: "{colors.sun-card}"
    textColor: "{colors.sun-ink}"
    typography: "{typography.body-touch}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "44px"
  answer-toggle-touch:
    textColor: "{colors.sun-ink-muted}"
    typography: "{typography.caption}"
    padding: "0 12px"
    height: "48px"
  status-pill-sunlight-planned:
    backgroundColor: "{colors.sun-planned}"
    textColor: "{colors.sun-card}"
    typography: "{typography.label-touch}"
    rounded: "{rounded.pill}"
---

# Design System: SLK Operations

## Overview

**Creative North Star: "One Job Record, Three Lenses"**

SLK Operations is a single record per slickline job, and the interface changes lens with the person reading it:
- **The Control Room** is the office's view (schedule, dashboards, reconciliation, attendance sheets). It is dense, calm and dark, built so a full fleet reads at a glance and colour appears only when something needs attention.
- **The Field Logbook** is the wellsite's view (job stages, JRA, job log, attachments). It is plain, sturdy and legible, with large targets and short labels, filled in outdoors on a phone or tablet over weak signal.
- **The Signed Record** is the view of approvals, reports and PDFs. It is precise and evidential: values, signatures and fingerprints are set in monospace, and nothing decorative competes with the facts.

The three lenses share one world in two light conditions. **Control Room** is the near-black night theme, the default on a desk with a mouse. **Sunlight** is a high-contrast light theme built for tablets outdoors, the default on touch screens. Both use chalk/ink type, a monochrome accent and a strict status palette. Control size follows the hand: **desk** density on a mouse, **touch** density (44–48px controls, 16px text) on a touch screen. Everyone can override both from the account menu, and the choice is remembered on that device (owner request, 2026-10-26). Density is high but never cramped on a desk (14px body text, 32–36px controls). Touch density raises every control to 44px, answer toggles to 48px and body text to 16px. Section labels stay in small monospace capitals that work like the ruled headings of a logbook. The action colour is the WL Operations Hub lime (#c8d400) with dark text, the same in both themes, so SLK Operations reads as part of the same family (owner request, 2026-10-26, replacing the earlier monochrome accent). Lime used as text is bright on night and deep olive (#465000) in Sunlight, where lime text would bleach; the word SLK in the name is lime on night and dark on a lime marker in Sunlight.

Rejected: the original WL Operations Hub's look, emoji icons and colours (none are reused), and any decoration that would make a field user hunt for the next field.

**Key Characteristics:**
- Two themes chosen by device: dark Control Room on desks, Sunlight on touch screens. Both are tokens, never hard-coded hex in components.
- Two densities chosen by pointer: desk (mouse) and touch (finger or glove). Control heights and text sizes are tokens that grow under touch.
- A lime action colour (WL Hub family) for primary buttons, the active pill and ticket numbers; other colour is reserved for status, severity, risk and the schedule's events (maintenance orange, unit status purple).
- Monospace capitals for section labels, units, IDs, timestamps and fingerprints; Manrope for page and stage titles; Inter for everything people read and type.
- Cards declare depth once per theme: a lifting shadow in Control Room, a 1px outline in Sunlight (shadows wash out in glare).
- Every state has a word next to its colour; colour is never the only signal.

## Colors

A night-instrument palette: blue-black surfaces in four steps, chalk-white text in three, and a status palette that only speaks when something is planned, running, done, blocked or at risk.

### Primary
- **Hub Lime** (accent-chalk token, #c8d400): the action colour. Primary buttons, the active section pill, progress fills, filter highlights, always with dark text. Lime text (accent-text) is #d4e000 on night and #465000 in Sunlight; lime borders use accent-edge for the same reason.

### Neutral
- **Ink Night** (ink-night): the page background, the darkest step.
- **Panel** (panel): cards and the stage card body, one tone up from the page.
- **Panel Raised / Panel Pressed** (panel-raised, panel-pressed): hover rows, secondary buttons, the active group tab, skeletons and tracks.
- **Well** (well): the inside of inputs, a step *below* the panel, so fields read as recessed.
- **Rule / Rule Strong / Rule Input** (rule, rule-strong, rule-input): 1px dividers, bordered controls and pills, and the input outline (the strongest, so empty fields stay findable in sunlight).
- **Chalk / Chalk Muted / Chalk Subtle** (chalk, chalk-muted, chalk-subtle): primary text, secondary text and labels, placeholders and metadata.

### Sunlight (light theme, the touch default)
Built for a tablet in direct sun. Every pair was checked with `replica/design/build_tokens.py`.
- **Sun Page / Sun Card / Sun Raised** (sun-page, sun-card, sun-raised): a soft grey page so white cards stand apart even before their outline.
- **Sun Ink / Muted / Subtle** (sun-ink, sun-ink-muted, sun-ink-subtle): text at 17.9 : 1, 10.4 : 1 and 8.9 : 1 on a card. Secondary text never drops below 7 : 1 on any surface.
- **Field Outline** (sun-field-outline): input borders at 7.6 : 1, so empty fields stay findable.
- **Card Edge** (sun-card-edge): the 1px card outline, 3.9 : 1 against the page and 4.5 : 1 against a card.
- **Sun Rule** (sun-rule): inner dividers only. **Sun Focus** (sun-focus): the focus ring, 6.7 : 1.
- **Status, solid:** Planned (sun-planned) and Done (sun-done) with white text, Running amber (sun-ongoing) with ink text, Alert (sun-danger) and Amber Ink (sun-amber-ink) for text on their pale tints at 8 : 1 or more. Tinted pills bleach out in sun, so pills are solid here.

### Status (functional, not decorative)
- **Planned Blue** (status-planned), **Running Amber** (status-ongoing), **Done Green** (status-done), **Alert Red** (status-danger, with status-danger-solid for confirm dialogs), **Blocked Clay** (status-blocked): job status, banners and pills. Each has a deep "subtle" tint for the pill or banner background (for example #13233b behind Planned Blue).
- **Severity ladder** for 8 Min. Facts (sev-negligible → sev-light → sev-serious → sev-major → sev-catastrophic): a teal-to-red scale on solid pills with dark text.
- **Focus Blue** (focus-blue): keyboard focus rings only.

### Named Rules
**The Colour Means Something Rule.** Hue appears only to carry status, severity, risk or focus. Everything else is night, panel and chalk. A screen with no problems is almost monochrome.

**The Words Beside Colour Rule.** Every coloured state also says its name ("PLANNED", "Exemption Required", "+5"). Field users read in glare and some are colour-blind.

**The Sunlight Rule.** In Sunlight, body and secondary text stay at 7 : 1 or more, field outlines at 4.5 : 1 or more, and card edges at 3 : 1 or more. The plain accessibility minimum is not enough in glare.

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

### Touch sizes
Under touch density the same roles grow: label 12px / 16px, caption 13px / 18px, body small 15px / 22px, body 16px / 24px, body lead 17px / 26px. Titles and headlines keep their size. One set of components serves both densities because the sizes are tokens (`--text-*` under `[data-density="touch"]`).

### Named Rules
**The Mono Is Evidence Rule.** Monospace is for things that are measured, identified or proven: labels, units (ft, psi, ppm), tickets, timestamps, fingerprints, form codes (QAF14021 Rev 3). Never for decoration or prose.

**The Uppercase Is Structure Rule.** Uppercase belongs to the page headline, stage titles and mono labels. Sentences, buttons and messages stay in sentence case.

## Layout

On a desk (1280px and up) the app shell is a 240px **sidebar** on the left (the groups with their pages, About and the version at the bottom) beside a 64px header row: the **title block** (the NESR mark at the height of "SLK OPERATIONS HUB" and the mono tagline "SLICKLINE JOBS, QUALITY & REPORTING" under it, after WIREGUARD's header) and the tools (country switch · WIREGUARD sync · Riyadh clock · Help · Ask · account menu). Narrower windows, or a hidden sidebar, use one header row (menu button · brand · the same tools) with the "Group › Page" menu button under it; there the section's pill row **stays pinned to the top** while the page scrolls. Then content in a 20px gutter (16px on phones) up to 1600px wide. The sidebar's top strip matches the header row so the two rules line up. Authors, version and build live in **About** (sidebar foot and account menu): a small centred window sized to its content (NESR mark, name, tagline, version and build, what the app does, authors with email, © NESR), closed by its × button, Escape or a click outside. Display settings, password, Data and Sign out live in the account menu.

- **Forms** are 1–4 column grids (`md:2`, `xl:4`) with 16–20px gaps. Sections are separated by mono label rules rather than nested boxes.
- **The job editor** puts a four-step stage strip (number · percent, title, one-line purpose, progress bar) over one stage card at a time, with Attachments as the final card on every stage.
- **Spacing** follows a 4px grid (4, 8, 12, 16, 20, 24, 32, 48).
- **Breakpoints** are 640, 768, 1024, 1280 and 1536px. Below 1536px the Help and Ask labels shrink to icons and the name leaves the account button. Below 1024px the clock hides. On phones the header tools wrap under the brand, the country switch moves into the account menu, grids collapse to one column, tab rows scroll sideways, and wide tables scroll inside their card.
- **Touch targets:** under touch density every button, input, select, tab and link control is 44px, and JRA answer toggles are 48px, with at least 8px between groups. Measured 2026-10-26 on a 1280 × 800 touch tablet: Preparation and JRA have no control under 44px. The Schedule's timeline cells are still smaller; it is an office screen.

### Named Rules
**The Nothing Floats Over Work Rule.** No floating buttons over content. Actions live in the header, in the page, or in a pinned bar that takes its own space. (A floating help button covered the JRA answer column on tablets until it moved into the header.)

**The One Card Per Concern Rule.** A stage, a panel or a dialog is one card. Inside it, structure comes from label rules and 1px dividers, never from a card within a card.

## Elevation & Depth

Lifted in Control Room, outlined in Sunlight (owner decisions, 2026-10-26). In Control Room, cards float off the page on a soft, offset shadow with a faint top highlight and carry no outline. In Sunlight, shadows wash out in glare, so cards drop the shadow and take a 1px Card Edge outline instead. Popovers, menus and dialogs use a deeper shadow in both themes; in Sunlight they also carry the Card Edge ring. Everything else (rows, inputs, pills, inner sections) stays flat and is divided by 1px rules.

### Shadow Vocabulary
- **Card lift, dark** (`box-shadow: 0 1px 0 rgba(255,255,255,.05) inset, 0 2px 6px rgba(0,0,0,.40), 0 10px 24px rgba(0,0,0,.32)`): every card.
- **Card, Sunlight** (`box-shadow: none` plus a 1px Card Edge border): every card on the Sunlight theme.
- **Pop** (`box-shadow: 0 16px 40px rgba(0,0,0,.45)`; Sunlight `0 0 0 1px #6b7889, 0 12px 32px rgba(15,23,42,.24)`): dialogs, dropdowns, the account menu, the signature popover, the help assistant drawer.

### Named Rules
**The Declare Depth Once Rule.** Each surface declares depth once per theme: a shadow (Control Room cards and overlays) or a 1px line (Sunlight cards, and everything inside a card in both themes). Never both on the same element. Sunlight overlays are the one deliberate pairing: a 1px ring plus a shadow, because a menu over a white page needs both edge and separation.

## Shapes

Gently rounded and consistent. Cards and dialogs use 12px corners; buttons, banners and dropdowns 8px; inputs 6px; small tags 4px. Pills (999px) are reserved for small controls: section tabs, status and severity pills, and the help assistant's round button. Dashed 1px outlines mean "not yet" or "locked" (empty states, lock hints, missing 8MF); solid rules mean "this exists". Unit blocks on the schedule use a diagonal hatch, the one textured surface in the system, because it marks a real "unavailable" span on a time chart.

## Components

Precise and quiet: controls look like tools, not decorations.

### Buttons
- **Shape:** gently rounded (8px).
- **Primary:** Chalk Accent fill, night text. 36px tall on a desk, 44px under touch; 14px side padding, 13–15px semibold. The same lime fill with dark text in Sunlight.
- **Hover / Focus:** hover steps to pure white (or lifted ink on light) over the fast transition (120ms). Keyboard focus shows a 2px Focus Blue ring with a 2px offset. Loading shows a spinner inside the button and keeps the label.
- **Secondary:** raised panel with a strong rule outline.
- **Ghost:** no fill, muted text that brightens on hover; used for toolbar and icon actions.
- **Danger:** outlined in Alert Red; the solid red version appears only inside confirm dialogs.
- **Sizes:** sm 32px, md 36px, lg 44px on a desk. Under touch, sm and md become 44px and lg 48px. Heights come from `--layout-control-sm/md/lg`; never hard-code `h-8` on an interactive control.

### Chips and Pills
- **Status pill:** 22px tall, mono label capitals. In Control Room, the status colour on its deep tint with a 40% outline. In Sunlight, a solid fill (white on Planned blue and Done green, ink on Running amber). Canceled is struck through. Colours come from the `pill-*` tokens.
- **Severity pill:** solid severity colour with dark text; "No 8MF" is a dashed outline.
- **Section pills:** outlined and muted; the active one is filled Hub Lime.
- **Role badges:** tiny mono capitals on Planned Blue's tint (PREP, CREW, SDM) beside field labels, showing who fills the field.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Panel (Sun Card in Sunlight).
- **Depth:** card lift and no outline in Control Room; a 1px Card Edge outline and no shadow in Sunlight (see Elevation & Depth).
- **Internal Padding:** 16px; field-heavy stage cards use 20px row gaps.

### Inputs / Fields
- **Style:** Well background (one step darker than the card; white in Sunlight), a 1px Rule Input outline (Field Outline in Sunlight), 6px corners, 36px tall (44px under touch). The label is a mono capital above, with an optional role badge and a red asterisk when required. Units sit inside the right edge in mono.
- **Focus:** the outline turns Focus Blue, plus the global focus ring.
- **Error / Disabled:** an error turns the outline red and puts an icon and message under the field. Disabled fields fade to 60%; a locked section shows a dashed lock hint saying why and when it opens.

### Navigation
- **Header:** one row (see Layout). Help opens the guide; Ask opens the help assistant drawer. Both are ghost buttons that shrink to icons below 1280px.
- **Account menu:** the name and role button at the right opens a 288px panel with:
  - the person and role;
  - **Sunlight mode** (an on/off switch);
  - **Large touch controls** (Auto / On / Off; Auto follows the pointer);
  - Change password in WIREGUARD, Data export & import (admins) and Sign out.
  - It closes on Escape or a tap outside, and holds the country switch on phones.
- **Sidebar (1280px and up):** two levels only (Apple HIG sidebars.md). Each group is a row with its icon; groups with several pages open and close like a disclosure, the group you are in always stays open, and which others are open is remembered. Pages are 32px rows indented under their group; the current page is Panel Pressed with a 3px lime edge, the only lime in the sidebar besides the current group's icon. A Hide sidebar button sits beside the wordmark; hidden, a Show sidebar button takes the toolbar's leading edge. The choice is remembered.
- **Menu button and drawer (narrower windows or a hidden sidebar):** the same two-level list in a drawer from the left.
- **Section pills:** the pinned row (see Chips), shown only when the sidebar is not.

### JRA answer toggle
A segmented Yes / No (/ N/A) control, 32px tall on a desk and 48px under touch, at least 48px wide per option. The chosen answer fills with the accent. An answer that scores points or triggers MOC / Exemption fills amber instead, and "+points" plus the requirement tag appear beside it, so the risk reads without relying on colour.

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
- **Do** size interactive controls with `h-(--layout-control-sm|md|lg)` (and `--layout-control-answer` for answer toggles), so touch density reaches 44–48px everywhere.
- **Do** test field screens in Sunlight under touch density (a 1280 × 800 touch tablet) as well as dark on a desk.
- **Do** lift cards with the card shadow and divide their insides with 1px rules.
- **Do** show "why" on every locked or disabled control (lock hint, tooltip, or hint text under the field).

### Don't:
- **Don't** add a 1px outline to a Control Room card that already has the card shadow, and don't nest cards.
- **Don't** place floating buttons over content.
- **Don't** use tinted status pills or pale text in Sunlight; keep to the Sunlight Rule's contrast floors.
- **Don't** introduce new hues for decoration; colour is for status, severity, risk and focus only.
- **Don't** reuse anything from the original WL Operations Hub: colours, emoji icons, copy or assets.
- **Don't** add coloured side stripes thicker than 1px to cards, list items or callouts (the banner edge is a known exception to remove).
- **Don't** use monospace for prose or as a "technical" costume.
- **Don't** invent NESR brand values. Use NESR's logo, colours and type only when NESR supplies them.
