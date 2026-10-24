# SLK Operations

Slickline operations hub for NESR: unit schedule, jobs from design to closure, and (coming) reconciliation with WIREGUARD, quality dashboards, attendance and inventory. Runs on Cloudflare (one Worker + D1 + KV). Signs people in with their WIREGUARD accounts and reads WIREGUARD's data through a read-only service binding. WIREGUARD is never written to.

Planning documents live in [`replica/`](replica/): recon, architecture, WIREGUARD integration, design system, migrations, build log.

## Run it locally

Needs Node 18+ (tested on Node 24).

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

Open http://localhost:5173 and sign in with one of the **fake** accounts in [`mock-wireguard/users.json`](mock-wireguard/users.json).

**The mock WIREGUARD** answers the service binding locally. It serves:
- WIREGUARD's real reference lists: units, job types, locations, fields, rigs;
- its wires, drums, job-log runs and tests, with every person replaced by a placeholder;
- fake users only.

**Roles:** a new account starts with the role mapped from its WIREGUARD role. Sign in as the test admin (NESR-90003) and use **Administration → Users & Roles** to change roles, add extra tabs, or pre-register someone before their first sign-in. The **WIREGUARD sync** tab shows what was pulled and can sync on demand.

Regenerate the mock data from WIREGUARD's exports with `node scripts/make-wg-fixtures.mjs`.

## Checks

```bash
npm test
```

```bash
npm run typecheck
```

```bash
python replica/migrations/test_schema.py
```

```bash
python replica/design/build_tokens.py
```

## Deploy (not done yet)

The open items before the first deploy are in `replica/integration-wireguard.md`:
- the WIREGUARD service account;
- Workers Paid;
- the D1 and KV ids in `wrangler.jsonc`;
- the `WG_SYNC_*` secrets;
- the custom domain `slkops.nesrapp.com`.
