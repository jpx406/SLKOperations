import { describe, expect, it } from 'vitest';
import { SCREEN_SIZES, isScreenSize, sizeScale } from '../src/client/display';

describe('screen size (6z.25)', () => {
  it('offers four sizes, smallest first, scaled from the browser’s 16 px', () => {
    expect(SCREEN_SIZES.map((s) => `${s.short} ${s.px}`)).toEqual(['XS 13', 'S 14', 'M 16', 'L 18']);
    expect(sizeScale('xs')).toBe('81.25%');
    expect(sizeScale('s')).toBe('87.5%');
    expect(sizeScale('m')).toBe('100%');
    expect(sizeScale('l')).toBe('112.5%');
  });
  it('only takes a known size from storage', () => {
    expect(isScreenSize('s')).toBe(true);
    expect(isScreenSize('xl')).toBe(false);
    expect(isScreenSize(null)).toBe(false);
  });
});
