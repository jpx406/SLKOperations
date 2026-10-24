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

Open http://localhost:5173 and sign in with one of the **fake** accounts in [`mock-wireguard/users.json`](mock-wireguard/users.json). Locally, a mock WIREGUARD answers the service binding with WIREGUARD's real reference lists (units, job types, locations, fields, rigs) and fake users. A new account starts with the role mapped from its WIREGUARD role. To try the SDM screens, give the test account the `sdm` role:

```bash
npx wrangler d1 execute slkops-db --local --command "UPDATE user_roles SET role='sdm' WHERE username='NESR-90001'"
```

Regenerate the mock lists from WIREGUARD's exports with `node scripts/make-wg-fixtures.mjs`.

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
