---
name: whe-bha-diagrams
description: Adds the Rig Up (WHE / pressure control, QAF14009) and Slickline String / BHA (QAF14010) diagram builder from SLK Operations Hub to another web app — parts catalogue, drag-and-drop editor with a continuous assembly drawing, standards checks, review, revisioned one-page PDF and reusable samples. Use when the user wants to add rig up, WHE, PCE, BHA or tool string diagrams to an app, or shares this pack.
---

# WHE and BHA diagrams pack

This pack is the **Diagrams section** of SLK Operations Hub (NESR Slickline), taken out so it can be added to a similar
app. It builds, checks and prints two forms per job:

- **Rig Up Diagram — QAF14009** (wellhead / pressure control equipment, "WHE"): one per job.
- **Slickline String Diagram — QAF14010** (tool string / BHA): one per run.

Look at `examples/` first to see what the result looks like.

## What is in the pack

| Path | What it is | Depends on |
|---|---|---|
| `core/diagram.ts` | Part types, rows, cleaning, totals, connection joints, checks, revision rule, drawings, stack layout | `core/partPictures.ts`, `core/toolstring.ts` only |
| `core/diagramPdf.ts` | One-page A4 PDF in the QAF layout | `core/pdf.ts` (dependency-free PDF writer), `core/brandLogo.ts`, `core/diagramPictures.ts`, `core/stamp.ts` |
| `core/partPictures.ts` | Size and string axis of each picture (small; safe for the browser bundle) | — |
| `core/diagramPictures.ts` | The same pictures as JPEG data for the PDF (≈140 KB; **server only**) | — |
| `server/diagrams.ts` | `createDiagramsRouter(host)` — Hono routes for the editor, samples, review and PDF | `hono`, Cloudflare D1 types, `core/` |
| `client/Diagrams.tsx` | React page (`Diagrams`) and the job summary card (`DiagramsCard`) | React 19, `@tanstack/react-query`, `react-router`, `lucide-react`, Tailwind v4, `client/shim/*` |
| `client/shim/` | Stand-ins for the SLK UI kit and API helper the page imports | — |
| `client/theme/` | SLK design tokens (Tailwind v4 `@theme`) and the `label-caps` utility | Tailwind v4 |
| `assets/diagram-parts/*.png` | Transparent grey part pictures for the screen | — |
| `migrations/0001_diagrams.sql` | Tables `parts` (79 seeded parts), `job_diagrams`, `diagram_samples` | a `jobs` table with `id` |
| `tests/diagram.test.ts` | Vitest: cleaning, joints, totals, every check, revision rule, layout, PDF, pictures, seed | vitest |
| `tools/` | The scripts that cropped and wrote the pictures (only needed to regenerate them) | playwright, pdfjs-dist |

`core/` has no framework dependencies and can be used as is. `server/` and `client/` are reference implementations:
keep them if the host app uses the same stack (Hono + D1, React + TanStack Query + Tailwind v4), otherwise port them —
they are thin layers over `core/`.

## Steps to add it to an app

Work through these in order. Ask the user only where a step says so.

1. **Read the host app first.** Find: how jobs are stored and fetched, how the signed-in user and permissions work,
   where files/attachments are stored, whether there is an audit log, the API helper and UI components, the router.
2. **Copy files.** `core/` to the shared code, `server/diagrams.ts` to the API, `client/Diagrams.tsx` to the pages,
   `assets/diagram-parts/` to the public/static folder so they are served at `/diagram-parts/<key>.png`.
   Keep `core/diagramPictures.ts` out of the browser bundle (only `diagramPdf.ts` imports it).
3. **Database.** Apply `migrations/0001_diagrams.sql` with the app's migration tool. It is SQLite/D1 SQL. On another
   database, translate `json_valid`/`json_each` and the `strftime` defaults. The samples query uses `jobs.well`,
   `jobs.ticket_no`, `jobs.start_date` and `jobs.country`; rename them in `server/diagrams.ts` if the job table differs.
4. **Mount the API** with a host adapter (see below): `app.route('/api/diagrams', createDiagramsRouter(host))`.
   Protect it with the app's own session middleware. The catalogue write routes (add / edit / remove a part) are not in
   the router: add them to the app's admin area, validating with `cleanPart()` from `core/diagram.ts`.
5. **Mount the page.** Route `/…/jobs/:id/diagrams` to `Diagrams`, and show `DiagramsCard` on the job's preparation
   view. Fix the three `Link` paths in `Diagrams.tsx` (`/operation/jobs/...`) to the host's job URLs. Replace
   `client/shim/*` imports with the host's own components where they exist; set `API_BASE` in `client/shim/api.ts`.
6. **Theme.** Either import `client/theme/diagrams.css` after Tailwind, or map the token names the page uses
   (`bg-surface`, `text-text-muted`, `border-border-strong`, `accent`, `danger`/`warning`/`success` and their
   `-subtle` forms, `--layout-control-sm`, `rounded-pill`, `shadow-pop`, `font-display`, `font-mono`, `label-caps`)
   onto the host's design system. The QAF sheet itself is always white paper with fixed colours.
7. **PDF branding.** `core/brandLogo.ts` is the NESR mark used in the PDF title block. Replace it with the host's logo
   (a baseline RGB JPEG as `{ width, height, base64 }`) if it is not a NESR app. Set the time zone in `core/stamp.ts`
   and the client name via `host.client`.
8. **Run the tests** (`tests/diagram.test.ts`, run from the folder that holds `migrations/` and `assets/`) and the
   host's type check. Then open a job, start a rig up from the template, add a part from the catalogue, make a PDF.

### The host adapter

```ts
import { createDiagramsRouter, type DiagramsHost } from './diagrams';

const host: DiagramsHost = {
  db: (c) => c.env.DB,
  user: (c) => c.get('user'),                       // { username, role, countries }
  getJob: async (c, user, id) => {                  // null if the user may not see it
    const j = await loadJob(c.env, user, id);
    return j && {
      id: j.id, country: j.country, ticket_no: j.ticket_no, drss_no: j.drss_no, well: j.well, field: j.field, rig: j.rig,
      unit_number: j.unit_number, start_date: j.start_date, sdm_username: j.sdm_username,
      siwhp_psi: j.siwhp_psi, h2s_ppm: j.h2s_ppm, min_restriction_in: j.min_restriction_in, target_depth_ft: j.target_depth_ft,
      wire_in: await wireDiameter(c.env, j.wire_serial_number), toolstring: j.toolstring ?? [],
    };
  },
  rights: async (c, user, job) => ({
    canEdit: canEditPreparation(user, job),
    canReview: user.username === job.sdm_username || user.role === 'sdm',   // SLK: the job's SDM reviews
  }),
  displayNames: (c, usernames) => lookupFullNames(c.env, usernames),        // optional
  storePdf: (c, user, job, f) => saveJobAttachment(c.env, user, job, f),      // optional: files the PDF with the job
  audit: (c, user, action, jobId, summary) => writeAudit(c.env, user, action, jobId, summary), // optional
  onSaved: async (c, user, job, kind, run, rows) => {                         // optional: keep job fields in step
    if (kind === 'rigup') await setJobField(c.env, job.id, 'lubricator_length_ft', rigTotals(rows).lubricator_ft || null);
  },
};
```

If the host has no wire diameter, H₂S, SIWHP or minimum restriction on its jobs, pass `null`: those checks then say
"not checked" instead of failing.

## How it behaves (keep these unless the user asks otherwise)

These were decided with the NESR owner; change them only on the user's say-so.

- **One rig up per job, one tool string per run** (runs 1–20, removable only while never filed as PDF, last run first).
- **Catalogue is the app's own** (table `parts`), seeded from the QAF14009/14010 pick lists. A diagram row is a *copy*
  of a part, so catalogue edits never change a filed diagram. Every row's description, sizes (OD, ID, F/N), rating,
  service, connections, length, weight and jar stroke can be edited per job.
- **Adding a part** drops it into its place in the stack by part type (stuffing box on top … tree at the bottom; rope
  socket … service tool), or where it is dragged.
- **Connections:** a red pill between two rows when the bottom connection of one doesn't make up to the top of the
  next, with **Add crossover**.
- **Checks** (warnings, never blocking; cited on screen): rig rated ≥ 1.2 × SIWHP and the test pressure (Pressure
  Standard §9.1, §9.2.1, §9.2.3); H₂S service on a sour well (§6.2.2, NACE MR0175); connections (§7.5); smallest bore ≥
  widest tool + 0.25 in (§9.2.4); lubricator ≥ longest string with jars open + 3 ft (§9.2.5); widest tool < minimum
  restriction (SOP-01 §7.16.2); weight above the jar ≥ wire area × SIWHP + 40 lb (SOP-01 §7.6, §7.16.6); stuffing box,
  wireline valve and tool catcher present. **The §9.2.8 barrier table is deliberately not applied.**
- **Review:** Draft → Sent for review → Reviewed. Reviewing files a PDF. Any change sends it back to draft.
- **Revision:** every diagram starts at **Rev 0**; the first change after a PDF of the current revision raises it by
  one (`afterChange` in `core/diagram.ts`).
- **Samples:** "Start from" saves the rows as a named sample (per country) and offers saved samples, the same diagram on
  previous jobs (same well first), the job's other runs and built-in templates.
- **Drawing:** the Assembly column is **one continuous drawing** down all the rows, every part at one scale, lined up
  on the string axis, shrunk to fit, with numbered tags to the rows. Pressure-control parts use the **Elmar catalogue
  artwork in grey** (`assets/`, see NOTICE.md); the client X-mas tree uses the QAF14009 workbook picture; crossovers and
  all tools are vector drawings (steel, no colour). Only lubricators stretch along their length (4–10 ft).
- **Autosave** with a conflict check (`updated_at`), Undo, ft/m toggle, keyboard: arrows move between rows, Alt+arrow
  moves a part, Delete removes it.

## Known gaps to tell the user about

- Most seeded parts have no length, weight or OD (the source lists don't give them); the totals and weight/bore checks
  need them. The catalogue is meant to be completed from the manufacturers' catalogues.
- The Elmar artwork is © NOV 2014 — see `NOTICE.md` before using it outside NESR.
