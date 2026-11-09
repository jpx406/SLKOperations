// PreToolUse guard for SLK Operations Hub.
// - Read / Edit / Write / Grep on .dev.vars* or .env* (secrets) is denied; *.example files are fine.
// - Bash that touches production (wrangler deploy, npm run deploy, D1 --remote, db:migrate:remote) asks first.
// - Bash that prints or copies the secret files is denied.
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const tool = input.tool_name;
const ti = input.tool_input ?? {};

const decide = (permissionDecision, permissionDecisionReason) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason } }));
  process.exit(0);
};

// .dev.vars, .dev.vars.production, .env, .env.local … but not .dev.vars.example / .env.example
const SECRET = /(^|[\\/\s"'=])\.(dev\.vars|env)(\.(?!example\b)[\w.-]+)?(?=$|[\s"';|&)<>])/;

if (tool === 'Bash') {
  const cmd = String(ti.command ?? '');
  if (SECRET.test(cmd)) decide('deny', 'Secrets: .dev.vars / .env files stay out of the session. Use .dev.vars.example for the variable names.');
  if (/\bwrangler(\.cmd)?\s+(deploy|publish|versions\s+deploy|secret\s+(put|delete|bulk))\b/.test(cmd)
    || /\bnpm\s+run\s+(deploy|db:migrate:remote)\b/.test(cmd)
    || /\bwrangler(\.cmd)?\s+(d1|kv|r2)\b[^\n|;&]*--remote\b/.test(cmd)) {
    decide('ask', 'This touches production (slkops.nesrapp.com, D1 slkops-db, KV or R2). Confirm before it runs.');
  }
  process.exit(0);
}

if (['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
  const p = String(ti.file_path ?? ti.notebook_path ?? '');
  const base = p.split(/[\\/]/).pop() ?? '';
  if (/^\.(dev\.vars|env)(\..+)?$/.test(base) && !/\.example$/.test(base)) decide('deny', `Secrets: ${base} stays out of the session. Use .dev.vars.example for the variable names.`);
  process.exit(0);
}

if (tool === 'Grep') {
  // Searching inside a secret file (by path or glob) would print its values. Listing names (Glob) is fine.
  const target = `${ti.path ?? ''} ${ti.glob ?? ''}`;
  if (/\.(dev\.vars|env)(?!\.example)(\b|\*|$)/.test(target)) decide('deny', 'Secrets: .dev.vars / .env files stay out of the session.');
}
process.exit(0);
