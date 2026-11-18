// How the app is shown on this device: the theme (dark Control Room or light Sunlight) and the control size (desk or
// touch). Defaults come from the device: touch screens get Sunlight and large controls, desks get dark and compact.
// A choice someone makes is kept on that device. index.html applies the same rules before the first paint.

import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
export type DensityChoice = 'auto' | 'touch' | 'desk';

const touchDevice = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode: applies for this visit only */ } };

export function initialTheme(): Theme {
  const t = read('slk-theme');
  return t === 'light' || t === 'dark' ? t : touchDevice() ? 'light' : 'dark';
}

export function applyTheme(t: Theme) {
  if (t === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
}

export function initialDensity(): DensityChoice {
  const d = read('slk-density');
  return d === 'touch' || d === 'desk' ? d : 'auto';
}

export function applyDensity(choice: DensityChoice) {
  const touch = choice === 'touch' || (choice === 'auto' && touchDevice());
  if (touch) document.documentElement.dataset.density = 'touch';
  else delete document.documentElement.dataset.density;
}

// Screen size (6z.25): scales the whole app (text, spacing, controls, all in rem) from the root font size, like
// zoom but kept per device. Computers default to S (14 px), touch screens to M (16 px, the size before 6z.25).
export type ScreenSize = 'xs' | 's' | 'm' | 'l';
export const SCREEN_SIZES: { value: ScreenSize; short: string; label: string; px: number }[] = [
  { value: 'xs', short: 'XS', label: 'Extra small', px: 13 },
  { value: 's', short: 'S', label: 'Small', px: 14 },
  { value: 'm', short: 'M', label: 'Medium', px: 16 },
  { value: 'l', short: 'L', label: 'Large', px: 18 },
];
export const isScreenSize = (v: unknown): v is ScreenSize => SCREEN_SIZES.some((s) => s.value === v);
/** The root font size for a size: 13 px is 81.25% of the browser's 16 px. */
export const sizeScale = (s: ScreenSize) => `${(SCREEN_SIZES.find((x) => x.value === s)!.px / 16) * 100}%`;

export function initialSize(): ScreenSize {
  const s = read('slk-size');
  return isScreenSize(s) ? s : touchDevice() ? 'm' : 's';
}

export function applySize(s: ScreenSize) {
  document.documentElement.style.fontSize = sizeScale(s);
}

export function useDisplay() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [density, setDensity] = useState<DensityChoice>(initialDensity);
  const [size, setSize] = useState<ScreenSize>(initialSize);
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { applySize(size); }, [size]);
  useEffect(() => {
    applyDensity(density);
    // "auto" follows the device, e.g. a laptop with a touch screen switching pointer
    if (density !== 'auto' || typeof matchMedia !== 'function') return;
    const mq = matchMedia('(pointer: coarse)');
    const on = () => applyDensity('auto');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [density]);
  return {
    theme,
    toggleTheme: () => setTheme((t) => { const n: Theme = t === 'light' ? 'dark' : 'light'; write('slk-theme', n); return n; }),
    density,
    setDensity: (d: DensityChoice) => { write('slk-density', d === 'auto' ? null : d); setDensity(d); },
    size,
    setSize: (s: ScreenSize) => { write('slk-size', s); setSize(s); },
  };
}
