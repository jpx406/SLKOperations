# WHE and BHA diagrams pack

The Rig Up (QAF14009) and Slickline String / BHA (QAF14010) diagram builder from **SLK Operations Hub**, packed so it
can be added to a similar app.

**To use it with Claude:** put this folder in the other app's repository (or attach the zip) and ask Claude to
"add the WHE and BHA diagrams from this pack". `SKILL.md` tells Claude what the pack holds and the steps. To install
it as a reusable skill, copy the folder to `~/.claude/skills/whe-bha-diagrams/`.

## What you get

- A parts catalogue (pressure control and tools), seeded with 79 parts from the QAF pick lists.
- An editor per job: catalogue on the left, the QAF sheet in the middle (the printout), row editor, checks and review
  on the right. One rig up per job, one tool string per run.
- A continuous assembly drawing at one scale, using the Elmar catalogue artwork in grey for pressure control parts.
- Checks against the NESR Pressure Standard and SOP-01, connection make-up with one-click crossovers.
- Review (Draft → Sent → Reviewed), revisions starting at Rev 0, one-page A4 PDF in the QAF layout.
- Saved samples and previous jobs' diagrams to start from.

See `examples/` for the sheet and PDFs.

## Stack it was built on

Cloudflare Workers + Hono + D1 (SQLite), React 19 + TanStack Query + react-router + Tailwind v4, lucide icons.
`core/` is plain TypeScript with no dependencies; the server and client parts are thin and easy to port.

## Checking the pack

```bash
npx tsc -p tsconfig.json
```

```bash
npx vitest run --dir tests
```

(Run both from this folder, with `typescript`, `vitest`, `hono`, `react`, `@tanstack/react-query`, `react-router`,
`lucide-react` and `@cloudflare/workers-types` installed.)

Made by Juan Lopez and Mohamed Manna (NESR) with Claude. Source: SLK Operations Hub, release 6z.11.
