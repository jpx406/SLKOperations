// Account colours (owner request 2026-10-28). Each account (the job's location: D&WO, SAWCOD ...) gets a light colour
// the first time a job is created for it, so the schedule, the job board and the job log read by account at a glance.
// The colour is a light hue: screens mix it into the surface (light and dark themes alike) and use it whole for the
// stripe and the legend swatch.

export const ACCOUNT_PALETTE = [
  '#7cc4fa', '#f9a8d4', '#86efac', '#fcd34d', '#c4b5fd', '#fdba74',
  '#5eead4', '#fca5a5', '#a5b4fc', '#bef264', '#f0abfc', '#93c5fd',
] as const;

export const NO_ACCOUNT = 'No account';

export const isColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c);

/** The next colour for a new account: the first one not taken yet, then round again. */
export function nextColor(taken: string[]): string {
  const free = ACCOUNT_PALETTE.find((c) => !taken.includes(c));
  return free ?? ACCOUNT_PALETTE[taken.length % ACCOUNT_PALETTE.length];
}

/** A row or bar background: the account's colour mixed into the surface, readable in both themes. */
export const tint = (color: string | undefined, pct = 22) => (color ? `color-mix(in oklab, ${color} ${pct}%, var(--color-surface))` : undefined);

/** Groups items by account in name order, with jobs that have no account last. */
export function byAccount<T>(items: T[], accountOf: (t: T) => string | null | undefined): { account: string; items: T[] }[] {
  const m = new Map<string, T[]>();
  for (const t of items) {
    const a = accountOf(t)?.trim() || NO_ACCOUNT;
    m.set(a, [...(m.get(a) ?? []), t]);
  }
  return [...m.entries()].sort(([a], [b]) => (a === NO_ACCOUNT ? 1 : b === NO_ACCOUNT ? -1 : a.localeCompare(b))).map(([account, list]) => ({ account, items: list }));
}
