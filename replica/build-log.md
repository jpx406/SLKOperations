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

### Open observation

- On the dev server's first boot, `PUT /api/jobs/:id/services` was refused as having no write rule (403), twice. After the Worker reloaded it passed every time (4 of 4), and the unit test for that rule passes. It wasn't reproduced. A log line now records any refused write with its method and path. Watch for it in `/replica-test`.

### Screenshots

`replica/clone-screens/`: S01, S01-error, S02, S02-390, S03, S03-390, S04, S04-new, S04-viewer, S06.

### Clean-room note

Every label, message and empty state was written here. No code, assets or copy from the WL Operations Hub were used. WIREGUARD contributes its API contract and its reference lists only, not its code.
