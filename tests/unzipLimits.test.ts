import { afterEach, describe, expect, it } from 'vitest';
import { zip } from '../src/shared/xlsx';
import { UNZIP_LIMITS, unzip } from '../src/shared/xlsxRead';

// An uploaded Office file is a zip: one that expands past the limit is refused instead of filling the Worker's memory.

const saved = { ...UNZIP_LIMITS };
afterEach(() => Object.assign(UNZIP_LIMITS, saved));

const file = (name: string, n: number) => ({ name, data: new TextEncoder().encode('<a>' + 'x'.repeat(n) + '</a>') });

describe('unzip limits', () => {
  it('opens a file within the limits', async () => {
    const files = await unzip(zip([file('a.xml', 100), file('b.xml', 100)]));
    expect([...files.keys()]).toEqual(['a.xml', 'b.xml']);
  });

  it('refuses a file that expands past the size limit', async () => {
    UNZIP_LIMITS.totalBytes = 1000;
    await expect(unzip(zip([file('a.xml', 600), file('b.xml', 600)]))).rejects.toThrow(/expands to more/);
  });

  it('refuses a file with too many parts', async () => {
    UNZIP_LIMITS.entries = 2;
    await expect(unzip(zip([file('a.xml', 1), file('b.xml', 1), file('c.xml', 1)]))).rejects.toThrow(/expands to more/);
  });
});
