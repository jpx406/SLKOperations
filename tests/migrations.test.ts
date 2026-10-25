import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// D1 traps recorded in WIREGUARD's handover note: a semicolon inside a SQL comment splits the statement,
// window functions and long UNION ALL chains are refused. Checked here so they never reach a deploy.
const files = ['replica/migrations/0001_init.sql', 'replica/migrations/0002_seed.sql', 'replica/migrations/0003_attendance_codes.sql', 'replica/migrations/0004_wg_raw_rows.sql', 'replica/migrations/0005_signatures.sql'];

describe('migrations stay inside D1 limits', () => {
  for (const f of files) {
    const sql = readFileSync(f, 'utf8');
    it(`${f}: no semicolon inside a comment`, () => {
      const bad = sql.split('\n').map((l, i) => [i + 1, l] as const).filter(([, l]) => /--[^\n]*;/.test(l)).map(([n]) => n);
      expect(bad).toEqual([]);
    });
    it(`${f}: no window functions`, () => {
      expect(/\bOVER\s*\(/i.test(sql)).toBe(false);
    });
    it(`${f}: at most one UNION ALL per statement`, () => {
      for (const stmt of sql.split(';')) expect((stmt.match(/UNION ALL/gi) ?? []).length).toBeLessThanOrEqual(1);
    });
  }
});
