# SLK Operations Hub

Slickline operations hub for NESR, live at **slkops.nesrapp.com**. One Cloudflare Worker (Hono) with D1, KV and R2, and a React 19 front end. People sign in with their WIREGUARD accounts (password, Face ID / fingerprint, or a QR code from their phone), and WIREGUARD's data is read through a read-only service binding. **WIREGUARD is never written to.**

What it covers:
- **Operation:** unit schedule, jobs from design to closure (JRA, job log, winch report, diagrams, report and job package), Job List, Job Risk Profile, Pre-Job Notes, Opportunities.
- **Service quality:** statistics, NPT analysis, Q-Incidents and the Incidents Dashboard.
- **Utilities:** Rig Up and Tool String diagrams, the Winch Report, and Lessons & Best Practices (PDF and PowerPoint on each company's template).
- **Equipment:** utilization, wire KPIs, hardware, explosive and MCR inventories, assets, wires and reconciliation with WIREGUARD.
- **Knowledge Hub, Competency and Career Development, Bonus, the SLK Activity Dashboard (sales), Attendance.**
- **Administration:** users and roles, audit trail, form templates, companies, the AI Agent and data export/import.

Background and plans are in [`PRODUCT.md`](PRODUCT.md), [`DESIGN.md`](DESIGN.md) and [`replica/`](replica/) (architecture, WIREGUARD integration, design system, migrations, and the build log with every release).

## Run it locally

Needs Node 20+ (tested on Node 24).

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

Open http://localhost:5173 and sign in with one of the **fake** accounts in [`mock-wireguard/users.json`](mock-wireguard/users.json). The test admin is NESR-90003.

**Sample jobs:** `scripts/dev-seed.sql` and `scripts/dev-jobs.sql` load example jobs into the local database (`npx wrangler d1 execute slkops-db --local --file scripts/dev-seed.sql`, then the same for `dev-jobs.sql`). `scripts/make-dev-jobs.mjs` regenerates `dev-jobs.sql`.

**The mock WIREGUARD** answers the service binding locally. It serves:
- WIREGUARD's real reference lists: units, job types, locations, fields, rigs;
- its wires, drums, job-log runs and tests, with every person replaced by a placeholder;
- fake users only.

Regenerate the mock data from WIREGUARD's exports with `node scripts/make-wg-fixtures.mjs`.

**Roles:** a new account starts with the role mapped from its WIREGUARD role. As the test admin, use **Administration → Users & Roles** to change roles, add extra tabs, or pre-register someone before their first sign-in. The WIREGUARD sync tab shows what was pulled and can sync on demand.

## Checks

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:worker
```

```bash
npm run build
```

`npm test` runs the plain Node tests (shared logic, permissions, migrations' D1 limits). `npm run test:worker` runs the Worker routes against a local throw-away database. Design tokens are rebuilt with `npm run tokens` (needs Python).

## Deploy

Production needs the owner's go-ahead every time (see `CLAUDE.md`):

```bash
npm run db:migrate:remote
```

```bash
npm run deploy
```

Secrets are set with `wrangler secret put`: `WG_SYNC_USERNAME`, `WG_SYNC_PASSWORD`, `SIGNING_KEY` (seals approval signatures) and, for the AI features, `ANTHROPIC_API_KEY`. `.dev.vars.example` lists them for local use.
