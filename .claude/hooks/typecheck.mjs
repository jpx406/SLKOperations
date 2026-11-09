// PostToolUse: after Claude edits a .ts/.tsx file under src/, tests/ or the config files, run the project
// type check (tsc -b, incremental, ~5 s) and hand any errors back to Claude so it fixes them straight away.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const file = String(input.tool_input?.file_path ?? input.tool_response?.filePath ?? '').replace(/\\/g, '/');
if (!/\/(src|tests|mock-wireguard)\/.*\.tsx?$|\/(vite|vitest)\.config\.ts$/.test(file)) process.exit(0);

const root = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
try {
  execSync('npx tsc -b --pretty false', { cwd: root, stdio: 'pipe', timeout: 90_000 });
} catch (e) {
  // src/shared is in two tsconfig projects, so the same error can print twice.
  const lines = `${e.stdout ?? ''}${e.stderr ?? ''}`.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.includes('error TS'));
  const out = [...new Set(lines)].slice(0, 25).join('\n');
  if (!out) process.exit(0); // timeout or tool failure: don't block on noise
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `Type check (tsc -b) failed after editing ${file.split('/').slice(-2).join('/')}:\n${out}`,
  }));
}
process.exit(0);
