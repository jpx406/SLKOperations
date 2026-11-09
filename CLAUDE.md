# SLK Operations Hub

NESR Slickline operations app: schedule, jobs from design to closure, diagrams, attendance, inventory, stats. One
Cloudflare Worker (Hono) + D1 + KV + R2, React 19 front end. Live at `slkops.nesrapp.com`. Background and plans are in
`README.md`, `PRODUCT.md`, `DESIGN.md` and `replica/` (architecture, WIREGUARD integration, build log).

## Commands

- `npm run dev`: Vite + Worker on http://localhost:5173 (the preview pane's `dev` config). Sign in with a fake account
  from `mock-wireguard/users.json`. The test admin is NESR-90003.
- `npm run typecheck`: `tsc -b`. A hook also runs it after every edit under `src/`, `tests/` and `mock-wireguard/`.
- `npm test`: Vitest, `tests/**/*.test.ts` only (plain Node).
- `npm run db:migrate:local`: applies `replica/migrations` to the local D1.
- `npm run build`: type check + Vite build.

## Layout

- `src/client`: React pages (`pages/`), UI kit (`components/`), API helper (`api.ts`).
- `src/worker`: Hono routes, one file per area. `index.ts` mounts them, `env.ts` has the bindings.
- `src/shared`: rules and logic used by both sides (diagrams, PDFs, toolstring, approvals, stages). Keep it free of
  browser- and Worker-only APIs. Large server-only data (for example `diagramPictures.ts`) must not be imported by the client.
- `replica/migrations/NNNN_name.sql`: D1 migrations, numbered and never edited after they ship. Add each new file to
  the list in `tests/migrations.test.ts`, which checks D1's limits: no `;` inside a `--` comment, no window
  functions, at most one `UNION ALL` per statement.
- `design/`: screenshots and packs for reference only. They are not built or tested.

## Rules

- **WIREGUARD is read-only.** It is reached through a service binding (`mock-wireguard/` stands in locally). Never
  write to it.
- **Production needs the user's go-ahead every time:** `npm run deploy`, `wrangler deploy`, `db:migrate:remote`,
  any `wrangler d1|kv|r2 … --remote`, and `wrangler secret`. A hook asks before these run.
- **Secrets:** `.dev.vars` and `.env*` stay out of the session (a hook blocks them). `.dev.vars.example` lists the names.
- `replica/sources/` is reference material from the original app, kept local (gitignored). Never copy its code,
  assets or copy text into the app.
- Text the user reads (UI, PDFs, emails, help) is plain, short English. The design tokens come from
  `replica/design` (`npm run tokens`).

## Workflow

- Work happens on `build/vertical-slice`. Each milestone has a release tag such as `6z.11`.
- Commits look like `feat: <what changed, in plain words> (6z.11)`; also `fix:` and `docs:`.
- After a milestone, add a section to `replica/build-log.md`: what changed, the owner's decisions, and a
  **Verified:** line with the test count and what was checked in the browser.
- Before calling UI work done: `npm run typecheck`, `npm test`, then check it in the preview at desktop and 390 px
  phone width, with no console errors and no sideways scroll.
