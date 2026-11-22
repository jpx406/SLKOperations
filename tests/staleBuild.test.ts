import { describe, expect, it } from 'vitest';
import { isStaleChunk } from '../src/client/staleBuild';

// 6z.48: a page left open across a deploy reloads into the new version when a code file is gone

describe('stale version', () => {
  it('knows a missing code file in each browser’s words', () => {
    expect(isStaleChunk(new TypeError('Failed to fetch dynamically imported module: https://slkops.nesrapp.com/assets/WinchData-sGix1yS9.js'))).toBe(true);
    expect(isStaleChunk(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunk(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isStaleChunk('Unable to preload CSS for /assets/x.css')).toBe(true);
  });
  it('leaves other errors alone', () => {
    expect(isStaleChunk(new Error('Job not found'))).toBe(false);
    expect(isStaleChunk(null)).toBe(false);
  });
});
