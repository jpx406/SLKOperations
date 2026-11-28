import { existsSync } from 'node:fs';

/**
 * Some tests read files that are never committed (NESR templates, QHSE forms, WIREGUARD's source). On a machine
 * without them those tests are skipped; this says so in the test output instead of skipping quietly.
 */
export function localFile(path: string, what: string): boolean {
  const ok = existsSync(path);
  if (!ok) console.warn(`[skipped] ${what}: needs ${path} (not in the repo, kept on the owner's machine)`);
  return ok;
}
