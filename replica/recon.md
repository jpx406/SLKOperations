# Recon map: WL Operations Hub (web, desktop-first)

Scope: the whole app. Operation, Service Quality, Attendance, Inventory and Knowledge Hub were seen live. Database, Quick Plan, Pre-Job Notes editor, JRA, MCR, WL Cables, Bonus, Sales Dashboard and Administration come from the user manual only.
For: an internal NESR rebuild (user confirmed authority on 2026-10-24), **re-targeted to Slickline (SLK)**, **deployed on Cloudflare and linked to WIREGUARD** (see `integration-wireguard.md`). The WL Hub is the workflow model; SLK services, wire, pressure control and crew roles are in `architecture.md` → "Slickline adaptation" and `seed_slk.sql`.
Date: 2026-10-24
Seen as: role **SQM**, country Saudi Arabia, app Rev 1.10.

> Privacy: the live app holds real personnel names, EIDs and client well data. None of it is copied here. Names in the original are replaced with role labels, and the enum values below are configuration lists, not records.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | the user's own account (SQM) | https://wl-operations-hub.vercel.app/ | read at human speed with the user present; navigation only after one accidental record creation (see "Recon incidents") |
| 2 | User Manual v1.1 (36 pp, covers Rev 1.10) | https://uozhquglqqyenmqkwplq.supabase.co/storage/v1/object/public/docs/WL_Operations_Hub_User_Manual.pdf | linked from in-app Help; marked "safe to share with any signed-in team member"; downloaded with the user's OK; copy in `replica/sources/` (PDF plus extracted text). Reference only, never shipped |
| 3 | Training Presentation (PDF, 2.4 MB) | …/docs/WL_Operations_Hub_Training_Presentation.pdf | not read (the user declined) |
| 4 | Administrator Manual | in-app Help, Admin only | not available to SQM; Bonus, Sales Dashboard, Users & Roles and AI Agent stay low-confidence |
| — | help center, pricing, changelog, store listing, API docs | n/a | none exist; this is an invite-only internal tool |

Visible stack hints (public, not reverse-engineered): hosted on Vercel, files in Supabase Storage. The data store is probably Supabase Postgres too (guess).

## Core loop

An SDM or Sales user opens a job ticket and books it on a unit in the **Unit Schedule**. The crew then moves the job through **Design → Preparation → Execution → Closure**. Every ticket rolls up into NPT, efficiency, utilization and competency dashboards that management runs the fleet on.

## Global shell (on every screen)

- Header: brand mark, country flag, app name, revision label.
- Top nav groups: Operation · Service Quality · (Bonus) · (Sales Dashboard) · Attendance · Inventory · (WL Cables) · Knowledge Hub · (Administration). Which groups appear depends on role and on per-user tab grants.
- User bar: name, role badge (e.g. SQM), Help, light/dark toggle, change password (key icon), Sign Out, **↻ Refresh** ("Reload from database"), a Riyadh GMT+3 clock, and a "live · hh:mm:ss" last-sync indicator.
- Floating **AI Assistant** button. It opens a chat side panel ("Help with the app — no live data access").
- Sub-tab pill row under the nav for the active group.
- Field-level permission badges next to labels (SALES, SDM, SALES / SDM). Fields without your badge are read-only.
- A second "restricted-content unlock" layer: an UNLOCKED pill on Job Log and the analytics pages, and a password prompt on Schedule filters ("same password as the Database").

## Screens

`(m)` = known from the manual only, not seen live.

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Sign in | `/` signed out | invite-only login | country picker (flag), email, password + eye toggle, Sign In, Forgot password, rev/credit line | empty |
| S02 | Unit Schedule | Operation → Schedule (default) | Gantt of units × days for a month | month ‹ › Today, legend (Planned blue / Ongoing yellow / Completed green), + Create Job, Filters (password-locked), Show canceled jobs, + Maintenance Event, + Unit Status Event, warning banner "N jobs without dates not shown", unit rows (unit #, ACTIVE pill, cable spec lines), job bars (ticket + well), hatched "Mechanic" maintenance bars, "Transferred" status tag, drag to move, edge-drag to resize | filled, today column highlighted, warning banner |
| S02b | Schedule Filters lock | S02 → Filters | Division/SDM filter, password-gated | modal, password field, Cancel/Unlock | locked |
| S03 | Job Board | Operation → Jobs | searchable list of every ticket | count ("473 jobs"), search (ticket/well/rig/SDM), status filter (All/Planned/Ongoing/Completed/Canceled), + Create Job, job cards (ticket or "NO TICKET", well · rig, dates or "no start", SDM line, account / area · primary service, 4 stage progress bars, "% eff", status pill, ✕ remove) | filled, blank-ticket cards |
| S04 | Job editor · 01 Design | open a ticket / + Create Job | client request and job setup | header (← Jobs, title, status pill, Full Job Report, Job Package, Signatures, save state "saving… / 💾 Saved", Delete Job), 4 stage cards with %, form grid with role badges, services 1–15 with an auto "Service Domains" readout, Save, Preparation → | new (6%), autosaving |
| S05 | Job editor · 02 Preparation | stage card | well data, equipment and PCE readiness | JRA banner (Not started / Start JRA, QAF12069), head-count steppers with max per role, account assignment, Well Data grid, Cable & Conveyance, conditional sections (🔒 Perforation details, 🔒 Pipe Recovery details), Pressure Control with a live clearance check, Special setup | empty, locked-conditional fields |
| S06 | Job editor · 03 Execution | stage card | runs, timing, NPT, efficiency | Job Log · Sequence of Events (Offline version, Start Job Log), run counters, auto efficiency fields, plug type (Plug service only), arrival/rig-up/rig-down datetimes, operating-hours auto + SDM override, NPT hours, auto job efficiency `(1 − NPT ÷ OpHrs) × 100`, Failure Y/N | empty, "auto — needs …" placeholders |
| S07 | Job editor · 04 Closure | stage card | sign-off, reporting, crew bonus | lock banner (failure fields unlock when NPT > 0 or Failure = Yes), sign-off selects, Job Package Link, report closure, GEARS #, audits, OpsMiner, service order, failure description, bonus remarks, "Done — back to Job Board" | locked failure fields |
| S08 | Job Log | Operation → Job Log | spreadsheet view of all jobs | UNLOCKED pill, status filter, Print, Download, XLSX, 9 filter dropdowns + Clear, wide table (~34 columns incl. crew slots, third-party PO), JRA status pill (DRAFT / SENT / APPROVED) | filled |
| S09 | Pre-Job Notes list | Operation → Pre-Job Notes | every pre-job note | (m) search, Sent / Not Sent, date range, table (Log #, ticket, rig, well, rig type, RDD dept, status, version, main contact, saved/sent on), row select → Export XLSX / merged PDF, Admin-only Delete | **restricted** for SQM ("restricted to WL contacts and Admins") |
| S10 | Failure Roster | Operation → Failure Roster | failure register and trend | CSV, PDF Report, + Add failure, "Failures by Month" bar chart (click for details; Excel/PDF/CSV per month), tracking warning ("21 jobs not fully tracked: 13 with NPT but no 8MF · 8 flagged as failure but not in roster", ▸ Show), 7 filters, table (#, date, well · RILR · 8MF severity or "NO 8MF", ticket, category, action-item status Open / In Progress / Closed) | filled, warning |
| S11 | 8 Min. Facts list | Operation → 8 Min. Facts | failure/NPT fact sheets per ticket | subtitle "per Ticket # → job NPT → Failure Roster → print, Word, email", status filter (All/Saved/Sent), search, + New 8 Min Facts, table (Log # EM-00nn, ticket, well, title, incidents, total NPT, severity pill, status pill incl. "Sent by …", version vN, created by, last saved) | loading, filled |
| S12 | 8 Min. Facts editor | S11 → row | structured incident report | ← back, title, Saved · vN, Log #, "✓ All changes saved", Save, Print/PDF, Word, Email…, History, audit line (created/saved/sent), Report Header (ticket picker → rig/well/crew prefilled, title, RILR no., auto severity), repeatable Incident cards (↑ ↓ collapse; What happened, When date/time, NPT hrs → severity, What failed list + Add item, Immediate actions, Current situation, Who was informed client/NESR), + Add incident, Severity Reference matrix (screen only; live row highlight), Report Totals, "On save, updates automatically" side effects | filled, saved |
| S13 | Operation Statistics | Service Quality → Statistics | fleet KPIs | UNLOCKED, period presets (This Month / 3 Months / YTD / All Time), 9 filters, KPI tiles (Jobs, Op Hrs, NPT, Fleet Eff, Avg Run Eff, Avg Unit Util), efficiency-by-division gauges, missing-data warning + View list, 12 analysis charts each with Print / XLSX and month drill-down, wellsite-audit compliance gauges per SDM (target 25%) | filled, warning |
| S14 | NPT & Failure Analysis | Service Quality → NPT Analysis | NPT breakdowns | Download Report, XLSX, filters, KPI tiles (Total NPT, Jobs w/ NPT, Failures, Failure rate, Fleet eff), horizontal bars by month / area / account / service / field engineer, failure job list | filled |
| S15 | Truck Utilization | Service Quality → Utilization | crew and fleet utilization | Download/XLSX/Print, filters, avg crew utilization per month (60/30 rotation), avg fleet utilization per month, methodology text, units section KPIs (fleet util, avg, jobs, op hrs, best/lowest truck), heatmap truck × month with jobs / avg / active-idle days, colour bands (≥75 / 50–75 / 25–49 / <25), section 2 for MEM/CT crews | filled |
| S16 | Competency | Service Quality → Competency | person × service experience levels | Print/Download/XLSX, filters (service, person, role FE/CC), level rule (<10 Basic · 10–19 Intermediate · 20–29 Advance · ≥30 Expert), team overview by level, service-domain rollup, monthly trend, bench strength / coverage gaps (⚠ ≤1 person at Advance+), near-threshold list, quality signal (fail % and NPT/job per person), person cards | filled |
| S17 | Attendance Sheet | Attendance | monthly day-code grid per employee | UNLOCKED, month picker, 7 filters + search, Multi-Select toggle (click / shift-click range, then apply a code), Save, XLSX (all), HTML, code legend, shading legend (weekend, Saudi holiday, on leave while assigned to a job), row highlight on click, groups by reporting line with per-group XLSX, per-cell code select, summary column, Approve per row | filled |
| S18 | Explosive Inventory | Inventory → Explosive | explosives ledger by location | CSV, PDF, Movement History, Job Reconciliation, 📦 Mobilize to Well, 🧾 Consumption & Return, Archived, + Add new, category pills, search (description / PN / SAP#), KPI tiles (On hand, At a well, Used, Junk, Received), grouped table (material, PN · SAP#, Aramco Bunker, Gun Shop, Inside Guns, At Location, On Order) | filled |
| S19 | Hardware Inventory | Inventory → Hardware | carriers, transfer kits, ESUB | same shell as S18; columns Warehouse, Gun Shop Store, Loaded Guns, At Location, On Order | filled |
| S20 | Job Reconciliation | S18 / S19 → Job Reconciliation | mobilized = consumed + returned, by well | ← Back to items, reconciliation table | **empty** ("No moves to or from a rig logged yet.") |
| S21 | Knowledge Hub | Knowledge Hub | lessons learnt library | count + "Library last synced", Lesson of the Week hero (thumbnail, summary, Key action, ▶ Present to the crew, Read), search, failure-type select with counts, sort (Newest / A→Z), show duplicates, type chips and category chips with counts, "▶ Present these N as a toolbox talk", doc cards (type, category, title, summary, tags, date, RILR ref) | filled |
| S22 | Help & Documentation | header → Help | manuals | modal with User Manual / Training Presentation (Open) and Admin Manual (admin only) | open |
| S23 | AI Assistant panel | floating button | in-app help chat | side panel, disclaimer, input, Send | empty |
| S24 | Equipment Database (m) | Operation → Database | lookup lists: WL Units (Active/Inactive, cable spec), PCE, Grease Panels | lists + Add | restricted to Ops Mgr / Maint Mgr |
| S25 | Quick Plan (m) | Operation → Quick Plan | card board for early job sketches | cards | — |
| S26 | Pre-Job Note editor (m) | S04 Design → Create/Open Pre-Job Notes | handover form with 5 sections, versioned | Job info, Toolstrings rows, Important notes, Contacts, Document control; Save (new version, Log # PJN-nnnn), Confirm & Send, History | — |
| S27 | Confirm & Send (m) | S26 | email with branded PDF | Subject/To/Cc, Open in Mail App (copies image to clipboard), Download .eml | — |
| S28 | JRA form (m) | S05 → Start JRA | QAF12069 risk assessment | 33 Yes/No/N-A questions in sections A…, live Risk Index Score, computed approval level, progress n/33, Send for Approval | — |
| S29 | MCR inventory (m) | Inventory → MCR | mechanical/completion hardware with par levels | reorder banner, stock-by-size table, Job Movement, Undo Log | — |
| S30 | Cable Summary (m) | WL Cables → Cable Summary | drum status and maintenance alerts | alert banner (Alloy ≈12 runs, STD ≈45 runs since service), per-unit drums | — |
| S31 | Cable Book (m) | WL Cables → Cable Book | per-wire run history | SN search, wire select, + Add Event, Excel/PDF export, link to the SharePoint directory, resistance trend, remaining length | — |
| S32 | Bonus Report / Bonus Analysis (m) | Bonus | crew bonus | Admin Manual only | unknown |
| S33 | Sales Dashboard (m) | Sales Dashboard | sales view | Admin Manual only | unknown |
| S34 | Users & Roles (m) | Administration | accounts, roles, per-tab grants | Admin Manual only | unknown |
| S35 | AI Agent admin (m) | Administration → AI Agent | data-aware agent | Admin Manual only | unknown |
| S36 | Change password modal | header → 🔑 | change password | current/new password | not opened |
| S37 | Maintenance Event form | S02 → + Maintenance Event | block a unit for maintenance | not opened (would write) | — |
| S38 | Unit Status Event form | S02 → + Unit Status Event | log Loan / Transferred / Junk / Backup-on-location periods | not opened | — |
| S39 | Mobilize to Well / Consumption & Return | S18 / S19 | inventory movements | not opened | — |
| S40 | Add failure | S10 → + Add failure | manual roster row | not opened | — |
| S41 | Full Job Report · Job Package · Signatures | S04 header | generated documents and e-signatures | not opened | — |
| S42 | Job Log · Sequence of Events | S06 → Start Job Log / Offline version | timestamped run log, offline capable | not opened | — |
| S43 | Knowledge doc reader / present mode | S21 → Read / ▶ Present | full lesson and toolbox-talk slideshow | not opened | — |
| S44 | Headcount Roster (m) | Attendance Administrator only | personnel master list | — | — |
| S45 | Resources Allocation (m) | not assigned to any role | equipment-pool drag-and-drop | — | dormant; skip |
| S46 | **Reconciliation (new for SLK)** | Operation → Reconciliation | SLK Ops jobs vs WIREGUARD job-log runs; discrepancy findings | summary per unit, SDM and month, findings table, ours-vs-theirs detail, Link to job, Mark explained, Re-check, WIREGUARD freshness | empty (no findings), filled, stale sync, WIREGUARD unreachable |

## Flows

```
F01 Sign in
    S01 pick country -> email -> password -> Sign In -> S02
    happy path clicks: 4 (plus typing)
    edge: wrong password, forgot password, invited user with no tabs, role sees a different default tab

F02 Create and book a job
    S02 + Create Job -> S04 (record created immediately) -> ticket, SDM, status, services, unit, start/end, account, area, rig, well, conveyance -> Save -> S02 bar appears
    happy path clicks: ~14 field interactions
    edge: no dates (job hidden from the schedule; warning banner), no unit, overlapping bookings on one unit, unit under maintenance, user lacks the SALES badge for a field

F03 Reschedule a job
    S02 drag bar to another unit/day (duration kept) or drag an edge to change start/end
    happy path clicks: 1 drag
    edge: drop on a maintenance block, drop on an inactive unit, drop across a month boundary

F04 Prepare a job (incl. JRA)
    S04 -> S05 Start JRA -> S28 answer 33 -> Send for Approval -> SDM approves -> S05 head counts, well data, cable, PCE -> Save
    edge: PCE bore vs casing OD clearance fails (red warning), conditional sections locked until a service is chosen, JRA not approved blocks Execution on restricted jobs

F05 Execute a job
    S06 Start Job Log (S42) -> arrival, rig-up, rig-down -> runs success/failed -> NPT -> Failure Y/N -> Save
    edge: offline at the wellsite, rig-down before rig-up, NPT > Op Hrs, SDM override of op hours

F06 Report a failure (8 Min. Facts)
    S11 + New -> S12 pick ticket (rig/well/crew prefilled) -> title, RILR -> incident(s): what, when, NPT, what failed, actions, situation, informed -> Save (vN) -> Print/PDF | Word | Email
    side effects: job NPT = sum of its 8MF NPT, job Failure = Yes, job 8MF = Yes, one Failure Roster row per incident
    happy path clicks: ~12
    edge: several 8MFs per ticket, editing after Sent (new version), severity changes as NPT is edited

F07 Close a job
    S04 -> S07 sign-offs -> report status -> Job Package link -> Done -> S03
    edge: failure fields stay locked on clean jobs, report closure date needed when closed

F08 Review performance
    S13 pick period/filters -> click a chart month or gauge -> job list -> open ticket S04
    also S14 / S15 / S16, each with Print / XLSX / PDF export

F09 Fill and approve attendance
    S17 month -> filter group -> click a cell -> pick a code (or Multi-Select range -> apply) -> Save -> Approve
    edge: holiday/weekend shading, on leave while assigned to a job (flag), self-updated rows, approver per category

F10 Move explosives to a well and reconcile
    S18 Mobilize to Well (S39) -> on return, Consumption & Return -> S20 mobilized = consumed + returned per well
    edge: partial returns, junk, item archived, read-only for non-explosive roles

F11 Pre-job note handover
    S04 Create Pre-Job Notes -> S26 five sections -> Save (PJN-nnnn v1) -> Confirm & Send (S27) -> mail app / .eml
    edge: second save = v2, no deletion except by Admin, Cc defaults to the picked contacts

F12 Toolbox talk from lessons learnt
    S21 filter by failure type/category -> ▶ Present these N as a toolbox talk (S43)

F13 Log a cable run / maintenance
    S31 pick wire -> + Add Event -> S30 alert updates when runs since service pass the threshold

F15 Reconcile jobs with WIREGUARD (new for SLK)
    S46 pick period → findings (no runs, unlinked runs, date / unit-drum / wire / location / service / value mismatch, runs pending approval) → open a finding → Link runs to job or Mark explained (note)
    edge: blank ticket (fallback match on drum + wire + dates + well), runs cut-only (excluded), WIREGUARD renamed a unit or field, sync stale

F14 Block a unit
    S02 + Maintenance Event (S37) or + Unit Status Event (S38) -> hatched bar; utilization denominator excludes those days
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Top nav group button | default, active | hover, active | all |
| Sub-tab pill | default, active (lime fill) | hover, active | all |
| Button | primary (lime), secondary (outline dark), ghost, danger (red outline "Delete Job"), icon-only (theme, key) | default, hover, disabled, saving | all |
| Status pill | Planned (blue), Ongoing (yellow), Completed (green), Canceled, ACTIVE, UNLOCKED, DRAFT / SENT / APPROVED, Saved / Sent | static | S02, S03, S08, S11 |
| Severity pill | Negligible, Light, Serious, Major, Catastrophic | static, "· auto" | S10, S11, S12 |
| Role badge on field label | SALES, SDM, SALES / SDM | static | S04–S07 |
| Lock hint | "🔒 only if …", "🔒 select … first", section lock banner | locked / unlocked | S05–S07, S12 |
| Select (native) | with "— select —", with Other | default, disabled (locked) | job editor, attendance cells |
| Multi-select filter dropdown | "All ▾" | open, n selected | S08, S10, S13–S17 |
| Filter bar | 9 standard dims (Year, Month, Account, Area, Service Domain, Service, SDM, Unit #, Conveyance) + Clear | — | S08, S13–S15 |
| Text / number / date / datetime input | plain, with unit in label (ft, psi, °F, pcf) | empty, filled, auto (read-only computed) | job editor |
| Stepper count select | max N per job | — | S05 |
| Stage card | 4 stages, % complete with mini progress bar | active, inactive | S04–S07 |
| Stage progress bars (×4) | — | 0–100% | S03 |
| Job card (board row) | ticket / NO TICKET | hover, removable ✕ | S03 |
| Gantt grid | unit rows × day columns, bars by status, maintenance hatched bar, status tag | drag, resize, today column | S02 |
| KPI tile | number + caption, coloured value | normal, alert colour | S13, S14, S15, S18 |
| Gauge (semicircle) | efficiency, audit compliance with target | — | S13 |
| Horizontal bar list | value at end, clickable | hover, drill | S10, S14 |
| Bar/line combo chart | op hrs vs NPT + efficiency line | month click → drill | S13 |
| Heatmap table | colour bands | — | S15 |
| Data table | sticky header, wide horizontal scroll, row click | loading, empty, filled | S08, S10, S11, S16, S18–S20 |
| Warning banner | amber "⚠ N jobs …" with View list / ▸ Show | collapsed / expanded | S02, S10, S13 |
| Modal dialog | password prompt, help, forms | open | S02b, S22 |
| Repeatable card group | incident card (↑ ↓ collapse ✕) | expanded, collapsed | S12 |
| Save-state indicator | "saving…", "💾 Saved", "✓ All changes saved", "live · time" | — | header, S04, S12 |
| Export buttons | CSV, XLSX, PDF, Print, Word, HTML, .eml | — | most pages |
| Attendance code cell | 15 codes, shaded weekend/holiday, red flag | selected, highlighted row | S17 |
| Chip filter row with counts | type, category | active | S21, S18 |
| Hero card | Lesson of the Week | — | S21 |
| Chat side panel | — | empty, conversation | S23 |
| Floating action button | AI assistant | — | all |
| Theme toggle | dark (default), light | — | all |

## Inferred data model

```
Country (tenant)   id, name, flag
                   evidence: S01 country picker   confidence: medium (other countries not seen)

User               id, email, name, role, country_id, tab_grants[], eid?
                   roles: Crew, Viewer, Field Engineer, Crew Chief, SDM, Deputy SDM, Sales, Director,
                          Operations Manager, Maintenance Manager, SQM, Explosive Manager/Admin,
                          Attendance Administrator, Admin, WL contact
                   evidence: manual §0, §1, §2; S17 role badge   confidence: high (role list), guess (grant shape)

Employee           eid, name, title, account (WL|UNC…), reports_to, group, rotation (60/30)
                   evidence: S17, S15 "60/30 rotation", manual §10 Headcount Roster   confidence: high

Unit               id/code ("18", "MEM-1", "CT-2", "Basic"), active, kind (truck|memory crew|coil tubing),
                   cable specs[] (type, size, length ft)
                   evidence: S02 rows, S04 unit list, S15 "MEM and CT slots are crews"   confidence: high

UnitEvent          id, unit_id, kind (maintenance|loan|transferred|junk|backup_on_location), start, end, note
                   evidence: S02 buttons/tooltips, S15 methodology   confidence: high

Cable              sn, type (Alloy S75|S77|Standard|Hepta), size, length_ft, unit_id, runs_since_service
CableEvent         id, cable_sn, date, kind (run|service|cut…), job_id?, resistance?, length_after?
                   evidence: S05 cable fields, manual §8   confidence: medium

PCE, GreasePanel   id, label, bore/size (PCE)
                   evidence: S05 dropdowns, manual §3.4   confidence: high

Lookup lists       SDM roster, Account (DWO-A, DWO-P, SAWCOD, NAWCOD, UNC…), Area (DWO, UNC, KHRS, SHYB…),
                   Conveyance, Vendors, Well type, Casing OD/grade, Plug type
                   evidence: S04–S06   confidence: high

Service            name, domain (Well Integrity, Production logging, Perforation, Pipe Recovery, Isolation,
                   Correlation, Reservoir Saturation, CIS, Well Integrity Combo), flags (is_perforation,
                   is_pipe_recovery, is_plug)
                   evidence: S04 "Service Domains (auto)", S13 chart 3, S05 conditional sections   confidence: high

Job                id, ticket_no (nullable!), dmr_no, sdm, program_in_place, status (planned|ongoing|completed|canceled),
                   run_details, n_services, unit_id, start_date, end_date, account, area, rig_site, well,
                   conveyance, third_party_required, created_by, created_at,
                   -- preparation
                   head_count {fe, cc, senior_op, op}, account_assignment, well_type, h2s_ppm, co2_pct,
                   bottom_log_ft, top_log_ft, bht_f, bhp_psi, siwhp_psi, fluid_type, fluid_weight_pcf,
                   solids_pct, min_restriction_in, max_incl_deg, target_casing {type, od, weight, grade},
                   wellhead_conn, ref_log_requested, ref_log_date, n_vendors, vendors[3], cable_type,
                   cable_size, cable_sn, cable_length_ft, pce_required, max_tool_od, pce_id_in, pce_no,
                   grease_panel_type, grease_panel_no, special_setup, special_setup_notes,
                   perforation_details{}, pipe_recovery_details{},
                   -- execution
                   perf_footage_ft, runs_ok, runs_failed, runs_total, run_efficiency (computed), plug_type,
                   max_depth_ft, arrival_at, rig_up_at, rig_down_at, op_hours (computed) , op_hours_override,
                   npt_hours, job_efficiency (computed), failure (yes|no|na), op_time_details,
                   -- closure
                   job_log_signed, ticket_signed, eight_min_facts, prelim_report, final_report,
                   job_package_link, report_closure_status, report_closure_date, gears_no,
                   wellsite_audit, opsminer_uploaded, service_order, failure_description, bonus_remarks,
                   stage_pct {design, preparation, execution, closure} (computed)
                   evidence: S03–S08, manual §4   confidence: high

JobService         job_id, position (1–15), service   evidence: S04, S08 "SERVICE(S)"   confidence: high
JobCrew            job_id, person (employee), role (FE|CC|Senior Op|Operator), slot   evidence: S08 FE1–4, CC1–3 columns; S05   confidence: high
JobThirdParty      job_id, slot, vendor, po_no, po_value   evidence: S08 columns   confidence: high
JobLogEvent        job_id, at, text/code, run_no?   evidence: S06 "Sequence of Events", offline version   confidence: guess

JRA                job_id, status (draft|sent|approved), answers {A1…: yes|no|na}, risk_score (computed),
                   approval_level (computed), sent_to, approved_by, approved_at
                   evidence: S05 banner, S08 JRA column, manual §4.5   confidence: medium

PreJobNote         log_no (PJN-nnnn), job_id, status (not sent|sent), version, rig_type, rdd_dept, casing,
                   suite_no, logging_from/to, toolstrings[] {conveyance, config, details}, important_notes,
                   sme {name, mobile, email}, main_contact, extra_contacts[], prepared_by, saved_at, sent_at
PreJobNoteVersion  note_id, version, snapshot json, saved_by, saved_at   (immutable)
                   evidence: manual §3.7–3.13   confidence: medium

EightMinFacts      log_no (EM-nnnn), job_id (ticket), title, rilr_no, status (saved|sent), version,
                   created_by, last_saved_by/at, sent_by/at, severity (computed max), total_npt (computed)
Incident           report_id, order, what_happened, date, time, npt_hours, severity (computed from NPT),
                   failed_items[] {asset, sn}, immediate_actions, current_situation, informed_client, informed_nesr
EightMinFactsVersion report_id, version, snapshot, saved_by, saved_at
                   evidence: S11, S12   confidence: high

FailureRosterEntry id, date, job_id?, well, rilr_refs[], eight_min_facts_id?, incident_id?, category, severity,
                   action_items_status (open|in progress|closed), manual (bool)
                   evidence: S10, S12 "one row per incident, kept in sync"   confidence: high

AttendanceEntry    employee_eid, date, code (P, A, AL, SL, UL, EL, PL, HL, MAL, JBFS, JO, FA, JBOF, TR, JBOFS),
                   updated_by, approved_by/at
AttendanceCategory name, approver_email   evidence: S17, manual §6   confidence: high
Holiday            date, name   evidence: S17 shading   confidence: medium

InventoryItem      id, inventory (explosive|hardware|mcr), category, description, part_no, sap_no, unit (ea|m),
                   par_level (MCR), archived
InventoryMovement  id, item_id, qty, from_location, to_location, job_id?, well?, kind
                   (receive|transfer|mobilize|consume|return|junk|order), by, at, undone_by?
                   locations: Aramco Bunker | Gun Shop | Inside Guns | At Location | On Order (explosive);
                              Warehouse | Gun Shop Store | Loaded Guns | At Location | On Order (hardware)
                   balances = sum of movements per item per location (computed)
                   evidence: S18–S20, manual §7   confidence: medium (ledger vs stored balances is a guess)

KnowledgeDoc       id, type (lesson learnt|best practice|learning from incident), category, title, summary,
                   key_action, failure_types[], date, rilr_ref, file/url, thumbnail, duplicate_of?, lesson_of_week
                   evidence: S21 ("Library last synced" suggests an import from SharePoint)   confidence: medium

Derived (no table): Statistics, NPT analysis, Utilization (crew and fleet), Competency levels
                   evidence: S13–S16 formulas shown on screen   confidence: high
```

Relationships: Country 1-n User / Unit / Job. Unit 1-n Job, 1-n UnitEvent, 1-n Cable. Job 1-n JobService, JobCrew, JobThirdParty, JobLogEvent, InventoryMovement. Job 1-1 JRA, 1-1 PreJobNote (1-n versions). Job 1-n EightMinFacts (1-n Incident, 1-n versions). Incident 1-1 FailureRosterEntry. Employee 1-n AttendanceEntry, n-n Job via JobCrew. InventoryItem 1-n InventoryMovement.

### Business rules seen on screen (rebuild these exactly)

- Job efficiency = (1 − NPT ÷ Op Hrs) × 100. Op Hrs = rig-down − rig-up, with an SDM/Ops Manager override that wins everywhere.
- Fleet efficiency = op ÷ (op + NPT). Run efficiency = successful ÷ total runs. Canceled jobs are excluded everywhere.
- 8MF severity from NPT: none = Negligible, < 4 h Light, 4–24 h Serious, 24–48 h Major, > 48 h Catastrophic. Report severity is the highest incident's. On save, job NPT = Σ of the job's 8MF NPT, Failure = Yes, 8MF = Yes, and the roster gets one row per incident.
- Closure failure fields unlock only when NPT > 0 or Failure = Yes.
- Utilization denominator: all calendar days minus maintenance and Loan/Transferred/Junk days. Active days: arrival (or start) to end, plus mob/demob (−1 / +2 days). No double counting per unit or person. MEM/CT units are crews and are reported separately. Bands: ≥75 green, 50–75 yellow, 25–49 orange, <25 red.
- Crew utilization: every WL field engineer on the roster counts, idle ones as 0%, with 60/30 rotation availability.
- Competency: successful jobs (Completed and Failure ≠ Yes) per person per service. <10 Basic, 10–19 Intermediate, 20–29 Advance, ≥30 Expert. A service with ≤1 person at Advance+ is flagged as a coverage gap.
- Wellsite audit compliance per SDM = audited ÷ total jobs, target 25%.
- Head-count caps: FE ≤6, CC ≤6, Senior Op ≤6, Operators ≤12.
- Conditional fields: Perforation details need a perforation service; Pipe Recovery details need RCT/PTC/E-Cutter; Plug type needs the Plug service; Reference log date needs Requested = Yes; vendors 2–3 follow the vendor count.
- PCE clearance check: PCE bore vs target casing/tubing OD, with a red warning on mismatch.
- Cable alerts: Alloy ≈12 runs, STD ≈45 runs since service.
- Inventory reconciliation: mobilized = consumed + returned, per well.

## Feature matrix

See `features.csv`: 120 rows (100 from the original, 7 Slickline-only, 13 WIREGUARD integration, wire module and platform). Must 52, should 47, could 12, skip 9.

## Out of scope (cannot or should not be cloned)

- **The records themselves**: 473 jobs, personnel, EIDs, attendance, inventory balances, failure history. They belong to NESR. An internal rebuild can migrate them through an approved export, never by scraping the live app.
- **Knowledge Hub content**: 147 incident and lessons documents. Rebuild the library feature; get the content from its source (SharePoint) through the owner.
- **Client-side systems and references**: Aramco RILR numbers, GEARS, OpsMiner and SAP numbers are free-text references in the clone. No integration without the client's official access.
- **Bonus amounts, compensation and revenue** (Bonus, Sales Dashboard, Admin Manual): not visible to SQM. Spec them with the owner.
- **The AI Agent** (data-aware, Admin): behaviour unknown. Rebuild as a new feature on the clone's own data if wanted.
- **QAF12069 JRA question text and scoring weights**: a controlled NESR QHSE document. Load it from the official form rather than copying it from screens.
- **Resources Allocation**: dormant in the original, assigned to no role.

## Recon incidents (so the next steps know)

- Clicking **+ Create Job** writes a blank job straight away. One blank "NO TICKET / Planned" job was created by this recon at about 14:29 Riyadh time on 2026-10-24. The user chose to leave it. The board already holds several other blank NO TICKET jobs, which suggests other users hit the same thing. The clone should create a draft only on first save, or auto-delete empty drafts.
- Filters on Schedule, plus Job Log and the analytics pages, sit behind a shared password ("same password as the Database"). The clone should replace that with role-based permissions.

## Size

Screens 45 (23 seen live, 22 from the manual or not opened). Flows 14. Entities about 25, plus derived analytics.

Hard parts:
1. **Permissions model**: role defaults plus per-user tab grants plus field-level edit rights (SALES / SDM badges) plus restricted-content unlocks, with the country as tenant.
2. **Interlinked, versioned documents and side effects**: 8MF → Job NPT/Failure → Failure Roster; Pre-Job Notes and 8MF version histories; JRA scoring and approval routing.
3. **Document generation and exports everywhere**: branded PDF, Word, .eml with inline image, XLSX/CSV/HTML, printable reports, toolbox-talk presentation mode.
4. **Gantt schedule** with drag-move and resize, plus maintenance and status blocks.
5. **Analytics engine**: utilization, competency and efficiency rules computed consistently across filters, with drill-downs.
6. **Explosives ledger**: an auditable movement history, undo, reconciliation per well, role-restricted edits.
7. Multi-user live sync and autosave, plus the offline wellsite job log.

Size: **XL for the whole app. Rescope it.** Recommended phases:
- **Phase 1 (L, about a quarter):** auth and roles, Operation (Schedule, Jobs, job editor with all four stages, Job Log, 8 Min. Facts, Failure Roster, Database) and Service Quality dashboards.
- **Phase 2 (M):** Attendance, Inventory (Explosive, Hardware, MCR), WL Cables.
- **Phase 3 (M):** Pre-Job Notes with email, JRA, Knowledge Hub, AI assistant, Bonus and Sales (after the Admin Manual is reviewed with the owner).
