# Components: SLK Operations

Built on Radix primitives (via shadcn/ui), styled only with tokens: `bg-surface text-muted rounded-md`, never raw hex. Icons are **Lucide** (ISC), stroke 1.75, at 16 / 18 / 20 px. The original's emoji icons (🔑 ☀️ 📦 🔧) are not reused.

Shared rules for every component:
- **Focus:** `outline: 2px solid var(--color-focus); outline-offset: 2px` on `:focus-visible` only.
- **Disabled:** 50 % opacity, `cursor-not-allowed`, `aria-disabled`, and the reason in a tooltip when there is one (for example "Only SDM can edit").
- **Motion:** `--motion-fast` for hover and press, `--motion-base` for open and close; switched off under `prefers-reduced-motion`.
- **Hit targets:** 36 px on desktop, 44 px under `md` and in field pages (the offline job log).
- **Copy:** every label and empty state here is new wording, not the original's text.

S-IDs refer to `replica/recon.md`.

---

## Shell

```
AppHeader
  parts     row 1 (64px): brand slot (logo from replica-brand) · product name · revision label (mono xs, text-subtle)
            row 2 (48px): user name · RoleBadge · Help · ThemeToggle · ChangePassword · Sign out · Refresh · LiveClock
  states    default, offline (amber "Offline — changes queued" chip), sync-stale (>5 min since last event: clock turns warning)
  tokens    bg bg, border-b border, gutter layout-gutter
  a11y      <header> landmark; icon buttons have aria-label; the live clock is aria-hidden (no announcements every second)
  mobile    row 2 collapses into an avatar menu (DropdownMenu)
  used on   all

TopNav (group tabs)
  variants  group button
  states    default, hover (bg surface-2), active (bg surface-3, text, border-strong), focus-visible, hidden-by-permission (not rendered)
  tokens    font sans base/600, radius md, h control-md, px 12
  a11y      <nav aria-label="Main">; active item aria-current="page"; arrow keys move between items (roving tabindex)
  used on   all

SubNav (pill row)
  states    default (border border, text-muted), hover, active (bg accent, text on-accent), focus-visible, locked (Lock icon + tooltip; does not navigate)
  tokens    radius pill, h control-sm, px 14, font sm/600, gap 8, row height subnav
  a11y      <nav aria-label="Section">; aria-current on the active pill
  used on   all module pages

LiveClock
  parts     clock icon · "14:32:05 · Riyadh (GMT+3)" in mono · "synced 14:31:50" in text-subtle
  states    live, stale (warning), offline (danger)
  tokens    font mono xs
  used on   header

AssistantFab + AssistantPanel
  fab       56px circle, bg accent, on-accent icon (MessageCircle), bottom-right 24px, z fab
  panel     420px right drawer (full screen under md), header with a "Help only — no live data" note, message list, composer
  states    closed, open, streaming (typing dots), error (retry), rate-limited
  a11y      the fab has aria-label "Open help assistant"; the panel is role="dialog" aria-modal="false"; Esc closes; focus returns to the fab
  used on   all (S23)
```

## Actions

```
Button
  variants  primary (bg accent, text on-accent), secondary (bg surface-2, border border-strong, text),
            ghost (transparent, text-muted → text on hover), danger (border danger, text danger; hover bg danger-subtle),
            danger-solid (bg danger-solid, text on-danger; only inside confirm dialogs)
  sizes     sm 32px (px 12, font xs/600) · md 36px (px 14, font sm/600) · lg 44px (px 18, font base/700)
  states    default, hover, active (translateY 1px), focus-visible, disabled, loading (spinner replaces the icon, label stays, aria-busy)
  tokens    radius md, font display for lg, sans for sm/md, gap 8 icon to label
  a11y      a real <button type="button"> (or "submit"); icon-only buttons need aria-label; loading keeps the accessible name
  used on   all

IconButton
  sizes     32 / 36 / 44 square
  variants  secondary, ghost
  a11y      aria-label required (lint rule); a tooltip with the same text
  used on   header, tables, incident cards

SaveState (autosave indicator)
  states    idle ("Saved"), dirty ("Unsaved changes"), saving (spinner + "Saving…"), saved (check + "All changes saved", fades to idle after 2s),
            error (danger + "Not saved — Retry"), conflict (warning + "Changed by Ana 1 min ago — Review")
  tokens    font xs/600, radius pill, success/warning/danger subtle backgrounds
  a11y      role="status" aria-live="polite"; announces saved/error only, not every keystroke
  used on   S04–S07, S12, S26
```

## Pills, badges and indicators

```
StatusPill (job status)
  variants  planned (info on info-subtle) · ongoing (warning on warning-subtle) · completed (success on success-subtle) · canceled (neutral on neutral-subtle, strikethrough)
  tokens    font label (mono 11/600 upper), radius pill, px 8, h 22, 1px border in the fg colour at 40% opacity
  a11y      text always present (colour is never the only signal)
  used on   S02 legend, S03, S04, S08

DocStatusPill
  variants  draft (neutral) · sent (info) · approved (success) · rejected (danger) · saved (warning) · version "v3" (neutral, mono)
  used on   S08 JRA column, S11, S12, S09

SeverityPill
  variants  negligible · light · serious · major · catastrophic (solid sev-* background, text on-sev) · "auto" suffix variant
  tokens    font xs/700, radius pill, h 22
  a11y      label text, plus aria-describedby pointing at the severity reference table on S12
  used on   S10, S11, S12

RoleBadge (user role, header)
  tokens    bg success-subtle, text success, font label, radius sm
  used on   header

FieldRoleBadge (who may edit a field)
  variants  SALES · SDM · SALES / SDM · OPS
  tokens    bg info-subtle, text info, font label 10px, radius xs, after the field label
  a11y      becomes part of the label: "Ticket number, editable by Sales"; read-only fields get aria-readonly
  used on   S04–S07

LockHint
  variants  inline ("Locked — choose a plug or lock service first"), section banner (a whole block locked with the reason and the unlock condition)
  tokens    icon Lock 14, text-subtle; banner bg surface-2, border dashed border-strong, radius md
  a11y      the locked control has aria-disabled and aria-describedby pointing at the hint
  used on   S05, S06, S07, S12

ProgressBar (stage)
  sizes     mini 4px (cards), sm 6px (board rows)
  states    0 %, partial (accent), 100 % (success)
  a11y      role="progressbar" aria-valuenow aria-label "Preparation 40 percent"
  used on   S03, S04 stage cards

Chip (filter chip with count)
  states    default, selected (bg accent, text on-accent), hover, focus-visible
  tokens    radius pill, h 28, font xs/600, count in mono
  a11y      role="checkbox" aria-checked (multi) or a radio group (single)
  used on   S18–S19 categories, S21 types and categories
```

## Forms

```
Field (wrapper)
  parts     Label (font label, text-muted) · FieldRoleBadge? · required asterisk (danger, aria-hidden; the input has aria-required) ·
            control · hint (xs, text-subtle) · error (xs, danger, Lucide AlertCircle)
  states    default, focused, filled, read-only (no border, text on surface-2), disabled, locked (LockHint), error, auto (computed)
  layout    responsive grid: 3 columns ≥lg, 2 columns md, 1 column below; gap 16 × 20
  a11y      <label for>; hint and error joined via aria-describedby; errors announced on submit via an error summary at the top of the form
  used on   S04–S07, S12, S26, S28, all modals

TextInput / NumberInput / Textarea
  sizes     md 36px (default), lg 44px (field pages)
  tokens    bg input, border border-input 1px, radius sm, px 12, font base; placeholder text-subtle
  states    hover (border-strong), focus (border focus + ring), error (border danger), read-only, disabled
  number    unit suffix inside the field (ft, lb, psi, °F, ppm, in); inputmode="decimal"; thousands formatted on blur, raw while typing; min/max from the schema checks
  a11y      the unit is part of the accessible name: "Tag depth, feet"
  used on   forms

Select (native-feeling, Radix Select)
  states    placeholder ("Choose…"), selected, open, disabled, locked, error
  features  type-ahead; "Other" reveals a free-text input below; lists come from lookup_values (editable in S24)
  a11y      Radix Select keyboard model; listbox labelled by the field label
  used on   forms

Combobox (searchable select)
  use for   long lists: services (29+), employees, wires by serial, PCE assets, tickets in the 8MF header
  states    empty query, results, no results ("No match — check spelling or add it in Database"), loading
  a11y      role="combobox" aria-expanded aria-activedescendant
  used on   S04 services, S05 crew/wire/PCE, S12 ticket picker, S31 wire picker

MultiSelectFilter ("All ▾")
  parts     trigger shows "All" / first value / "3 selected" · popover with search, checkboxes, Select all / Clear
  tokens    trigger like Select sm; popover bg surface-2, shadow pop, radius md, max-h 320 scroll
  a11y      the trigger has aria-haspopup="listbox"; the popover is a listbox with multi-select; Esc closes and returns focus
  used on   FilterBar

FilterBar
  parts     up to 9 MultiSelectFilters (Year, Month, Account, Area, Service domain, Service, SDM, Unit, Conveyance) · Clear · active-filter count
  behaviour filters live in the URL query, so views are shareable and survive refresh; a "Filters (3)" drawer below md
  used on   S08, S10, S13–S16

DateInput / DateTimeInput
  features  shows local Riyadh time and stores UTC; "Now" button on DateTimeInput (field use); a popover calendar plus typed input (dd MMM yyyy HH:mm)
  validation rig-down after rig-up, end after start, shown inline
  a11y      typed input is always available; calendar grid uses arrow keys
  used on   S04, S06, S12, S17 month picker

Stepper (head count)
  parts     − value + with the cap shown ("max 6 per job")
  states    at min (− disabled), at max (+ disabled, hint turns warning)
  a11y      role="spinbutton" aria-valuemin/max/now
  used on   S05

YesNoNA (segmented)
  options   Yes · No · N/A (Other optional)
  tokens    segmented control, radius sm, selected bg surface-3 + border-strong; "Yes" on failure fields uses danger
  a11y      radio group with arrow keys
  used on   S05–S07

Toggle / Checkbox
  used on   Show canceled jobs (S02), Show duplicates (S21), multi-select mode (S17)
```

## Slickline-specific

```
ToolstringBuilder  (new for SLK)
  parts     ordered rows: component (Select: rope socket, stem, knuckle joint, spang jar, hydraulic jar, accelerator,
            running/pulling tool, gauge cutter, bailer, LIB, memory gauge carrier, other) · OD in · length ft · weight lb · drag handle · remove
            footer totals: total length, max OD, stem weight
            live checks: max OD vs minimum restriction and lubricator bore; total length vs lubricator length (warning, not blocking)
  states    empty ("Add the toolstring from the rope socket down"), filled, warning (danger or warning text on the totals row), read-only after Closure
  a11y      each row is a fieldset with a legend "Component 3"; reorder with buttons (Move up / Move down) as well as dragging; totals in role="status"
  used on   S05 (feeds jobs.toolstring, max_tool_od_in, toolstring_length_ft, stem_weight_lb)

WireCard / WireLog
  parts     serial, type, material, size, length on drum, unit · runs since last cut-back vs threshold (ProgressBar) · days since torsion test ·
            event table (date, type, job, max depth, max pull, cut ft, torsion result, length after) · "Log event"
  states    ok, due soon (warning), overdue (danger banner "Cut back before the next run"), retired
  used on   S30, S31; job Closure "Wire cut" writes a cut-back event
```

## Data display

```
DataTable
  features  sticky header and first column, horizontal scroll with fade edges, row click opens the record, column visibility menu,
            sort on header click (aria-sort), virtualised rows above 200, density compact (36px rows) / comfortable (44px)
  states    loading (6 skeleton rows), empty (icon + one line + primary action when allowed), filtered-empty ("No jobs match these filters — Clear filters"),
            error (danger banner + Retry), restricted (LockHint card in place of the table)
  tokens    header bg surface-2, font label; rows border-b border; hover bg surface-2; selected bg info-subtle
  a11y      a real <table>; caption (visually hidden); row action is a link in the first cell so keyboard users can open it
  used on   S08, S10, S11, S16, S17, S18–S20, S09

JobCard (board row)
  parts     ticket (display lg, accent-text; "No ticket yet" in text-subtle italics) · well · rig · dates (mono) · SDM · account/area · primary service ·
            4 stage ProgressBars with labels · efficiency "92% eff" · StatusPill · overflow menu (Open, Duplicate, Delete)
  states    default, hover (border-strong), focus-visible (whole card is a link), draft (dashed border)
  used on   S03

StageTabs (job editor)
  parts     4 cards: number (mono) · stage name (display lg upper) · subtitle · % · mini progress
  states    active (border accent, bg surface-2), done (success check), default, hover
  a11y      role="tablist"; each card role="tab" aria-selected; panels role="tabpanel"; ←/→ to switch; the URL holds the stage
  used on   S04–S07

KpiTile
  parts     label (font label) · value (font kpi, colour by meaning: success/danger/text) · caption (xs, text-subtle) · optional delta
  states    loading (skeleton), no-data ("—" + "No hours recorded")
  used on   S13, S14, S15, S18, S19

Gauge (semicircle)
  parts     value %, needle, target tick, label
  a11y      role="img" with aria-label "Fleet efficiency 95.8 percent, target 25 percent audited"
  used on   S13

Chart (bar / line / combo / horizontal bars)
  rules     colours from chart-1..6 in a fixed order; gridlines border; axis labels xs text-muted; a tooltip card on hover and focus;
            each chart has Print and XLSX in its header; clicking a bar opens a drill-down Drawer with the job list
  a11y      every chart has a "View as table" toggle rendering the same data in a DataTable; focusable bars (Tab / arrows)
  used on   S10, S13, S14, S15, S16

Heatmap (utilization)
  cells     heat-green ≥75 · heat-yellow 50–75 · heat-orange 25–49 · heat-red <25 · "—" no data; text on-heat; the value is always printed in the cell
  used on   S15

Banner
  variants  info, warning, danger, success
  parts     icon · message · optional action ("View list", "Show") · optional dismiss
  tokens    bg *-subtle, text *, radius md, border-l 3px in the fg colour
  a11y      role="status" for info and success, role="alert" for danger; dismiss remembered per user
  used on   S02 jobs without dates, S10 tracking gaps, S13 missing hours, S29 below par, S30 wire due

Toast
  variants  success, error, info · max 3 stacked bottom-right, 5s (errors stay until dismissed)
  a11y      aria-live polite (assertive for errors)
  used on   save results, exports ready, permission errors
```

## Schedule

```
GanttGrid
  layout    sticky left column 220px (unit code display md, kind, ACTIVE/INACTIVE pill, wire spec lines in mono xs) ×
            day columns min 36px (weekday letter + date; weekend columns bg surface-2; today column border-x accent)
  JobBar    bg {status}-subtle, border-l 3px {status}, text {status}, label "ticket · well", radius sm, h 26, stacked lanes when jobs overlap on a unit
  states    default, hover (raise + tooltip: ticket, well, dates, SDM, service), selected, dragging (shadow pop, ghost at origin), drop-invalid (danger outline),
            canceled (hidden unless toggled; strikethrough)
  BlockBar  maintenance and status events: blocked-subtle with a 45° hatch of blocked, label "Maintenance" / "On loan" / "Transferred" / "Junk"
  interact  drag body to move (duration kept), drag edges to resize; Shift+arrow keys move the focused bar by a day; Alt+↑↓ changes unit
  a11y      the grid is role="grid"; each bar is a focusable button with aria-label "Job S-1001, TEST-1, 20 to 21 Oct, ongoing, unit SLK-01";
            keyboard moves are announced; a "List view" toggle shows the same data as a table
  empty     "No units yet — add one in Database" (ops managers get the link)
  used on   S02
```

## Overlays

```
Dialog (modal)
  sizes     sm 400 · md 560 · lg 800 · full under md
  parts     title (display lg) · body · footer (secondary left of primary; destructive uses danger-solid)
  a11y      Radix Dialog: focus trap, Esc closes, focus returns to the trigger, aria-labelledby the title
  used on   S37, S38, S39, S40, S22, S36, confirm-delete

ConfirmDialog
  rule      irreversible actions (delete job, undo movement, send) require it; type-to-confirm for delete when the job has data

Drawer (side sheet)
  width     480 (drill-downs, filters on mobile, history)
  used on   chart drill-downs, 8MF History, Pre-Job Note history

Popover / Tooltip / DropdownMenu
  tooltip   300ms delay, also on focus; never the only place important information lives
```

## Documents and records

```
IncidentCard (8 Min. Facts)
  parts     header "Incident 2" · SeverityPill (auto from NPT) · NPT readout · move up/down · collapse · remove
            fields: what happened (Textarea), date, time, NPT hours, what failed (repeatable asset + S/N rows), immediate actions, current situation,
            who was informed (client side, NESR side)
  states    expanded, collapsed (one-line summary), error (required fields), single (remove disabled)
  used on   S12

SeverityMatrix
  table of the 5 severity rows × NPT / people / assets; the row matching each incident lights up with "Incident 1, 3" chips
  marked "On screen only — not printed"
  used on   S12

VersionHistory
  list newest first: vN · who · when · Sent marker · "View" opens a read-only snapshot in a Drawer
  used on   S12, S26

JraQuestion
  parts     id (mono, e.g. A4) · question text · YesNoNA · points added (mono, warning when > 0)
  header    running score (kpi), approval level, progress n/33, Send for approval
  used on   S28

AttendanceGrid
  layout    sticky EID, name, title, account columns · 28–31 day cells 40px · summary column · Approve
  cell      code text (mono 11/700) on a code-tinted background; weekend bg surface-2; holiday bg info-subtle; leave-while-on-job danger corner flag with tooltip
  interact  click a cell for the code menu; multi-select mode: click / Shift-click a range, then pick a code; type a code letter to set it; arrows move between cells
  a11y      role="grid" with row and column headers; cell aria-label "Ahmed, 14 October, Present"
  used on   S17

InventoryTable
  rows grouped by category (group header row) · material + part no · SAP no (mono xs) · one numeric column per location (tabular-nums, right-aligned) · On order
  row actions Mobilize, Consume / Return, History; below-par rows get a warning left border (MCR)
  used on   S18, S19, S29

KnowledgeCard + LessonHero
  card      type pill · category pill · title (md/700) · summary (2 lines, clamp) · failure-type chips · date · reference (mono)
  hero      thumbnail (from the doc) · "Lesson of the week" label · title · summary · key action (accent-text label) · Present · Read
  present   full-screen slides, ←/→, Esc exits, a slide counter, large type (display)
  used on   S21, S43
```

## WIREGUARD link and reconciliation (new for SLK)

```
SyncStatus (header chip)
  states    fresh ("WIREGUARD · synced 14:30"), syncing (spinner), stale (>30 min, warning), unreachable (danger, "Using data from 13:45")
  action    click opens a popover with the last sync per resource and "Sync now" (allowed roles only)
  a11y      role="status"; changes announced politely
  used on   header, S46

ReadOnlySourceBadge
  "From WIREGUARD": a small info-subtle label with an external-link icon, shown on every field and list that comes from WIREGUARD
  (units, wires, drums, fields, rigs, job types). Opens the record in WIREGUARD in a new tab. The inputs are read-only.
  used on   S02 unit column, S04/S05 wire and drum pickers, S24 (WIREGUARD lists shown but not editable)

FindingRow (S46)
  parts     severity pill (info / low / medium / high) · check name · job link (ticket, unit, dates) · WIREGUARD run count · first seen · status
  states    open, explained (muted, the note on hover), resolved (hidden by default)
  used on   S46

SideBySideDiff (finding detail drawer)
  table     field | SLK Ops | WIREGUARD, with mismatched rows highlighted (warning-subtle) and the tolerance shown for numbers
  actions   Link runs to this job (Combobox of candidate runs) · Mark explained (Textarea, required) · Re-check · Open in WIREGUARD
  a11y      a real table with row headers; actions are buttons, the drawer is a dialog
  used on   S46

ReconSummary
  grid unit × month: SLK Ops jobs vs WIREGUARD runs, with a findings count; cells link to the filtered findings
  used on   S46
```

## Empty, loading and error states to build (the recon saw few of them)

| where | empty | loading | error / restricted |
| --- | --- | --- | --- |
| Schedule | "No units yet" + link to Database | grid skeleton | "Couldn't load the schedule — Retry" |
| Job board | "No jobs yet — create the first one" | 6 card skeletons | banner + Retry |
| Job editor | — | form skeleton | conflict banner (someone else changed it), offline banner |
| Job Log, Failure Roster, 8MF list | "Nothing here yet" / filtered-empty with Clear filters | table skeleton | restricted card |
| Dashboards | "No completed jobs in this period" per chart | chart skeleton | per-chart error with Retry, so one failure doesn't blank the page |
| Attendance | "No employees in this group" | grid skeleton | restricted card |
| Inventory | "No items in this category" + Add item (if allowed) | table skeleton | "Insufficient stock — 60 available" inline on the movement form |
| Reconciliation | "No movements to or from a well yet" (S20 was seen this way) | — | — |
| Knowledge Hub | "No lessons match" + Clear filters | card skeletons | — |
| Wire log | "No events logged for this wire" | — | overdue banner |
