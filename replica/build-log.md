# Build log

One line per screen: ID, date, status, what is missing, what was harder than expected.

## Milestone 1: vertical slice (branch `build/vertical-slice`)

Stack: Vite + React 19 SPA and a Hono API in one Cloudflare Worker (`@cloudflare/vite-plugin`), D1 + KV, a WIREGUARD service binding. In development the binding is answered by `mock-wireguard/`: WIREGUARD's real response shapes and country rule, its real reference lists (from its CSV exports), and fake test accounts only.

| ID | date | status | missing | harder than expected |
| --- | --- | --- | --- | --- |
| shell | 2026-10-24 | done | admin screens (2a) | — |
| S01 sign-in | 2026-10-24 | done | passkeys (WIREGUARD's are bound to its own host), "forgot password" link to WIREGUARD | WIREGUARD's `/auth/me` has no countries, so countries are worked out from the units WIREGUARD shows the user |
| S02 schedule | 2026-10-24 | partial | drag to move and resize, unit blocks UI, filters (2c) | long bar labels stretched the grid past the screen; fixed with fixed-minimum columns |
| S03 job board | 2026-10-24 | done | delete button | — |
| S04 design stage | 2026-10-24 | partial | DMR, program in place, third parties, service domain readout (2d) | create-on-first-save while the URL changes from `new` to the id, without losing typed edits |
| S05 preparation | — | stub | everything (2d) | — |
| S06 execution | 2026-10-24 | partial | job log, plug/fishing/survey sections, overpull (2d) | — |
| S07 closure | — | stub | everything (2d) | — |
| other screens | — | stub | per architecture.md milestones | — |

### Verified 2026-10-24

- **Unit tests:** `npm test`, 15 of 15. Covers metrics, field policy, stage completion, deny-by-default write rules and WIREGUARD role defaults.
- **Schema tests:** `replica/migrations/test_schema.py`, 30 of 30. Both migrations also apply to the local D1 through `wrangler d1 migrations apply --local`.
- **API smoke test (curl against `vite dev`):**
  - Sign-in: wrong password 401, inactive WIREGUARD account 403, no session 401.
  - Creating with nothing is refused; the job is created on the first value; a duplicate ticket is refused.
  - A Bahrain unit on a Saudi job is refused.
  - Efficiency: op 12 h, 58.3 %, run 75 %. A stale save gets a 409. Rig-down before rig-up is refused.
  - Services: unknown job type refused.
  - Access: a viewer reads but can't edit (403); an unknown write route gets 403; a Bahrain user can't see Saudi jobs (404) and sees only SL-38.
  - Sign-out ends the session; audit rows are written.
- **Browser (Playwright, 1440 and 390 px):**
  - Sign-in by keyboard; a wrong password shows a message.
  - Schedule: all 34 Saudi units, the job bar on the right days.
  - New job → first keystroke creates it → unit, dates, location, field, two services → execution times give 20 h, 90 %, 80 %. Rig-down before rig-up shows its error on the field.
  - Board; the viewer's read-only editor; no horizontal scroll at 390 px.
  - No console errors apart from the 401 the browser logs for the deliberate wrong-password test.

### Bugs found and fixed during the slice

- **Sign-out loop:** a 401 removed the cached session, which refetched and got another 401, forever. Replaced with `/api/session`, which answers 200 with the user or null.
- **Bounce after sign-in:** the cached "signed out" answer redirected back to sign-in before the new session was read. Sign-in now drops that cache.
- **Schedule width:** wider than the screen at 1440 px.

### Open observation (resolved in milestone 2)

- **Reported:** on the dev server's first boot, `PUT /api/jobs/:id/services` was refused as having no write rule (403).
- **Resolved:** the refused-write log line showed the real request was `PUT /api/jobs/<id>`. My test script had left out `/services`, so deny-by-default refused a route that really has no rule, which is correct. Nothing was wrong with the app, and the log line stays as a diagnostic.

### Screenshots

`replica/clone-screens/`: S01, S01-error, S02, S02-390, S03, S03-390, S04, S04-new, S04-viewer, S06.

## Milestone 2a: Users & Roles (S34)

| ID | date | status | missing | harder than expected |
| --- | --- | --- | --- | --- |
| S34 Users & Roles | 2026-10-24 | done | — | WIREGUARD can't list its users to a Viewer, so people appear after their first sign-in. An admin can pre-register a `NESR-` number with a role instead |

What it does:
- **People:** set the SLK Ops role, switch access on or off, add extra tabs (view or edit) per person, pre-register someone before their first sign-in.
- **Role permissions:** the role × tab matrix (view, edit, delete). Admin always has every right and isn't editable.
- **WIREGUARD sync:** see the next section.
- **Recent changes:** the audit of access changes.

Guards:
- nobody can change their own role or switch off their own access;
- the last active admin can't be removed;
- the Users & Roles tab can't be granted;
- reading the area is admin-only, not just writing.

Changes apply on the person's next click, because the role is loaded on every request.

**Verified 2026-10-24 (API):**
- bad username refused (400), duplicate (409);
- a pre-registered person keeps the SDM role at first sign-in, while their WIREGUARD role is Supervisor;
- an SDM can't read (403) or write (403) the area;
- an admin can't demote themself;
- a grant gives the viewer jobs:edit, but the field policy still drops fields that role may not edit;
- granting Users & Roles is refused, and so is editing the admin role;
- a matrix change is live on the next request; switching access off gives 403 on the next call;
- every change is audited (11 entries).

**Verified (browser, 1440 and 390 px):** all four tabs; the person's own controls are locked; the dialog closes with Escape; no sideways scroll at 390 px after one fix (the tab row now wraps).

## Milestone 2b: full WIREGUARD sync

| item | date | status | missing |
| --- | --- | --- | --- |
| wires, drums, runs, documents, alerts, settings, build stamp | 2026-10-24 | done | wire screens and KPIs that use them (milestone 3) |

Sync rules:
- **Runs:** pulled with `?status=all`, so runs awaiting approval reach reconciliation.
- **Approval status:** stored lower-case, because imported history writes `Approved`.
- **Cut-only rows:** `Maintenance Wire cut`, `SPOOL-AD` and document-sourced rows are flagged and never counted as runs, as in WIREGUARD.
- **Remaining length:** each wire gets it from its latest approved run.
- **Alerts:** WIREGUARD sends them unfiltered, so each gets the country of its wire or drum. Alerts with neither are admin-only.
- **Schedule:** runs and lists every 15 minutes; documents, settings and the build stamp on the hour; everything on demand.

**Mock data:**
- Built from WIREGUARD's exports by `scripts/make-wg-fixtures.mjs`: 81 wires, 73 drums, 1,210 runs, 1,283 tests and maintenance entries.
- **Every person pseudonymised** (51 names → "Supervisor NN", 5 usernames → NESR-95xxx), and checked: no real name is in `data.json`.
- Edge cases added on purpose: pending runs, two country-less runs, a capitalised `Approved`, a shop wire-cut row.

**Verified 2026-10-24:**
- **Full sync in 2.6 s:** 1,208 runs (the 2 country-less runs are invisible to the Viewer account, which is exactly the gap the open item describes); 1,207 real runs (4 awaiting approval) + 1 cut-only row.
- **Lookups and alerts:** approval statuses folded to `approved` / `pending`; 64 of 81 wires have a remaining length; 6 alerts got Saudi Arabia and 1 is admin-only.
- **Settings:** 5 settings keys + the build stamp stored.
- **Repeat sync:** the second sync changes no counts.
- **Unit tests:** 17 of 17 (cut-only rule, admin write rules added).

Schema change: `wg_active` added to `wg_documents` and `wg_notifications`, plus a drum index on documents. Made in `0001`, which is still undeployed. **From the first deploy on, schema changes go in new numbered migrations, never into 0001 or 0002.**

Tooling note: stopping a background dev-server task ends the shell, not Node. Check port 5173 is free before restarting.

## Milestone 2e: Reconciliation (S46)

| ID | date | status | missing | harder than expected |
| --- | --- | --- | --- | --- |
| S46 Reconciliation | 2026-10-24 | done | findings in the header banner and daily digest; SDM column in the summary | WIREGUARD's field tickets are placeholders (`LEG-BATCH-n`) and DRSS is per run, so matching had to fall back to unit + date + well. That fallback is the main path in practice |

How it's built:
- **Engine:** `src/shared/recon.ts`, pure functions with no database, tested on its own.
- **Worker:** `src/worker/recon.ts` loads the scope, stores findings by fingerprint and marks resolved anything that no longer shows.
- **Checks (9):**
  - high: no runs, drum on another unit, different wire;
  - medium: unlinked runs, dates outside, runs awaiting approval;
  - low: well/field/rig, job type not among services, depth/jarring/wire cut beyond tolerance (50 ft or 2 %, 5 min, 10 ft).
- **Actions** change SLK Ops only: link or unlink runs, explain (note of at least 5 characters), reopen.
- **Schedule:** a "Check now" button, plus a nightly cron (04:00 Riyadh) that pulls WIREGUARD and then reconciles every country.

**Verified 2026-10-24:**
- **Unit tests:** 32 of 32 (15 new): placeholder keys; the ±1-day window; DRSS beats unit + date; placeholders never match; ambiguity offers candidates; a well disagreement offers instead of matching; manual links win; countries are never mixed; each check fires and stays inside tolerance; unlinked groups have stable fingerprints.
- **End to end with the mock's real September 2026 runs (six jobs):**
  - A: 12 runs matched by DRSS, clean.
  - B: no runs.
  - C: matched by DRSS, wrong unit, date and well.
  - D: matched by unit + date + well; wire, service and depth differ.
  - E: linked by hand to a 2022 run awaiting approval; four findings.
  - The SL-33 run is unlinked.
- **Lifecycle:**
  - an explanation survives a re-check, and reopening works;
  - fixing job C resolved its 3 findings on the next check;
  - creating a job for the SL-33 run resolved the unlinked finding;
  - access: a role without the tab gets 403 on read and write; the Bahrain user sees no Saudi findings.
- **Browser (1440 and 390 px):**
  - the list, the severity tiles (which also filter) and the per-unit summary;
  - the drawer with the side-by-side comparison, runs table, explanation box and WIREGUARD link;
  - Escape closes it; no sideways scroll at 390 px.
  - Fixed: severity pills stretched across their column; the month picker ran full width.

## Administrator Manual review and adjustments (2026-10-24)

Full review: [admin-manual-review.md](admin-manual-review.md).

Decisions (user):
- bonus rules are configurable;
- revenue is entered on each job;
- the AI Agent comes in a later milestone;
- countries are set by the SLK Ops admin.

Pre-Job Notes access follows the manual.

**Changed in what was already built (2a):**
- **Countries per person, owned by the admin:** first sign-in seeds them from WIREGUARD; later sign-ins don't overwrite them; read on every request. Admins see every country.
- **Effective tabs = role + grants − removals.** Being on the SLK Contacts list opens Pre-Job Notes. Admins ignore removals.
- **Person dialog:** countries, tabs grouped like the navigation (role default / + view / + edit / remove), Remove from SLK Ops with a confirmation, and a link to WIREGUARD for the account itself. The People list gained role and access filters, a tab count and the SLK-contact mark.
- **Read rules, deny by default:** found during this review, and the most important fix here. A removed tab used to hide only the menu while `/api/schedule` still answered. Every read now needs a tab that opens it, and unknown reads are refused.
- **Jobs:** delete is refused (409, naming the note) while a Pre-Job Note exists.
- **Schema (still undeployed 0001):**
  - `tab_grants.effect` (grant/deny);
  - `jobs.revenue_cents` and `revenue_currency`;
  - `employees.is_slk_contact`, `contact_email` and `contact_mobile`;
  - `bonus_rules`, `bonus_role_splits`, `job_bonus_lines`, `ai_settings` and `ai_usage`.
- **Seed:** new menus `bonus`, `sales_dashboard`, `headcount_roster`, `ai_agent`, with role defaults from the manual. Pre-Job Notes is removed from the SLK supervisor and the deputy SDM, who can get it by grant.
- **Navigation:** Bonus, Sales Dashboard, Headcount Roster, AI Agent and Data export & import (stubs with their milestone).

**Verified:**
- **Tests:** unit 45 of 45 (new: effective tabs, contacts, removals, clusters, read rules, admin delete rule); schema 30 of 30; the new migration-trap test passes.
- **API:**
  - countries required and checked against WIREGUARD's countries;
  - a pre-registered SDM gets their countries, and widening applies on the next click;
  - a WIREGUARD-only Bahrain user is seeded with Bahrain, and an admin's change survives his next sign-in;
  - a removed tab gives 403 on its read, other reads stay 200, unknown reads give 403;
  - a duplicate tab is refused; removing yourself is refused;
  - after removing a person, their old session is dead, and their next sign-in starts from the default role;
  - deleting a job with a Pre-Job Note gives 409.
- **Browser:** the person dialog and the People list, with no sideways scroll at 390 px.

**Caught along the way:**
- I wrote a semicolon inside a SQL comment, WIREGUARD's D1 trap. It's fixed, and `tests/migrations.test.ts` now fails the build on that, window functions or chained `UNION ALL`.
- A hot reload once kept a half-edited Worker (the usage of a function arrived before its import) and every request returned 500. A restart cleared it; the code was right.

## Milestone 2c: schedule drag-and-drop and unit blocks

| ID | date | status | missing | harder than expected |
| --- | --- | --- | --- | --- |
| S02 schedule | 2026-10-24 | done | division/SDM filter | dragging redraws the bar in the row under the pointer, which replaced its element and lost pointer capture. The drag is now followed on the window |
| S37/S38 unit blocks | 2026-10-24 | done | — | — |

**Server:**
- **One path for every job change.** `applyPatch` covers the editor's autosave and the schedule's `POST /jobs/:id/move`: field rights, the conflict check, value checks, blocked days, audit. A move is all-or-nothing: if the role can't change one of the fields, nothing moves.
- **Blocked days refuse bookings** (User Manual §3.1): maintenance, loan, transferred and junk refuse a create, edit or move onto those days. "Backup on site" only marks.
- **Unit-event API:** create, edit, delete. A block over planned or ongoing jobs returns 409 with the jobs and needs `confirmOverlap`. Overlapping blocks are refused by the D1 trigger.
- **Deactivated units:** open jobs on a unit WIREGUARD no longer lists are returned with the schedule and shown in a red banner (Administrator Manual §4).

**Client:**
- **Mouse:** drag the body to another day or unit; drag either end to change the dates. A click without movement opens the job.
- **Keyboard:** Shift+←/→ moves a day, Alt+↑/↓ changes the unit, `[` and `]` change the end. Results are announced in a live region.
- **Unit block dialog:** with the confirm-over-jobs step, plus edit and remove.

**Verified 2026-10-24:**
- **API:**
  - a move keeps the duration; a stale move gets 409;
  - overlapping blocks are refused; a job on maintenance days is refused, both by move and on creation;
  - backup-on-site doesn't block; a block over a booked job asks first, then saves with confirmation;
  - a role without schedule edit can't move; a deactivated unit lists its open job.
- **Browser (mouse):**
  - grabbing the left handle moved the start +3 days, stopping at the end date;
  - a body drag went +3 days and to the unit under the pointer;
  - dragging the end handle took a day off; a click opened the job.
- **Browser (keyboard):**
  - Shift+→ onto a maintenance block was refused, which is correct;
  - Alt+↓ changed the unit, and `]` extended the end.
- **Block dialog and layout:** the booked-jobs warning → Save anyway → edit → remove; no sideways scroll at 390 px. Unit tests: 46 of 46.

**Bugs found and fixed:**
1. **Drags never saved.** The element was replaced mid-drag, so pointer capture was lost; the drag now uses window listeners.
2. **Quick successive moves lost.** The second one carried an old timestamp and got 409; the cache now takes the server's answer at once, and three quick `]` presses all landed.
3. **Audit lines lost field names.** A PowerShell here-string blanked `${k}` in a template literal. **Lesson:** never splice TypeScript through PowerShell expandable strings; use the editor tools.

## Milestone 2d: job editor complete (S04–S07)

**Server:**
- **Field policy:** covers every job field, by role group (planners, managers, field crew, preparation, quality); sign-offs go to the crew, reporting to SQM/SDM, revenue to SDM and Sales.
- **Checks:** values and references are checked on every patch: wire and drum from WIREGUARD (active, same country), PCE and grease panel (same country, active), report status, job package link.
- **Gates:** plug, fishing, survey and perforation open only with a matching service profile; the failure follow-up opens only with NPT or Failure = Yes. Both are enforced in the API, and the failure gate also as a database check.
- **Toolstring:** cleaned by `parseToolstring`; length, stem weight and largest OD are derived and stored so reports read one number.
- **New routes:**
  - `GET /jobs/:id/crew`, `PUT /jobs/:id/headcount` (caps 3/6/6/6), `PUT /jobs/:id/crew` (people from the job country's active roster, no duplicates);
  - `GET /jobs/:id/wire-options` (drums on the job's unit with their wire, MBL, remaining length, tests and WIREGUARD's tension-test window);
  - `GET /employees`;
  - `/lookups` now also returns the local lists, PCE, grease panels and service profiles.
- **Rules:** read and write rules for all of the above, deny by default.
- **D1 column limit:** D1 returns at most 100 columns per row, and `jobs` has 96. A full job is now read in two statements (the row, then metrics and services); the board selects only the columns it shows. **New job fields from here on go in side tables.**

**Client:**
- **Preparation:** well data, the drum and wire panel from WIREGUARD with pre-job test status (`preJobWireStatus`), pressure control (picking a set fills rating and lubricator length when empty), the toolstring builder with live clearance checks, head count and named crew.
- **Execution:** adds overpull, plug type (gated), operating time details, and the fishing, memory survey and perforation sections (gated).
- **Closure:** sign-off, ticket value in USD (stored in cents), bonus remarks, and the failure follow-up (locked until NPT or Failure = Yes).
- **Design:** adds DMR, Program in place and Third party.
- **Stage percentages:** cover all four stages.
- **Autosave on exit:** leaving the editor now saves what is still waiting.

**Dev data:** `scripts/dev-seed.sql` holds fake people, PCE and grease panels for local use only.

**Verified 2026-10-25:**
- **API:**
  - head count over the cap is refused, and so is crew from another country;
  - crew slots are numbered per role;
  - the toolstring stores derived totals (10.8 ft, stem 60 lb, OD 1.5 in);
  - revenue is saved in cents;
  - plug type without a plug service is refused, and so is a GEARS number without NPT;
  - the board lists jobs with 47 columns.
- **Browser:**
  - Preparation shows WIREGUARD drum MOL 148 with wire CWR-1970, and flags its tension test as 569 days old;
  - picking the drum saves the drum and the wire together;
  - typing 1.5 in minimum restriction shows the OD warning at once;
  - a third toolstring part with a 1.875 in OD updates Max OD and saves;
  - Closure shows revenue as 12500 USD, with the follow-up locked; after NPT = 2 it opens, and a GEARS number saves.
- **Unit tests:** 57 of 57.

**Bug found and fixed:** the first job creation returned a 500 ("too many columns in result set"); this led to the D1 change above.

## Milestone 2f: Equipment Database (S24)

**Server (`/api/database`):**
- **Read:** one call returns WIREGUARD units (read-only, with drums and open-job counts), PCE and grease panels (with open and total job counts), local lists including hidden values, every WIREGUARD job type with its service profile, and the service domains.
- **PCE and grease panels:** add, edit, switch off and on, remove.
  - Switching off something open jobs still use answers 409 with the count; it saves on a second, confirmed request (Administrator Manual §4).
  - Removing is refused once any job has used it; switch it off instead.
  - Labels are unique per country.
- **Lists:** add (appended to the end), rename, hide and show, move up and down (swaps with the neighbour). Renaming doesn't rewrite jobs that saved the old text, and the editor still shows a saved value that left the list.
- **Service profiles:** upsert per WIREGUARD job type, for job types in the caller's countries only; domain from the fixed list.
- **Rights:** reading needs the Database tab; changes need its edit right, and removals its delete right. Everything writes to the audit log.
- **Lookups:** now return switched-off PCE and panels too, so a job keeps showing its equipment by name, marked "(switched off)"; new jobs can't pick them. Service profiles carry their domain.

**Client:**
- **Database screen:** tabs for Units, Pressure control, Grease panels, Lists and Service profiles, plus a country filter for people with more than one country.
  - Pressure control shows the days since the last pressure test and flags tests that are due (over 180 days, or never recorded).
  - Equipment is added and edited in a dialog with the confirm-to-switch-off step.
  - Lists are edited inline.
  - Service profiles save on each change.
- **Job editor:** Design shows the service domain under the picked services.

**Verified 2026-10-25:**
- **API:**
  - adding PCE works; a duplicate label, a 7,000 psi rating and another country are refused;
  - switching off PCE-5K-01 (used by an open job) asked first; removing it was refused;
  - a list value was added and moved; a profile for an unknown job type was refused.
- **Browser:**
  - Units lists 35 units with drums and open jobs;
  - switching off PCE-5K-01 in the dialog showed the warning, and "Switch off anyway" saved it;
  - the job then showed "PCE-5K-01 · 2.5 in bore (switched off)";
  - a jar type was added and moved up; the Fishing flag on Gauge Cutter was toggled on and off;
  - Design showed the domain for two services;
  - no sideways scroll at 375 px on any tab.
- **Unit tests:** 63 of 63.

## Milestone 2g: Job Log (S08)

**Shared:**
- **`filters.ts`:** the standard filter bar for this screen and the later statistics screens (S10, S13–S15): status plus nine dimensions (year, month, account, area, service domain, service, SDM, unit, conveyance). Values travel as repeated query parameters and become SQL in one place, each condition binding one JSON list.
- **`jobLog.ts`:** one column list (34 columns) drives the table, the XLSX and the CSV. Codes show as words, and lists (services, crew per role, third parties with PO) are joined. **Revenue is left out on purpose:** it belongs to the restricted Sales Dashboard.
- **`xlsx.ts`:** a dependency-free XLSX writer: zip with stored entries and CRC-32, a bold frozen header, autofilter, column widths, and numbers kept as numbers. Text is always written as text, never as a formula. The CSV gets a BOM and a leading apostrophe on values that start with `=`, `+`, `-` or `@`.

**Server:**
- `GET /api/job-log` (up to 5,000 rows, with a truncation flag; search by ticket, well, rig or DRSS) and `GET /api/job-log/options` (only values that occur in the caller's jobs).
- Both need the Job Log tab.

**Client:**
- **Job Log screen:** filter bar (dropdowns of checkboxes, with search when a list is long; filters live in the address so a view can be shared), search, Print, CSV and XLSX.
- **Table:** sticky header and first column; a row (or Enter) opens the job.
- **Print:** the app header, section nav and filter bar are hidden; the date and active filters are printed instead.

**Verified 2026-10-25:**
- **API:** the options list the units, services and domains in use; unit + status + service narrows to one job; domain + year + month works.
- **XLSX:** a real file from the API data opens in .NET (every part parses as XML) and in Excel, read-only: sheet "Job Log", range A1:AH6, frozen header, autofilter on, NPT read as a number.
- **Browser:**
  - 5 jobs and 34 columns; picking unit MSL-022 put `?unit=MSL-022` in the address and narrowed the list to 2;
  - the dropdown closes on an outside click, and Clear appears;
  - the playwright screenshot showed the layout as intended, with no page-level sideways scroll.
- **Unit tests:** 72 of 72.

**Not checked:** the print layout in a real print preview.

## Milestone 2h: 8 Min. Facts (S11, S12) and Failure Roster (S10)

**8 Min. Facts:**
- **Severity bands** live in `src/shared/emf.ts`, the same as the generated `incidents.severity` column: none → Negligible, under 4 h Light, 4–24 h Serious, 24–48 h Major, over 48 h Catastrophic. A report takes its worst incident.
- **Saving:** every save is checked (`cleanReport`) and written in one batch:
  - the report and its incidents; incidents are updated in place by id, so roster rows survive a reorder;
  - an immutable version snapshot; a stale `expectedVersion` gets 409;
  - the job: NPT = the sum of all its 8MF NPT, Failure = Yes, 8MF = Yes;
  - one roster row per incident (upsert on `incident_id`); action status and notes survive edits.
- **Log numbers:** EM-0001, EM-0002 … per country.
- **Sending:** the screen opens the mail app with a plain summary, then `POST /emf/:id/sent` records it. Editing after sending makes a new version and puts the report back to Saved, with the earlier send still shown.
- **Exports:** Print/PDF uses a print stylesheet (collapsed incidents print expanded; the matrix and buttons are hidden). Word is an HTML `.doc`, with no library.
- **Editor:** ticket search prefills rig, well and crew; incident cards can be reordered, collapsed and removed, with an auto severity pill; a "what failed" list; report totals; the severity reference with the current row highlighted; a History panel to read any version; a warning on leaving with unsaved changes.

**Failure Roster:**
- **Filters:** the standard bar applies to the linked job; severity (including "No 8MF") and action status are added.
- **Chart:** failures by month, last 12 months, major-or-worse stacked. Click a month to list it, with per-month Excel, PDF and CSV.
- **Tracking gaps:** a warning lists jobs with NPT but no 8MF, and jobs with failure but no roster row, with links.
- **Hand-added rows:** for events without a report. They can be removed; rows from a report can't, and their category and severity are edited in the report.
- **Action status** (Open / In progress / Closed) is set inline.

**Filter options** moved to `GET /api/filter-options`, open to any signed-in user but limited to values from their own jobs. Only the options handler is shared, not the Job Log itself.

**Verified 2026-10-25:**
- **API:**
  - incidents of 6 h and 30 h give 36 h, Major (Serious + Major); the job became NPT 36, Failure Yes, 8MF Yes; the roster got 2 rows;
  - setting a roster row to In progress survives an edit that reordered, dropped and added incidents (v2, back to Saved after Sent; job NPT 4);
  - a stale save gets 409; v1 is still readable; category edits on an 8MF row are refused; a hand-added row works.
- **Browser (playwright):**
  - a new report on ticket M-1 with 5.5 h + 26 h showed 31.5 h, Major, live, with the Major row highlighted;
  - Save went to EM-0002 v1 at its own URL;
  - the roster listed the rows, and clicking Nov 26 filtered to 4.
- **Unit tests:** 78 of 78.

**Not checked:** the Word file in Word, and the mail app hand-off (it depends on the machine's mail client).

## Milestone 2i: Operation Statistics (S13) and NPT & Failure Analysis (S14)

**How it's built:**
- `GET /api/stats` returns the rows: non-canceled jobs with a start date, filtered by the standard bar and the period. Each row carries its services, domains and crew (supervisors and operators), plus the active units and the unit events in range. It's readable with any of the Statistics, NPT Analysis, Utilization or Competency tabs.
- Every figure is computed in `src/shared/stats.ts`, so each bar or gauge knows the job ids behind it:
  - KPIs: fleet efficiency = op ÷ (op + NPT); average run efficiency per job; failure rate;
  - `groupBy` (one job can fall in several buckets, e.g. services) and `byMonth` (fills empty months);
  - `unitUtilization`: available days = calendar days minus maintenance, loan, transferred and junk; active days = arrival or start to end, plus mob −1 and demob +2, never counted twice;
  - missing data (completed jobs without hours or runs); wellsite audit compliance per SDM against 25 %.
- **Charts** are plain HTML bars with a hidden data table for screen readers. Each chart has its own Print (prints only that chart, via a body class) and XLSX; clicking a bar toggles the job list.

**Screens:**
- **Statistics:** period presets (This month, 3 months, Year to date, All time); KPI tiles (jobs, op hours, NPT, fleet efficiency, average run efficiency, average unit utilization); fleet-efficiency gauges by account (the SLK stand-in for "division"); the missing-data warning with its list; 12 charts (six monthly trends, six breakdowns); audit-compliance gauges per SDM with a target tick.
- **NPT Analysis:** KPIs (total NPT, jobs with NPT, failures, failure rate, fleet efficiency); NPT by month, area, account, service, crew member and unit; the list of jobs with NPT or a failure; report print and XLSX.

**Dev data:** `scripts/make-dev-jobs.mjs` generates 120 fake 2026 jobs with services and crew (deterministic). The generated SQL is git-ignored and local only.

**Verified 2026-10-25 (playwright, dev data):**
- Statistics for All time: 120 jobs, 2,915 op h, 247.3 h NPT, 92.2 % fleet efficiency, 93.3 % run efficiency; canceled jobs are left out; gauges, charts and audit gauges render.
- NPT Analysis filtered to account D&WO: 67.7 h NPT over 8 of 37 jobs, 3 failures, 8.1 % failure rate; the breakdowns and the job list match.
- **Unit tests:** 88 of 88, including the utilization example (6 active of 21 available days = 28.6 %).

**Not checked:** a bar drill-down click in the browser (my selector didn't match the bar's accessible name; it's covered by the shared bucket ids instead), and single-chart printing.

## Milestone 2j: Attendance (S17), Headcount Roster (S44) and the SLK Contacts list

**Schema:** migration `0003_attendance_codes.sql` rebuilds `attendance_entries` so its check allows **JO** (Field Bonus without Food). Recon had misread the manual's legend as "30"; the recon text is corrected too.

**Attendance:**
- **Who sees what:** people with the Attendance edit right see and edit the whole sheet for their countries. Everyone else with the tab sees only their own row, linked through `employees.wg_username`, read-only (the manual's simplified crew view). All five statements bind the same five parameters; D1 refuses a bind count that doesn't match.
- **Saving:** `PUT /attendance` saves a batch of cell changes, all or nothing: codes and days are checked, people must be in the caller's countries, and approved rows are refused.
- **Approval** locks a person's month until it is unapproved.
- **Holidays** are kept per country in the sheet's Holidays dialog. Islamic holidays move every year, so they are entered when announced, not seeded.
- **Grid:**
  - groups by reporting line, each with its own XLSX; a sticky name column; weekday letters;
  - Fri/Sat and holiday shading; a dot on days the person is crewed on a job; a red outline for a leave code on a crewed day, with a tooltip naming the tickets;
  - a per-cell code menu; Multi-select with Shift-click rectangles and Apply or Clear;
  - pending cells show underlined until Save; leaving with unsaved changes warns;
  - a summary column (on, field and leave days), XLSX of everything and an HTML export.

**Headcount Roster:**
- The single people list. Add and edit EID, name, title, account, crew role, reporting line, rotation, WIREGUARD username, contact email and mobile, and active.
- Someone who was ever on a job crew can only be switched off; others can be removed.
- An **SLK contact** must have a WIREGUARD username, so Pre-Job Notes access (already checked at sign-in) follows them. The "SLK contacts" tab is the Contacts list.

**UI fix across screens:** `inputSized()` drops the default full width when a width is given. Narrow filters and selects had been stretching, because `w-full` could win in the CSS order.

**Verified 2026-10-25:**
- **API:**
  - month read (31 days, 8 people, crew assignments); a 3-cell save;
  - a day outside the month is refused; approving locks the row and unapproving unlocks it;
  - a holiday is added; a contact without a username is refused; a duplicate EID is refused;
  - removing a person who is on 61 crews is refused.
- **Browser (playwright):**
  - a Shift-click range of 5 cells → JBFS → Save (5) → summary "5 field";
  - a single cell set to P through the code menu showed Save (1); leaving raised the unsaved-changes warning;
  - a leave-on-crewed-day cell (SL on the 5th) shows the red outline.
- **Unit tests:** 98 of 98.

**Not done:** attendance categories with an approver email (a could-have in the manual), left for milestone 6.

## Milestone 2k: Explosive inventory (S18, S20, S39), with Hardware (S19) and MCR (S29) from the same module

**One module, three inventories.** Each has its own tab and its own read and write rules, so explosives stay apart from slickline hardware (the storekeeper-only-hardware case from 2026-10-24 still holds). One country is shown at a time. A country opening an inventory for the first time gets the standard locations.

**Ledger** (`src/shared/inventory.ts`, `src/worker/inventory.ts`):
- **Balances** come from the `inventory_balances` view. Movements are never edited or deleted, and the existing trigger refuses any move that would take a location below zero ("Not enough stock … nothing was moved").
- **`checkMovement`** fixes which kinds can go where:
  - receive (delivery or on order → on hand), order, transfer (on hand ↔ on hand);
  - mobilize (on hand → at well), consume (at well → used), return (at well → on hand); these three need a job or a well;
  - junk; count adjustment (adds to, or takes from, one location).
- **Movements** carry several items in one batch. Each line gets a client id derived from the request id, so a retried request is ignored rather than doubled.
- **Undo** writes the mirror movement (`reverses_id`). It is refused for an undo, for a movement already undone, or when the stock has already moved on.
- **Reconciliation** (S20): per job, well and item, mobilized vs consumed + returned + junked. An undo comes off the column it reverses. A completed job with stock still out is flagged.
- **MCR:** a par level per item and a below-par banner.

**Screen:**
- KPIs: on hand, at a well, used, junk, on order, received to date; category pills; search by description, PN or SAP number; an archived toggle.
- A grouped table with a column per stock location; add and edit items, archive and restore; CSV and print.
- **Mobilize to well** (choose items, quantities checked against what's available, job search or well); **Consumption & return** (pick a job or well, see what's still out, enter used and back-to-stock); other movements from a menu.
- **Movement history** with undo, and **Job reconciliation**.

**Verified 2026-10-25:**
- **API:**
  - receive 10 → mobilize 4 to W-1234; repeating the same request id did not double it;
  - consume 3; consuming 5 more was refused with nothing moved; consuming from the bunker and mobilizing without a well were refused;
  - undoing the consume nets out in reconciliation (4 / 0 / 4 open); a second undo says it was already undone;
  - Bahrain hardware got 8 default locations on first open.
- **Browser (playwright):** Consumption & return on W-1234 (3 used, 1 back) gave on hand 7, used 3, at a well 0; reconciliation reads 4 = 3 + 1 + 0, nothing open.
- **Unit tests:** 105 of 105.

**Not done:** the prompt to mobilize explosives from a job with an explosive service (a could-have).

## Milestone 3a: quick wins and catch-up

- **Country switch** (stands in for the original's country picker at sign-in): a header select for people with more than one country. The client sends `X-SLK-Country`; `resolveSession` narrows `countries` to that one only if it is among the person's countries (`allCountries` keeps the full list). Every screen and export follows without page-level code.
- **WIREGUARD password links:** "Forgot your password?" on the sign-in page, through a small public `/api/public-config` registered before the session middleware, and "Change password" in the header. Passwords stay in WIREGUARD.
- **Delete job:** a two-step button in the editor for roles with the jobs delete right. The API refuses while a Pre-Job Note exists (Administrator Manual 8.1) or while 8 Min. Facts exist (their roster rows belong to the job); the answer suggests Canceled instead.
- **Schedule:** SDM and account filters change which bars are drawn; units and blocks stay, so free days remain visible.
- **Feature matrix catch-up:** marked rows that earlier milestones had already built (service catalogue, slickline execution fields, separate inventory rights, memory survey, Failure Roster exports, the pre-job wire panel).

**Verified 2026-10-25 (API):**
- deleting the DEV-W1 job was refused because it has EM-0001;
- `X-SLK-Country: Bahrain` narrowed the countries to Bahrain (0 jobs) while keeping both in `allCountries`; an unknown country was ignored;
- the public config answers without signing in.

**Still open on the must list:** deploying to Cloudflare and the real WIREGUARD sync account, both waiting on the user.

## Milestone 3b: Pre-Job Notes (S09, S26, S27) and JRA (S28)

**JRA:**
- **The template is data.** `jra_templates` holds one per country, and a JRA keeps the template it started with. The default (`SLK-JRA` rev 1: 29 questions in five sections, points per risky answer, approval SDM < 20 ≤ Operations Manager < 35 ≤ Country Manager) was written for slickline here. It is **not** NESR's QAF12069; NESR can load its own form as a new revision.
- **Answering:** Yes/No/N-A, saved as you go while in draft; live Risk Index, approval level and progress.
- **Send for approval** needs every required answer and an active SDM or manager. The named approver, or an admin or operations manager, approves or rejects; rejecting needs a reason and returns the JRA to draft. Approved answers are locked.
- **Execution gate** (manual §4.2): a job with an explosive service, H₂S, wellhead pressure of 5,000 psi or more, or a special setup refuses Execution fields until its JRA is approved. This is enforced in `gateCheck`, and the editor greys the fields and shows the banner on Preparation and Execution. `EXECUTION_FIELDS` is now shared from `fieldPolicy`.

**Pre-Job Notes:**
- **One note per job:** five sections, prefilled from the job (dates, toolstring, run details) and with standard SLK reminders written here.
- **Required fields** (manual §3.7): rig type, RDD department, casing, suite # and main contact. Contacts must be on the country's SLK Contacts list.
- **Saving:** every save is an immutable version, and a stale save gets 409. A save after sending goes back to Not Sent.
- **Numbering:** PJN numbers sit above both the counter and any number already used. This came from a bug: an old test note had taken PJN-0001 without the counter, so the first create failed.
- **Confirm & Send:** Subject, To, and Cc defaulting to the other contacts; the mail app with the text on the clipboard, or a `.eml` draft with an HTML body. The PDF comes from Print, not attached automatically.
- **List:** search, status, date range; select rows to export XLSX or print several notes one after another.
- **Admin delete:** two confirmations (a warning, then the typed log number). The versions go through `ON DELETE CASCADE`; the immutability trigger only guards a note that still exists, which the test proves.

**Verified 2026-10-25:**
- **API:**
  - required-field message; create, send, edit (v2, back to Not Sent); a stale save gets 409; v1 is readable;
  - job delete is refused while a note exists; admin delete with the wrong log number is refused, with the right one it removes the note and 0 versions remain;
  - numbering continues at PJN-0003;
  - H₂S on a job blocks rig-up until the JRA is approved; sending is refused while answers are missing.
- **Browser (playwright):**
  - JRA answered → sent to the SDM → approved by admin → the Execution banner reads "JRA approved" and rig-up is editable (it was disabled before);
  - the Design panel shows "Open Pre-Job Note" and opens the editor.
- **Unit tests:** 115 of 115.

## Milestone 3c: Utilization (S15) and Competency (S16)

**Data:** `GET /api/stats/people` returns the active roster and every crew assignment (non-canceled), with services and domains. It's readable with the Utilization or Competency tab. The calculations live in `src/shared/people.ts`.

**Utilization:**
- **Crew:** each month, every field person (supervisor, operator, assistant, helper) gets busy days ÷ on-duty days. Busy days run from arrival or start −1 to end +2, each day counted once; on-duty days follow the rotation share (60/30 = ⅔). Idle people count as 0 %, and nobody goes above 100 %.
- **Fleet:** `unitUtilization` per unit per month, as in 2i.
- **Screen:** KPIs (fleet, crew, jobs, op hours, busiest and least used unit); crew and fleet monthly charts; a unit × month heatmap with the manual's bands (≥75 / 50–75 / 25–49 / <25) and tooltips for jobs and active and idle days; the methodology in plain words; XLSX and print.

**Competency:**
- **Levels:** completed jobs without a failure, per person per service: Basic <10, Intermediate 10–19, Advance 20–29, Expert ≥30.
- **Screen:** an overview by level; bench strength (a service with ≤1 person at Advance or above is flagged as a gap); people within two jobs of the next level; a service-domain roll-up; successful crew jobs per month; person cards with the quality signal (fail % of completed jobs, NPT per job); filters by service, person and role; XLSX of the person × service matrix.

**Verified 2026-10-25:**
- **Playwright, dev data:**
  - Utilization YTD: 35 units, fleet 5.9 %, crew 65.2 % across 7 field people, 115 jobs, busiest SL-33 (23.2 %); the heatmap and charts render.
  - Competency shows 100 person-service pairs, all Basic (the fake data has few jobs per service), the gap list and near-threshold entries.
- **Unit tests:** 123 of 123. One expected value in a new test was wrong (5 busy days, not 4) and was corrected; the code was right.

## Milestone 3d: Wires (register, detail) and Wire KPIs with a parity test

**Data:**
- **Migration `0004_wg_raw_rows.sql`** keeps WIREGUARD's raw rows for drums and alerts, plus the alert's resolved date, as was already done for wires, runs and documents. The sync now stores them.
- **`GET /api/wires/data`** returns WIREGUARD's own rows for the caller's countries:
  - a document takes the country of its wire or drum; alerts without a country go to admins only, as in WIREGUARD;
  - it also returns the KPI and SOP settings, the WIREGUARD build stamp, and whether it matches the build the port was verified against.
- **Payload:** about 1.9 MB of JSON on the mock data (compressed in transit), cached for 5 minutes on the client. Worth revisiting if the history grows a lot.

**Port (`src/shared/wireKpis.ts`):**
- WIREGUARD's `keysToCamel` (with its acronym overrides), `v2DateParts`, `v2DaysBetween`, the SOP fallback table and `v2SopNum` / `v2KpiParam` / `v2KpiEnabled`, `v2Derive` (per-run trips, impacts and minutes since the last cut, used-wire limit, tension utilisation, pre-job test status), `v2ComplianceScore`, `v2WireRemaining`, `v2MpiStatus`.
- **18 KPIs:** G1–G6, C12, C1–C6, J7, J9, M5, W14, W1. The integration note said 17, but its own list has 18. Each follows its WIREGUARD counterpart line for line and returns numbers instead of HTML. A KPI switched off in WIREGUARD's kpi-settings is hidden.

**Parity test (`tests/wireKpiParity.test.ts`):**
- Reads WIREGUARD's `v2-patch.js` (set `WG_V2_PATCH`, or the sibling checkout) and cuts the needed functions out by their own markers, not line numbers. It stubs only the rendering helpers and runs both engines on the 1,209-run mock data.
- **Result:** the derivation is identical for every run, and the tiles, notes and lists match for every ported KPI. It's skipped, with a label saying so, when WIREGUARD's source isn't present.
- **Build watch:** `KPI_VERIFIED_BUILD = 2026-10-22T03-00`. When WIREGUARD's `app-build` stamp differs, admins see "WIREGUARD updated — KPI parity not yet re-checked". The mock reports 2026-10-19, so the banner shows locally, which is correct.

**Screens:**
- **Wires** (replaces Cable Summary): register with remaining length (lowest first), runs and life %, latest test, drum MPI, open alerts; search, unit and status filters; Open in WIREGUARD.
- **Wire detail** (replaces Cable Book): remaining, drum and unit, life consumed, trips, impacts and minutes since the last cut, hours, used- or new-wire tension limit; pre-job test status for today; runs with per-run rule checks; tests and inspections; alerts.
- **Wire KPIs:** General and Compliance tiles with codes; C1 failure reasons; monthly C1–C4 adherence (latest 24 months); J7 utilisation bands; J9 by month; M5 bands with the late wires; W14 with the metric switch; W1; the link to the full WIREGUARD dashboard.

**Verified 2026-10-25:**
- **Parity:** 8 of 8 cases pass against WIREGUARD build 2026-10-22.
- **Browser (playwright, synced mock):**
  - the register lists 79 wires; opening 1514 shows 14,496 ft, 40.5 % life, 50 % MBL limit (used wire);
  - Wire KPIs: G1 1,207 runs, C12 76.8 %, C1 17.6 % with the failure reasons, C6 2.7 %, J7 36 runs over the limit; the parity banner shows for the admin.
- **Unit tests:** 134 of 134 (including the parity cases).

## Milestone 3e: Job Log sequence of events (S42), Full Job Report and Job Package (S41)

- **Sequence of events:** `GET/POST/DELETE /api/jobs/:id/events`. Each entry has a time, an optional run and depth, and text. The client makes the id, and `ON CONFLICT (job_id, client_id) DO NOTHING` makes a retried upload harmless. The panel sits on Execution and follows the JRA lock.
- **Offline:** entries go into a device queue (localStorage) first and upload straight away. If the network fails they stay, with a banner, and upload on the browser's `online` event or with "Upload now". A server refusal is dropped with its message; a network failure keeps the entry.
- **Full Job Report** (`/operation/jobs/:id/report`, linked from the editor header): Design, Preparation (with crew, JRA and Pre-Job Note), Execution, the sequence of events, 8 Min. Facts, and Closure on one printable page. Revenue is left out.
- **Job Package:** a zip made in the browser with the existing zip writer: `report.html` (self-contained), `job.json`, and CSVs of the events, toolstring and crew.
- **Matrix:** "wire cut on the job vs WIREGUARD runs" was already covered by the 2e `value_mismatch` check.

**Verified 2026-10-25:**
- **API:** the same client id posted twice gives one entry; a bad time is refused.
- **Browser (playwright):** with the page's `fetch` failing, a new entry stayed queued ("1 entry is kept on this device…"). After restoring the network and firing `online`, the queue emptied and the entry is listed. The report shows both entries and every section.

**Not checked:** opening the downloaded zip (the same zip writer is already proven by the XLSX files opening in Excel).

## Milestone 3f: reconciliation per SDM, banners and the morning digest

- **Per SDM:** `/api/recon/summary` also returns, for each SDM, the jobs in the month and the open findings on their jobs. The Reconciliation screen shows a "Per SDM" table (counts link to the filtered list) and an SDM filter; the findings API already accepted `sdm`.
- **Banner:** on the Schedule and Job board, for people with the Reconciliation tab, when high-severity findings are open, with a link to the filtered list.
- **Digest** (`src/shared/digest.ts`, pure and tested):
  - SDMs get the findings on their own jobs plus every high one in their countries; managers and admins get high and medium. New ones are marked; with nothing to report, nothing is sent.
  - `sendDigests` runs after the nightly reconciliation. Recipients are active SDMs, deputy SDMs, operations managers and admins whose roster entry (linked by WIREGUARD username) has a contact email.
  - It sends through the Cloudflare Email Service binding `EMAIL` (`send_email` in `wrangler.jsonc`, sender `EMAIL_FROM = slkops@nesrapp.com`) and records the outcome in the audit log.
  - "Your morning digest" on the Reconciliation screen shows the person the same text.

**User action before it can send:** onboard the sender domain with `npx wrangler email sending enable nesrapp.com` (WIREGUARD already sends from `nesrapp.com`), and put contact emails on the roster entries of the people who should receive it.

**Verified 2026-10-25 (local):**
- Triggering the 04:00 cron through `/cdn-cgi/handler/scheduled` ran sync → reconciliation (22 findings: 18 high, 4 medium, 9 per SDM) → digest ("0 sent, 2 without an email on the roster").
- The preview shows "SLK Ops reconciliation: 22 open findings (22 new)" with the lines, highest severity first.
- **Unit tests:** 138 of 138.

**Not checked:** an actual email delivery (needs the onboarded domain and a real recipient).

## Milestones 4a and 4b: Bonus, Sales Dashboard and step-up

**Step-up** (replaces the original's shared access code):
- `POST /api/step-up` checks the person's own WIREGUARD password with WIREGUARD and sets `stepUpUntil` on the KV session for 30 minutes; each unlock is audited.
- Middleware refuses `/api/bonus/*` and `/api/sales/*` without it (403 with `stepUp: true`). The pages then show the password prompt, and an "Unlocked · N min" badge while open.

**Bonus** (Administrator Manual 1 and 3; rules decided 2026-10-24):
- **Rules** (`/bonus/rules`): per WIREGUARD job type and country: fixed per job, per successful run, or % of the job revenue, with an on/off switch. A default split by role must add up to 100 %.
- **Pool:** set by the rule of the job's main service (`poolFor`).
- **Split:** each role's share is divided among the people in that role. Roles nobody filled are spread over the present ones in proportion, so the whole pool is allocated, with rounding cents to the first person.
- **Closure → Crew assignment and bonus distribution:** Admin and SDM roles only, completed jobs only. Proposed from the split; edit a share or an amount (the total can't exceed the pool); save, then approve. Only an admin reopens, with a reason; statements already sent stay recorded.
- **Bonus Report:** per person totals of approved lines (the toggle includes unapproved ones); the standard filters plus a name search; XLSX, print; **Email statements** through the `EMAIL` binding, marking `statement_sent_at`.
- **Bonus Analysis:** total paid, jobs with bonus, bonus % of the revenue of the same jobs against the < 4.5 % target (warning when over), revenue of completed jobs and how many lack revenue; by month, person, main service and role.

**Sales Dashboard** (decided: aggregate of revenue entered on each job):
- Tabs per account plus Analysis, Find / edit job (opens the job's Closure) and Incomplete data (completed jobs without revenue, counted on the tab).
- KPIs: total, jobs #, average per job, approved bonus on those jobs. Quarterly and account charts, with month, service, area, SDM and unit in Analysis. XLSX and print.
- No "Add jobs" or "Upload clean revenue", since there is no second dataset.

**Verified 2026-10-25 (local, fake amounts):**
- **API:** bonus routes refuse before step-up; a wrong password is refused, the right one unlocks for 30 minutes. A split that doesn't add up is refused. A $500 per-job pool split 40/35/15/10 over a supervisor, operator and assistant gives 222.22 / 194.44 / 83.34, exactly 500.00.
- **Browser (playwright):**
  - the Bonus Report prompts, then shows "Unlocked · 30 min";
  - on devjob-010's Closure the proposed split saved and approved ("Approved by NESR-90003");
  - the Report lists the three people;
  - Analysis shows 500.00 USD = 1.3 % of the revenue of the same job; Sales totals 266,500 USD over 11 jobs.
- **Unit tests:** 145 of 145.

**Open:** real bonus rules and splits are NESR's to enter. Statements need email sending switched on (the 3f user action).

## Milestone 4c: data export and import (Administrator Manual 7)

- **Export** (`GET /api/admin/export`, admin role): every SLK Ops table in dependency order, plus the audit log for the record. WIREGUARD mirrors are left out because the sync owns them. The export id is written to the audit log and acts as the backup receipt.
  - The screen packs a zip: `slkops-package-<time>.json` (what an import takes) and `tables/<table>.xlsx` for reading, with the existing writers.
  - A "Data" link sits next to Sign out for admins, as in the manual.
- **Dry run** (`POST /api/admin/import/dry-run`):
  - checks the package format, version and table names;
  - compares each table's rows with the database by primary key (composite keys work, generated columns are ignored): new, changed (with the fields), unchanged, refused;
  - history tables (note and 8MF versions, inventory movements) never change, and the audit log is never imported.
- **Apply** (`POST /api/admin/import/apply`):
  - needs `confirm: IMPORT` and a backup export by the same admin within the last 15 minutes;
  - inserts new rows and updates changed rows in place; it never deletes and never rewrites unchanged rows, so table triggers only see real changes. This came from a bug: the first version upserted every row, and the unit-block overlap trigger refused the unchanged ones;
  - writes in chunks of 80, all-or-nothing per chunk and in dependency order; a failure stops, is audited, and names the backup to restore from.

**Verified 2026-10-25:**
- **API:**
  - exporting the local board gave 34 tables with rows;
  - a dry run of the same package showed 0 changes across 1,051 rows;
  - a package with a renamed PCE, a new list value and an edited inventory movement showed +1 / ~1 / 1 refused;
  - an apply without a fresh backup was refused;
  - an apply with a PCE rename, a new list value and a unit-block note wrote exactly 3 rows and audited the per-table counts.
- **Browser (playwright):** the export downloaded the zip, which .NET opens (34 entries: the JSON package and 33 table spreadsheets), and the screen recorded the backup.
- **Unit tests:** 150 of 150.

**Not checked:** a file upload through the screen (playwright-cli's upload needs a file chooser open first); the same requests were checked through the API.

### Clean-room note

Every label, message and empty state was written here. No code, assets or copy from the WL Operations Hub were used. WIREGUARD contributes its API contract and its reference lists only, not its code.

## Milestone 5: AI Agent (Administrator Manual 6)

- **How it reads data.** Every tool is a GET through the app itself (`app.fetch`), carrying the asker's cookie and country switch. Read rules, countries and step-up apply exactly as in their browser, so the agent can't see more than the person can. Tools are offered only for the tabs the person has. A refused read or a locked revenue page comes back to the model as an error, and the model says so.
- **Tools** (`src/shared/ai.ts`):
  - job statistics with a breakdown, using the shared KPI maths;
  - find jobs and one job;
  - Failure Roster with its summary;
  - 8 Min. Facts;
  - attendance per person for a month;
  - open reconciliation findings;
  - revenue by account and month (needs step-up).
  - Results are reduced to the fields that matter and cut at 30,000 characters.
- **Model** (`src/worker/ai.ts`):
  - `claude-opus-5-5` by default (admins can pick Sonnet 5.5 or Haiku 5.5), effort `medium`;
  - server-side fallback `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), not sent for Haiku, which has none;
  - a manual tool loop of at most 8 turns; `refusal`, `max_tokens` and `pause_turn` are handled;
  - `ANTHROPIC_API_KEY` is a Worker secret; `ANTHROPIC_BASE_URL` optionally routes through Cloudflare AI Gateway.
- **Limits:** `ai_settings` holds on/off (off by default), model, the monthly budget in cents (shared with the help assistant) and messages per person per day (reset at midnight UTC). `ai_usage` gets one row per question with tokens and cost in micro-USD; fallback attempts are priced at their own model, and unknown models at the highest rate.
- **Screen** `/admin/ai-agent`:
  - chat with starter prompts;
  - a list of what it can read for you;
  - a small Markdown reader (tables, lists, bold) that never injects HTML;
  - for admins, settings plus this month's spend per person.
- **Permissions:**
  - `POST /api/ai/chat` needs the `ai_agent` tab;
  - `GET /api/ai/status` needs `ai_agent`;
  - `GET`/`PUT /api/admin/ai` need Users & Roles.

**Verified 2026-10-25:**
- **Fake Anthropic API** (a local server via `ANTHROPIC_BASE_URL`, removed afterwards): the admin's question called `job_statistics` through the app and got real figures back (120 jobs, 247.3 NPT hours, broken down by unit). Each request carried the fallback beta, effort `medium` and only the allowed tools.
- **Refusals:** an SDM without the tab was refused on chat (403) and on status (403). With no key set, chat says the agent isn't set up.
- **Browser:** the starter prompt sent a question and showed the answer with the "Read: Statistics" chip.
- **Unit tests:** 162 of 162, including the loop against a mocked Messages API (tool round-trip, one usage row with the right cost) and a check that every tool path is covered by the same read rule for the same menus.

**Not checked:** a real Anthropic call (no key here). The PowerPoint output the manual mentions is not built.

## Milestone 6a: explosives prompt on explosive services

- A job with a service whose profile is marked explosive shows a warning on its Execution stage, above Perforation.
  - People with the explosive inventory's edit right get a "Mobilize explosives to the well" link. It opens Explosive inventory with Mobilize to well already filled in (this job and its well).
  - People who can view that inventory also see a per-job table: mobilized, consumed, returned and still at the well, from the existing reconciliation.
  - Anyone else is told to ask the explosives custodian.
- **Verified 2026-10-25 in the browser:** on job DV-26062 (PERFORATORS service), the link opened the Mobilize dialog with the job picked and the well filled. Closed without saving.

## Milestone 6b: attendance categories with approver email (User Manual 6)

- A category is a reporting-line group on the sheet ("Reports to …", "No reporting line"), kept per country in the existing `attendance_categories` table.
- **Manage categories** (Ops Manager and admin; people with Attendance edit see the button only when they may manage) sets each group's approver email.
- **Notify approver**, on each group header, emails that approver that the month is ready. The email lists each person's present, field, leave and unmarked days, whether they are approved yet, and a link to the sheet. It uses the same EMAIL binding as the digest, and every send is audited.
- **Refusals:** no approver set, no email binding (503), or someone other than the Ops Manager changing approvers.
- **Verified 2026-10-25:**
  - API: bad email refused; approver saved; notify sent through the local email simulator (text checked); an SDM changing an approver got 403.
  - Browser: the group header shows Notify approver, or "no approver set".
  - Unit tests: email text and escaping; rules.

## Milestone 6c: Knowledge Hub and toolbox talk (S21, S43)

- **Library** (`/knowledge`, the `knowledge_hub` tab) over the existing `knowledge_docs` table:
  - document count;
  - a Lesson of the Week card (the latest pick on or before today, otherwise the newest lesson);
  - search, a failure-type select with counts, Newest or A→Z sort, Show duplicates;
  - type and category chips, each counted under the other filters;
  - cards with type, category, title, summary, failure tags, date and RILR reference. Filters live in the URL.
- **Reader** (S43): the full entry, the key action, and a link to the source document (http and https only), plus "This repeats …" for duplicates.
- **Toolbox talk:** "Present these N as a toolbox talk", or Present on a single card, opens a full-screen slideshow with one entry per slide in large type. Arrow keys, Space or PageDown move between slides; Escape leaves.
- **Editing** (the tab's edit right; Ops Manager by default): add and edit entries, mark an entry as a duplicate of another, and star an entry as the lesson of the week from today. Nothing is deleted, and every change is audited.
- **Content:** none is shipped. The 147 documents stay with QHSE; entries link to them (features.csv "skip" row). `source_ref` holds the link.
- **Verified 2026-10-25:**
  - API: three made-up sample entries added; an ftp link refused; an SDM adding an entry got 403.
  - Browser: the Wireline chip narrowed to 2 entries with correct counts; the slideshow went 1 → 2 of 2 and closed.
  - Unit tests: link check, lesson-of-the-week rule, filters and chip counts, rules.

## Milestone 6d: Help guide and help assistant (S22, S23)

- **Help** (a header button) opens the SLK Operations guide: 15 sections written for this app (`src/shared/help.ts`), filtered to the reader's tabs. Administration appears for admins only. The original's manuals are not shipped; they describe a different app and belong to NESR.
- **Help assistant** (a round button at the bottom right, for people with the `ai_assistant` tab) opens a side panel with a disclaimer. Questions go to `POST /api/ai/assistant`, which answers from the guide sections that person can see.
  - No tools, no data, effort `low`.
  - Same model setting, on/off switch, monthly budget and fallback as the AI Agent.
  - Its own daily count; usage is logged as `assistant` in the same ledger, so the budget is shared as the manual says.
- **Also in this milestone:**
  - the Markdown reader moved to `components/Markdown.tsx`;
  - the guide and the Knowledge Hub dialogs close on Escape even when focus stayed on the button that opened them.
- **Verified 2026-10-25:**
  - Browser (page scripts, because the pane wasn't drawing): the admin's guide lists 15 sections; Escape closes it; the assistant panel focuses its input; a question without a key shows "isn't set up yet".
  - Unit tests: section filtering, and the assistant request (guide in the system prompt, no tools, low effort, one ledger row priced correctly).

## Milestone 6e: Quick Plan (S25)

- A card board for jobs that aren't tickets yet, using the existing `quick_plan_cards` table: Idea → Likely → Confirmed. Each card has a title, target date, unit and notes.
- Cards move by drag and drop or by the left and right arrows (so a keyboard works too). `reorder` renumbers the column on the server.
- **Make it a job** (needs the jobs edit right and a date or a unit) creates a planned job through the normal job route, with all its checks, links the card to it, and opens the job's Design stage. The card then shows the job's ticket link.
- Cards can be edited and removed (quick_plan edit right), and every change is audited.
- **Guide fix:** the Jobs section of the help guide now describes the real stages (Design, Preparation, Execution, Closure) and what each holds. The first draft in 6d had them wrong.
- **Verified 2026-10-25:**
  - API: created two made-up cards; moved one to Confirmed; created the job and linked it; an SDM can read the board.
  - Browser (page scripts): the columns show 1 / 0 / 1 with the job link; Make it a job on a card without date or unit explains why it can't; the arrow moved a card to Likely.
  - Unit tests: card check, reorder, rules.

## Milestone 6f: digital sign-off on approval

**Owner decision, 2026-10-25:** no drawn signatures. Approving signs digitally.

- **What gets signed:** approving a JRA, a job's bonus distribution, or a person's attendance month writes a signature in the same batch as the approval (`signatures` table, migration 0005). Each signature holds:
  - who signed, their name, role and the time;
  - a SHA-256 fingerprint of exactly what was approved: the JRA answers, score and level; the bonus lines; or the month's attendance codes;
  - an HMAC-SHA256 seal over all of that, made with the Worker secret `SIGNING_KEY`.
- **Checking:** every time a signature is shown, the server recomputes both.
  - **Valid:** the record is exactly as approved.
  - **Changed after signing:** the record was edited, for example in the database directly.
  - **Does not verify:** the signature row itself was altered.
  - **Withdrawn:** reopening a bonus distribution or unapproving an attendance month withdraws the signature with the reason. Withdrawn signatures are kept as history.
- **Where it shows:**
  - under the approval on the JRA page and on the bonus distribution;
  - a "JRA signature" row on the Full Job Report;
  - a "signed" link next to each approved attendance row, which loads only when opened.
- **Data package:** signatures are exported but never imported, so a package can't plant a signature.
- **Without `SIGNING_KEY`:** signatures are recorded and fingerprinted but not sealed, and the screen says so.
- **Verified 2026-10-25 (API, local key):**
  - an attendance approval showed valid; unapproving showed withdrawn ("unapproved"); re-approving added a new valid signature with the old one kept;
  - inserting an attendance code straight into the database turned it to "changed after signing", and removing it turned it back to valid;
  - editing the signer's name in the signatures row showed "does not verify".
  - Unit tests: canonical JSON, fingerprint, seal, every state, the export-only rule, read rules.
- **Not checked:** the screens in the browser (the pane lost its session after the server restart). The JRA and bonus approvals use the same signing code as attendance but weren't run live.

## Milestone 6g: JRA from NESR's Excel form (QAF14021)

**Owner request, 2026-10-25:** the JRA must show on Preparation and be uploadable from the Excel form, updated by uploading it again.

- **JRA briefing on Preparation:** always shown. It gives the status, score → approval level, the MOC / exemption count, the form and revision, "Upload Excel JRA", and Start / Open JRA. Before, the banner hid itself on jobs that didn't strictly need a JRA.
- **Upload** (`POST /api/jra/:job/upload`, raw .xlsx body, jobs edit right, draft only):
  - a dry run first shows the form and revision, answered / total, score and level, what each answer triggers, which answers change, and any warnings;
  - confirming replaces the draft's answers;
  - uploading again updates it, until it is sent for approval.
- **What's read from the file:**
  - the form's header (job no., performed by, position, date, client, location, rig/well, the job) and the remarks per question;
  - the file name, who uploaded it and when (new `jras.form_details`, migration 0006).
  - It warns when the form's country or job no. doesn't match the job.
- **The form defines the JRA** (`src/shared/jraForm.ts` over a small reader, `src/shared/xlsxRead.ts`). Nothing about QAF14021 is hard-coded:
  - **Sections:** rows with "Answer" over the answer column.
  - **Questions:** the numbered rows under each section.
  - **Points per answer:** each row's `IF(Rn="NO",a,b)`.
  - **Requirements and approvers:** "MOC Required" / "Exemption Required" and the approver from their IF formulas.
  - **Options:** Yes / No / N/A from the list validations.
  - **Guidance:** cell comments.
  - **Approval levels:** the nested `IF(P<10,"Cell Leader",…)`.
  - **Points per exemption:** the COUNTIF × 5.
  - **Notes:** the "JRA Notes" lines.
- **Revisions:** a new revision is stored for the country the first time it's uploaded and becomes the form for new JRAs (an older revision doesn't take over). The same revision with different questions is refused once another JRA uses it, so an approved JRA never changes underneath.
- **Quirks in QAF14021 Rev 3**, surfaced as warnings and kept as the form defines them:
  - C3 and D7 have no risk formula, so they score 0;
  - D9 "N/A" scores 6, like "No";
  - the section C total (`SUM(T23:T25)`) leaves out C1, so SLK Operations counts C1 and can score higher than the sheet.
- **Not in the repository:** the form file itself. Tests use a small made-up form with the same layout, plus a check against the real file that runs only on a machine that has it.
- **Verified 2026-10-25:**
  - Real file through the API: dry run, then upload; QAF14021 Rev 3 loaded with 26 questions, all 26 answers taken, header saved. Re-uploading recognised the same form. Answering A2 No + B2 Yes on screen scored 20 → Country Technical Manager (5 + 5 + 2 exemptions × 5). New JRAs on other jobs now use QAF14021.
  - Browser (page scripts): the briefing card on Preparation; the JRA page with form details, per-answer points, Exemption tags, approver, guidance and form notes.
  - Unit tests: 192.
- **Local note:** after the real database ID went into `wrangler.jsonc`, local development uses a fresh local database. Reseed it with `scripts/dev-seed.sql` and `scripts/dev-jobs.sql`.

## Milestone 6h: attachments in R2

**Owner request, 2026-10-25:** files need to be stored.

- **Storage:** R2 bucket `slkops-files` (binding `FILES`). Each file has a row in `attachments` (migration 0007) with its category, name, type, size, a SHA-256 of the bytes, the R2 key and who uploaded it when. Removing a file hides it (`deleted_at`) and keeps the object; every upload and removal is audited.
- **Where they show:**
  - an **Attachments** section at the bottom of every job stage;
  - **Files** in the Knowledge Hub reader.
  - Categories: photo, field ticket, job log, JRA form, report, permit / certificate, document, other.
  - Upload by picking or dropping files; images show as thumbnails; images and PDFs open in a new tab, everything else downloads.
- **Uploaded JRA Excel:** the original file is now kept as a "JRA form" attachment on the job, next to the answers read from it.
- **Access follows the record** (`/api/attachments/:type/:recordId[/:fileId]`):
  - job files need the jobs tab (adding or removing needs its edit right);
  - Knowledge Hub files need the knowledge_hub tab;
  - both stay inside the person's countries;
  - a file id only works under the record it belongs to.
- **Safety:**
  - only document and image types are accepted (no HTML, SVG, scripts or executables), up to 25 MB, names cleaned;
  - files are served with `nosniff`, a sandboxing Content-Security-Policy, and as downloads except images and PDFs.
- **Data package:** file records are exported but never imported. The files themselves stay in R2 and aren't in the package.
- **Production:** create the bucket once with `npx wrangler r2 bucket create slkops-files`, run the migration, then deploy. Without the bucket the section says storage isn't set up, and JRA uploads still work (the original just isn't kept).
- **Verified 2026-10-25 (dev server, local R2):**
  - a PDF uploaded; an .html file and an unknown category refused;
  - a JRA upload kept its Excel, and downloading it gave a byte-identical file with the expected headers;
  - the PDF opened inline;
  - removing it hid it (later fetch 404); fetching through a different job's address gave 404; no session gave 401;
  - in the browser, a PNG uploaded through the panel showed in the list with View / Download, and its thumbnail decodes (40×30).
  - Unit tests: 199.

## Milestone 6i: JRA autosave with the job, approved JRA filed as a PDF

**Owner request, 2026-10-25:** the JRA must always autosave and belong to its job; once approved, a PDF goes into the job's attachments.

- **Bound to the job from the start:** opening a job's JRA (with the jobs edit right) creates its draft record straight away, pinned to the form revision in force that day. Before, the record only appeared after the first answer.
- **Autosave fixes:**
  - Each answer is kept on the device at once and saved to the server 0.4 s later.
  - Leaving the JRA page, hiding the tab or closing it saves immediately (`keepalive`). Before, a change made in the last 0.6 s before leaving was lost.
  - A failed save is retried every 5 s and when the connection comes back; the answers stay on the device meanwhile and are restored on the next visit if they never reached the server.
  - Refocusing the tab no longer overwrites answers that are still waiting to save.
  - Send for approval first pushes anything pending.
  - The header shows "All changes saved · hh:mm:ss", "Saving…", or "Not saved yet. Kept on this device; retrying."
- **Approved JRA as a PDF:** approving files `JRA <ticket> <form> Rev <n> approved.pdf` in the job's attachments (category JRA form). It contains:
  - the form title, code and revision; the job and form header;
  - the score, approval level and MOC / exemption count;
  - every question with its answer, points, requirement, approver and remarks;
  - the form notes;
  - who approved it and when, and the digital-signature fingerprint.
  - The approval stands even if storage isn't set up; the page says the PDF wasn't filed.
  - "File approved PDF again" (`POST /api/jra/:job/pdf`) covers JRAs approved before this, or a removed PDF.
- **PDF writer** (`src/shared/pdf.ts`): written here, no dependency; A4, Helvetica, word wrap, Windows-1252 text, page numbers and a footer.
- **Verified 2026-10-25 (dev server):**
  - sending and approving DV-26071's uploaded JRA filed a 17 KB PDF; it downloads as a valid PDF;
  - on DV-26072, opening the JRA created its draft (QAF14021 Rev 3), and an answer clicked 50 ms before leaving the page was saved;
  - unit tests (204) check the PDF's cross-reference offsets and stream lengths and the text it draws.
- **Not checked:** how the PDF looks on screen. There's no PDF renderer here; a sample file was sent to the owner to open.

## Milestone 6j: Sunlight field mode

**Owner request, 2026-10-26:** the app must work on tablets in bright light.

- **Sunlight theme:** the light theme was rebuilt for outdoor tablets.
  - Text and secondary text at 7 : 1 or more, field outlines at 7.6 : 1, card edges at 3 : 1 or more; 50 pairs checked by `build_tokens.py`.
  - Cards are outlined instead of shadowed, because shadows wash out in glare.
  - Status pills are solid (new `pill-*` tokens), because tints bleach out.
- **Touch density** (`[data-density="touch"]` in `tokens.css`): controls 44px, JRA answer toggles 48px, body text 16px, labels 12px. Buttons, inputs, tabs and the field-page controls now take their height from `--layout-control-*` instead of fixed classes.
- **Defaults by device** (`src/client/display.ts`, plus the same rules in `index.html` before the first paint): touch screens open in Sunlight with touch density; a desk with a mouse opens dark and compact. The account menu has Sunlight mode and Large touch controls (Auto / On / Off), remembered per device.
- **Header:**
  - one row: brand, country, WIREGUARD sync, clock, Help, Ask, account menu;
  - the section tabs stay pinned to the top while scrolling;
  - on phones the tools wrap and the country switch moves into the account menu;
  - name, role, password, Data and Sign out moved into the account menu.
- **Help button fix:** the floating help-assistant button covered the JRA answer column on tablets. It is now "Ask" in the header, and nothing floats over content.
- **Also updated:** DESIGN.md (Sunlight colours, touch sizes, the Sunlight Rule, the Nothing Floats Over Work Rule), `.impeccable/design.json`, `components.md`, and the in-app guide.
- **Verified 2026-10-26:**
  - 1280 × 800 touch tablet: Sunlight and touch switch on by themselves; on Preparation and the JRA, 0 of 75 and 0 of 82 controls are under 44px (before: 46 of 52 and 59 of 59); body text 16px; no floating button; section tabs pinned at the top.
  - 1440 desk with a mouse: still dark and compact, header 100px.
  - 390 phone: no sideways scroll, nothing cut off in the header.
  - Tests: 204 pass. Design checker: only the banner edge the owner chose to keep.
- **Not done:** the Schedule's timeline cells stay below 44px (an office screen). Charts were already labelled on the bars, so they were left as they are.
- **Dev note:** vite's pre-bundled dependency cache got stuck mid-rebuild, and every page load hung. Restarting with `--force` fixed it.

## Milestone 6k: critique, redo of the two weakest screens, polish

**Owner request, 2026-10-26:** critique each screen, redo the two weakest, polish all.

- **Critique:** two isolated assessments, a design review of 21 screens at desk and touch tablet, and the Impeccable detector with browser overlays. The median score was about 28.5/40; the weakest were Reconciliation (25) and the Job board (26). The snapshot is in `.impeccable/critique/`.
- **Redo: Reconciliation.** A status header in three states replaces four zero tiles that sat above a "Nothing to reconcile" message, shown even when no check had ever run:
  - "Never checked", with "Run first check";
  - "All checked jobs agree", with the check time;
  - "N open findings", with the counts.
  - Findings are grouped by severity in one card with count chips.
  - Coverage is one table with a unit / SDM switch. Units with jobs but no WIREGUARD runs say "No WIREGUARD runs".
  - The morning digest is linked from the header.
- **Redo: Job board.**
  - Dense rows replace 121 tall cards, grouped as Needs attention / Ongoing / Planned / Closed (Closed collapses past 20).
  - Each flagged job says why ("Incomplete: Prep 0% · Execution 67% · Closure 14%", "Missing unit and start date"). There is a "Needs attention only" switch with a count, and status filters as chips.
  - Stage values show as numbers plus bars. SDM names come from the SDM list. The page is 9,458px tall instead of 13,309px at desk.
- **Polish:**
  - **JRA:**
    - approving opens "Sign this JRA": job, risk index, approval level, who signs, and the answers needing MOC / exemption;
    - Reject sits behind "Reject instead…";
    - the "doesn't need a JRA" banner hides once the JRA is sent or decided;
    - the counts line reads plainly.
  - **Touch sizes:** 64 fixed control heights across 18 files now follow the density tokens; 24–28px controls keep their desk size and grow to 44px under touch.
  - **Colour, type and buttons:**
    - 10px labels moved onto the type scale;
    - Wires shows "none on file" muted (red only for expired or failed MPI) and "1 alert" in words;
    - the Knowledge Hub toolbox slide drops its side stripe;
    - disabled primary buttons are a quiet surface with readable text.
  - **Layout and copy:**
    - crew groups in Preparation use rules instead of boxes inside the card;
    - the "No one holds the SDM role yet" hint shows only when no SDM is set;
    - the AI budget "USD" sits next to its input.
- **Detector:** 20 → 14 findings. The rest are Word and email export templates, the schedule bar encodings, and the banner style the owner chose to keep.
- **Not done here** (planned for the owner's step 4, or later):
  - reduced-motion for the spinner and skeleton animations;
  - the Execution layout (job log above the computed tiles);
  - Statistics targets on the gauges;
  - the 8 Min. Facts backlog in its empty state.
- **Verified:** tests 204; screenshots in `design/after/` (desktop 1440 dark, phone 390 touch) compared against `design/before/`.

## 6l — Accessibility and motion fixes (ui-skills: fixing-accessibility, accessible-animation)

- **Reduced motion, tiered:** under `prefers-reduced-motion` the spinners fade slowly instead of spinning (loading still reads as loading), the skeleton pulse slows to 3s, and transitions and smooth scrolling are cut.
- **Keyboard:**
  - every radiogroup (JRA answers, touch-controls switch, drum and wire, 8 Min. Facts status, Inventory category) is one Tab stop; arrows and Home/End move and choose (`rovingKeys`, `radioTab` in `ui.tsx`);
  - the attendance code menu takes arrow keys, and its items are `menuitemradio`, showing the code with its name ("P Present"), so the legend isn't needed to choose;
  - Schedule bars: `{` and `}` move the start date (`[` `]` already moved the end), and the keyboard moves are written under the grid, not only in the bar's accessible name;
  - the drag handles widen from 6px to 10px.
- **Focus:** inside segmented controls the ring is drawn inset in the text colour; the outside ring was clipped by the rounded border and faint on a chalk fill.
- **Not by colour alone:**
  - Schedule bars and their legend carry a status glyph (planned, ongoing, completed, canceled);
  - gauges say "on target / below target" or "good / watch / low" under the value;
  - on Wires, a passing tension test past its window shows "N days old, out of window" and is no longer green;
  - the ADMIN-style badge uses the solid pill tokens in Sunlight.
- **Forms:**
  - the Execution log row has visible labels (Time, Run, Depth (ft), What happened) instead of placeholders, and the Log button explains that it needs "what happened";
  - Sign in and Unlock are never dead buttons: an empty submit says what's missing and puts focus there;
  - Save settings says "No changes to save";
  - 8 Min. Facts print and Word say "Save to print or export".
- **Headings:** the JRA briefing on Preparation is an h2 (it skipped from h1 to h3).
- **Verified:**
  - tests 204;
  - in the browser with reduced motion, the spinner uses `slk-breathe`; a JRA answer group has tab stops `[0, -1]`, and ArrowRight selects and focuses "No" with an inset ring;
  - 12 Schedule bars and the legend show glyphs;
  - an empty Sign in announces "Enter your username." and focuses the field.

## 6m — No second password, NESR logos, the last critique items

- **Step-up removed (owner's request):**
  - Bonus and Sales open to whoever holds those tabs, with no password re-entry;
  - removed `/api/step-up`, the 30-minute session flag, the bonus/sales API gate, the client prompt and "Unlocked" badge, and the AI tool's locked message;
  - the feature matrix records the removal.
- **Logos:**
  - the NESR mark sits beside the product name in the header (white on dark, dark on Sunlight, picked by theme with no reload) and on the sign-in page;
  - printed pages carry a header with the mark;
  - favicon and touch icon are the wings on the dark surface;
  - the approved-JRA PDF has the mark in its title band: `PdfDoc.jpeg()` embeds a baseline JPEG with `/DCTDecode`, so no image decoder is needed;
  - the assets are in `public/brand/` and `src/shared/brandLogo.ts`.
- **Critique leftovers:**
  - **Preparation:** opens with "Safety checks" (the picked wire's pre-job tests, toolstring OD and length against restriction, PCE bore and lubricator, sour gas, SIWHP against the pressure rating), each marked Stop or Check;
  - **Execution:** opens with operating hours and efficiencies, then the job log, then the form; closed service sections fold into one line instead of three boxes;
  - **8 Min. Facts:** lists the jobs with NPT or a failure still waiting for a report, each with "Start report", which opens a new report with the job already picked (`?job=`);
  - **JRA:** shows the approver and recipient by name;
  - **Statistics:** states the gauge thresholds (good 90%, watch 75%);
  - **Job log export:** "Job eff %" is now "Job efficiency %";
  - **Admin users:** the admin Save points to the note explaining why it's off.
- **Verified:**
  - tests 204 (the PDF test checks the embedded image);
  - the sample PDF parses under pypdf strict mode with its 200×156 JPEG;
  - in the browser, the header shows the white mark on dark and the dark mark on Sunlight, `/brand/icon-64.png` is served, and Sales and Bonus load without a prompt.

## 6n — WL Operations Hub look: lime accent, Unit schedule, Job log, Job board

- **Colour and name:**
  - the action colour is the WL Hub lime (#c8d400, dark text) in both themes;
  - lime text is bright on night and deep olive (#465000) in Sunlight;
  - "SLK" in the name is lime on night and dark on a lime marker in Sunlight;
  - under the name: Juan Lopez (jceron@nesr.com) / Mohamed Manna (mmana@nesr.com), on the sign-in page and in the header from laptop width;
  - new tokens: maint / status-event (orange / purple, with subtle fills), today, accent-edge. All 55 pairs pass AA in both themes.
- **Filter panel:**
  - `FilterBar variant="panel"` lays out the WL Hub filter card (label above an "All" dropdown, Clear at the end);
  - the same nine dimensions plus Job status are used on the Job log, the Job board and (without year and month) the Unit schedule.
- **Unit schedule:**
  - laid out like the WL Hub: month in lime, legend dots, Create Job, Filters (with a count), Show canceled;
  - "+ Maintenance Event" (orange) and "+ Unit Status Event" (purple) open the WL Hub dialogs:
    - maintenance has a type (Cable Maintenance, Mechanic, Electrical, Hydraulic, Pressure Test, Inspection / Certification, Other);
    - a status event (Loan, Transferred, Junk, Backup on location) may have no end date ("ongoing", stored as 9999-12-31);
  - events are drawn in orange or purple stripes with their type; clicking one edits or removes it;
  - unit rows show ACTIVE and each drum's wire from WIREGUARD ("Supernova, 1/8", 24,970'");
  - today's column is tinted lime;
  - the filters (SDM, account, area, service domain, service, unit, conveyance, status) narrow the jobs, and Unit # narrows the rows;
  - migration 0008 adds `unit_events.detail`.
- **Job log:**
  - the filter panel holds the search;
  - Print, Download (CSV) and XLSX;
  - columns follow the WL Hub: Ticket, DMR #, Start, End, Rig up, Rig down, Status, JRA, SDM, Account, Area, Rig/Site, Well, then the rest;
  - ticket numbers are lime and the JRA shows as a pill.
- **Job board:**
  - WL Hub cards (lime ticket, well · rig, dates; SDM, account / area · services; the four stage bars; efficiency; status; × to delete with a confirm step);
  - the full filter panel, search, and "Needs attention" with its count;
  - the jobs API takes the standard filters.
- **Verified:**
  - tests 207;
  - in the browser (desk, dark and Sunlight): sign-in, schedule, job log and job board, with no page errors;
  - a Mechanic maintenance event and an open Loan were created from the new dialogs and drawn on the schedule.

## 6o — Reconciliation moved under Wires

- Reconciliation is now the second tab of Wires (`/wires/reconciliation`) instead of an Operation tab (owner request).
- The old `/operation/reconciliation` address redirects there with its query (`?severity=high`), so bookmarks and digest emails sent before the move still land.
- The digest link, the schedule and job board banner link, and the help text point to the new place.
- Section tabs that are a prefix of another (Wires and Wires / Reconciliation) match exactly, so only one is highlighted.
- The menu key (`reconciliation`) and its rights are unchanged.
- Verified: tests 207; in the browser the old link redirects, Wires shows both tabs with the right one active, and Operation no longer lists Reconciliation.

## 6p — "A new version is available" bar

- Each build stamps an id (UTC timestamp) into index.html (`<meta name="app-build">`) and into the code (`__APP_BUILD__`, a Vite define).
- The running page reads the id the server now serves every 5 minutes, when the tab comes back into view, and when the connection returns.
- When the ids differ, a yellow bar across the top says: "A new version of SLK Operations is available. Finish what you are typing and save it, then click Refresh now", with a CAUTION line that refreshing clears anything not yet saved.
- Nothing reloads by itself. Refresh now fetches a fresh copy of the page first, so the reload can't come back from the browser cache.
- Local development ("dev") never shows the bar.
- Tokens: notice-bg #facc15 and notice-fg #0b121a, the same in both themes (12.3:1).
- Verified with a simulated deploy (preview build A → page open → build B served): the bar appeared, and Refresh now loaded B with the bar gone.

## 6q — Sign-in like NESR's field apps, Face ID / fingerprint, QR sign-in, WIREGUARD users

- **Sign-in screen:**
  - laid out like NESR's other field apps: the mark, "SLK Operations", "Slickline operations — sign in", "Employee ID or username" (a bare number becomes NESR-number), password with the eye beside it, Sign in on the right, then "Sign in with Face ID / fingerprint" and "Sign in with your phone (QR code)", "Forgot password?";
  - the footer has the version (package.json version and the build stamp);
  - the contact names and emails are off this screen (the header keeps them);
  - the header shows the real version.
- **Face ID / fingerprint (WebAuthn passkeys):**
  - kept by SLK Ops in `passkeys` (migration 0009). WIREGUARD is never written to, and WIREGUARD's own passkeys are bound to its own site, so they couldn't be used here anyway;
  - set up from Account menu → "Face ID / fingerprint sign-in": Face ID, Touch ID, Android fingerprint or Windows Hello; synced passkeys are marked;
  - a Face ID session has no WIREGUARD token, so it is re-checked against WIREGUARD's user list through the sync account. Someone switched off in WIREGUARD loses access within minutes. A password session still re-checks its token as before.
  - every sign-in also needs SLK Ops access on, and Face ID allowed for the person.
- **QR sign-in for a laptop:**
  - the laptop shows a QR code and a four-digit code;
  - the phone opens `/qr/<id>`, which shows the computer (browser, OS, approximate place) and the code, and confirms with Face ID ("This wasn't me" refuses);
  - the laptop polls with a secret only it holds, so only that screen can collect the session;
  - three minutes, single use, every step audited.
- **Users & Roles:**
  - "Import from WIREGUARD" reads WIREGUARD's user list (sync account, read-only) and brings in everyone: name, email, employee ID, WIREGUARD role, country, field, active;
  - new people get their mapped role and WIREGUARD countries; existing people keep the SLK Ops role and countries the admin set;
  - the import also runs nightly at 01:00 UTC;
  - People shows email, employee ID, "Inactive in WIREGUARD" and Face ID devices;
  - Edit shows the WIREGUARD details, a per-person "Face ID allowed" switch, and their devices, each removable.
- **Verified:**
  - tests 213;
  - end to end in Chrome with a virtual Face ID authenticator on localhost (WebAuthn refuses bare IP addresses): set up a device, sign out, sign in with Face ID as NESR-90003;
  - QR: a "laptop" with no authenticator showed code 1577, the "phone" showed the same code and approved with Face ID, and the laptop signed in as NESR-90003; the used code then read "expired";
  - the import brought in 6 users, with the inactive one flagged.

## 6r — Attendance by role: three sheets, who fills and who approves

- **Three sheets** (owner request), set per person in the Headcount Roster ("Attendance sheet"; new entries follow the crew role):
  - **Operators & Helpers:** the Foreman fills the crew who report to them, the SDM approves;
  - **Support Staff (Shop):** the Maintenance Supervisor fills, the Maintenance Manager approves;
  - **Management:** each person fills their own row (or an Admin does), the Operations Manager approves.
- **Overrides:** Admin and Attendance Admin may fill any row; Admin may approve any row. "Fills own attendance (SELF)" in the roster lets a person fill their own row on any sheet.
- **New roles:** Foreman and Maintenance Supervisor (owner's choice).
  - Migration 0010 rebuilds `user_roles` to add them to the role CHECK; tab grants are kept aside and restored.
  - The Foreman starts from the Slickline Supervisor's tabs and the Maintenance Supervisor from the Storekeeper's, both with Attendance edit.
  - SDM, Maintenance Manager and Ops Manager get Attendance edit for approvals.
- **Server rules:** `shared/attendanceSheets.ts` holds the rules, used by the server and the sheet alike.
  - Each person sees the rows they fill or approve and their own; Admin, Attendance Admin, Ops Manager, Director and SQM see everything.
  - Saves and approvals are checked row by row with a refusal that names the sheet and role. They no longer need the tab's edit right, so a manager can fill their own management row.
- **The sheet**, laid out like the WL Operations Hub:
  - the month and filters (account, updated by, filled by, reports to, EID, name, title) across the top, plus search;
  - Multi-Select, Save, XLSX (all sheets), HTML;
  - the codes legend always open;
  - one card per sheet titled "Operators & Helpers — Foreman → SDM", with Operators & Helpers split by foreman crew;
  - per card: Notify the approver, Approve all, XLSX for that group;
  - SELF badges, and an account column in lime.
- **Notify:** emails everyone with the sheet's approving role in that country, using their emails imported from WIREGUARD. "Approver emails" adds an address for an approver without an account.
- **Verified:**
  - tests 222, with new sheet-rule tests;
  - signed in locally with the mock accounts:
    - the Foreman saw only his crew and his own row, saved a crew cell, and was refused on a shop row;
    - the SDM saw the field sheet, could approve but not fill, and was refused approving a shop row;
    - the Admin saw all nine rows.

## 6s — Attendance from Users & Roles; the Headcount Roster is gone

- **People come from Users & Roles:**
  - every active SLK Ops user (from the WIREGUARD import or added by hand) is on attendance, mirrored into `employees` by `syncPeople` and linked by WIREGUARD username;
  - the mirror runs on import, on the users list, on the attendance sheet and on the crew picker;
  - attendance and job crews still read `employees`, so nothing downstream changed;
  - people switched off in SLK Ops or inactive in WIREGUARD drop off.
- **Users & Roles → Attendance categories** (migration 0011, `attendance_role_sheets`):
  - each role is assigned to Operators & Helpers, Support Staff (Shop), Management or Not on attendance;
  - defaults: crew roles and Foreman → field; Maintenance Supervisor, storekeeping, explosive and sales roles → shop; managers, SDMs, Director, SQM and Admin → management; Viewer → not on attendance (keeps the sync account off).
- **Users & Roles → a person's Edit → "Attendance and crew":** sheet (from the role, or moved by hand), foreman (Foremen in the same country), job title, account, crew role, mobile, SELF and SLK contact. These replace the Headcount Roster's fields.
- **Headcount Roster:** page and menu removed; `/attendance/roster` goes to Users & Roles.
- **Faster entry on the sheet:**
  - sheet chips (All, Operators & Helpers, Shop, Management);
  - Status (still to fill, waiting approval, approved);
  - "Only rows I fill" (remembered on the device);
  - Role and Foreman filters next to account, updated by, filled by and title;
  - "Fill empty days with <code>" for the rows on screen that you fill, optionally skipping weekends and holidays and stopping at today; it stays pending until Save;
  - a people count.
- **Data package:** includes `attendance_role_sheets`.
- **Verified:**
  - tests 225;
  - in the browser: the categories tab lists all 20 roles, a person's attendance details save, and the sheet shows the 4 active non-viewer users;
  - the Management chip narrows it to 2, and "Fill empty days with P" set 72 days ready to save;
  - a column-name clash in the users list (users joined to employees) was caught in the browser and fixed before commit.

## 6t — Roles and approvals in Users & Roles; searchable dropdowns everywhere

- **Roles as data** (migration 0012, `roles`):
  - Users & Roles → Roles lists every role with its source and how many people hold it;
  - roles can be renamed, and new ones added, optionally starting from another role's tabs;
  - roles WIREGUARD's mapping uses (Admin, Viewer, Maintenance Mgr, SLK Supervisor) can't be deleted, nor can a role someone still holds;
  - deleting a role removes its tabs, attendance category and approvals;
  - `user_roles` loses its fixed role CHECK (rebuilt, tab grants kept);
  - role names come from the table everywhere (`roleLabel`).
- **Approvals as data** (`approval_rules`, `shared/approvalRules.ts`): Users & Roles → Approvals sets the roles for every approval and checklist. Admin is always allowed, each rule shows its default, and Reset puts it back.
  - **Job:** who can be the job's SDM, who fills Design (request / SDM part), Preparation and Execution, who overrides operating hours.
  - **JRA:** one rule per approval level and MOC / exemption approver named on the uploaded JRA forms, plus "approve any JRA". The JRA can only be sent to someone holding a role for its level (the send list comes from `/api/jra/:job/approvers`).
  - **Closure checklist:** sign-off items, failure follow-up, service order, revenue.
  - **Bonus:** distribute and approve; reopen.
  - **Attendance:** fill and approve per sheet.
  - The server enforces every rule, and the screens follow them.
- **Searchable dropdowns:**
  - every `<select>` goes through `<Select>`: lists of five or more (rigs, units, people, wires, items, lookups) become a searchable dropdown with the search box at the top of the list, as in the WL Hub; short fixed choices stay native;
  - data-backed job fields, the JRA send list, the foreman picker and the attendance filters are always searchable;
  - multi-select filters always show their search box.
- **Verified:**
  - tests 233 (new rule tests);
  - in the browser: a role added (copying SLK Operator's tabs), renamed and deleted, with Admin's delete disabled;
  - Approvals shows the five groups and 7 JRA levels, and changing "Ticket value" to SDM only took effect on the server, then Reset;
  - typing "SL-4" in a job's unit and "spare" in the maintenance dialog filtered the lists;
  - a sweep of 23 pages showed no page errors.

## 6u — Attendance categories you manage, Field Supervisors / Engineers, days from the jobs, two-step approval

- **Categories as data** (migration 0013, `attendance_sheets`). Users & Roles → Attendance categories:
  - add, rename, reorder and delete categories; delete is refused while a role or a person still uses one;
  - per category: who fills (their foreman for a crew, the fill roles for everyone, or each person), one or two approval steps, whether days come from jobs, and the code for job days;
  - below that, the role → category map, which offers whatever categories exist;
  - a person can still be moved by hand (`employees.attendance_category`);
  - each category's fill / review / approve roles are rules under Approvals → Attendance.
- **New category: Field Supervisors / Engineers.**
  - Days come from their jobs, the SDM fills the rest and reviews, and the Operations Manager gives the final approval.
  - The SLK Supervisor role moves to it.
- **Days from the jobs** (owner's answer; also for Operators & Helpers):
  - for people in a category set that way, every day crewed on an ongoing or completed job gets the category's code: start to end for completed jobs, start to today for ongoing ones;
  - this is worked out again whenever the sheet is read and nightly, so it follows schedule changes and is rechecked when a job completes;
  - only cells the app filled are touched: typed cells stay, and reviewed or approved rows are left alone;
  - job-filled cells say "(from the job)" and have a dashed edge.
- **Two-step approval** (`attendance_reviews`):
  - Review, then Final approval, per row or "Review all" / "Approve all";
  - the final approval is refused until the review is done;
  - a reviewed row is locked for filling;
  - Notify goes to the reviewers while rows wait for review, then to the approvers.
- **Verified:**
  - tests 236 (rewritten category tests);
  - locally:
    - the Foreman's row got exactly 4–7, 15–18 and 25–26 Oct from three completed jobs and one ongoing to today, not the planned 22–24;
    - the supervisor's row got 10–11;
    - approval before review was refused, review locked the row, then approval passed;
    - "Drivers" was added, renamed to "Drivers & Riggers" and deleted, with Operators & Helpers' delete disabled;
    - Approvals lists the review and final approval rules.

## 6v — Account colours, form templates, job-stage rights, crew changes by date, attendance links

- **Account colours** (migration 0014, `account_colors`):
  - each account (the job's location) gets a light colour when its first job is created; accounts already in use get theirs the first time the list is read;
  - the schedule, the job board and the job log are grouped and tinted by account, with a legend on top;
  - clicking an account in the legend filters to it (the same `account` filter as the filter panel);
  - Database editors can change a colour from the legend.
- **Form templates** (Administration → Form templates; `jra_templates` gains name, kind, stage, source file; `job_forms`):
  - the JRA and the job checklists: list by stage, filter, edit, copy, switch in use, delete (refused once a job filled it);
  - each template belongs to a job stage and shows there; one JRA in use per country;
  - new questions on a template jobs already used are saved as the next revision;
  - templates are made by hand, from a Word (.docx) or Excel (.xlsx) file, or with the AI assistant, which uses the existing AI settings and budget;
  - NESR's JRA form is still read exactly;
  - checklists are answered Yes / No / N/A with remarks on the job, then marked complete or reopened;
  - the Upload Excel JRA button and its API are gone from the job.
- **Job-stage rights**:
  - Design, Preparation, Execution and Closure are rights of their own in Users & Roles, under Jobs, seeded from each role's Jobs rights;
  - a role without them follows Jobs;
  - the editor hides stages a role can't see and locks stages it can't edit;
  - the API drops fields of stages the caller can't edit (a schedule move keeps the Schedule right).
- **Crew changes by date** (`job_crew` start/end dates):
  - on a started job a crew member is replaced from a date (optionally both on the job that day) or taken off after a last day, with a reason, and can be put back;
  - attendance from jobs counts only each person's own days;
  - ongoing jobs fill up to today even past their planned end.
- **Attendance**:
  - clicking a day on a job opens a menu with a link to that job, also for rows you don't fill;
  - picked cells are highlighted;
  - Multi-Select moved below "Fill empty days".
- **Verified:**
  - tests 249;
  - in the browser:
    - legends on all three screens, and the D&WO filter from the legend;
    - replacing the Foreman from 6 Oct cut their job days to 4–5 Oct, and Undo restored them;
    - two picked cells highlighted, and the job link opened DV-26061;
    - a Word file was read into 4 questions with sections, saved for Execution, then shown, answered and completed on a job;
    - delete and new questions on the used template were refused (409);
    - no Upload Excel JRA button on the job;
    - the AI assistant reports the missing key locally.

## 6w — Service Order number, job package in R2, SDM approval of job forms, PDFs and timestamps

- **Service Order** (migration 0015, `jobs.service_order_no`):
  - when "Service order raised" is Yes, Closure asks for the Service Order number;
  - setting it back to No clears the number;
  - the job can't be completed without it.
- **Job package**:
  - a form template of a new kind, one in use per country, on Closure;
  - the list known today is loaded the first time a country needs it, and is edited in Administration → Form templates;
  - items can apply only when the job has a Service Order, NPT or a failure, explosives, a third party or a JRA;
  - each document is uploaded into R2 under `job-packages/<YYYY-MM>/<Rig-Well-Date>/` (the date is the job's end date), and files move there at approval if the dates changed;
  - the package is marked complete once every document that applies is uploaded, then approved by the SDM;
  - **the job can't be completed until the package is approved.**
- **Approval of job forms**:
  - checklists and the package: complete → SDM approval (rule `forms.approve`, plus the job's own SDM), each step stamped with who and when;
  - on approval a PDF is filed in the job's attachments (the package's contents list also goes in its folder); the JRA already did this;
  - only an admin can reopen, and the reopening keeps who and when;
  - every save, upload, removal, completion, approval and reopening goes to the audit trail, with the answers that changed;
  - package files can't be removed from the general attachments list.
- **Timestamps**: approvals show date and time on the JRA briefing, attendance (review and approval), bonus, the job report and every job form.
- **Verified:**
  - tests 255;
  - in the browser on DV-26071:
    - completing was refused first for the missing SO number, then for the package;
    - 8 documents were uploaded into `job-packages/2026-10/RIG-102-W-1595-2026-10-27/`, completed by the admin and approved by the SDM (PDF filed);
    - the job then completed;
    - an SDM's reopen was refused (403), and the admin's reopen worked;
    - the audit trail shows each step and the answers changed.

## 6x — Audit trail in Administration

- **Administration → Audit trail** (menu right `audit`, admins by default; migration 0016 adds the address and browser to sign-in events and two indexes):
  - every change any screen writes to `audit_log`, plus sign-in events, newest first with seconds, Riyadh time;
  - filters: dates (today, 7 / 30 / 90 days, or chosen), area (Sign-in, Jobs, Form templates, Files, Users & Roles, Attendance, Reports & quality, Bonus & sales, Inventory & wires, Database, System, Other), person, action and free text (ticket, name, what changed);
  - filters live in the address;
  - counts of entries, sign-ins, failed sign-ins and people, each a shortcut filter;
  - job entries link to the job;
  - load older entries page by page;
  - XLSX / CSV export of up to 5,000 entries.
- **Sign-in events now recorded**:
  - signed in (password, Face ID, QR) and signed out;
  - failed password, Face ID and QR sign-ins (with the reason);
  - sessions ended by inactivity or by WIREGUARD;
  - access refused because SLK Ops access is off;
  - a manual WIREGUARD sync.
  - each keeps the IP address and the browser.
- Users & Roles → History links to the full trail.
- **Verified:**
  - tests 259;
  - in the browser:
    - a wrong password, a sign-in, a sign-out and a sign-in again showed as four entries with the IP and "Chrome on Windows";
    - searching DV-26071 found its 29 entries;
    - XLSX downloaded;
    - the Foreman gets 403 on the trail.

## 6y — Activity sheet and Daily report in the Sales dashboard

- Replaces the two Excel workbooks "NESR Activity Sheet" (a billing line per job, one tab per account: Site-less SAWCOD, NAWCOD, RAZOR, D&W Oper, UNC, LSTK, Wireline & FRAC-LSTK OOS) and "Daily Report" (a line per unit per day, one tab per day). Migration 0017 adds `sales_activity`, `sales_daily`, `sales_daily_days` and `sales_account_formats`.
- **One format for every account** (`shared/salesSheets.ts`): the columns all accounts share, plus the few only some keep (Org code, Aramco unit name, KM, land/offshore, rig assigned, unit type, site, campaign, PR plug serial …), shaded on screen and in Excel. Each account picks its format by name (SAWCOD, NAWCO, D&WO, Unconventional, LSTK) and Sales can change it on the sheet. Ticket statuses follow the account's own list.
- **Where each value comes from:** from the job (read-only, a link opens the job stage to fix it, amber when missing), typed on the sheet (DMR status, ticket follow-up dates, stand-by, partially billed, comments …), suggested by the app and overridable (revenue month, a unit's daily status and client), or calculated (total time, man-hours, net revenue, utilisation).
- **Sales dashboard → Activity sheet:** revenue month (the job's end month unless the line says otherwise), account legend filter, search, to check / checked / changed since checked; KPI tiles; grouped by account with net subtotal; column groups (Job, Crew, Dates, Hours, Ticket & documents, Ticket follow-up, Revenue, Account details, Comments) fold to one summary column each, or all at once; accounts fold too.
- **Sales dashboard → Daily report:** day picker with a month strip of progress; every active unit with its status from its job or maintenance/loan, client, rig, well, activity, crew; unit type, PCE, location type and entity carry over from the day before; counts by status, location type, client and well type; upcoming planned jobs for 3 weeks plus rigs typed by hand; people on board; grouped by client.
- **Review:** each line is checked and locked (one or many), with who and when; the values are frozen as a snapshot and a warning shows when the job changed afterwards; only an Admin unlocks, with a reason. Every edit, lock and unlock goes to the audit trail.
- **Exports:** Excel with a group row and one sheet per account (Activity) or for the day / one sheet per day of the month (Daily); landscape PDF of the columns open on screen, sized to content, continuing wide tables on more pages. The XLSX writer now writes several sheets; the PDF writer has landscape pages.
- **Gaps the app cannot fill:** call-out, booking, mob and demob dates; KM; stand-by hours; DMR status and ticket follow-up; partially billed amounts; client unit names and org codes; unit type, location type and entity per unit; SAPESCO rigs with no job; people on board. Razor and Wireline jobs sit under other accounts in WIREGUARD, so their format is picked per account.
- **Verified:**
  - tests 276;
  - in the browser: edits, lock and unlock, carry-over, Excel (activity, day, month) and PDF downloads, dark theme.

## 6z — Company, distance to location, man-hours and travel

- **Administration → Companies** (menu right `companies`, admins by default): add, rename, reorder, switch off and remove companies; NESR and SAPESCO are there to start. A rename follows through to the jobs; a company on jobs can be switched off but not removed. Every change goes to the audit trail (Database area).
- **Job Design → Company**: picked from the active companies (Sales rights, `job.design`); the API only takes a company on the list.
- **Job Execution → Distance to location (km)**, one way (crew rights, `job.exec`; waits for the JRA like the other Execution fields).
- **Job Closure → Man-hours and travel**: man-hours = operating hours × people assigned (the named crew still on the job, else the planned head count); travel = distance × 2. Each can be overridden; the new rule `closure.man_hours` (SDM and Deputy SDM by default) controls who.
- The jobs table is at D1's 100-column limit (on a table and on a result set), so the four fields live in `job_extras` (one row per job), written with the job and read beside it. Migration 0018 adds `companies` and `job_extras`.
- **Sales sheets**: the Activity sheet's Company, KM to location, Man-hours and Travel km now come from the job (in "Hours & distance", for every account); the Daily report's entity is suggested from the job's company (N / S).
- Data export & import now carry `companies`, `job_extras` and the four sales tables.
- **Verified:**
  - tests 280;
  - in the browser: a company added, renamed and removed; "sapesco" saved as SAPESCO and an unknown company refused; Closure showed 18.2 h × 3 people = 54.6 h and 120 km × 2 = 240 km; the Activity sheet read the same.

## 6z.1 — Activity sheet PDF on A3

- The Activity sheet has two PDF buttons: **PDF A4** (the columns open on screen, extra columns continue on further pages) and **PDF A3 · all columns** (every column on one A3 landscape page width; when they are wider than the page, columns and type shrink together). The PDF writer takes A3 as well as A4.
- **Verified:**
  - tests 280, including the A3 PDF holding 40 lines on one page;
  - in the browser: the October sheet's 50-odd columns printed on a single A3 page.

## 6z.2 — Activity sheet full-detail PDF

- The A3 "all columns" table was too cramped to read, so A3 now prints a **full-detail** layout: each job is a block with a title strip (ticket, well, unit, rig, status, company, who checked it, net amount) and every field below in labelled group blocks (Job, Crew, Dates, Hours & distance, Ticket & documents, Ticket follow-up, Revenue, Account details), spread across five columns of even height (`balance`), comments in full under them. Account-only fields keep their shading; fields an account doesn't keep are left out of its section.
- Buttons: **PDF table (A4)** (the columns open on screen) and **PDF full detail (A3)**.
- The table PDF's cell padding now scales with the type, so header words no longer split ("Revenu / e month").
- **Verified:**
  - tests 282;
  - October rendered: the full detail is 3 jobs per A3 page, and the A4 table header is clean.

## 6z.3 — PDF tables span the page

- The PDF tables (Daily report, Activity sheet table) now always share the full page width between their columns, in proportion to what each holds; before, a table narrower than the page stopped part-way across.
- Each column is sized from its longest filled value (empty cells no longer make a column narrow), with a minimum width for free text (remarks, comments).
- A table up to a third wider than an A4 page shrinks to fit the page instead of continuing on further pages; wider tables still continue.
- **Verified:**
  - tests 282;
  - the 28 Oct daily report renders across the full page with every status and unit name whole.

## 6z.4 — SLK Activity Dashboard; Activity sheet as foldable job lines

- **Renamed** Sales Dashboard → **SLK Activity Dashboard** (menu, page title, Users & Roles label, help and hints). The menu key `sales_dashboard` and the `/sales` address stay, so rights and links keep working.
- **Activity sheet on screen** now reads like its full-detail PDF:
  - one line per job with the basics (job, revenue month, account, company, field/rig, well, job type, job status, unit), grouped by account;
  - click a job (or its arrow) to unfold every field in labelled group blocks (Job, Crew, Dates, Hours & distance, Ticket & documents, Ticket follow-up, Revenue, Account details) and the comments; typed fields are edited in place, job fields link to the job stage; click again to fold;
  - Unfold all / Fold all jobs, and fold accounts as before;
  - the lock sits at the end of each line: an open lock checks and locks the line, a closed lock (green) shows it is checked and, for an Admin, unlocks it with a reason; a locked line also shows a small lock at its start, and its unfolded detail is read-only with who checked it.
- The A4 PDF table now prints the Job, Ticket & documents and Revenue columns with the other groups as summaries.
- **Verified:**
  - tests 282;
  - in the browser: unfold, edit stand-by, lock from the line end (inputs close, lock at start), Admin unlock, fold, unfold all 12.

## 6z.5 — Activity sheet PDF A4 in the full-detail layout

- **PDF A4** now prints the same full-detail layout as **PDF A3**: a title strip per job and every field in labelled group blocks, four columns on A4 (two jobs a page in October), five on A3. The A4 table layout is no longer offered on the Activity sheet (the Daily report keeps its table).
- **Verified:** tests 282; the October A4 PDF rendered.

## 6z.6 — Face ID / fingerprint and QR sign-in easier to find

- Face ID / fingerprint and QR sign-in were already in place (sign-in page buttons; set-up in the account menu), but production had 0 devices set up for 95 allowed people because the set-up was hidden in the account menu.
- After signing in on a device that can do it, people with no device set up now see an offer above the page: **Set up now** (opens the dialog), **Not now** (asks again in 14 days), **Don't ask again** (remembered on that device). It goes away once a device is set up.
- The account menu item now reads "Set up Face ID / fingerprint & QR sign-in"; the dialog (shared by both) adds the three steps for signing a laptop in with a phone's QR code.
- Help → "Signing in and moving around" explains both.
- **Verified:**
  - tests 282;
  - in the browser with a virtual authenticator: offer shown, set up from it ("Windows PC · Chrome"), offer gone, signed out, signed back in with Face ID.

## 6z.7 — GUI review against Apple's HIG (desktop, tablet, phone)

- Reviewed the schedule, job board, job editor, Activity sheet and Daily report at 1440, 820 and 390 px against the HIG foundations (accessibility, layout, typography, color) and the navigation, toolbar and button guidance. Text contrast passes everywhere (muted text 7.1:1 dark, 10.4:1 light; field borders 3.3:1); no text under 11 px.
- **Navigation on phones and tablets** (below 1024 px): the 9-group pill row was cut off ("SLI…", "Wi…") with nothing saying more was there. It is replaced by a location button ("Operation › Schedule") that opens a menu drawer listing every group and its pages as a two-level list, like a sidebar (sync status and country switch at its top; Escape, the backdrop or picking a page closes it). The page row keeps scrolling with an edge fade. Desktop keeps the group row.
- **Phone header** from four rows (~235 px) to two (~110 px): the wordmark hides under 480 px, the sync status moves beside the location button.
- **Export menu**: the Activity sheet (Excel, PDF A4, PDF A3) and the Daily report (Excel day, Excel month, PDF) put their exports in one pull-down instead of a row of buttons that wrapped onto two or three lines.
- **Page titles** 22 px on phones (28 px from 640 px up), so "SLK Activity Dashboard" fits one line.
- **Daily report** no longer scrolls sideways on a phone (the upcoming-operations table scrolls inside its card).
- **Selected pills** have an edge in the text colour, so the selection isn't shown by the lime fill alone (lime on white is 1.63:1).
- **Touch targets** on touch screens: sheet fields 40 px, tick boxes 28 px, unfold arrows, fold headers and job-link icons 44 px, ticket links 28 px tall.
- The Schedule's event buttons sit with the other controls on a phone instead of against the right edge.
- **Verified:**
  - tests 282;
  - captures at three widths: no sideways scroll at any width; on phones no target under 32 px except two on the Schedule; the menu drawer opens, closes and navigates; the Export menu works.

## 6z.8 — Large text and screen reader checks

- **Text follows the browser's text-size setting** (the web counterpart of Dynamic Type). Text sizes, line heights, control heights, spacing and breakpoints were fixed in pixels, so Chrome's "Font size: Very large" changed nothing. `build_tokens.py` now writes them in rem (16 px = 1 rem): identical at the default, and 14 px body text becomes 21 px with a 24 px browser root. Breakpoints in rem also mean the phone/tablet menu takes over when large text no longer fits the group row. Attendance's fixed 11 px labels moved to rem too.
- **Reflow at 320 px** (a laptop at 400% zoom): no sideways scroll on any screen. Fixed the Schedule month bar, the bonus distribution table on Closure and the Daily report's day picker. Long stage names ("PREPARATION") wrap inside their card at large sizes.
- **Screen reader audit** of 23 screens (2,169 controls): every control has a spoken name; one h1 per page and no skipped heading levels (Attachments, chart titles, Daily report cards and the Activity detail groups moved to h2); the header wordmark is no longer a focusable link hidden from screen readers; the hidden file pickers on Closure and Form templates are named; chart tables have column headers.
- **Keyboard**: every tab stop on the job board, Activity sheet and job Design shows a focus ring; date, month and time fields get the ring on their inner part too.
- **Verified:** tests 282; the checks above re-run clean.

## 6z.9 — Desktop sidebar (Apple HIG desktop review)

- **Review:** on a 1440 px desk the shell stacked three rows of equally weighted boxed buttons (header, nine groups, section pills) above every page, and the header carried the contact names and version. Apple's desktop guidance puts top-level navigation in a sidebar with at most two levels that people can hide (sidebars.md › Best practices) and lets branding defer to content (branding.md).
- **Sidebar from 1280 px:** groups with icons, pages indented under them, the current group always open and the others remembered as disclosures; the current page gets a soft fill and a 3 px lime edge. Mark and wordmark at the top, contacts and version at the bottom. The group button row is gone; the section pills show only when the sidebar is not.
- **Hide sidebar / Show sidebar**, remembered per browser. Below 1280 px (Apple: hide the sidebar as the window narrows) the menu button and drawer take over as before.
- **Verified:** tests 282; screen-reader audit 0 issues on 23 screens; no sideways scroll at 1280 px or 320 px; Control Room and Sunlight screenshots checked.

## 6z.10 — SLK Operations Hub: title block and About

- **Renamed** to SLK Operations Hub everywhere it is shown: wordmark, browser title, sign-in, emails' sender name, PDF footers, help text, the passkey name and the assistants' prompts.
- **Title block** in the header, after WIREGUARD's: the NESR mark sized to the name and the tagline under it, so they read as one lock-up. The small mark crammed beside a one-line name in the sidebar is gone; the sidebar keeps only Hide sidebar at the top, on a strip the height of the header.
- **About** (sidebar foot, with the version, and the account menu): a window sized to its content with version and build, what the app does, the authors and their email, © NESR. The names and version no longer sit in the header or under the sidebar.
- Help, Ask and the account name show their labels from 1536 px, so the desktop header stays one row in Sunlight's larger controls.
- **Verified:** tests 282; screen-reader audit 0 issues (2,152 controls); About opens with focus on Close and closes on Escape on desktop and phone; no sideways scroll; header and sidebar rules line up in both themes.

## 6z.11 — Rig Up (QAF14009) and tool string (QAF14010) diagrams

- **Owner decisions (2026-11-04):** one rig up per job and one tool string per run; the job's SDM reviews; the barrier table (Pressure Standard §9.2.8) is not applied; the parts catalogue is kept here, not in WIREGUARD; each diagram starts at Rev 0 and the first change after a PDF raises the revision.
- **Parts catalogue** (Database → Parts catalogue, migration 0019): 79 parts seeded from the two workbooks' pick lists, with lengths, IDs and connections only where the workbook gives them; the tab flags parts missing the sizes the checks use. Diagrams copy a part, so catalogue edits never change a filed diagram.
- **Editor** (Preparation → Rig up and tool string diagrams, `/operation/jobs/:id/diagrams`), after the approved mock in `design/pce-diagram`: catalogue on the left (a part drops into its place in the stack, or drag it to a row), the QAF sheet in the middle, row editor, checks and SDM review on the right. Autosave with a conflict check, Undo, ft/m, keyboard moves. A red pill marks connections that don't make up, with Add crossover.
- **Drawings:** every part redrawn as plain steel (no colours), after WirelineMaster: shaded cylinders, quick-union collars, side ports, rams, sheave and tree valves, one scale per family (15 in across the column for pressure control, 8.5 in for tools) so no part looks oversized; each row fills its height, so the stack reads as one continuous string on screen and in the PDF. (The workbook pictures were tried first and dropped: mixed scales and colours.)
- **Assembly as one drawing** (owner: the rig up looked deformed, the BHA too thick and running off the page): the column is one drawing down all the rows, like the workbook's merged Assembly cell. Each part is drawn with one scale for width and length (long parts shortened, short parts keep room for their features), the whole stack shrinks to fit, and a numbered tag ties each part to its row.
- **WHE parts redrawn after the Elmar WPCE catalogue** (owner: not close to a professional drawing): threaded male pin on top and knurled union nut at the bottom of every part, so nut sits over pin down the string; stuffing box with packing nut, hydraulic port and offset sheave on its bracket; tool catcher with release piston; tool trap with actuator and external handle; subs with needle valves; BOP as a square block with round ram bonnets, end caps, indicator rods and a manifold block; pump-in sub with side flange and 1502 hammer union; wellhead adapter flange with studs and nuts; tree with swab and master gate valves, flow cross and wing valves, handwheels edge-on.
- **Closer to the Elmar renderings, still grey** (owner choice over Elmar red): chrome shading lit from the front-left, taller ringed union nuts with a chamfered shoulder, slimmer lubricator tubes, large spoked sheave on a curved bracket, round BOP body with a ram housing ring per ram and long bonnets, shaded square blocks, adapter flange with a long threaded neck and bolt holes.
- **Elmar catalogue artwork, in grey** (owner: use exactly the Elmar graphics; owner accepts using NOV's © 2014 catalogue artwork internally): the parts are cropped from the vector rig-up on page 174 of the Elmar WPCE catalogue, rendered at 5x, item numbers, hoses and leader lines masked, turned grey with transparent backgrounds (PNG for the screen, JPEG for the PDF). They keep the catalogue's own size (it draws every part at one scale) and line up on each picture's string axis; only lubricators stretch along their length for 4 to 10 ft. Stuffing box, grease head, tool catcher / ball check, lubricator (lightweight, integral), tool trap, quick test sub, single/dual/triple BOP, pump-in sub and adapter flange use the artwork; chemical injection and bleed-off subs, crossovers and the client's tree stay NESR drawings at the same scale. The PDF's Assembly column is wider.
- **Owner follow-ups:** the client X-mas tree uses the QAF14009 workbook picture with the same grey treatment; chemical injection and bleed-off subs use the quick test sub artwork (a sub with a side port and needle valve), so they line up with the string; a leader dash left on the tool catcher is masked. OD and ID are editable on every row (OD / ID on the sheet and PDF). **Samples** (migration 0020): Start from saves the rows as a named sample per country and offers saved samples, the same diagram on previous jobs (this well first), this job's other runs and the templates.
- **Checks** (cited): rating ≥ 1.2 × SIWHP and the test pressure, H₂S service, connections, bore ≥ widest tool + 0.25 in, lubricator ≥ longest string with jars open + 3 ft, tool OD vs minimum restriction, weight above the jar vs balance + 40 lb, stuffing box / valve / tool catcher present. Not blocking.
- **PDF:** one A4 page in the QAF layout, filed with the job's attachments the first time per revision and on review. The lubricator length and the Preparation toolstring (Run 1) stay in step, so the report, package, pre-job note and checks keep working.
- **Workbook bugs left behind:** the Rig Up total skipped the Bleed-off Sub (39 ft instead of 41 ft); the String total in feet was labelled metres.
- **Verified:** tests 300; flow on the dev job: template, bad joint and Undo, send, review, PDF (filed), change after PDF → Rev 1 draft; no console errors; no sideways scroll at 390 px; both PDFs rendered and checked.

### 6z.11 — Diagrams pack for other apps

- **`design/diagrams-pack/`** (also zipped as `design/whe-bha-diagrams-pack.zip`): the Diagrams section packed so Claude can add it to a similar app. `SKILL.md` gives the steps and the host adapter, `README.md` the summary, `NOTICE.md` the artwork and brand rights (Elmar © NOV 2014, NESR mark and form numbers).
- `core/` is the app's `src/shared` diagram code unchanged, except `stamp.ts` (PDF date stamp, split from `formPdf`) and a trimmed `toolstring.ts` (only the `ToolPart` type). `server/diagrams.ts` is `createDiagramsRouter(host)`: database, user, job, rights, names, PDF filing, audit and the Preparation field sync come through a `DiagramsHost`. `client/` is the page with shims for the UI kit and API base; one migration (`0001_diagrams.sql`) holds parts, job diagrams and samples.
- **Verified:** the pack type-checks on its own (`tsc`, strict) and its 16 tests pass from the pack folder; the zip matches the folder file for file.

## 6z.12 — Diagram sheets in two layouts, and QAF14010 Rev 2

- **Owner decisions (2026-11-09):** both mocked-up presentations are built (`design/diagram-mockups`); the tool string follows the revised workbook, QAF14010 Rev 2.
- **Two PDF layouts**, picked beside the PDF button and remembered per browser; the PDF filed on approval uses the same choice. *Engineering sheet:* framed drawing sheet with zones, title block and sign-off, parts list, key data, checks, revision line, schematic with a running-length scale and balloons. *Data sheet:* header band with status, six key figures, schematic panel beside a numbered table, checks that need attention, sign-off strip. Both print the editor's checks for the job and the well figures from Preparation.
- **QAF14010 Rev 2:** upper and lower fishing neck (new `fn_lower_in` on parts and rows, migration 0021), max OD and ID, weight in lb and kg, totals with jars open, total depth MD (TVD when the job has it). The editor's BHA sheet shows OD / ID, upper / lower F/N and weight.
- **Verified by:** a Verify step between sending and approval; someone other than whoever prepared the diagram verifies it (admins may test it alone). Any change, or sending it back to draft, clears it, like the approval. "Reviewed" reads "Approved by the SDM" to match the form.
- The dark NESR mark is now embedded for these sheets; the picture data stays out of the browser bundle (checked in the build).
- **Editor sheet as the engineering sheet** (owner follow-up): the on-screen QAF sheet now matches the Engineering sheet layout for the rig up and the BHA: frame, assembly column drawn at the column's real size with the joint scale and balloons that select rows, parts list with paired two-line values, title block and sign-off. Editing is unchanged: row select, drag to reorder, row tools, keyboard, connection pills with Add crossover.
- **Verified:** tests 307; editor sheet checked for both diagrams (balloon click selects the row, crossover pill and Undo, no console errors, no sideways scroll at 390 px); both layouts rendered for the rig up and the BHA from the dev job and compared with the mockups; editor checked for Verify, layout choice kept after reload, Rev 2 columns, no console errors, no sideways scroll at 390 px.

## 6z.13 — Knowledge Hub in three sections, with document control

- **Owner request (2026-11-17):** three sections. *Lessons & best practices* (lessons learnt, best practices, learnings from incidents) filed under a country or Global. *SLK SOPs* by country or Global, listed Global first and then each country, each with its company: NESR, SAPESCO or Gulf Energy. *Client procedures* by country and client, consulted on jobs in that country. One Add document: the type is picked first and decides the section. Files in R2 in folders made as needed; everyone downloads; the admin replaces a file when it is updated and keeps the editable version of each document.
- **From the Document Control project** (`nesr/DOC_control`): a document number per entry, the current revision, a revision history that keeps every old file, the editable formats limited to admins (its Viewer role downloads PDF only), a review date, retire instead of delete, and a log of every download. Its approval workflow and download stamping were left out (not asked for).
- **Migration 0022:** `knowledge_docs` rebuilt (the lesson-only CHECK on `doc_type` can't be changed in place) with `section`, `company`, `client`, `doc_no` (unique), `revision`, `review_due`, `retired_at`; existing lessons copied as section `lesson`. New `knowledge_files`: one row per upload, `published` (the document) or `source` (the editable version), with the revision, change note and `superseded_at`. Exported with backups, never imported, like attachments.
- **Numbers:** blank means the next one under its prefix (LL-SA-001, SOP-GL-NESR-001, CP-BAH-001); an official number can be typed instead.
- **R2 layout:** `knowledge/<Lessons learnt | SOPs | Client procedures>/<Global | country>/<company or client>/<number title>/Rev N/<document | editable>/<file>`.
- **Rights:** the Knowledge Hub tab reads the whole library (Global and every country) and downloads the current file; its edit right adds and corrects entries and adds the first file; only admins replace a file (with a note, raising the revision), keep the editable version, open old revisions and retire or restore entries.
- **Job:** Preparation shows the client procedures for the job's country, the job's client first, with Download.
- **Gulf Energy** is a fixed SOP company, not added to Administration → Companies, so job company lists are unchanged.
- **Verified:** tests 317; on the dev server: SOPs, a client procedure and a lesson added through the API (numbers SOP-GL-NESR-001/002, CP-SA-001, LL-GL-001, a typed SAP-SLK-SOP-014), a client procedure under Global refused, replace without a note refused, replace with a note made Rev 1 and kept Rev 0, R2 keys in the folder layout, download logged in the audit trail; as a supervisor only the current file downloads (old revision and editable version 403, replace and retire refused); SOP tab grouped Global then Saudi Arabia, reader with history and admin controls, Add document form per type, client procedure on a Saudi job's Preparation; no sideways scroll at 390 px; no console errors on page load.

## 6z.14 — Document control in the Knowledge Hub

- **Owner request (2026-11-17, before deploying 6z.13):** add the Document Control app's approval workflow and download stamping, and every usable feature of it, so all document control is done here. A feature inventory of `nesr/DOC_control` found that only its sign-in, AI ask and stamped downloads ran on its server; the workflow, numbering, register, archive and manuals were demo screens. They are built for real here.
- **Workflow (migration 0023, `knowledge_revisions`):** draft → in review (a reviewer picked by the sender) → awaiting approval (an approver picked by the reviewer) → published. Sending back needs a reason and returns it to draft; the sender is emailed. Whoever submitted it can't review or approve it (admins can do every step). Reviewers and approvers are chosen by admins in Knowledge Hub → Settings (`knowledge_people`); they act with the tab's view right. Readers see published revisions only; staff (editors, reviewers, approvers, admins) also see drafts.
- **Revisions:** a new entry starts as a draft at Rev 0 or a typed number (to bring in an existing numbered document). "Start Rev N" opens the next revision of a published document; the published one stays live until the new one is approved, then it is superseded and kept. One open revision at a time; a draft of a later revision can be discarded. Files belong to their revision and can only change while it is a draft. This replaces 6z.13's direct "replace with a new revision".
- **Required files** (Document Control's required formats): SOPs and client procedures need a PDF and the editable Word or Excel version before review; a form needs its fillable file; a lesson needs a file or a written summary.
- **Who opens what:** readers download the published document; editors, reviewers, approvers and admins also the editable version and the files of a revision being worked on; reviewers, approvers and admins also older revisions. A document marked as a form lets everyone download the fillable file (Document Control's Forms exception).
- **Download stamping** (`pdf-lib` 1.17.1, server only): every page of a downloaded PDF gets a footer with the number, revision, "Controlled copy, uncontrolled when printed" (or the status when not approved), who downloaded it, the date, a COPY-XXXXXXXX number and the page count; a revision not yet approved also carries NOT APPROVED across each page. The copy number goes in the audit trail with every download. A PDF that can't be opened is served unstamped and logged as such. Word and Excel files are not stamped (Document Control stamped only the placeholder files it generated).
- **Dates:** approval sets the next periodic review to 12 months later; each revision has an expiry (revision date + 36 months unless typed). Review is flagged 30 days before and when overdue, expiry 90 days before and when expired, in the lists, the reader and the register. Admins can move a review date by hand.
- **Numbering settings** (`knowledge_settings`): automatic or manual (manual requires the typed number), a prefix per section, 2–6 digits, place code on or off, with a preview of the next number.
- **Register** (the API Q2 document register): tiles and filters (published, in review or approval, drafts, review overdue, expired or expiring, external, retired), a table, and Excel / CSV export of the filtered rows with 15 columns.
- **Queue:** what waits on me (to review, to approve, sent back to me) and everything in progress; a count on the tab.
- **Archive:** retiring needs a reason (admins and approvers); retired documents are listed with who, when and why, and can be restored.
- **Also from Document Control:** origin internal or external (external shows a controlled-distribution note), author, QR code that opens the published revision, batch upload (files with the same name make one document, type and number read from the name, optional send to a reviewer), Reference manuals (uncontrolled folders, admins manage, everyone downloads, downloads logged).
- **Left out:** product lines, user invites and passwords (WIREGUARD and countries cover these), impersonation, and Ask AI over documents (needs text extraction and a vector index; the AI Agent stays as it is).
- **Backups:** reviewers, settings and manual folders are in the data package; revisions and manual files are exported with it, never imported.
- **Verified:** tests 329; all migrations applied to a fresh database; on the dev server with four fixture accounts: a new SOP hidden from a reader as a draft, review refused without the PDF and editable version, submit to a non-reviewer refused, files locked during review, approver can't skip the review, send back needs a reason, resubmit, review to approver, approve publishes Rev 0 with review +12 months and expiry +36 months, reader downloads the stamped PDF and is refused the editable version, Rev 1 started while Rev 0 stays live, second open revision refused, retire refused to a reader and without a reason, register and manuals checked, settings validation and manual numbering; both stamped PDFs rendered (draft with NOT APPROVED, published as controlled copy); reader with revisions and QR code, settings, register, queue, archive and manuals pages at desktop and 390 px with no sideways scroll; batch upload made two documents and sent them for review; no console errors on page load.

## 6z.15 — Forms and work instructions, AI-read Add document, dashboard, QR codes, admin settings

- **Owner request (2026-11-17):** a section for Forms and one for Standard Work Instructions (SWI), forms downloadable by users in their original format (Excel, Word, PowerPoint, PDF); the Settings page was locked for admins; add the dashboard; Add document uploads first and fills every field by AI analysis of the document, which the user can change before saving; a QR code for every document.
- **Sections (migration 0024):** `swi` and `form` join lessons, SOPs and client procedures. Both are filed under Global or a country and a company (NESR, SAPESCO, Gulf Energy), listed Global first, numbered SWI-… and FRM-… (prefixes in Settings), and go through the same review and approval. An SWI needs a PDF and the editable version before review, like an SOP; a form needs only its file, in any of the accepted formats. Everyone downloads a published form as it is (PDFs are still stamped); the download is logged with a copy number. `knowledge_docs` was rebuilt for the section CHECK; its files and revisions were copied aside and put back, because dropping the table would cascade-delete them (row counts and the foreign key check were compared before and after).
- **Add document starts with the file:** pick the document (and optionally the editable version), then Read the document. The Worker sends a PDF or picture to Claude as it is, and the text of a Word, PowerPoint, Excel, text or CSV file (read from the zip in the Worker); Claude answers in a fixed JSON shape (type, country, company, client, title, number, category, summary, key action, failure types, author, revision, dates, origin, a note). The answer is cleaned (known countries and companies only, real dates, revision as a number), the fields it filled are outlined, and the person corrects them before saving. Fill in by hand skips it; when AI is off, over budget or not set up, the name of the file still gives the type, number and title. It uses the AI Agent settings (on/off, model, monthly budget, daily limit) and is counted in AI usage as `document` (`ai_usage` rebuilt for the new feature).
- **Settings unlocked for admins:** the reviewer and approver boxes of admin accounts were fixed as ticked; they are now ordinary choices (admins are ticked until changed, and can still step in on any document). Only ticked people are offered as reviewers and approvers. Numbering saved before this release keeps working, with the SWI and FRM prefixes added from the defaults.
- **Dashboard** (editors, reviewers, approvers, admins): eight tiles (published, in review, awaiting approval, drafts, review overdue, expired, external, downloads), bars by section, by country, by company, approvals by approver, downloads by month, the most downloaded documents, and the lists of reviews and expiry coming up and of what is waiting in review or approval.
- **QR codes:** a QR button on every row and card in every section and in the document, for drafts too, with SVG, PNG and a printable label; it opens the document at its published revision.
- **Verified:** tests 339; migration 0024 applied locally with the same document, file and revision counts before and after and no foreign key errors, and applied to a fresh database; analysis route refuses readers and, without the API key, answers with the fill-by-hand message (the live Claude call is checked on production, where the key is set); in the browser: Forms and SWI tabs and empty states, Add document upload step, fallback filling type Form, number FRM-GL-NESR-005, title, Global, NESR from the file name, saved as a draft, sent through review and approval, the Forms list offering XLSX and QR, the QR dialog with SVG/PNG/print, a reader downloading the Excel file unchanged with a copy number, the dashboard figures, admin approver box unticked and ticked again and saved; 390 px with no sideways scroll on SWI, Forms, Dashboard, Settings and the Add document dialog; no console errors on a fresh load.

## 6z.16 — Slides for the crew, Read opens the PDF, mind maps for the job

- **Owner request (2026-11-17):** Present to the crew makes detailed slides from the document; Read just opens the PDF; mind maps so documents need not be read again when consulted during the job.
- **One AI pass per published revision** (migration 0025, `knowledge_digests`): Claude reads the revision's document file (PDF as it is, Word, PowerPoint, Excel or text as their text; a lesson without a file uses its summary and key action) and returns, in a fixed shape, a 5 to 12 slide deck and a three-level mind map. The prompt keeps the document's numbers, limits and names and adds nothing. Saved per document and revision, so it is made once, the first time anyone presents it or opens its mind map, and then opens straight away for everyone; staff can make it again. Uses the AI Agent settings and budget, counted as `document` in AI usage, logged in the audit trail.
- **Present to the crew:** for every published document (not only lessons). Slide styles: title, points, numbered steps, an amber "stop the job / key action" slide, and questions for the crew, with a presenter note and a progress bar. A toolbox talk of several lessons uses the saved slides of each and the summary for any not made yet (with a note); without AI the summary slides are shown with the reason.
- **Read:** opens the document's PDF in a new tab (the stamped copy, logged as a download). Details opens the record, revisions and files. Documents without a PDF open their details.
- **Mind map:** the subject in the middle with branches on both sides and exact values as chips; one column on a phone; full screen with larger type for the unit; print as a one-page outline. In every list (a button per published document), in the document's details, and on the job.
- **Job:** Preparation's "Procedures for this job" lists the client procedures of the job's country (its client first) and, folded, the SLK SOPs and work instructions for that country and Global, each with Read, Mind map and download.
- **Verified:** tests 346; migration 0025 applied locally; the dev server has no Anthropic key, so the AI pass returns the "AI isn't set up" message and was not run end to end here (it is checked on production); with a hand-written sample deck and map saved for one test document (removed afterwards): mind map in the list dialog and full screen, five slides (title, points, steps, stop-the-job, questions) with arrow keys, Read links going to the inline stamped PDF in a new tab, the summary fallback with its note for a lesson, the job's Procedures for this job with the folded SOPs and the mind map dialog; 390 px with no sideways scroll on the job, the details with the map and the lessons; no console errors.

## 6z.17 — Support files, two-slide lessons as PowerPoint and PDF, the AI Agent reads the mind maps

- **Owner request (2026-11-17):** support documents, videos and pictures listed below each document to view and download; lesson slides at most two, with pictures, made as PowerPoint and downloadable as PowerPoint or PDF; Present to the crew only for lessons (not SOPs, forms, SWIs, client procedures or reference manuals); a more professional mind map, with mockups to choose before deploying; mind maps used by AI to answer faster when a document is needed elsewhere.
- **Support files** on every Knowledge Hub entry (were lessons only): pictures as a gallery with a full-screen viewer, videos played in the page, other files listed with View and Download; editors add (drag and drop) and remove. Videos (MP4, MOV, WebM) accepted up to 50 MB (the Worker holds an upload in memory), other files 25 MB as before. Attachments now answer byte-range requests (206, 416) so videos can be scrubbed. Videos are stored with the existing category "other" (the attachments table's CHECK predates them; the gallery groups by file type).
- **Lesson slides:** the AI pass now makes exactly two slides for a lesson (what happened; what we do now, with the key action in an amber box) and none for other sections, which only get the mind map. Each slide shows one of the lesson's support pictures (oldest first). Older, longer decks are cut to their first two content slides; without AI the two slides come from the summary and key action. Present to the crew is offered on lessons only.
- **PowerPoint and PDF:** `src/shared/lessonDeck.ts` lays the two slides out once on a 960 x 540 widescreen page and writes them as Office Open XML (theme, master, layout, slides, pictures; no dependency) and with the app's PDF writer (new 16:9 SLIDE page; large photos now embedded in chunks). Built in the browser from the saved slides and the pictures converted to JPEG. Buttons in the lesson's details and in the toolbox talk.
- **AI Agent:** two new tools for people with the Knowledge Hub tab: find_documents (published documents by words, section, country) and document_mindmap (the saved mind map of one document, with its number and revision). The system prompt sends procedure, limit, client-requirement and lesson questions through them, citing the document.
- **Mind map look:** three mockups in `design/mindmap-mockups` (logic chart, balanced map, structure cards) with values, limits and stop-work conditions as coloured chips; waiting for the owner's choice before it is built.
- **Verified:** tests 351; the generated PowerPoint opened in Microsoft PowerPoint (2 slides, 960 x 540, exported to PNG and saved as PDF) and the generated PDF rendered with pdf.js, matching; in the browser: a picture and a test video added to a lesson, the gallery, the video player, a byte range (206 with the right bytes, 416 past the end), a 51 MB video refused, PowerPoint and PDF downloads produced with the right names and types, the toolbox talk with the picture beside slide 1 and the summary fallback note, test files removed; 390 px with no sideways scroll; no console errors.

## 6z.18 — Mind map as numbered structure cards (option C)

- **Owner decision (2026-11-17):** option C of the mockups (`design/mindmap-mockups`): structure cards, top-down, numbered.
- **Look:** the subject on top, a rail, and one numbered card per topic in the document's order, each with its colour (chart tokens, so light and dark both work); the stop-work topic is a red-tinted card. Details under each point are chips: grey for values, amber for limits, red for stop-work conditions, with a key above the map. One column on a phone; full screen with larger type and the key; the printed sheet uses the same cards in three columns with print colours.
- **Data:** every mind map node now carries a kind (value, limit, stop or none), asked for in the AI prompt (stop-work conditions grouped in one branch marked stop; details as short exact values) and kept by the cleaning; maps made before keep working, with stop branches found by their name. The AI Agent's document_mindmap result explains the kinds, so limits and stop conditions are stated exactly.
- **Verified:** tests 351; a tagged sample map saved for one local test document (removed afterwards) shown in the list dialog and full screen, dark and light, matching the mockup; 390 px with nothing past the right edge; build clean.

## 6z.19 — Support files under each document; lesson slides with all explanations and pictures

- **Owner request (2026-11-17):** extra documents listed below the main document with download, read and QR, no mind map; the crew slides for a lesson use all its explanations and pictures, and when they can't be made, the lesson learnt itself is used.
- **Support files in the lists:** the library now returns each entry's support files, listed under the document in every section's list, on the lesson cards and in the job's Procedures for this job: name and size, Read (opens PDFs, pictures and videos in the browser), Download, and a QR code of its own. A scanned support-file code (`/knowledge?doc=…&file=…`) opens that file after sign-in. No mind map for support files.
- **Lesson slides:** the AI is asked to keep all the lesson's explanations (every event, cause, contributing factor, consequence, action and recommendation), up to eight points per slide; all the lesson's support pictures are spread over the two slides (first half beside slide 1, the rest beside slide 2) as a grid of up to six each, on screen and in the PowerPoint and PDF downloads. Text shrinks to fit (down to 10 pt in the files).
- **When the slides can't be made:** the toolbox talk shows the lesson's own PDF (embedded) with the reason, and the PDF button gives that document; a lesson with no PDF still falls back to slides from its summary.
- **Checked:** a PDF opens inline in Microsoft Edge with the app's security headers, both in its own tab (Read) and embedded in the page (the fallback); the browser pane in this session downloads PDFs instead of showing them, so Edge was used for these two checks.
- **Verified:** tests 353; the three-picture slide opened in Microsoft PowerPoint (2 slides, pictures in a grid); in the browser: a test lesson with a PDF, a picture and a report published through review and approval, its support files listed under it with Read, Download and QR, the file QR link opening the picture, the toolbox talk showing the lesson PDF when no slides exist (Edge), and with a saved two-slide sample all explanations and three pictures (two beside slide 1, one beside slide 2); test lesson retired and test files removed; 390 px with no sideways scroll on the SOP, lessons, forms and client lists and the job's Preparation (a support-list overflow found and fixed); no console errors.

## 6z.20 — Present to the crew removed; Read is the briefing

- **Owner decision (2026-11-17):** the two-slide presentation was still too basic; remove it and keep Read.
- **Removed:** Present to the crew (lesson cards, Lesson of the Week, details), "Present these N as a toolbox talk", the lesson PowerPoint and PDF downloads, and the code behind them (`src/shared/lessonDeck.ts`, `src/client/pages/knowledge/lessonExport.ts`, their tests). The slides can't be better than a text summary because the pictures and layout inside a lesson's PDF can't be taken out of it; Read shows the lesson document itself, full screen in the browser.
- **AI:** the AI pass now makes only the mind map (the answer's slides field stays, always empty, so saved rows keep their shape); slides in older saved rows are ignored. Messages and the audit line say "mind map".
- **Kept:** Read, Mind map, support files with Read, Download and QR, the Lesson of the Week.
- **Verified:** tests 346; type check and build clean; in the browser no Present, toolbox talk or PowerPoint controls remain, Read, Mind map and Details on the Lesson of the Week and the cards; no console errors.

## 6z.21 — SAPESCO and Gulf Energy copies of global NESR SOPs and SWIs

- **Owner decisions (2026-11-18):** option B of the mockups (`design/sop-company-mockups`): the app writes the company Word file; the copy goes through review and approval; an admin saves it as PDF in Word and uploads it. Defaults kept as shown in the example: revision and date follow the NESR document, "SAPESCO" and "Gulf Energy" in the text, client names unchanged, no contents page added.
- **Conversion** (`src/shared/companyCopy.ts`, no dependency): opens the NESR .docx and the company template (one of its own SOPs in Word). Header and footer parts are taken from the template by type (default, first page), with the template's own title, number, revision and date replaced by this document's (read from the NESR footer); the logo and other pictures are copied in. The NESR colour (024800) becomes the company colour in the body, tables and borders. Text rules: the admin's extra words, "National Energy Services Reunited" to the full name, NESR document numbers to the company prefix (NESR-8000-SOP-04 → SAP-8000-SOP-04, so references to other SOPs follow), then NESR to the company name. Cover names after Prepared By, Reviewed By, Segment Approval and Corporate Approval become the company's where set. Matching runs on whole paragraphs but changes only the runs and characters that differ, so formatting such as the raised "th" in dates is kept. Anything still saying NESR is listed for the person checking it. `unzip` can now keep every file of a package.
- **Data:** migration 0026 adds `copy_of` and `copy_of_revision` to knowledge_docs (one live copy per company of each NESR document). Templates and their settings live in knowledge_settings (key `copies`); template files in R2 under `knowledge/Templates/<company>/`.
- **Routes:** `POST /api/knowledge/:id/copies` (editors and admins) makes or remakes the copies from the newest NESR editable .docx: a new copy document, a new draft revision when the copy is published and behind, or a fresh Word file in a copy's existing draft; a copy in review or approval, or already at that revision, is left alone with the reason. `PUT /api/knowledge/settings/copies` and `POST|GET /api/knowledge/settings/copies/:company/template` for the templates (admins change them).
- **Screens:** the question after saving a global NESR SOP or SWI with its Word file and after publishing a revision that has copies; "SAPESCO and Gulf Energy copies" panel in the details with Make company copies; on a copy, what it was made from and the three steps while it waits for its PDF; copies listed under the NESR document with Published, Draft: needs its PDF, In review or Behind the NESR source; the Queue marks copies and "waiting for an admin to add the PDF"; Settings › Company templates (template, prefix, colour, names, cover approvers, extra words, NESR colours). Help updated; a stale "pictures are used on the lesson slides" line removed from Support files.
- **Verified:** tests 358 (new: companyCopy, 9); type check clean. Conversion run on the real NESR-8000-SOP-11 with the real SAPESCO and Gulf Energy SOPs as templates; both copies opened in Microsoft Word, saved as PDF and matched the company covers, headers and footers, nothing left saying NESR. In the local app (test admin): both templates uploaded, a global NESR SOP added with its PDF and Word file, both copies made from the details, the SAPESCO Word file fetched from storage, saved as PDF in Word, uploaded, sent through review and approval and published; list, Queue and Settings checked; publishing the NESR revision brought up the question, and remaking skipped the published copy with its reason. A join-order bug in the Queue query found and fixed. 390 px with no sideways scroll on the list, both details, the dialog, the Queue and Settings. The only console errors came from earlier steps (before sign-in, the Queue bug before the fix, one wrong reviewer pick). Test documents retired and test files removed.

## 6z.22 — Add a missing company template from the copy question

- **Owner report (2026-11-18):** on production the copy question showed both companies greyed out with "Make 0 copies": no templates had been added yet, and the only way was Settings.
- **Change:** when a company has no template, an admin now sees "Add the SAPESCO template (.docx)" (or Gulf Energy) right in the question; once added, that company is ticked and ready. Others are told to ask an admin. With nothing ticked the button says "Make copies". A ready company with no cover names set says the NESR names are kept until an admin sets them in Settings.
- **Verified:** tests 358; type check clean; in the local app with both templates cleared, the question shows both upload buttons and the plain "Make copies"; 390 px with no sideways scroll.

## 6z.23 — Company copies from an older Word file

- **Owner report (2026-11-18):** NESR-8000-SOP-02 refused with "Company copies are made from the NESR Word file (.docx)" although it has an editable version: the stored file is not a .docx (an older .doc, for example), and replacing it would mean a new NESR revision with review and approval.
- **Change:** the message now names the stored file and says what to do; the copy question then offers "Pick the .docx file". The picked file is used only to make the copies (the NESR record and its files stay as they are); the copy follows the NESR document's newest revision number and date. `POST /api/knowledge/:id/copies` takes the .docx as the body with `?companies=`.
- **Verified:** tests 358; type check clean; in the local app a global NESR SOP whose editable version is a .doc: making the copy gave the named-file message and the Pick the .docx file button; sending the .docx made SAP-8000-SOP-92 Rev 4 with nothing left saying NESR. Test documents retired, test files removed.

## 6z.24 — Editable versions are Word .docx only; admins replace the published one

- **Owner request (2026-11-18):** an option to replace the editable files, and no uploads of editable files that aren't .docx.
- **Rule** (`editableProblem`, `editableAccept` in knowledgeControl): the editable version of an SOP, SWI, client procedure or lesson must be a Word .docx; a document marked as a fillable form may also use an Excel .xlsx; forms under Forms keep any format (that file is their document). Checked by the server on every upload (Add document, the draft's file buttons, Add several, the admin replacement), by the file pickers (they offer only .docx) and before saving Add document. An older .doc or an Excel file is refused with how to fix it (Word › Save As › Word Document (.docx)). Add several leaves such a file out and says so on that line. A draft still holding an older .doc can't be sent for review until it is replaced.
- **Replace on a published document:** admins get "Replace the editable version (.docx)" under the published revision in the details. It replaces the Word file in place: the PDF, the approval and the revision stay; the old file is kept (superseded) and named in the audit line. Others still change files through a new revision.
- **Verified:** tests 359; type check clean; in the local app on a published SOP: a .doc refused with the message, a .docx accepted and shown as the editable version with the PDF unchanged, uploads outside a draft still refused for non-admin paths; the button shows with a .docx-only picker; 390 px with no sideways scroll. Test document retired, test files removed.

## 6z.25 — Screen size: four sizes, smaller by default on computers

- **Owner request (2026-11-18):** text too big compared with the UC Wireline Operations app on the same screen; an option for at least four display sizes.
- **Change:** a Screen size picker in the account menu, below Large touch controls: XS 13 px, S 14 px, M 16 px (the size until now), L 18 px. It sets the root font size, and because the app's text, spacing and control heights are all in rem, everything scales together, like zoom. Computers now open at S; phones and tablets keep M so touch targets stay large. The choice is kept per device (`slk-size`) and applied in index.html before the first paint, like the theme. Help updated.
- **Verified:** tests 361 (new: display, 2); type check clean; a job's Design page at S by default (root 14 px); XS, M and L each at 1280 px and 390 px with no sideways scroll; the picker in the account menu switching to XS at once and remembered; no console errors.

## 6z.26 — Winch data: plots and guidelines check on Closure

- **Owner request (2026-11-18):** add the standalone "Winch Data — Plots & Guidelines Check" module under Closure in the job, as a first step before tailoring it.
- **Change:** a "Winch data: plots and guidelines check" section on the job's Closure tab, loaded only when Closure opens. Same five steps as the module: the winch export (delimiter, preamble and header found by themselves; columns and units guessed from the header names and changeable), the well zones (four depths or a directional survey file), the rules (post-seasoning and seasoning sets, every limit editable, restore defaults, save or load a rules file), the run details (filled from the job: ticket, well, unit, cable, start date, the signed-in person) and the check. Results: eight figures (max depth, RIH, bottom, POOH times, average speeds, max tension, violations), the rule set switch, a Time view (depth, speed and tension against time, zone shading, red and amber bands, a hover readout, drag to zoom), a Depth view (speed and tension against depth, trip in and out, dashed limit lines) and Findings (by zone, the guidelines check, every violation and advice, phases), with a findings CSV and Print. A demo run to try it without a file.
- **How:** the analysis is ported to `src/shared/winchData.ts` (no dependency, tested); the charts are plain SVG in the theme colours instead of Plotly from a CDN, so they follow dark and Sunlight and add nothing to the page load.
- **Not yet (for tailoring):** nothing is saved to the job (file, results or sign-off), and the rule limits are kept per device, as in the module.
- **Verified:** tests 373 (new: winchData, 12); type check clean; in the local app on a job's Closure: the demo run checked, Time view, Depth view and Findings drawn (8 violations, 1 advisory on the demo), the hover readout working; 390 px with no sideways scroll and the depth panels stacked; no console errors from the app.

## 6z.27 — Doc Control tab, QAF numbers for forms, optional editable version for client procedures, lesson copies in PowerPoint

- **Owner request (2026-11-19):** in the Knowledge Hub, make the editable version optional for client procedures and reference manuals; forms use the QAF number they already have or get one, with a record of what is uploaded so nothing is filed twice; put Dashboard, Queue, Register, Archive and Settings under one Doc Control tab; add PowerPoint templates so lessons learnt can be changed to the other companies.
- **Client procedures:** go to review with the PDF alone; an editable version, when added, must still be a .docx. Reference manuals were already uncontrolled and never asked for one. SOPs and SWIs still need theirs.
- **Forms and QAF numbers:** a form's number is a QAF number. Add document asks for the QAF number already assigned (written QAF14009, QAF-14009 or "QAF 14009"), or leaves it blank and the app gives the next free one (one above the highest in use, as wide as it). Any other kind of number is refused for a form. A number already used, retired forms included, is refused with the form that has it, for every section. A form file already uploaded under another live form (same SHA-256) is refused, with its number and title; Add document checks both before anything is saved. The Forms tab opens with the QAF number record: every number, title, where it is filed, its status and the files uploaded under it (who and when, for staff), with search and the next free number (`GET /api/knowledge/forms-record`). Add several reads "QAF14009 Pre-job checklist.xlsx" as a form with its number.
- **Doc Control:** one tab for editors, reviewers, approvers and admins, with Dashboard, Queue, Register, Archive (admins and approvers) and Settings under it; the queue count shows on the tab. Old links (`?view=queue` in the review emails) open the same screen.
- **Lessons in PowerPoint:** a lesson's editable version is its PowerPoint (.pptx) or Word (.docx) file. Lessons from any country (not copies, not filed as SAPESCO or Gulf Energy) get SAPESCO and Gulf Energy copies like global SOPs and SWIs: asked after saving a lesson with its .pptx and after publishing a revision of one with copies, and from its details. `makeCompanySlides` (in companyCopy, no dependency) builds the copy inside the company's own presentation: its slide masters, layouts, theme and logo stay, its own slides (and their notes and section list) are taken out, and each NESR slide goes on the company layout of the same kind (title, title and content, else by name, else content); pictures, charts, SmartArt and other parts the slides use are copied once under free names with their content types; speaker notes and comments are left out; text, document numbers and the NESR colour change as in the Word copies, also inside SmartArt. A different slide size is flagged for checking. The paragraph engine now reads PowerPoint text (a:p and a:t) as well as Word. The copy is a lesson draft (number SAP-LL-GL-004 and so on) holding the .pptx; it shows as the company's copy in the lessons list and the Queue says "Slides copy made: waiting for an admin to add the PDF". Settings › Company templates takes a PowerPoint template per company next to the Word one (`?kind=slides` on the template routes).
- **Verified:** tests 384 (new: knowledgeDocControl, 11); type check clean. A lesson deck and a company template made in PowerPoint, the copy made by the app opened in PowerPoint without repair (3 slides on Title Slide and Title and Content, the template's sample slide gone) and saved as PDF: the company band and logo from the template, NESR → SAPESCO, NESR-8000-SOP-11 → SAP-8000-SOP-11, the green box red, the picture kept. In the local app (test admin): slides template uploaded (a .docx refused), lesson added with its .pptx (a .ppt refused), the SAPESCO copy made and the stored file opened in PowerPoint, Gulf Energy skipped with the reason; forms QAF94009 (typed as qaf-94009) and QAF94010 (blank), the same number and the same file refused with the form named, a non-QAF number refused; the record listed both with the file; a client procedure sent for review with its PDF only; Doc Control with its five screens, the old `?view=queue` link, Settings with both templates, the copy question for a lesson; 390 px with no sideways scroll on Doc Control, Queue, Settings and Forms; no console errors on load (only the deliberate refusals). Test documents retired, test files removed, the mock slides template cleared.

## 6z.28 — NESR version of a SAPESCO or Gulf Energy lesson

- **Owner request (2026-11-19):** when a lesson learnt is not from NESR, give the option to generate a NESR version.
- **Whose lesson:** Add document and Edit details now ask the company for a lesson too (NESR, SAPESCO or Gulf Energy; NESR by default). Lesson cards show SAPESCO or Gulf Energy, and a copy as "NESR copy" or "SAPESCO copy".
- **NESR version:** a SAPESCO or Gulf Energy lesson that is not itself a copy gets Make the NESR version (in its details, and asked after saving it with its .pptx) instead of company copies. The app builds it in NESR's own presentation, with the same slide engine run the other way (`makeCompanySlides(..., { toNesr: true })`, `nesrRules`): the company's extra words back, its full name to National Energy Services Reunited, its number prefix to NESR (`nesrNumber`: SAP-LL-GL-004 → NESR-LL-GL-004, LL-OM-002 → NESR-LL-OM-002), its name to NESR, its colour to the first NESR colour; anything still saying the company's name is listed. It is a lesson draft filed as NESR, waiting for its PDF, then review and approval, like the other copies. The copy route takes the targets from `copyTargets` (NESR documents → SAPESCO and Gulf Energy; their lessons → NESR) and refuses others.
- **NESR template:** Doc Control › Settings › Company templates has a NESR block for NESR's own PowerPoint template (`POST|GET /api/knowledge/settings/copies/NESR/template?kind=slides`; NESR takes slides only).
- **Verified:** tests 385 (round trip SAPESCO → NESR added); type check clean. In PowerPoint: the SAPESCO copy of the test lesson turned back into NESR in a NESR template (green band and logo), opened without repair, 3 slides on Title Slide and Title and Content, NESR, National Energy Services Reunited and NESR-8000-SOP-11 back, the box green again. In the local app (test admin): the NESR slides template uploaded (a Word upload for NESR refused), a SAPESCO lesson with its .pptx, the NESR version made as NESR-LL-GL-005 with nothing left saying SAPESCO, asking that lesson for a SAPESCO copy refused; the details panel ("NESR version", Make the NESR version again), the question with what changes back, Settings with the NESR block, the lesson cards and the Company field on a lesson at 390 px with no sideways scroll. Test documents retired, test files removed, the mock NESR template cleared.

## 6z.29 — Delete drafts that were never published

- **Owner request (2026-11-19):** let admins and other roles delete drafts; a draft doesn't need to go to the archive.
- **Change:** Delete draft in a document's details, in place of Retire, for a document that was never published and whose revisions are all drafts (or discarded). Two steps: Delete draft, then "Delete SOP-GL-NESR-021" or Keep. Admins, approvers, editors and anyone with the Knowledge Hub delete right may do it; reviewers alone may not. `DELETE /api/knowledge/:id` removes the record, its revisions, files, support files and mind map, clears any "duplicate of" pointing at it, then the files in storage; the audit trail keeps "Draft deleted: … (never published; N files removed)". A draft in review or approval is refused (send it back first), a published document is refused (retire it), a draft with company copies is refused until they are deleted. A deleted form draft frees its QAF number.
- **Fix found while testing:** a new SWI could get a number without its prefix ("-GL-NESR-001") when the numbering settings had been saved before SWIs and forms existed: the library and Add document read the saved settings without filling in the missing prefixes. Both now use the helper that does (`numberingOf`). Documents already numbered that way on production would keep their number until edited.
- **Verified:** tests 387 (new: deleting drafts, 2; the old "no delete" assertion updated); type check clean. In the local app (test admin): a draft SOP with its PDF and a support file deleted from its details (confirm step at desktop and 390 px, no sideways scroll): its rows gone, its PDF gone from storage, the audit line kept; a draft in review refused, then sent back and deleted; a published form refused; a new SWI numbered SWI-GL-NESR-001 after the fix. Test documents deleted.

## 6z.30 — Forms keep the number they already have

- **Found (2026-11-19):** a read-only check of production for numbers missing their prefix found none. The saved numbering settings there have no SWI or form prefix, which the 6z.29 fix already covers for new documents. The one form on production is numbered QAF-14110-GL-NESR-001, and since 6z.27 any form whose number isn't a plain QAF number (that one, or an older FRM- number) could no longer be edited: Edit details refused it with "Form numbers are QAF numbers".
- **Fix:** `checkDoc` takes the document's current number; a form keeps the number it already has when its details are edited. A new number typed for a form must still be a QAF number.
- **Verified:** tests 387 (form number cases added); type check clean. In the local app: the form FRM-GL-NESR-005 saved with its number unchanged; changing it to a non-QAF number still refused.

## 6z.31 — Filters: lessons by company, client procedures and forms by country

- **Owner request (2026-11-19, with a screenshot of the SOP filters):** lessons learnt and SWIs filtered like SOPs, by company and Global or country; client procedures told apart by country; forms by company and by country.
- **Change:** Lessons & best practices gets the company chips (All companies, NESR, SAPESCO, Gulf Energy, with counts; a lesson with no company counts as NESR) next to its country list; the counts of types, categories, failure types and countries follow the company picked (`filterLibrary` takes `company`). Work instructions already had the same company chips and country list as SOPs; they show once the section has documents. Client procedures show the countries as chips (All countries, then each country with its count) instead of a list; Forms show the company chips, then the country chips. Company counts follow the country picked and the other way round.
- **Verified:** tests 388 (lessons by company added); type check clean. In the local app: the filters on Lessons, SOPs, Forms and Client procedures as above, picking SAPESCO on Lessons narrows the list; 390 px with no sideways scroll on all four.

## 6z.32 — Best practice PowerPoint templates for NESR, SAPESCO and Gulf Energy

- **Owner request (2026-11-19):** an option to upload PowerPoint templates for the three companies for best practices.
- **Change:** each company in Doc Control › Settings › Company templates has two slides templates: Lessons slides (lessons learnt and learnings from incidents) and Best practice slides. The NESR block (for NESR versions of SAPESCO and Gulf Energy documents) has the same two, and now sits as wide as a company card. A best practice's copies (SAPESCO and Gulf Energy, or its NESR version) are built in that company's best practice template; until one is added, the lessons template is used, and the copy question says which template each company's copy will use ("With SAPESCO's best practice template"). An admin can add a missing best practice template right in the question. Settings keeps `slidesBp` per company and `nesrSlidesBp`; the template routes take `?kind=bp` (`slideTemplate`, `slideKindOf` in companyCopy).
- **Verified:** tests 390 (template choice and fallback, settings keep the uploads); type check clean. In the local app: lessons and best practice templates uploaded for SAPESCO and a best practice one for NESR, each downloads with its own name; a NESR best practice with its .pptx copied to SAPESCO built in SAPESCO's best practice template (its slide master, not the lessons one) with the text changed, Gulf Energy skipped with the reason; Settings with both rows per company and NESR, the question naming the template; 390 px with no sideways scroll. Test documents deleted, mock templates cleared.

## 6z.33 — Pick a module after signing in: SLK Operations Hub, Knowledge Hub or Competency

- **Owner request (2026-11-19):** on sign-in, an option to open the Knowledge Hub, Competency or SLK Operations; roles decide who opens which, a module a person may not open is greyed out, and the SLK Operations Hub includes all the modules.
- **Picker:** after signing in (or on the app's home address) a page lists the three modules with what each holds. The person's role decides which open; the others are greyed out with a lock and "No access: ask an admin to add it to your role". The SLK Operations Hub opens on the first page the person may see, the Knowledge Hub on /knowledge, Competency on its page. A link to a page (from an email) still opens that page straight away.
- **In a module:** the menu shows only that module (the Knowledge Hub, or Competency alone); the SLK Operations Hub shows everything as before. The module name next to the clock, and the NESR mark, go back to the picker. The pick is kept for the browser tab; a page opened from a link shows its own module.
- **Rights:** a new role right, SLK Operations Hub (`slk_ops`), first in Users & Roles › Role permissions with what it does; it can also be added or removed per person. With it, the role opens the whole hub and the Knowledge Hub and Competency (at least to read). Without it, only the Knowledge Hub and Competency rights stay (and the help assistant), and the rest of the app is refused on the server (`applyModules` in `src/shared/modules.ts`, applied when rights are loaded and shown). Migration 0027 gives the new right to every role that has rights today, so nobody loses access; a role copied from another copies it too.
- **Verified:** tests 398 (new: modules, 5); type check clean; migration checks pass and 0027 applied locally (19 roles kept the hub). In the local app: as the test admin the picker after sign-in with all three open, the Knowledge Hub and Competency each with only their own menu, the hub with every group, the module link in the header. With the foreman role's hub right taken away locally: the picker with the hub and Competency greyed and the Knowledge Hub open, the Knowledge Hub working, jobs and people data refused (403) on the server. 390 px with no sideways scroll on the picker and the Knowledge Hub. Role permissions shows the new right first. The foreman role was given its right back.

## 6z.34 — Competency is now the NESR Competency Framework System, converted to slickline

- **Owner request (2026-11-19):** replace the Competency section with the NESR WL Competency Framework System (handoff package `nesr-wl-cfs-module.zip`, `NESR_WL_HANDOFF.md`), converted to slickline with what this app knows, storing data and files the way the app does (D1 and the R2 bucket); tailoring comes later.
- **The module:** `src/client/competency/App.jsx` is the framework system's single file (7,300 lines: Dashboard, Administration, Progression, Proficiency, Matrix, CDP, Tools), loaded only on the Competency page (`CompetencyModule`, its own 986 KB chunk). It keeps its own screens and header inside the SLK Ops shell; the earlier experience page is no longer routed.
- **Its three seams, as the handoff describes:** (1) storage: `window.storage` (get, set, delete, list by prefix) is served by `/api/competency/kv` on a new D1 table `competency_kv` (migration 0028). Values over 256 KB (the team dataset as it grows, its backups) go to R2 under `competency/kv/` and the row keeps the key; a value that shrinks moves back into the row and its R2 copy is removed. Personal keys (theme, notifications read) are kept per username; the prefix list is a literal match (`substr`), not LIKE. (2) identity: the person signed in to SLK Ops is the user, so the module's own login, default passwords and forced password change never show, and its Log out button is hidden; SLK admins are Super Admin, people with the Competency edit right get the role set for them in the module (else Manager), everyone else Viewer. The server refuses shared writes without the edit right. (3) mount: lazy-loaded, starting in SLK's light or dark theme.
- **Excel:** the two imports (CDP Progress Tracker, Job Details) read the first sheet through the app's own reader (`competency/sheet.ts`) instead of SheetJS, so the outdated `xlsx` package is not shipped. `recharts` is added for the charts.
- **Converted to slickline:** training, certifications, core and advanced elements, the element catalog (setup, conveyance, HSE, well access, flow control, gas lift, surveys, perforating and cutting) and the services (the SLK service list and domains); the career ladder Trainee → Assistant Operator → Slickline Operator → Slickline Supervisor → Senior Supervisor in positions, CDP steps, the tracker import and the promotion tracker; the CDP booklet's courses, certifications and competency targets mapped to slickline equivalents; WL and Wireline to SLK and Slickline in the text; the module's "Engineer" role is "Operator". A new dataset starts from SLK Ops (`/api/competency/slk-seed`): active employees with their WIREGUARD username as the ID (crew role to position and CDP step), the services and domains, and the countries, with no wireline examples.
- **For tailoring later:** the catalog is a first slickline version (the setup check lists 66 elements without validation tables, 6 certifications without validity and 20 services without elements); the CDP steps follow the wireline booklet's structure until a slickline booklet replaces it; the module's own Users & Roles (standalone users with passwords) and its deployment-package generator are still in it, unused; experience from SLK jobs is not fed in yet.
- **Verified:** tests 406 (new: competency, 5: storage keys and rights, the Excel reader, the slickline catalog, the SLK seed); type check clean; build passes; migration checks pass and 0028 applied locally. In the local app: Competency opens the module as "SLK Competency Framework System", segment Slickline, the test admin as Super Admin with their own employee record; the first save stored the dataset and its first backup in D1; a 300 KB value went to R2 and back, shrank back into the row with nothing left in R2, deleted; personal keys kept apart from shared ones; a bad key refused. With the foreman role (Competency read only): Viewer tabs, the team data readable, shared writes refused (403), personal keys allowed. 390 px with no sideways scroll; no new console errors.

## 6z.35 — Menus regrouped, Competency and SLK Knowledge Hub headers, Competency users in Users & Roles

- **Owner request (2026-11-20, with the Standards / Guidelines / Sharing / Information picture and a screenshot of the Competency header):** (1) Competency header: segment, ID, name, role as per Competency, grade and last edit; no NESR mark on the right and no light/dark button, the app controls that. (2) Competency its own menu, at the level of the Knowledge Hub. (3) A SLK Knowledge Hub header like Competency's with the picture, the same information, and the menus presented the same way. (4) Knowledge Hub below Service Quality, Competency below the Knowledge Hub. (5) Attendance under Bonus. (6) An Equipment menu with Wires and Inventory. (7) Competency users handled from SLK Ops Users & Roles, with every field Competency needs, linked to the main user, and the Competency role separate from the app role.
- **Menus:** Operation, Service Quality, Knowledge Hub, Competency, Bonus (Bonus Report, Analysis, Rules, Attendance), SLK Activity Dashboard, Equipment (Explosive, Hardware, MCR, Wires, Reconciliation), Administration. Competency moved to `/competency`; the old `/quality/competency` address still opens it. Page addresses for attendance, inventory and wires are unchanged.
- **Competency header:** Segment, ID, Name, Role (the Competency role), Grade (from the person's record) and Last edit; the NESR mark and the theme button are gone inside SLK Ops, and the module follows the app's light or dark setting as it changes (the page watches the app's theme).
- **SLK Knowledge Hub header:** the picture (`public/brand/knowledge-hub.png`, resized to 358 × 200 for sharp display at 78 px), "SLK Knowledge Hub", Segment, ID, Name, Role (the Knowledge Hub role: Admin, Editor, Reviewer, Approver or Reader), Grade (from the Competency profile) and Last edit (the newest Knowledge Hub change in the audit trail, downloads left out), with Add several and Add document on the right and the sections as tabs along the bottom of the dark band, like Competency's. The band and its text keep fixed colours so they read the same in Sunlight. Barlow Condensed is loaded for these headers (`font-condensed`).
- **Competency users (`competency_users`, migration 0029):** set in Users & Roles on each person's page (a Competency system section, next to but apart from their SLK Ops role, countries and tabs) and in a new Competency users tab (everyone set up, add a person, edit). Fields: Competency role (from the Competency system's own role definitions, so roles added there appear here), employee record, position, grade, segment, location, hire date, mentor, status. Whether the role changes data is kept with the profile; the server lets a person write the team's Competency data with the Competency edit right in SLK Ops or a Competency role that edits. Competency takes each person's role from their profile, and copies the profiles into its employee register every time it loads its data (adding a record for anyone missing); a save in Users & Roles reaches it on its next load. Its own Administration › Users & Roles now points to SLK Ops for users and keeps the role definitions (what each role sees and does); its employee logins, password reset queue and standalone users are hidden. `GET /api/competency/users`, `GET /api/competency/me`, `PUT|DELETE /api/competency/users/:username` (Users tab edit right).
- **Found while testing:** Competency copies the Users & Roles profiles once after it loads, and in development its load runs twice, so the second load put back the saved register. The copy now happens every time data is loaded (also on Refresh and after restoring a backup) and again when the profiles change.
- **Verified:** tests 414 (new: competencyUsers, 5: profiles, roles from the dataset, rights, the copy into the register, the menus); type check clean; migration checks pass and 0029 applied locally. In the local app: the menus in the new order with Attendance in Bonus and the Equipment pages; the SLK Knowledge Hub header with the picture and all six fields (grade G9 from the profile); Competency users tab and a person's Competency section (Save works, a bad role or grade refused, an unknown user refused); Competency with role Admin and G9 in its header, the test admin's register record updated to Admin, G9, Slickline Supervisor, DMM and hire date, and the light/dark following the app both ways; its Users & Roles pointing to SLK Ops with the role table kept. 390 px with no sideways scroll on the Knowledge Hub, Competency, the Competency users tab, Attendance and Hardware; the header readable in Sunlight after a colour fix; no console errors beyond the deliberate refusals.

## 6z.36 — Competency users from and to Excel, no duplicates

- **Owner request (2026-11-20):** upload and download Competency users with an Excel file, without adding duplicates, based on Employee ID.
- **Download Excel** (Users & Roles › Competency users): one sheet, columns Employee ID, Name, Competency role, Employee record, Position, Grade, Segment, Location, Hire date, Mentor, Status; the people set up first, then every other active SLK Ops user with the Competency columns blank, ready to fill in.
- **Upload Excel:** read in the browser with the app's own reader (columns found by name, any order; grade as G9 or 9; dates as Excel dates or typed). The server (`POST /api/competency/users/import`, Users tab edit right) plans first and shows what it will add, update and leave out, with the reason for each row left out; Apply writes it in one go with one audit line. **Employee ID is the key** (`planImport` in `competencyUsers.ts`): an ID that is someone's SLK Ops username or their employee record updates that person and never adds a second profile, case aside; the same ID twice in the file keeps the first row; an ID that is not a SLK Ops user, a blank ID, or a role, grade, position or date that does not check out is left out. At most 2,000 rows at a time.
- **Verified:** tests 417 (new: 3, dates, reading a downloaded file back, the plan with update, add, duplicate, unknown user, bad role and blank ID); type check clean. In the local app: the download read back with the two people set up then the others blank; an upload with an update, an addition, a repeated ID and an unknown user previewed as 1 to add, 1 to update, 2 left out with the reasons, applied (3 profiles, the repeated person updated once); the same rows again planned 0 to add, 2 to update. 390 px with no sideways scroll.


## 6z.37 — Lessons learnt and best practices listed like the SOPs, in two columns

- **Owner request (2026-11-20):** lay out lessons learnt and best practices the same way as the SOPs, keeping best practices apart from lessons learnt in two columns, and keep the filters.
- **Lessons & best practices** now uses the SOP list: rows grouped Global first then by country, each row with its type, category, number and the Read, Mind map, QR and Details buttons. Two columns on wide screens: **Lessons learnt** (lessons learnt and learnings from incidents) and **Best practices**, each with its count and its own empty message; one under the other on smaller screens. Editors keep the edit button and the star that makes a published lesson the Lesson of the Week.
- The Lesson of the Week and every filter (search, country, failure type, sort, duplicates, company, type, category) stay as they were and narrow both columns.
- **Verified:** tests 417; type check clean. In the local app at desktop: the two columns side by side under the filters; the Best practice type filter leaves Lessons learnt with "None match the filters." and the best practice on the right. 390 px: one column, no sideways scroll, no new console errors.


## 6z.38 — Activate, deactivate and delete users, modules per person, and the People / Competency / WIREGUARD reconciliation

- **Owner request (2026-11-20):** activate or deactivate users; delete a user only after the admin's password and only with no records in Competency or WIREGUARD (otherwise deactivate only); People, Competency users and WIREGUARD reconciled with fixes; each person allowed SLK Operations Hub, WIREGUARD and Competency one by one; everyone uses the Knowledge Hub as a viewer, more by role.
- **Status:** the People list shows Active or Inactive with Deactivate / Activate; the person's Edit page has the same. Deactivating ends access on the next click (as before) and now sets their Competency profile to Inactive; activating sets it back to Active (only from Inactive, so Transferred or Resigned stay).
- **Delete user** replaces Remove from SLK Ops. `GET /api/admin/users/:u/records` checks WIREGUARD (an account in its user list; unreachable counts as a blocker), Competency (profile, records in the dataset by username or employee record, register entry) and SLK Ops (job crew, attendance days, bonus lines, signatures). With anything there, only Deactivate is offered. Otherwise `POST /api/admin/users/:u/delete` (Users delete right) asks for the admin's own WIREGUARD password, checked with a sign-in to WIREGUARD (nothing there changes; a wrong password is refused and written to the audit), checks the records again and removes the person's user, grants, passkeys, Knowledge Hub roles and attendance row. The old `DELETE` route is gone.
- **Modules per person:** migration 0030 adds `user_roles.modules` (JSON; missing means the role decides). `applyModules(menus, modules)` applies them on the server: SLK on opens the whole hub, off closes it; Competency on or off wins; WIREGUARD follows the hub unless set. Everyone gets the Knowledge Hub to read (an edit right from the role stays). The module page has a fourth tile, WIREGUARD, which opens the WIREGUARD app in a new tab for people allowed it.
- **Reconciliation** (Users & Roles tab): `reconcileUsers` in `shared/userAdmin.ts` compares People, WIREGUARD's user list and Competency users plus the Competency register. Differences: missing from People, active here but missing or switched off in WIREGUARD, different name, email or employee ID, a Competency user with no SLK Ops user, still Active in Competency while deactivated. Notes: active people not in Competency, register entries not linked to anyone. Each has one fix (`POST /api/admin/reconcile/fix`, which re-checks that the difference is still there): Add to People, Deactivate, Use the WIREGUARD details, Remove from Competency, Mark inactive in Competency, Add to Competency as Viewer. WIREGUARD is only read.
- **Verified:** tests 430 (new: 13 for modules per person, delete blockers, Competency record counting and the reconciliation); type check clean; migration applied locally. In the local app: Reconciliation found the test user switched off in WIREGUARD but active here, Deactivate fixed it, and Add to Competency as Viewer added Test SDM; a person with WIREGUARD, register, crew and attendance records was refused delete with the four reasons; a new test person with no records was refused with a wrong password and deleted with the right one; modules set to SLK off and WIREGUARD on left only the Knowledge Hub, help and WIREGUARD open; the module page shows the four tiles. 390 px: person dialog and Reconciliation with no sideways scroll; no failed requests after a reload.


## 6z.39 — Only the allowed modules shown, and WIREGUARD checked before it opens

- **Owner request (2026-11-20):** when WIREGUARD is picked, check the user is enabled and sign them in automatically; do not show the modules a user is not allowed (Competency, Knowledge Hub or WIREGUARD).
- **Module page:** greyed-out tiles are gone; only the modules the person may open are listed. Someone allowed only the Knowledge Hub goes straight to it, and the header's module switch is hidden when there is nothing to switch to.
- **WIREGUARD tile:** `GET /api/wg/account` (only for people allowed WIREGUARD) asks WIREGUARD's user list, fresh, whether the person's account is on. On: the tile opens WIREGUARD in a new tab. Switched off or missing: the tile says so and does not open. WIREGUARD unreachable: it still opens, with a note.
- **Not done: automatic sign-in to WIREGUARD.** WIREGUARD's web app keeps its sign-in token in memory only and takes no sign-in from outside (its own code says so), so SLK Ops cannot sign the person in there without a change inside WIREGUARD (a one-time sign-in link its API would accept). WIREGUARD is read-only for this project, so that change waits for the owner's decision.
- **Verified:** tests 431 (new: who may ask for the WIREGUARD account check); type check clean. In the local app: the admin sees four tiles and WIREGUARD links to the WIREGUARD app after the check; a user set to Knowledge Hub and WIREGUARD sees those two only; set to the Knowledge Hub only, the module page opens the Knowledge Hub directly, the menu shows only the Knowledge Hub and there is no module switch; the account check refuses a user not allowed WIREGUARD. 390 px: no sideways scroll, no failed requests.


## 6z.40 — Career Development: the Career Development Plan out of Competency, its own menu and module

- **Owner request (2026-11-21):** move CDP out of Competency into a menu called Career Development below Competency, with a header like Competency's called SLK Career Development using the supplied picture; the same users as Competency; assignable to roles like the others; offered after sign-in.
- **Menu and module:** new right `career_development` and menu Career Development (`/career`) under Competency. The module page has a Career Development tile; the person's Modules (Users & Roles) now include Career Development (role default, allowed, not allowed). It comes with the SLK Operations Hub like Competency, or alone with its own right.
- **Screen:** `/career` opens the Competency module in a new career mode: header SLK Career Development with the Growth, Training, Learning, Success picture (`public/brand/career-development.png`, 358×200), the same segment, ID, name, Competency role, grade and last edit, and the plan's three sections (CDP Progress, Reference, CDP Promotion Tracker) as its tabs. Competency no longer shows the CDP tab. The CDP steps are still set in Competency › Administration › Catalog.
- **Data and users:** one dataset and one set of users. The Competency data store (`/api/competency/kv`) is read and written with the Competency or the Career Development right (writes moved to the route check; shared data still needs an edit right or an editing Competency role). Competency users and their Competency roles apply to both.
- **Migration 0031:** each role gets the same Career Development rights as its Competency rights, and people given or refused Competency one by one get the same for Career Development, so nobody who used the plan loses it.
- **Verified:** tests 435 (new: 1 for the module rules, plus the menu order and the shared store rules); type check clean; migration applied locally (7 roles). In the local app: the module page shows the Career Development tile; `/career` shows the SLK Career Development header with the picture and the three tabs, each opening its section; Competency's tabs are Dashboard, Administration, Progression, Proficiency, Matrix and Tools; the role permissions list Career Development; a person set to Career Development not allowed loses it and gets it back on role default. 390 px: no sideways scroll; no failed requests after signing in.


## 6z.41 — Winch data: Lineminder recordings, a tab per run, the analysis window and the SOP-04 speed and jarring checks

- **Owner request (2026-11-21):** read the Lineminder files (the owner's tdat2csv 1.1.0 converter attached) on the Closure tab's winch data; on upload choose Lineminder (dat) or CSV; match the channels and units and choose which channels are needed; open the file in an extra window for analysis; detect the runs (surface down and back) with a tab and the same report for each; use SOP-04, the Jarring Guidelines and the Speed Guidelines from the Knowledge Hub; detect jarring and flag anything not compliant.
- **Lineminder reader:** `shared/lineminder.ts` is a TypeScript port of tdat2csv (MIT, by the owner), so nothing has to be installed: the Worker cannot run Python, and the file is read in the browser. Same header layout, record stream (mask, values, elapsed ms, forward-filled), units from each channel's type code (mm, g, µm/s to ft, lb, ft/min or m, kg, m/min; unknown types kept raw), alarm set-points, and the five self-checks (recording length, speed against the depth change, round set-points, known types, end marker). Resampling keeps the tension peak inside each step so jar hits are not lost. A writer is included for the tests and the demo recording (`shared/winchDemo.ts`).
- **Upload:** Lineminder recording or CSV/text export. Lineminder: a channel table (kind, unit in the file, unit shown, changes) with Keep boxes, the depth, tension and speed channels (warned when the type does not match), ft/lb or m/kg, read every 0.1–2 s, the job fields, the alarm set-points and the checks. CSV: the column and unit mapping as before plus the channels to keep. A .da_tdat dropped with CSV picked is read as Lineminder.
- **Runs:** `splitRuns` in `shared/winchRuns.ts`: from the tools going deeper than 30 ft until they are back above it, at least 200 ft deep and a minute long, partial runs marked. Each run gets a tab with the same report (tiles, time view with jarring and SOP-04 bands, depth view, cable guidelines, SOP-04 and jarring, channels), plus a summary table of all runs. A vertical well option (the default) puts the whole hole in the vertical zone.
- **SOP-04:** from NESR-8000-SOP-04 Winch Operations (read from the GES copy on this computer): 6.2, 30 ft/min or less shallower than 200 ft and within 100 ft of a restriction (restrictions typed as "650 SSSV, 7450 X nipple"); 6.4/Speed Guidelines, BHA RIH and POOH speeds (0 = not checked, to be set from the Speed Guidelines); 8.3, jar up never over the MAT or 60% of the breaking strength, the 1,450 lbs spang jar limit when spang jars are run, jar down never losing over 20% of the normal tension, cycles of 15 min at most with 10 min of rest, 3 cycles at one place at most. All limits editable and kept on the device; the Knowledge Hub documents matching SOP-04, Jarring or Speed Guidelines are linked beside them.
- **Jarring detection:** while the depth stays within 30 ft over 60 s; the normal tension is the median there; a jar up is a peak at least 150 lbs or 15% over normal that falls half way back within 5 s (followed to its top), a jar down a drop of 10% or more that recovers; hits within 120 s at the same place are one cycle. Every threshold is editable.
- **Analysis window:** `/winch-window` opens without the app frame; it asks the job page that opened it for the report (postMessage, same origin only) and draws it full width and taller. Nothing is saved or fetched.
- **Owner follow-up:** the BHA speed table (SOP-04 6.4) and the jarring flow chart (8.3) are pictures in the SOP, and the Jarring and Speed Guidelines documents are only in the live Knowledge Hub, so the BHA speeds start unchecked until set.
- **Verified:** tests 443 (new: 8, reading a written .da_tdat, units by type code, the peak-keeping table, the self-checks, two runs in the demo, the near-surface and restriction speed checks, the four jarring cycles with the spang, jar-down, long cycle, short rest and fourth-cycle flags, the jar-up limit and saved limits); type check clean. In the local app on a job's Closure tab: the demo recording shows its channels, units, set-points and five passed checks; two runs found (5,000 and 6,000 ft), run 2 with 4 jarring cycles, 5 jarring flags and the near-surface speed flag; the SOP-04 tab, the channel plot and the analysis window page draw the report (the preview pane opens pop-ups in the same tab, so the window was fed the report directly); the CSV demo export still reads as one run. 390 px: form, report and window with no sideways scroll; no failed requests.


## 6z.42 — Winch data: wire or braided line, Speed and Jarring Guidelines by service, several files per job

- **Owner request (2026-11-21):** tell wire from braided line; braided line uses the seasoning rules (new line, or seasoned after more than 10 runs) with every horizontal reference removed, and a new line's speeds can be changed and used; wire uses the Speed and Jarring Guidelines, kept by an admin and changeable, speeds by type of service per run, the default values used and flagged for a service not in the list (services can be added); several files per job, checked before joining, asking same job or different when there is more than a day between them, runs found across the joined files; the analysis window lets you pick the run. The guidelines are the documents attached to SOP-04.
- **Guidelines read:** the three files attached to NESR-8000-SOP-04 in the live Knowledge Hub (read-only, with the owner's go-ahead): NESR-8000-QAF-04-01 Speed Guidelines Rev 0 (gauge cutter, drift, check set, brush, prong, LIB, blind box 300 ft/min; plug, pulling tool, RBP, gauge hanger, ACDC, bailers, finder grab 200; SBHP/FBHP 120; 30 ft/min to 200 ft and 100 ft either side of a restriction; normal tension over 0.8 × static RIH and under 1.2 × static POOH; any other service confirmed with the Service Manager in the JRA), QAF-SLK-Jarring-01 Jarring Flow Chart Rev 1.0 (3 cycles of 15 min with 10 min rest, MAT, 60% of 0.125/0.160 wire, spang jar limit 1,450 lbs, heavy jarring over 1,300 lbs needs a new program and MoC) and the Winch Operations placard Rev 4.
- **`shared/winchGuide.ts`:** the guideline values (`GUIDE_DEFAULTS`, `checkGuide`), `lineKind` (size 0.18 in and up or "braided" is braided line), `speedsFor` (whole-word match, plurals ignored; not listed gives the fallback, flagged), `wireSop` / `braidedSop`, the braided-line rules without the horizontal ones (`BRAIDED_CHECKS`: near-surface and max POOH speed, RIH tension, POOH tension at the deepest point), `staticTension` (halfway between running and pulling tension at each 100 ft), and `joinPlan` (same kind and channels, no overlap, gaps over a day asked).
- **`shared/winchRuns.ts`:** tension against static (`sopTensionFindings`), heavy jarring, off switches (0) for the surface and restriction speed; sources now name the Speed or Jarring Guidelines.
- **Worker:** `/api/winch/guide` (read with Jobs or Users; saved by an admin only, in `knowledge_settings` under `winch-guide`, audited) and `/api/winch/line/:jobId` (the job's wire from WIREGUARD's mirror: grade, size, breaking strength, runs on it up to the job date). No migration.
- **Card:** files list with the join question per gap; the line (detected, can be changed), new or seasoned line with the run count, the new-line speeds, breaking strength (from WIREGUARD), MAT, spang jars, restrictions; the guideline tables, with "Change the guidelines" for admins (rows of services can be added, removed and renamed, the default speeds, factors, jarring and braided-line values). The well survey (KOP, 30°, lateral) is gone. A "Demo: two recordings" button tries the join.
- **Report:** a service per run on wire (from the job's services, can be changed), "default speeds" flagged on the run tab, table and panel; wire depth view shows the service speed limits and the static tension band; braided line shows the seasoning rules tab with no zones; a run picker (with previous and next); dates on the runs when they fall on different days. The analysis window opens on the run being looked at.
- **Verified:** tests 457 (new `tests/winchGuide.test.ts`, 14: line kind, seasoned from runs, no horizontal words, speeds by service and the default, wire speed flags on the demo, braided checks no service speeds, static tension and the 0.8 / 1.2 flags, heavy jarring, saved values checked, join plan, the two-recording demo giving runs at 5,000 and 6,000 ft two days apart); type check clean. In the local app: the two-recording demo asks about the 2-day gap, joined as the same job finds both runs; Interwell Plugs takes the 200 ft/min row, an unlisted service shows "default speeds"; an admin added a "Shifting" row (Sliding Side Door, SSD) and run 2 took it; braided line with the new-line max POOH speed set to 150 flagged the 180 ft/min pull and showed no horizontal rules; the analysis window opened on run 2 with the picker. 390 px: no sideways scroll; no console errors.


## 6z.43 — Winch data kept with the job, a scorecard, the PDF report in Attachments; Q-Incidents, Incidents Dashboard and Assets Inventory

- **Owner request (2026-11-21):** Print is for the winch analysis; a refresh lost everything, so keep it all saved at all times; keep the files and the reports in Attachments with the version told apart by the time of print or save; a scorecard counting violations, speeds and jarring; move 8 Min. Facts (renamed Q-Incidents) and the Failure Roster (renamed Incidents Dashboard) under Service Quality, and the Database (renamed Assets Inventory) under Maintenance.
- **Kept with the job:** migration `0032_winch_checks.sql` (one row per job: the card's choices as JSON), `GET/PUT /api/winch/state/:jobId` (read with Jobs, saved with the right to edit jobs). Every file added is uploaded to the job's attachments (Document, note "Winch data file"; `.da_tdat`, `.dat`, `.tsv`, `.log`, `.prn` added to the kept types, always downloaded); the choices are saved 0.8 s after each change; on opening, the files come back from the attachments, the choices are put back and the check runs again if it had been run. Demo files are not kept. The card says when it was last kept and by whom, or why it was not (a role that only views jobs).
- **Scorecard:** `shared/winchScore.ts`, on the report above the run tabs and on the PDF: flags in all, speed, tension and jarring flags, jarring cycles, moving time inside the limits (overlapping flags counted once), top RIH and POOH speed and tension, per run and for the job, and the flags by rule. No scorecard was found in the app's history, so this one is new.
- **Print and Save report:** `winch/reportPdf.ts` makes a PDF with pdf-lib (loaded only then): page 1 the heading and the scorecard, then each run with its plot (depth, speed, tension, flag and jarring bands), its flags and its jarring cycles. Both buttons keep it in the job's attachments (Report) as "Winch analysis <job> <date> <time> printed|saved.pdf"; Print then opens the print dialog on it. Works from the analysis window too. The card lists the saved reports.
- **Menus:** Operation keeps Schedule, Jobs, Job Log, Pre-Job Notes and Quick Plan; Service Quality gets Q-Incidents and Incidents Dashboard; a new Maintenance menu holds Assets Inventory. Addresses unchanged, so links and bookmarks still work; page titles and the words that name them follow.
- **Verified:** tests 462 (new: the scorecard on the demo, winch files kept as attachments; the menu test follows the new layout); type check clean. In the local app: two recordings added through the file picker went into the attachments, the gap answered, a restriction typed and the check run; after a full reload the files, choices and report came back by themselves; Save report kept "Winch analysis DV-26032 2026-11-21 1656 saved.pdf" (4 pages, read back: scorecard, both runs with plots, flags and jarring cycles); Q-Incidents and Incidents Dashboard under Service Quality, Assets Inventory under Maintenance. 390 px: no sideways scroll; a fresh tab with no console errors. Print's dialog was not opened in the preview (it would block it).


## 6z.44 — Winch guidelines kept on the device, Job details from the job, menus reordered

- **Owner request (2026-11-21):** the live card showed "The guidelines could not be read"; no need to read them every time, only when their version changes, and keep them ready. Run details become Job details: Field instead of Job or pad, field and well from the job, the runs as detected, Job date instead of Run date, a DRSS field before Field, all taken from the job and locked. Utilization and Wire KPIs into Equipment as its first two, the Explosive and MCR inventories out, the Maintenance menu inside Equipment after the third line, Equipment after Service Quality, and the SLK Activity Dashboard first, before Operation.
- **Guidelines:** the error could not be reproduced (the production query answers, and every local role reads them). The card no longer depends on that read: the guidelines are shown at once from the copy kept on the device (or the document values built into the app), `GET /api/winch/guide/version` asks only for the version, and the full guidelines are read again only when it changes (after an admin saves); if the check fails, a short note says the kept copy is in use. The guidelines are readable by anyone signed in (reference values from SOP-04); the job's line reads with Jobs or Schedule.
- **Job details:** DRSS, Field, Well, Unit, Line, Job date and Checked by from the job and the signed-in person, shown, not typed; Runs shows how many the last check found. The report and the PDF heading show the well, field and unit, the DRSS, the job date and the runs found; the PDF is named after the DRSS. Older saved checks drop their typed details.
- **Menus:** SLK Activity Dashboard, Operation, Service Quality (Statistics, NPT Analysis, Q-Incidents, Incidents Dashboard), Equipment (Utilization, Wire KPIs, Hardware, Assets Inventory, Wires, Reconciliation), Knowledge Hub, Competency, Career Development, Bonus, Administration. The Explosive and MCR pages still open by address, their rights stay in Users & Roles (named there), and the job's explosives section is unchanged. The hub still opens on the Schedule for people who have it, now that the dashboard is first.
- **Verified:** tests 462 (the menu test follows the new order and checks the Explosive and MCR labels); type check clean. In the local app: the guidelines show from the kept copy and the version check; the Job details show the job's field, well, unit and date, locked, with "2 found in the files"; the report heading reads "Well W-1824 · Field Central · MSL-022"; the new menu order and the Equipment tabs; 390 px with no sideways scroll; a fresh tab with no console errors.


## 6z.45 — Winch data stays loaded; add winch files from the job's attachments

- **Owner request (2026-11-21):** loaded winch data must stay so it can be looked at any time, never removed; when loading files, also offer the job's attachments.
- **Cause:** on production the check was saved (one file, checked) but the card showed no file. Coming back to the Closure tab inside the app, the card read an old copy of the saved check kept from the first visit (before the file was added) instead of asking again. Nothing was overwritten: the saved check stays as long as the card has no file of its own.
- **Fix:** the saved check is read fresh every time the card opens (no copy kept between visits), the card waits for that answer before restoring, and each save also updates what the page holds.
- **Kept:** demo files are kept like any other file; the demo buttons show only on an empty card, so a demo never replaces loaded files. A file that is already in the job's attachments (same name and size) is linked instead of uploaded again.
- **From the attachments:** under the drop zone, "Or add one from the job's attachments" lists the job's winch files (.da_tdat, .dat, .csv, .txt, .tsv, .log, .prn) not loaded yet, one of each, with Add; it reads the file from the attachment without uploading it again.
- **Verified:** tests 462; type check clean. In the local app: a demo loaded on an empty job, Closure left for Execution and back: the file and check came back; on the first job the report came back the same way; a file removed from the card was offered from the attachments and added back with no second copy (1 attachment); 390 px with no sideways scroll; a fresh tab with no console errors.


## 6z.46 — Ask to load the winch files found in the job's attachments

- **Owner request (2026-11-21):** when winch data is found in the attachments, ask whether to load it, and show all the files so they can be picked.
- **What the live job showed:** its saved check pointed to the demo export (demo-run.txt), which had then been deleted from the attachments, so nothing could be brought back; the recording itself was still in the attachments (four copies from earlier tries).
- **Change:** on an empty card, "Winch data found in this job's attachments: N files. Load them?" lists every winch file in the attachments (.da_tdat, .dat, .csv, .txt, .tsv, .log, .prn) not loaded yet, each with a tick box, all ticked, with Load selected, Tick or Untick all, and Not now. Copies with the same name and size are listed once ("4 copies, one is loaded"). Once files are loaded, the same list stays as "Add from the job's attachments", nothing ticked. Several files load in one go, in order, each read from its attachment without uploading it again.
- **Verified:** tests 462; type check clean. In the local app: both recordings removed from the card, the question listed both, ticked; Load 2 selected loaded them and asked about the 2-day gap; with one loaded, the other stayed offered unticked; 390 px with no sideways scroll; no console errors.


## 6z.47 — Winch report in the Winch Benchmark layout; Utilities: rig up, tool string and winch report without a job

- **Owner request (2026-11-22):** use the attached Winch Benchmark PDF as the template for the winch report; under Service Quality, a Utilities menu with copies of the Rig Up Diagram, the Tool String Diagram and the Winch report that work the same but are not tied to a job, the information typed as needed, with projects that can be saved, edited, duplicated and deleted.
- **Winch report PDF:** `winch/reportPdf.ts` rebuilt on the template: a dark green band with the white NESR logo and the title and identification on the right, a light green rule, green table headings with pale rows in turn, wrapped cells, and the footer with the page count. Page 1 "Winch Report - Analysis Summary": prepared by and when, the runs, the line, the crew, a row per run (file, service, max depth and tension, average RIH/POOH, violations, jarring, kept time, main issue) with a total, the scorecard tiles and the flags by rule, and how flags are counted. Each run: "Run n - file" with its spans and durations, the plot (depth, speed, tension on three scales, flags and jarring shaded), "Result by rule" (Pass, n violations or Not checked, the rule, where it comes from and the requirement), the jarring cycles and every violation (time, lasted, depth, tension, where, rule, detail, worst vs limit). The rule wording is shared with the screen (`winch/ruleRows.ts`). The job's crew comes from the job; the file of each run from the joined files.
- **Utilities:** migration `0033_utilities.sql` (`utility_projects`, `utility_files`, and the `utilities` right, each role starting with its Jobs rights); `worker/utilities.ts`: list, create, open, save, duplicate (the copy points at the same stored files, its winch check remapped), delete (whoever made it, the delete right or an admin), the project's files and winch check in the same shapes as a job's attachments and check, and the diagram PDF made by the server from the typed details (`diagramPdf`), kept with the project as the next revision. Menu "Utilities" after Service Quality with Rig Up Diagram, Tool String Diagram and Winch Report; each opens its project list, then the project page with Rename, Duplicate and Delete.
- **Reuse:** the winch card is now `WinchWorkbench` with a host (a job, or a project with typed job details and crew); the diagram page's catalogue, sheet, part editor and totals are reused with typed details (and a typed client on the sheet).
- **Verified:** tests 469 (new `tests/utilities.test.ts`, 4: typed details, copy names, the menu and right, the access rules); type check clean. In the local app: a Winch Report project with typed details and crew, the two-recording demo joined and checked, Save report kept "Winch report 26586 … saved.pdf" with the project (5 pages read back: the template's band, logo, summary with crew and main issues, scorecard, each run with plot, result by rule, jarring and violations); the project came back after a reload; a duplicate kept its 2 files and check, and deleting it left the original's files; a Rig Up project with typed client, well, SIWHP and wire size, 3 parts, PDF Rev 0 kept with the project (read back: client, well, parts, key data, checks); a Tool String project with 2 parts and its PDF; duplicate, rename and delete on the list; the job's own winch card still saves to the job's attachments; 390 px with no sideways scroll; no console errors.

## 6z.48 — A page left open across a deploy reloads into the new version

- **Owner report (2026-11-22):** "Failed to fetch dynamically imported module: …/assets/WinchData-sGix1yS9.js" during sign-in, gone after a refresh.
- **Cause:** a tab opened before the 6z.47 deploy still ran the old version; the Winch data card loads its code on demand, and the deploy had replaced that file (each version's files carry a new name). Nothing was wrong on the server: a refresh loads the new version.
- **Fix:** `client/staleBuild.ts`: when a code file cannot be loaded (each browser's wording), the page reloads itself once into the new version; a second failure within 30 s shows the error instead of looping. Used by the three on-demand loads (Winch data card, analysis window, Competency) and Vite's own preloading (`vite:preloadError`). The routes now have an error page (`components/RouteError.tsx`): "A new version is ready … Loading the new version" for this case, or the error in plain words with Reload for anything else, instead of the raw "Unexpected Application Error".
- **Verified:** tests 471 (new `tests/staleBuild.test.ts`, 2); type check clean. In the local app: a simulated missing file reloaded the page once; a second one within 30 s was passed on, not reloaded again.

## 6z.49 — Job stages tidied: collapsible sections with their status, well depths, the Job log and Winch data on their own pages

- **Owner request (2026-11-22):** Preparation: Well data, WHE equipment and Crew collapsible, closed until opened, each saying whether it is complete; "Max Target Depth - Multiple runs"; Top of Interval marked "Memory logging" and greyed out without a memory logging service; SSSV depth 0 when not used; minimum restriction with its depth, both mandatory, checked against the tool string OD; Max inclination renamed Max deviation, with its depth. Execution: the Job log · Sequence of Events opens on its own page as the JRA does; Times, runs and depths take what the log says and fold away; Operating hours, Job efficiency and Run efficiency move to the top of Closure. Closure: Job package renamed Debriefing and collapsible; the Winch data opens on its own page; the Failure follow-up collapsible, open when Failure is Yes on Execution, and Failure set to Yes when failed runs are more than 0.
- **Fields:** migration `0034_well_depths.sql` adds `min_restriction_depth_ft` and `max_deviation_depth_ft` to `job_extras` (the jobs table is at D1's column limit). Preparation's tracked fields now include the minimum restriction depth and the SSSV depth (12 fields).
- **Collapsible sections:** `components/Collapsible.tsx` (a details element): the heading shows "Complete" or "n of m filled" (Crew: "n of m named" against the head count). Well data says on its heading whether the largest tool OD (Run 1 of the tool string) passes the minimum restriction.
- **Execution:** a card like the JRA's: entries, the last one, "Open job log" to `/operation/jobs/:id/log`. `shared/jobEvents.ts` reads arrival, rig-up, rig-down, runs, failed runs, the deepest point and the tag from the log; Times, runs and depths shows what differs, with "Fill the empty ones" and "Use all from the log".
- **Closure:** the three figures on top; Debriefing (the job package) folded; a Winch data card ("n files · checked · n reports saved", "Open winch data" to `/operation/jobs/:id/winch`); the Failure follow-up opens with `needsFollowUp` (Failure = Yes or failed runs). The job package still asks for the 8 Min. Facts with NPT or a failure, as before.
- **Mistake caught:** the first draft of the log reader was written over the existing `shared/jobLog.ts` and `tests/jobLog.test.ts` (the Job Log page's); both were put back from git unchanged and the new code went to `shared/jobEvents.ts` and `tests/jobEvents.test.ts`.
- **Verified:** tests 478 (new `tests/jobEvents.test.ts`, 4; the stage tests follow the new Preparation fields and follow-up rule); type check clean. In the local app: Preparation sections closed with "0 of 13 filled", "0 of 5 filled", "Head count not set"; the renamed fields, Top of interval greyed out with no memory service; minimum restriction 2.31 in at 7,450 ft, max deviation depth 8,200 ft and SSSV 0 saved (job_extras); seven log entries read into Execution (arrival, rig-up, rig-down, 1 failed run, 9,450 ft deepest and tag), "Use all from the log" filled them and set Failure to Yes; Closure with the figures on top, Debriefing and Failure follow-up folded (follow-up "0 of 5 filled"), the Winch data card; both new pages open; 390 px with no sideways scroll on every stage and page; a fresh tab with no console errors.

## 6z.50 — Fix: the Job board failed to load

- **Owner report (2026-11-23):** Operation → Jobs showed "Couldn't load jobs. Something went wrong on the server".
- **Cause:** 6z.49 added the minimum restriction depth to Preparation's tracked fields; the board selects every tracked field from the jobs table, but that field lives in job_extras, so D1 answered "no such column: j.min_restriction_depth_ft". Single jobs opened fine (they read job_extras on their own), which is why the stage pages worked.
- **Fix:** the board reads job_extras fields from job_extras (a left join) and the rest from jobs; it also reads the failed runs, which open the failure follow-up in the Closure percentage.
- **Verified:** tests 479 (new `tests/jobBoard.test.ts`: no job_extras field asked of the jobs table); in the local app `/api/jobs` answers 200 with 121 jobs and the new depth.

## 6z.51 — The Job log · Sequence of Events becomes the owner's job log form

- **Owner request (2026-11-23):** replace the Job log · Sequence of Events under Execution with the attached job log package (a port of the WL Operations Hub log), adjusted for slickline.
- **Form:** one per job (`shared/jobLogForm.ts`): header (well, client, services, rig or site, ticket, date) filled from the job and editable; every event with date, time, day (from the date), run, depth (ft), description and remarks; Enter goes to the next row; insert, delete, add and sort rows. Day and night crew hours are worked out from the first to the last event in Riyadh time (day 06:00–18:00, night 18:00–06:00, to the half hour); a typed number wins. Two sign-off blocks, Slickline supervisor / operator (names picked from the job's crew) and Client representative, each with an I.D. number and a signature drawn or typed.
- **Saving:** migration `0035_job_logs.sql` adds `job_logs` (the current form) and `job_log_versions` (every save, with what changed). Saves check the version they started from; when someone else saved first the two are joined (rows by id, a header field is mine when I changed it) and saved again. The form is kept on the device as you type (IndexedDB) and sent when there is a connection; unsent changes come back after a reload. Both signatures set "job log signed" for Closure. History lists every version and loads one as a draft.
- **Copies:** Print / PDF and PDF (A4 with the NESR logo, header, green events table, crew hours and signatures), Word (.doc), Excel (Job log and Header sheets), and Email: a message file with the three attached, or the mail app.
- **Old entries:** the migration moves each job's existing entries into its form as version 1 ("Moved from the old sequence of events") and leaves the old table in place. `/api/jobs/:id/events` now answers from the form, so Execution's times, runs and depths, the Full Job Report and the job package read the new log.
- **Left out of the package:** the stand-alone offline page with its own service worker (the form already works offline inside the app); Word is a .doc made from the page, not a .docx, to avoid a new library; Supabase is replaced by D1 and the Jobs edit right.
- **Verified:** tests 489 (new `tests/jobLogForm.test.ts`, 7: header from the job, crew hours, change summary, the merge, reading back, sorting and Execution's figures, access); type check clean. In the local app: the Execution card showed "v1 · 7 events" from the moved entries; added a row and both typed signatures and saved v2 (job log signed yes, 6 h); an unsent rig change came back after a reload; a colleague's save (v3) joined with the page's into v4, keeping both changes; History listed v1–v4; PDF read back (logo, header, nine events, hours, both signatures), Word, Excel and email files made; 390 px with no sideways scroll on the log and Execution (the events table scrolls inside its card); no failed requests on a fresh load.
