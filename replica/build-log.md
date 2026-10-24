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

### Clean-room note

Every label, message and empty state was written here. No code, assets or copy from the WL Operations Hub were used. WIREGUARD contributes its API contract and its reference lists only, not its code.
