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
