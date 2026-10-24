# SLK Operations ↔ WIREGUARD integration

Decided with the user on 2026-10-24. Source of facts: the WIREGUARD project (`nesr/SLK__Wireguard_v2`): its handover note (build `2026-10-19T01-00`, migration 0035), `reference/wrangler.toml`, `schema.sql`, migrations 0030–0031, the `index.js` routes, and the `DATA_SLK` exports.

## Decisions

| # | decision | consequence |
| --- | --- | --- |
| D1 | **Separate app, linked.** SLK Operations is its own Cloudflare Worker with its own D1, on a `nesrapp.com` subdomain (proposed `slkops.nesrapp.com`). | Its own releases; nothing in WIREGUARD's single-file Worker changes. |
| D2 | **WIREGUARD is independent and the system of record** for wires, drums, units, fields, rigs, job types, job locations and the job log (runs). | SLK Ops never writes to WIREGUARD. If SLK Ops is down, WIREGUARD is unaffected. |
| D3 | **SLK Ops receives all WIREGUARD data.** WIREGUARD's wire and drum data replaces the WL Hub's "cables" module. **Decided 2026-10-24: the wire module is read-only views plus WIREGUARD's KPIs** (see "Wire module" below). | No local wire editing at all. Changes to wires, drums and tests are made in WIREGUARD. |
| D4 | **Reconciliation module** in SLK Ops compares SLK Ops jobs with WIREGUARD job-log entries and shows the discrepancies. | New screen S46 and new flow F15 (below). |
| D5 | **Same WIREGUARD accounts** for sign-in (`NESR-<numbers>` usernames). | No second password. SLK Ops keeps its own operational roles per username, because WIREGUARD roles are wire roles. |

## How the link works

```
 browser ──▶ SLK Ops Worker (slkops.nesrapp.com)
               │  D1 slkops-db   (jobs, schedule, 8MF, attendance, inventory, mirror tables)
               │  R2 slkops-files, KV slkops-kv, cron, Email Service, Anthropic API
               │
               └─[service binding WIREGUARD]──▶ WIREGUARD Worker (unchanged)
                                                  D1 slkwireguard-db, R2, KV
```

- A **Cloudflare service binding** (`[[services]] binding = "WIREGUARD", service = "slkwireguard-backend"` in SLK Ops' `wrangler.toml`) lets the SLK Ops Worker call WIREGUARD's existing HTTP API internally, with no public round trip and no CORS. It needs both Workers in the same Cloudflare account. **To confirm:** the account that hosts `slkwireguard-backend`.
- **Read-only.** SLK Ops calls only `GET` endpoints, plus `/auth/login` and `/auth/me` for sign-in. It never calls a write endpoint. A code-level allow-list in the SLK Ops client enforces this.
- **Data flow is a pull, which keeps WIREGUARD unchanged.** "WIREGUARD pushes to SLK Ops" is met by SLK Ops pulling on a short schedule and on demand. If a true push is wanted later, WIREGUARD could emit fire-and-forget events (a Cloudflare Queue) that never block or fail its own saves. That would be a WIREGUARD change, so it's optional and later.

### WIREGUARD endpoints SLK Ops uses (all exist today)

| endpoint | used for | sync |
| --- | --- | --- |
| `POST /auth/login`, `GET /auth/me` | sign-in and session check | per request (cached 60 s) |
| `GET /units` | schedule rows (35 units: SL-30…SL-67, MSL-0xx, TRPY-01, spares; Saudi Arabia and Bahrain) | every 15 min + on demand |
| `GET /job-types` | the SLK service catalogue (21 job types) | every 15 min |
| `GET /job-locations` | accounts: D&WO, LSTK, NAWCO, SAWCOD, Unconventional, Other | every 15 min |
| `GET /fields` | areas/fields (~100 codes: ABQQ, HRDH, HWYH, KHRS, MNIF …) | every 15 min |
| `GET /rigs` | rig list (~200) | every 15 min |
| `GET /wires`, `GET /drums` | wire and drum register (85 wires, drums by unit and position) | every 15 min |
| `GET /jobs?status=all` | job-log runs for reconciliation and dashboards | every 15 min, plus "Refresh" on the reconciliation screen |
| `GET /documents` | maintenance entries and wire tests (wrap, torsion, tension; expiry dates) | hourly |
| `GET /sop-settings`, `/sop-wire-size-thresholds`, `/wire-alloy-database`, `/kpi-settings`, `/wire-retirement-reasons` | wire limits and KPI parameters (D3) | hourly |
| `GET /notifications` | wire alerts for G5 and the wire flags (no country filter upstream, filtered in SLK Ops) | every 15 min |
| `GET /health` | WIREGUARD reachability | every sync |
| `GET /` (the app shell `wireguard.html`) | build stamp from `<meta name="app-build" content="…">`, which drives the KPI parity watch | hourly |

### Sync service account (decided 2026-10-24)

A dedicated **read-only WIREGUARD account with every country** is used only by the sync.

**What WIREGUARD's code does with it:**
- Its read endpoints (`GET /jobs`, `/wires`, `/documents` …) check sign-in and filter by country, but don't check a menu permission. A **Viewer** can therefore read everything the sync needs, and WIREGUARD's `WRITE_RULES` stop a Viewer from writing.
- **Watch out:** `filterRowsByCountry` shows rows with **no country** to Admin only. Legacy rows imported before country-scoping may have none. A Viewer, even with every country listed, would not see them, so SLK Ops would undercount runs and reconciliation would report false "no runs" findings.
- The fix is **not** to make the service account Admin, because Admin can write. Instead, count the country-less rows once, and if there are any, have a WIREGUARD admin fill in their country (a data correction in WIREGUARD; no code change). The read-only count, run from the WIREGUARD project folder:
  ```bash
  npx wrangler d1 execute slkwireguard-db --remote --command "SELECT 'jobs' t, count(*) n FROM jobs WHERE country IS NULL OR country = '' UNION ALL SELECT 'wires', count(*) FROM wires WHERE country IS NULL OR country = '' UNION ALL SELECT 'drums', count(*) FROM drums WHERE country IS NULL OR country = ''"
  ```

**Setup:** done by a WIREGUARD admin. SLK Ops never creates accounts.
1. In WIREGUARD → Users, create the account:
   - username `NESR-` + digits (WIREGUARD's rule; pick an unused number reserved for the service);
   - name "SLK Ops sync";
   - role **Viewer**;
   - **countries: every enabled country** (Saudi Arabia, Bahrain …);
   - active.
2. Sign in once in WIREGUARD with it to clear the "must change password" flag, and set a long random password.
3. Store it only as SLK Ops secrets: `wrangler secret put WG_SYNC_PASSWORD` (the username goes in `WG_SYNC_USERNAME`).
4. When a new country is enabled in WIREGUARD, add it to this account too. SLK Ops' sync status shows "countries seen" so a missing one stands out.

**Behaviour:**
- The sync signs in, keeps the 12-hour token in KV, and signs in again on a 401.
- It never calls a write endpoint. This is enforced by the allow-list in SLK Ops' WIREGUARD client and by the Viewer role in WIREGUARD itself.
- Human users keep using their own accounts, so WIREGUARD's audit trail stays meaningful.

### Sign-in with WIREGUARD accounts

1. The SLK Ops sign-in form (username, password) posts to the SLK Ops Worker.
2. The Worker calls `WIREGUARD /auth/login` through the binding. On success it gets WIREGUARD's token, then calls `/auth/me` for the name, WIREGUARD role and countries.
3. SLK Ops looks up the username in its own `user_roles` table:
   - **Found:** the SLK Ops role and tab grants apply.
   - **Not found:** a default comes from the WIREGUARD role (Admin → admin, Data Manager → viewer, Maintenance → maintenance_manager, Supervisor → slickline_supervisor, Viewer → viewer), and an SLK Ops admin adjusts it.
4. SLK Ops stores the WIREGUARD token **server-side** (KV, keyed by an opaque SLK Ops session id in an HttpOnly, Secure, SameSite=Lax cookie). The browser never sees the WIREGUARD token.
5. Every request re-validates through `WIREGUARD /auth/me` (cached 60 s in memory/KV). WIREGUARD's own revocation therefore applies within a minute: password change, deactivation and "sign out everywhere" all raise its session generation.
6. SLK Ops idle sign-out matches WIREGUARD's 60 minutes. The session cannot outlive WIREGUARD's 12-hour token.
7. **Passkeys / Face ID:** WIREGUARD's passkeys are bound to its own host, so they won't work on another subdomain. Password sign-in in v1; shared passkeys later only if WIREGUARD's relying-party ID moves to `nesrapp.com`, which would be a WIREGUARD change.

No shared `JWT_SECRET`: SLK Ops never verifies WIREGUARD tokens itself, so the secret stays only in WIREGUARD.

## Mirror tables in SLK Ops

SLK Ops keeps a **read-only local copy** of what it needs, so screens are fast and still work if the binding hiccups. Every mirror row carries `wg_synced_at`, and a sync never deletes history: rows missing upstream get `wg_active = 0`.

`wg_units`, `wg_job_types`, `wg_job_locations`, `wg_fields`, `wg_rigs`, `wg_wires`, `wg_drums`, `wg_runs` (job log), `wg_documents` (tests and maintenance), `wg_sync_log`.

SLK Ops' own tables reference these by **natural key** (unit number, wire serial, drum no, field code, job-type name, field ticket), not by id. A WIREGUARD rename shows up as a reconciliation finding instead of breaking a foreign key.

## Reconciliation: SLK Ops jobs vs WIREGUARD runs (S46, F15)

> **Built 2026-10-24 (milestone 2e). What the data showed changed the matching order.** In WIREGUARD's export, field tickets are all legacy placeholders (`LEG-BATCH-n`, one per run), and DRSS numbers are mostly one per run. Matching therefore works in this order:
> 1. a manual link;
> 2. a **real** field ticket;
> 3. a **real** DRSS number;
> 4. **unit + date (±1 day) + well**: the run's drum belongs to the job's unit (WIREGUARD's drum register).
>
> Placeholders never match. When two jobs on one unit fit, the run stays unlinked and both are offered in the link picker. Runs dated before `RECON_START_DATE` (default 2026-10-01, the go-live) are history and are never reported as unlinked.
>
> **Suggestion for WIREGUARD (its owner's call, no change needed for SLK Ops):** if crews entered the real field ticket in WIREGUARD's Job Entry, matching would become exact rather than inferred.

**Matching.** An SLK Ops job matches WIREGUARD runs on **field ticket** (`jobs.ticket_no` ↔ `fieldTicket`), and also on the **DRSS number** when present. Fallback when the ticket is blank: unit's drums + wire serial + date window (job start−1 to end+1) + well.

| check | finding | severity |
| --- | --- | --- |
| Completed SLK Ops job with no WIREGUARD runs | "No wire runs logged in WIREGUARD" | high |
| WIREGUARD runs with no SLK Ops job | "Runs not linked to any job" | medium |
| Run date outside the job's dates (±1 day) | date mismatch | medium |
| Run's drum not on the job's unit (from `wg_drums.slicklineUnit`) | unit / drum mismatch | high |
| Wire serial differs from the job's wire | wire mismatch | high |
| Well, field or rig differ | location mismatch | low |
| Job type of runs not among the job's services | service mismatch | low |
| Max depth, jarring minutes or wire cut differ beyond a tolerance | value mismatch (adjustable tolerance) | low |
| WIREGUARD runs still pending approval for a closed job | "Runs awaiting approval in WIREGUARD" | medium |
| SLK Ops job count vs WIREGUARD run count per unit per month | volume summary | info |

**Screen S46** (Operation → Reconciliation):
- A summary per SDM, unit and month, then a findings table with filters.
- Each finding links to the SLK Ops job and shows the WIREGUARD run values side by side.
- Actions are SLK Ops-side only: "Link to job", "Mark explained" (with a note) and "Re-check". Fixing a WIREGUARD entry happens in WIREGUARD, with a deep link to it.
- A nightly check feeds the integrity banner and the daily digest.

## Wire module inside SLK Ops (D3, decided 2026-10-24: read-only views + WIREGUARD's KPIs)

Nothing about a wire is edited in SLK Ops. Every wire screen has **Open in WIREGUARD** for changes.

| piece | what the user sees | data |
| --- | --- | --- |
| **Wires** (menu, replaces the WL Hub's Cable Summary S30) | the register: serial, grade, size, drum, unit, status, remaining length, latest test result and expiry, alert flags; filters by unit, status, country | `wg_wires`, `wg_drums`, `wg_documents` |
| **Wire detail** (replaces Cable Book S31) | runs (date, job, depth, max tension, jarring, wire cut, remaining length), tests (wrap, torsion, tension, MPI with results and expiry), and derived facts: trips and jarring minutes since the last cut-back, cumulative hours, life consumed, "used wire" (any run history → 50 % MBL limit), pre-job test status | `wg_runs`, `wg_documents`, `wg_settings` |
| **Wire panel on the job** (Preparation and Execution) | wire and drum picked from the drums on the job's unit. Shows whether the pre-job test rule is met (wrap or torsional before the job + tension test within 30 days, the parameters WIREGUARD uses), the tension limit for the toolstring and a warning when the expected pull is near it. On Execution: the WIREGUARD runs linked to this job | same + `recon_links` |
| **Wire KPIs** (Service Quality → Wire KPIs) | WIREGUARD's KPIs with **the same codes, names and parameters**, filtered by SLK Ops' filters (unit, month, account, field), plus **Open the full WIREGUARD dashboard** | all of the above |

### How the KPIs are reproduced

WIREGUARD computes its 49 KPIs **in the browser** (`v2-patch.js`: `v2Derive` builds per-run facts once, the `V2_KPIS` registry renders each card). There is no server endpoint to fetch them from. SLK Ops therefore **ports the formulas** into `src/shared/wire-kpis` (pure TypeScript, run in the browser like the original). It keeps them honest three ways:

1. **Same parameters.** SLK Ops reads WIREGUARD's `/kpi-settings`, `/sop-settings`, `/sop-wire-size-thresholds` and `/wire-alloy-database` into `wg_settings`. Thresholds and on/off switches are WIREGUARD's own, and a KPI switched off in WIREGUARD is hidden in SLK Ops too.
2. **Same codes.** G1, C1, W14 and so on keep their codes, so a number in SLK Ops can be checked against the same card in WIREGUARD.
3. **Parity test.** The test suite loads WIREGUARD's own `v2-patch.js` in a headless page (WIREGUARD's toolkit already does this with a mock API and exposes `window.__v2Kpi`), feeds both engines the same mirrored data, and fails if any ported KPI differs. The sync records WIREGUARD's build stamp (the `app-build` meta tag in its app shell, currently `2026-10-19T01-00`) in `wg_settings`. When it changes, SLK Ops shows "WIREGUARD updated — KPI parity not yet re-checked" to admins until the test is re-run.

**Ported in v1 (17 KPIs, the ones operations acts on):**

| section | KPIs |
| --- | --- |
| General | G1 Runs logged, G2 Hours worked, G3 Wire cut, G4 Active wires, G5 Open alerts, G6 Awaiting approval, C12 Compliance score |
| Compliance | C1 Pre-job test compliance, C2 Cut-back on trips, C3 Cut-back on jarring, C4 Tension within limit, C5 Discard rule respected, C6 MPI currency |
| Jobs | J7 Tension utilisation per run, J9 Runs over the tension limit |
| Maintenance | M5 Time since last passing test |
| Integrity | W14 Wires needing attention first, W1 Life consumed |

The other 32, and WIREGUARD's Release 2 integrity KPIs (W2–W13) when they ship, are reached through **Open the full WIREGUARD dashboard**. Porting more is a per-KPI decision later; each needs only its formula and a parity case.

**Alerts:** `GET /notifications` (latest 300) has no permission check, so the Viewer sync account can read it. It also has **no country filter**, so SLK Ops assigns each alert the country of its wire or drum before showing it. Alerts with neither go to admins only, matching WIREGUARD's rule for country-less rows. Mirrored in `wg_notifications`.

## Cloudflare (decided 2026-10-24)

- **Same Cloudflare account as WIREGUARD.** A service binding only works inside one account.
- **Domain `slkops.nesrapp.com`**, a custom domain on the `slkops` Worker. `nesrapp.com` is already in the account.
- **Workers Paid plan.** The account owner switches it in the Cloudflare dashboard (Workers & Pages → Plans). The subscription is per account, so WIREGUARD gains the same higher CPU limits.
- Email sending uses the `nesrapp.com` domain already onboarded for WIREGUARD. Add the sender `slkops@nesrapp.com`.

## Open items (later)

- Count WIREGUARD rows without a country (command above), and fill them in WIREGUARD if any.
- Whether SLK Ops' daily digest is merged with WIREGUARD's or separate (separate by default).
- More ported KPIs beyond the 16, case by case.
