# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Field and office use it equally (confirmed 2026-10-26).

- **Field:** slickline crews, supervisors and operators at the wellsite, on a phone, tablet or laptop with weak or no signal. They fill in a job's stages, answer the JRA (or upload the filled QAF14021 Excel), log the sequence of events, attach photos and signed tickets, and mark attendance.
- **Office:** SDMs and deputies, Operations Managers, Sales, QHSE and Maintenance at a desk. They plan the unit schedule, approve JRAs and bonus, reconcile jobs against WIREGUARD, read the quality dashboards, run attendance and inventories, and report upward. Directors mostly read.
- **Admins:** set roles, countries, tab grants, AI settings and data export / import.

Access is by role, with per-person tab grants and countries (Saudi Arabia and Bahrain today; admins add more). People see only their own countries.

## Product Purpose

SLK Operations is NESR's slickline operations hub. It runs a job from request to closure: the unit schedule, the job's Design, Preparation, Execution and Closure stages, the JRA, Pre-Job Notes, 8 Min. Facts and the Failure Roster. Around the jobs it keeps attendance, inventories (explosive, hardware, MCR), the Knowledge Hub, bonus and sales, and quality statistics.

It replaces the WL Operations Hub for slickline. Success means a job's record is complete, approved and traceable without re-typing data that already exists in WIREGUARD or in NESR's Excel forms.

## Positioning

What SLK Operations does that the WL Operations Hub could not (confirmed 2026-10-26):

- **Tied to WIREGUARD.** Everyone signs in with their WIREGUARD account. Units, drums, wires and runs come from WIREGUARD read-only, and jobs are reconciled against WIREGUARD's runs every night.
- **Built for slickline.** Jobs, toolstrings, wire and drum, pressure control, and NESR's slickline JRA (QAF14021, loaded from QHSE's own Excel form) are first-class, not a wireline tool adapted.
- **Audit and approvals.** Approving a JRA, a bonus distribution or an attendance month signs it digitally (a sealed fingerprint, re-checked whenever it is shown). Versions and the inventory ledger can't be edited, and every change is in the audit trail.
- **Less admin work.** Excel forms are uploaded instead of re-typed, approved JRAs are filed as PDFs automatically, a reconciliation digest arrives each morning, and files live with the job.

## Operating Context

- **Wellsite:** a JRA is often done before rig-up and the job log during operations, on poor connections. The job log queues offline, and JRA answers are kept on the device until they reach the server.
- **Office:** a dense desk-based routine of planning, approvals, reconciliation findings and month-end attendance and bonus.
- **Times:** Saudi Arabia and Bahrain local time (UTC+3), shown as Riyadh time. The working week has Friday and Saturday as the weekend.
- **NESR documents it works with:** QAF14021 JRA (Excel, controlled by QHSE), field tickets, job logs, the Job Package, Aramco references (RILR, GEARS kept as free-text references).
- **Email:** Pre-Job Notes, approval notices, bonus statements and the morning digest go out from slkops@nesrapp.com.

## Capabilities and Constraints

- **Stack:** Cloudflare Worker (Hono API) with a React single-page app; D1 database, KV for sessions, R2 for files, Email Service, crons. Served at slkops.nesrapp.com.
- **Never writes to WIREGUARD.** WIREGUARD stays the source of record for wires, drums, units and runs.
- **Deny by default:** every read and write is checked against the role's tabs and the person's countries.
- **Nothing is hard-deleted:** records are switched off, withdrawn or hidden, and history is kept.
- **The JRA form is data, not code:** a new QAF14021 revision is loaded by uploading it.
- **Terminology:** job stages are Design, Preparation, Execution, Closure. Also: SDM, NPT, 8 Min. Facts, Failure Roster, PCE, MOC / Exemption, unit block, Pre-Job Note, toolstring.
- **AI:** an AI Agent answers only from data the asker can already see, and a help assistant answers only from the in-app guide. Both have budgets and are off until an admin enables them.
- **Open:** on-screen drawn signatures were declined (2026-10-25); approval is the signature. PowerPoint output from the AI Agent is not built.

## Brand Commitments

- **It is an NESR internal tool** (confirmed 2026-10-26). It must read as an NESR system, using NESR's name, logo and colours where provided.
- **Product name:** "SLK Operations".
- **NESR brand assets** (logo files, colour values, typeface rules) are not in the repository yet and must be supplied by NESR; don't invent them.
- **The original WL Operations Hub:** none of its code, copy or assets are reused.

## Evidence on Hand

- **No real operational data is in the repository.** Development data is fake and pseudonymised (`scripts/dev-seed.sql`, `scripts/make-dev-jobs.mjs`, `mock-wireguard/`).
- **NESR's manuals and the QAF14021 Excel form** are kept out of the repository (`replica/sources` is git-ignored; the form is uploaded in the app).
- **Knowledge Hub content** (about 147 QHSE documents) is owned by QHSE and is loaded or linked by them, not shipped.
- **Not available:** no customer quotes, metrics or benchmarks. Don't fabricate any.

## Product Principles

1. **One record per job, complete and traceable.** Everything about a job (stages, JRA, events, files, approvals) lives with that job, and each change says who and when.
2. **Don't make people re-type what exists.** Read it from WIREGUARD, upload the Excel, or generate the PDF.
3. **Approvals are signatures.** What was approved is fixed, provable, and visibly invalid if it changes.
4. **Work where the job is.** The field gets the same reliability as the office, including on weak signal.
5. **People see only what their role and countries allow,** whether through a screen, an export or the AI.

## Accessibility & Inclusion

- Field use on phones and tablets, often outdoors in sunlight: readable contrast, large touch targets, and dark and light themes (dark by default, with a switch).
- The interface is in English.
- No further formal standard has been set.
