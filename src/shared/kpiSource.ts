// KPI parity watch. The wire KPIs are a port of WIREGUARD's own dashboard code (v2-patch.js). tests/wireKpiParity.test.ts
// runs that code next to the port and compares; the build it passed against is recorded below with a fingerprint of
// the parts of the file the KPIs depend on. Each sync, SLK Ops reads the live file through the service binding: if a
// new WIREGUARD build leaves those parts unchanged, the port still matches and the build is marked as checked. If they
// changed, the parity test has to be run again against the new file (and the port updated if it fails).

/** The build the parity test last passed against, and the fingerprint of its KPI code. */
export const KPI_VERIFIED = { build: '2026-11-17T01-00', sourceHash: '11efcdf133a5006b78250a47700748bd25d2e5624f4a185ab54c23d664b67a9a' } as const;

/** How many WIREGUARD KPIs SLK Ops works out itself (replica/integration-wireguard.md). */
export const PORTED_KPIS = 17;

/** The slices of v2-patch.js the ported KPIs depend on, found by their own markers rather than line numbers. */
export const KPI_SLICES: [start: string, end: string][] = [
  ['const v2Num = (v) =>', '\n'],
  ['function v2KpiOverrides()', 'function v2CardOpt('],
  ['const v2DateParts = (d) => {', 'const V2_MONTH_NAMES'],
  ['function v2Percentile(values, p) {', '// ── derived facts'],
  ['let v2DerivCache = ', '// ── chart forms'],
  ['const v2St = (r) =>', '\n'],
  ['const V2_P = (key, label', 'const v2Bars = '],
  ['const V2_KPIS = [', '// ── the section view'],
  ['function v2IsCutOnly(j)', '\n'],
];

/** The KPI code out of a v2-patch.js file, or the first marker that is missing. */
export function kpiSource(file: string): { code: string } | { missing: string } {
  const src = file.replace(/\r\n?/g, '\n');
  const parts: string[] = [];
  for (const [start, end] of KPI_SLICES) {
    const a = src.indexOf(start);
    const b = a < 0 ? -1 : src.indexOf(end, a);
    if (a < 0 || b < 0) return { missing: start };
    parts.push(src.slice(a, b));
  }
  return { code: parts.join('\n') };
}

export async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** What a build's KPI code means for the port. */
export async function checkKpiSource(file: string): Promise<{ match: boolean; hash: string | null; reason: string }> {
  const s = kpiSource(file);
  if ('missing' in s) return { match: false, hash: null, reason: `KPI code not found in WIREGUARD's file (${s.missing.slice(0, 40)})` };
  const hash = await sha256(s.code);
  return hash === KPI_VERIFIED.sourceHash
    ? { match: true, hash, reason: `KPI code unchanged since build ${KPI_VERIFIED.build}` }
    : { match: false, hash, reason: 'WIREGUARD changed its KPI code' };
}

/** Builds compare without the local mock's prefix. */
export const sameBuild = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.replace(/^mock-/, '') === b.replace(/^mock-/, '');
