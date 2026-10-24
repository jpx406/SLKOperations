# Architecture: SLK Operations (a Slickline hub built on WL Operations Hub's features)

Sources: `replica/recon.md` (45 screens + S46, 14 flows + F15), `replica/features.csv`, and the WIREGUARD project (`nesr/SLK__Wireguard_v2`).
Updated: 2026-10-24.

Decisions so far:
- **Product line:** Slickline (SLK).
- **Hosting:** everything is **deployed on Cloudflare**, following WIREGUARD's setup.
- **WIREGUARD:** stays **independent and the system of record** for wires, drums, units, fields, rigs, job types and job-log runs. SLK Ops receives all of it through a read-only link and reconciles its jobs against it. Details: [`integration-wireguard.md`](integration-wireguard.md).
- **Sign-in:** with the **same WIREGUARD accounts**.
- **Wire module (D3):** read-only views plus 17 of WIREGUARD's KPIs, ported with a parity test.
- **Sync:** a read-only Viewer service account with every country.
- **Cloudflare:** the same account as WIREGUARD, on `slkops.nesrapp.com`, Workers Paid (all decided 2026-10-24).

## Stack

| layer | choice | why |
| --- | --- | --- |
| runtime | **one Cloudflare Worker** `slkops` serving the API and the static app (Workers Static Assets) | the same platform, account and habits as WIREGUARD; one deployable |
| API | Hono (TypeScript) on the Worker, `/api/*` | small router built for Workers; typed handlers; middleware for auth and WRITE_RULES |
| web app | React 19 + Vite + TypeScript SPA, served from the same Worker | runs entirely on Cloudflare; Next.js on Workers would add an adapter layer for nothing the app needs |
| styling | Tailwind v4 + `replica/design/tokens.css` / `tailwind.theme.css` | dark-first with a light toggle; 0 AA contrast failures, gated by `build_tokens.py` |
| components | Radix primitives (shadcn/ui), Lucide icons | accessible base; specs in `design/components.md` |
| data fetching | TanStack Query (30 s background refetch on live pages) | replaces realtime; the schedule and boards stay current without WebSockets |
| tables / grid | TanStack Table + virtualisation | Job Log (~34 columns), Attendance (people × 31 days), reconciliation findings |
| schedule | custom CSS-grid Gantt + dnd-kit | unit rows (from WIREGUARD's units) × day columns, drag and resize |
| charts | Recharts | S13–S16 |
| database | **Cloudflare D1** `slkops-db` (SQLite), own database | same engine as WIREGUARD; migrations numbered like WIREGUARD's |
| ORM | Drizzle (`drizzle-orm/d1`), schema mirrors `migrations/0001_init.sql` | typed queries on D1; the SQL files stay the source of truth |
| auth | WIREGUARD accounts through a **service binding** (`/auth/login`, `/auth/me`); SLK Ops session id in an HttpOnly cookie, WIREGUARD token kept server-side in **KV** | one account per person; WIREGUARD's revocation applies within 60 s |
| WIREGUARD link | **service binding** `WIREGUARD` → `slkwireguard-backend`, read-only allow-list, mirror tables `wg_*` | WIREGUARD unchanged and independent |
| files | **R2** `slkops-files` (job packages, knowledge PDFs, signatures, generated exports, backups) | same as WIREGUARD's attachments bucket pattern |
| sessions / cache | **KV** `slkops-kv` (sessions, `/auth/me` cache, sync cursors) | |
| documents | PDF (`@react-pdf/renderer`), XLSX (`exceljs`), Word (`docx`), `.eml` generated **in the browser**; the Worker only stores them in R2 | keeps the Worker's CPU low. WIREGUARD exports PNGs client-side for the same reason |
| email | **Cloudflare Email Service** `send_email` binding, sender on the onboarded `nesrapp.com` domain | as in WIREGUARD. Pre-Job Notes and 8MF still go through the user's own mail client, as in the original |
| scheduled work | **Cron Triggers** on the Worker | WIREGUARD sync (every 15 min), nightly reconciliation and integrity sweep, daily digest, R2 backup |
| offline | PWA service worker + IndexedDB outbox for the wellsite job log | WIREGUARD's proven pattern: build stamp in the HTML, cache version bumped every release, idempotent `client_id` |
| AI assistant | Anthropic API (`claude-sonnet-5-5`) with the `ANTHROPIC_API_KEY` secret, manual text only, no data tools | same approach as WIREGUARD's AI panel |
| domain | custom domain on the Worker: **`slkops.nesrapp.com`** (confirmed) | `nesrapp.com` already serves WIREGUARD, in the same Cloudflare account |
| plan | **Workers Paid** (confirmed; the account owner switches it in the dashboard) | the free plan's 10 ms CPU limit forced WIREGUARD's PBKDF2 down to 50k rounds. SLK Ops' sync, reconciliation and analytics need headroom, and auth is delegated to WIREGUARD anyway |
| tests | Vitest + `@cloudflare/vitest-pool-workers` (API on real workerd + D1), Playwright (flows), `migrations/test_schema.py` (schema rules) | the Playwright CLI skill is installed |

One Worker, one D1, no microservices. WIREGUARD remains a separate Worker.

### wrangler.toml (planned)

```toml
name = "slkops"
main = "src/worker/index.ts"
compatibility_date = "2026-10-01"
assets = { directory = "dist/client", binding = "ASSETS", not_found_handling = "single-page-application" }

[[d1_databases]]
binding = "DB"
database_name = "slkops-db"
database_id = "<created with: wrangler d1 create slkops-db>"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "FILES"
bucket_name = "slkops-files"

[[kv_namespaces]]
binding = "KV"
id = "<created with: wrangler kv namespace create slkops-kv>"

[[services]]
binding = "WIREGUARD"
service = "slkwireguard-backend"          # the live WIREGUARD Worker, same Cloudflare account

[[send_email]]
name = "EMAIL"

[triggers]
crons = ["*/15 * * * *", "0 1 * * *", "0 2 * * *"]   # sync · reconciliation + digest (04:00 Riyadh) · backup

[vars]
APP_URL = "https://slkops.nesrapp.com"
EMAIL_FROM = "slkops@nesrapp.com"
WG_SYNC_USERNAME = "<NESR-digits service account>"

# secrets (never in this file): wrangler secret put WG_SYNC_PASSWORD · SESSION_SECRET · ANTHROPIC_API_KEY
```

## Schema

Migrations, applied in order (`wrangler d1 migrations apply slkops-db --remote`):

| file | content |
| --- | --- |
| [`migrations/0001_init.sql`](migrations/0001_init.sql) | **50 tables**, 1 FTS5 index, 2 views (`job_metrics`, `inventory_balances`), 13 triggers |
| [`migrations/0002_seed.sql`](migrations/0002_seed.sql) | generated by `gen_seed.py`: 7 service domains, profiles for WIREGUARD's 21 job types, 102 local lookup values, 21 inventory locations, 192 role permissions |

The Postgres/Supabase version is kept for reference in `archive/` and is no longer the plan.

**Verified 2026-10-24.** `migrations/test_schema.py` passes 30 of 30 on SQLite 3.50, and both migrations apply on a **local D1 (wrangler/workerd)**. The D1 spot checks confirmed the overlap trigger, the closure lock and the `RETURNING` counter.

The tests also caught and fixed two bugs that were in the earlier Postgres design:
- The closure lock let failure fields through when Failure was empty, because a NULL check silently passes.
- Job efficiency could go negative when NPT exceeded operating hours. It now floors at 0 %.

| group | tables |
| --- | --- |
| identity | `user_roles` (per WIREGUARD username), `role_permissions` (role × menu key × view/edit/delete, WIREGUARD's pattern), `tab_grants` |
| WIREGUARD mirror | `wg_units`, `wg_job_types`, `wg_job_locations`, `wg_fields`, `wg_rigs`, `wg_drums`, `wg_wires`, `wg_runs`, `wg_documents`, `wg_notifications`, `wg_settings` (KPI and SOP parameters, build stamp), `wg_sync_log`, `kpi_parity_runs` |
| local config | `service_domains`, `service_profiles` (behaviour per WIREGUARD job type), `lookup_values`, `pce`, `grease_panels`, `unit_events`, `jra_templates` |
| jobs | `jobs`, `job_services`, `job_headcount`, `job_crew`, `job_third_parties`, `job_log_events`, `jras` |
| documents | `doc_counters`, `pre_job_notes`, `pre_job_note_versions`, `eight_min_facts`, `incidents`, `eight_min_facts_versions`, `failure_roster_entries` |
| reconciliation | `recon_findings` (fingerprinted, re-checks update instead of duplicating), `recon_links` |
| people | `employees` (with `wg_username` when the person has a WIREGUARD account), `attendance_categories`, `holidays`, `attendance_entries`, `attendance_approvals` |
| inventory | `inventory_locations`, `inventory_items`, `inventory_movements` (append-only, overdraw refused by trigger) |
| other | `knowledge_docs` + `knowledge_fts`, `quick_plan_cards`, `audit_log` (append-only) |

**References to WIREGUARD data use natural keys**: `unit_number`, `wire_serial_number`, `drum_no`, field and rig codes, job-type names, field ticket. A rename upstream therefore becomes a reconciliation finding, not a broken foreign key. **Wire module (D3):** no local wire tables at all. Wire screens and KPIs read the mirror; edits happen in WIREGUARD.

### Access rules: WRITE_RULES in the Worker (D1 has no row-level security)

Copied from WIREGUARD's SOX Phase 1 design, so both apps behave the same:

1. **Session middleware.** It reads the SLK Ops session from KV, re-validates the WIREGUARD token through `/auth/me` (cached 60 s), and loads the SLK Ops role from `user_roles`.
2. **`role_permissions` + `tab_grants`** decide which menus a user sees, and whether they may edit or delete there. Admin always passes.
3. **One central `WRITE_RULES` table** in code maps every write route to its menu key and action (`jobs:edit`, `inventory_explosive:edit` …). No handler checks roles on its own, and a unit test asserts every write route is covered.
4. **`FIELD_POLICY`** (field → roles) filters job patches field by field (the SALES/SDM badges). The same map drives the UI.
5. **Country scoping.** Every query adds `country IN (user's countries)`. The countries come from WIREGUARD's `/auth/me`, matching WIREGUARD's `filterRowsByCountry`.
6. **Explosives** are editable only by the explosive roles. Hardware and MCR also allow storekeeper, maintenance and operations managers.
7. Every write lands in `audit_log`, which has no update and no delete.

### Rules the database enforces (tested)

- Ticket unique per country when set, so drafts can be blank.
- `end_date >= start_date`; rig-down after rig-up; JSON columns are valid JSON.
- Unit maintenance and status blocks cannot overlap (trigger). Jobs may overlap on a unit, and the schedule warns.
- The closure failure fields stay empty unless NPT > 0 or Failure = Yes.
- Incident severity is generated from NPT (<4 h Light, ≤24 h Serious, ≤48 h Major, more is Catastrophic). The report shows the highest incident's severity.
- Efficiency is `(1 − NPT ÷ op hours) × 100`, floored at 0. The operating-hours override wins.
- Head-count caps 3 / 6 / 6 / 6 (**to confirm**). Services 1–15 per job.
- Document numbers EM-0001 / PJN-0001 come from an upsert … `RETURNING` counter. D1 serialises writes, so numbers are gap-free.
- Inventory: overdraw refused, replayed submits refused on `client_id`, movements, versions and audit rows are immutable.

## API (Hono on the Worker, under `/api`)

Every write passes the session middleware and then `WRITE_RULES`. "Who" means the role list in `0002_seed.sql`, with Admin always included.

### Sign-in and session (F01)

| method path | does | who | flow |
| --- | --- | --- | --- |
| POST `/api/auth/login` | relays username and password to WIREGUARD `/auth/login` through the binding, then `/auth/me`; creates the SLK Ops session (KV) and sets the cookie; creates `user_roles` from the WIREGUARD role on first sign-in | anyone | F01 |
| POST `/api/auth/logout` | deletes the KV session and clears the cookie | signed in | F01 |
| GET `/api/me` | name, SLK Ops role, countries, effective menus, field policy | signed in | shell |
| GET/PUT `/api/admin/user-roles[/:username]` | assign SLK Ops roles and tab grants | admin | admin |
| GET/PUT `/api/admin/role-permissions` | edit the role × menu matrix | admin | admin |

Forgotten passwords and password changes link to WIREGUARD, which owns the account.

### WIREGUARD sync and reconciliation (F15, new)

| method path | does | who | flow |
| --- | --- | --- | --- |
| cron `*/15` | pulls units, job types, job locations, fields, rigs, wires, drums and runs (and documents hourly); upserts the `wg_*` tables, deactivates rows gone upstream, writes `wg_sync_log` | system | F15 |
| POST `/api/wg/sync` | on-demand sync of one resource or all | ops mgr, sdm, sqm | F15 |
| GET `/api/wg/status` | last sync per resource, row counts, last error | signed in | shell |
| GET `/api/recon/findings` | findings with filters (check, severity, status, SDM, unit, month) | reconciliation view | F15 |
| POST `/api/recon/run` | re-runs the checks for a period or a job | reconciliation edit | F15 |
| POST `/api/recon/links` | link WIREGUARD runs to a job manually | reconciliation edit | F15 |
| PATCH `/api/recon/findings/:id` | mark explained (note) or reopen | reconciliation edit | F15 |
| GET `/api/recon/summary` | jobs vs runs per unit and month, per SDM | reconciliation view | F15 |

### Schedule and jobs (F02–F07)

| method path | does | who | flow |
| --- | --- | --- | --- |
| GET `/api/schedule?month=` | units (from `wg_units`) × jobs × unit events for the month | schedule view | F02 |
| POST `/api/jobs` | creates the job on **first save**, never on click | jobs edit | F02 |
| PATCH `/api/jobs/:id` | autosave patch with `FIELD_POLICY` filtering and an `updated_at` precondition (409 on conflict) | jobs edit (per field) | F02–F07 |
| POST `/api/jobs/:id/move` | drag on the schedule (unit, dates); warns on overlap with a block | schedule edit | F03 |
| PUT `/api/jobs/:id/services` | WIREGUARD job types 1–15; their profiles unlock sections | jobs edit | F02 |
| PUT `/api/jobs/:id/crew` · `/headcount` · `/third-parties` | crew and planning | jobs edit | F04 |
| DELETE `/api/jobs/:id` | soft delete | jobs delete | F02 |
| GET `/api/jobs` · `/api/jobs/:id` · `/api/job-log` | board, editor, wide log | jobs / job_log view | F02, F08 |
| POST/DELETE `/api/unit-events` | maintenance and status blocks | schedule edit | F14 |
| POST `/api/jobs/:id/log-events` | batch upsert by `client_id` (offline replay safe) | jobs edit | F05 |
| POST `/api/jobs/:id/jra` · PATCH answers · POST send · POST decide | JRA lifecycle; the score is computed on the server from `jra_templates` | jobs edit / approver | F04 |

### Documents, quality and analytics (F06, F08, F11)

| method path | does | who | flow |
| --- | --- | --- | --- |
| GET/POST `/api/8mf`, PUT `/api/8mf/:id` | save = one **D1 batch**: report + incidents + version snapshot + roll-up to job NPT/Failure + roster upsert (the statements tested in `test_schema.py`) | eight_min_facts edit | F06 |
| POST `/api/8mf/:id/sent` · GET `/api/8mf/:id/history` | send marker, versions | 8MF edit / view | F06 |
| GET/POST/PATCH `/api/failure-roster` | roster, manual rows, action status | failure_roster | F06 |
| GET/PUT `/api/pre-job-notes/:jobId` · POST `/send` | versioned handover notes | pre_job_notes | F11 |
| GET `/api/metrics/:name?filters` | statistics, NPT, utilization, competency computed by `src/shared/metrics` (pure TypeScript, unit-tested, also used by the browser) | dashboard views | F08 |
| POST `/api/files` · GET `/api/files/:key` | upload or download to R2 (generated PDFs/XLSX, job packages, knowledge docs); the size is checked first | per menu | all |

### Wires (D3: read-only, fed by WIREGUARD)

| method path | does | who | flow |
| --- | --- | --- | --- |
| GET `/api/wires?unit=&status=` | register from `wg_wires` + `wg_drums` + latest test + flags | wires view | F13 |
| GET `/api/wires/:serial` | detail: runs, tests, derived facts (trips/jars since cut, life consumed, used-wire limit, pre-job test status) | wires view | F13 |
| GET `/api/jobs/:id/wire-check` | pre-job test rule and tension limit for the job's wire and toolstring, plus linked WIREGUARD runs | jobs view | F04, F05 |
| GET `/api/wire-kpis/data?filters` | the mirrored rows and WIREGUARD parameters the browser-side KPI engine needs (paged) | statistics view | F08 |
| GET `/api/wire-kpis/parity` | last parity run vs the current WIREGUARD build stamp | admin | — |

There are no write routes: every wire screen links to WIREGUARD for changes.

### Attendance, inventory, Knowledge Hub, admin (F09, F10, F12)

| method path | does | who | flow |
| --- | --- | --- | --- |
| GET `/api/attendance?month=` · PUT `/api/attendance` (batch) · POST `/approve` | grid, cell codes, approvals | attendance | F09 |
| GET `/api/inventory/:kind` · POST `/api/inventory/movements` · POST `/undo` · GET `/reconciliation` | ledger; overdraw and replays refused by the database | inventory_* | F10 |
| GET/POST/PUT `/api/knowledge` · GET `/api/knowledge/search?q=` (FTS5) | library and curation | knowledge_hub | F12 |
| GET/PUT `/api/database/{lookups,pce,grease-panels,service-profiles}` | local lists; WIREGUARD lists are read-only here, with a link to edit them in WIREGUARD | database | F02 |
| POST `/api/assistant` (streaming) | Claude over the manual text, capped per user per day | ai_assistant | — |

Route count: **about 60** API routes plus 3 cron schedules.

**Webhooks in:** none in v1 (sync is a pull). **Webhooks out:** none. SLK Ops never writes to WIREGUARD.

### Scheduled work

| cron (UTC) | Riyadh | does |
| --- | --- | --- |
| `*/15 * * * *` | every 15 min | WIREGUARD sync (lists, wires, drums, runs). Documents and tests on the hour |
| `0 1 * * *` | 04:00 | reconciliation (all open jobs + last 90 days), integrity sweep (NPT without 8MF, failure without roster row, missing rig times, blank drafts > 24 h, deleted after 7 days), daily digest e-mail |
| `0 2 * * *` | 05:00 | D1 export to R2 `backups/` (30-day retention), the same pattern as WIREGUARD's nightly backup |

## The parts that bite

- **D1 quirks (from WIREGUARD's handover):**
  - No semicolons inside SQL comments, no window functions, no long `UNION ALL` (all checked in `0001`).
  - `wrangler d1 execute --file` never returns SELECT rows, so use `--command`.
  - Imported WIREGUARD history says `Approved` where the app writes `approved`, so the mirror columns use `COLLATE NOCASE`.
  - Client-raised alerts use `sev`, server rows use `severity`. Normalise in the sync.
- **Writes and transactions:** D1 has no interactive transactions. Multi-step writes (8MF save, job + services, movement + audit) go in one `db.batch([...])`, which is atomic. Guards live in the database (triggers and checks), so a batch fails as a whole instead of half-applying.
- **Sync correctness:**
  - Upsert by natural key, never delete: rows gone upstream get `wg_active = 0`.
  - Runs that are cut-only (`Maintenance Wire cut`, `SPOOL-AD`) are flagged `is_cut_only` and kept out of run counts, exactly as WIREGUARD does.
  - A failed sync leaves the previous mirror intact and shows "WIREGUARD data as of hh:mm" in the header.
- **Service account for sync:** a Viewer with every country (decided). WIREGUARD shows **country-less rows to Admin only**, so legacy rows without a country would be invisible to the sync and cause false 'no runs' findings. Count them once and fill them in WIREGUARD; don't make the account Admin.
- **KPI drift:** WIREGUARD's KPI formulas live in its browser code and change with its releases. The parity test plus the build-stamp watch (`app-build` meta tag) catch drift. Re-run parity after every WIREGUARD release.
- **Auth coupling:**
  - If WIREGUARD is unreachable, nobody can sign in. Existing sessions continue on the cached `/auth/me` for up to 15 minutes, then pause with a clear message.
  - Passkeys don't carry across subdomains (password only in v1).
- **Time zones:** store UTC ISO text; show Asia/Riyadh. Job and attendance days are local dates. WIREGUARD dates arrive as `22-Feb-22` style in old imports, so the sync normalises them to ISO.
- **Multi-country:** WIREGUARD already has Saudi Arabia and Bahrain (SL-38). Every row carries `country`. Lookups are seeded for Saudi Arabia, and Bahrain gets its own when enabled.
- **Idempotency:** offline job-log events and inventory movements carry `client_id`. 8MF and Pre-Job Note saves carry `expectedVersion`. Sync upserts are naturally idempotent.
- **Races:** job autosave sends `expectedUpdatedAt` and gets a 409 with per-field merge. Document numbers come from the atomic counter.
- **Releases:** follow WIREGUARD's discipline. A build stamp sits in the HTML and the service-worker cache version bumps every release, or devices keep stale code. A migration goes before the Worker deploy.
- **CPU and size limits:** exports are generated in the browser. The Worker handles lists, metrics on indexed queries and the sync in pages of 500 rows. D1 limits are a 10 GB database and 100 KB rows, comfortable for this volume; WIREGUARD holds about 1,200 runs a year.
- **Personal data:** names, EIDs and leave types are HR data. They're restricted by role, audited, and exported only by permitted roles.

## Build order

The build comes **later**, after the user's review of the seed and design.

### 1. Vertical slice

Sign in with a WIREGUARD account → units come from WIREGUARD → create a job on a unit → enter rig-up/down → see efficiency on the board.

- Screens: S01, S02 (read-only), S03, S04, S06.
- Tables: `user_roles`, `role_permissions`, `wg_units`, `wg_job_types`, `service_profiles`, `jobs`, `job_services`, `job_metrics`.
- Routes: auth login/logout, `/api/me`, the units part of the WIREGUARD sync, schedule, jobs list, job create and patch.
- Done when the job shows on the schedule of a real WIREGUARD unit and a viewer can't edit it.

### 2. Must-haves, by area

| milestone | screens | tables | routes |
| --- | --- | --- | --- |
| 2a Auth, roles, WRITE_RULES, FIELD_POLICY | S01, S34 | `tab_grants` | admin user-roles, role-permissions |
| 2b Full WIREGUARD sync + status | header status | all `wg_*`, `wg_sync_log` | cron, `/api/wg/*` |
| 2c Schedule complete | S02, S37 | `unit_events` | move, unit-events |
| 2d Job editor complete (incl. toolstring builder, slickline execution fields) | S04–S07 | crew, headcount, third parties, pce, grease panels | services, crew, headcount |
| 2e **Reconciliation** | S46 | `recon_findings`, `recon_links` | `/api/recon/*`, nightly cron |
| 2f Database (local lists, service profiles) | S24 | lookups | `/api/database/*` |
| 2g Job Log | S08 | — | job-log + browser XLSX |
| 2h 8 Min. Facts + Failure Roster | S10–S12 | 8MF tables | `/api/8mf`, roster |
| 2i Statistics + NPT | S13, S14 | — | metrics |
| 2j Attendance | S17 | people tables | attendance |
| 2k Explosive inventory | S18, S39 | inventory | inventory |

### Remaining order (updated 2026-10-24 after the Administrator Manual review)

Done: slice, 2a Users & Roles (with the manual's adjustments), 2b WIREGUARD sync, 2e Reconciliation. The rest, in order:

| # | milestone | screens | from the Administrator Manual |
| --- | --- | --- | --- |
| 2c | Schedule: drag to move and resize, unit maintenance and status blocks, a warning when WIREGUARD drops a unit that has open jobs | S02, S37, S38 | §4 caution |
| 2d | Job editor complete: Preparation (well, wire and drum from WIREGUARD, pressure control, toolstring builder), Execution extras, Closure sign-offs, **revenue**, crew, head count | S04–S07 | §3 placement, revenue decision |
| 2f | Database: local lists, service profiles, PCE, grease panels | S24 | §4 |
| 2g | Job Log with exports | S08 | |
| 2h | 8 Min. Facts and Failure Roster | S10–S12 | |
| 2i | Statistics and NPT Analysis | S13, S14 | |
| 2j | Attendance grid + **Headcount Roster** (attendance admin) with the **SLK Contacts list** | S17, S44 | §6, §8.2 |
| 2k | Explosive inventory and movements | S18, S39 | |
| 3 | Should-haves: hardware and MCR, utilization, competency, JRA, **Pre-Job Notes** (incl. admin delete with two confirmations), wire views and 17 Wire KPIs, documents and exports, offline job log | | §8 |
| 4 | **Bonus**: rules per job type, Closure distribution and approval, Bonus Report and Analysis, statements by e-mail, **step-up re-authentication**; **Sales Dashboard** from job revenue; **admin data export and import** | S32, S33, S47 | §1, §2, §3, §7 |
| 5 | **AI Agent** (scoped tools, budget, daily caps) and the help assistant | S23, S35 | §5.2 |
| 6 | Could-haves: Knowledge Hub, Quick Plan, signatures | | |

### 3. Should-haves, then could-haves

- **Should:** hardware and MCR, utilization, competency, JRA, Pre-Job Notes, documents and exports, offline job log, **the Wires register and wire detail (read-only), the wire panel on the job, Wire KPIs (17, with parity test)**, attendance extras, digest e-mail.
- **Could:** Knowledge Hub, Quick Plan, AI assistant, signatures.

### 4. Fixes from replica-entrepreneur

Not run yet. Seeds:
- no blank jobs;
- role permissions instead of a shared password;
- the tracking-gap and reconciliation warnings become a to-do list per SDM.

## Slickline adaptation (what changed from the WL Hub)

| area | WL Hub | SLK Operations |
| --- | --- | --- |
| units | WL trucks 18–59, MEM, CT | **WIREGUARD units** (35: SL-30…SL-67, MSL-0xx, TRPY-01, spares; Saudi Arabia + Bahrain), synced |
| services | 47 logging/perforating services | **WIREGUARD's 21 job types** (Gauge Cutter, Tubing Drift, Sand bailer, R&P PX & PXN Otis, R&P GAS LIFT VALVES, Memory Gauges, PERFORATORS …), each with a local profile: domain + plug / fishing / memory / perforation / explosive flags (`service_profiles`) |
| accounts | DWO-A, SAWCOD, NAWCOD, UNC | **WIREGUARD job locations**: D&WO, LSTK, NAWCO, SAWCOD, Unconventional, Other |
| areas / fields | WL area list | **WIREGUARD fields** (~100 codes) and **rigs** (~200) |
| cables | cable book with run counts | **WIREGUARD wires and drums** (85 wires, D58 Super Duplex etc., MBL): read-only register, wire detail, wire panel on the job, 17 ported Wire KPIs (D3) |
| crew roles | FE, CC, Sr Op, Op | slickline supervisor, operator, assistant operator, helper (+ storekeeper) |
| pressure control | PCE + grease panel | lubricator, wireline valve/BOP, stuffing box, grease head, tool trap, with ratings and lengths |
| new job fields | — | toolstring builder, target depth, completion details, nipple profile, SSSV depth; tag depth, max pull, overpull, jarring minutes, wire cut, survey details |
| inventory | explosive-heavy | small explosives set (perforators); hardware = plugs, locks, running and pulling tools, gauge cutters, bailers, GLVs, memory gauges; MCR = wire reels, packing, rope sockets, seals |
| new module | — | **Reconciliation with WIREGUARD** (S46) |
