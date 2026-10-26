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

export function useDisplay() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [density, setDensity] = useState<DensityChoice>(initialDensity);
  useEffect(() => { applyTheme(theme); }, [theme]);
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
  };
}
