// Data export and import (Administrator Manual 7). A package is { format, version, exported_at, by, tables: { name: rows[] } }.
// Import never deletes: rows are new, changed or unchanged by primary key. History tables only take new rows.

export const PACKAGE_FORMAT = 'slkops-data-package';
export const PACKAGE_VERSION = 1;

/** Import order: a row's parents come first. WIREGUARD mirrors are not part of a package (the sync owns them). */
export const IMPORT_ORDER = [
  'service_domains', 'service_profiles', 'lookup_values', 'pce', 'grease_panels', 'user_roles', 'role_permissions', 'tab_grants', 'employees',
  'holidays', 'attendance_categories', 'jobs', 'job_services', 'job_crew', 'job_headcount', 'job_third_parties', 'job_log_events', 'unit_events',
  'jra_templates', 'jras', 'pre_job_notes', 'pre_job_note_versions', 'eight_min_facts', 'incidents', 'eight_min_facts_versions', 'failure_roster_entries',
  'attendance_entries', 'attendance_approvals', 'inventory_locations', 'inventory_items', 'inventory_movements', 'bonus_rules', 'bonus_role_splits',
  'job_bonus_lines', 'recon_findings', 'recon_links', 'doc_counters', 'knowledge_docs', 'quick_plan_cards', 'ai_settings', 'ai_usage', 'kpi_parity_runs',
];
/** Exported for the record, never imported. */
export const EXPORT_ONLY = ['audit_log'];
/** Append-only history: an import may add rows but never change one. */
export const IMMUTABLE = ['pre_job_note_versions', 'eight_min_facts_versions', 'inventory_movements'];

export type Row = Record<string, unknown>;
export interface TableDiff { table: string; incoming: number; added: number; changed: number; unchanged: number; refused: number; samples: { key: string; kind: 'added' | 'changed' | 'refused'; fields?: string[] }[] }

export const keyOf = (row: Row, pk: string[]) => pk.map((k) => String(row[k] ?? '')).join('|');
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || String(a ?? '') === String(b ?? '');

/** Compares incoming rows with what is stored, on the columns the table really has. */
export function diffTable(table: string, incoming: Row[], existing: Row[], pk: string[], columns: string[]): TableDiff {
  const have = new Map(existing.map((r) => [keyOf(r, pk), r]));
  const d: TableDiff = { table, incoming: incoming.length, added: 0, changed: 0, unchanged: 0, refused: 0, samples: [] };
  for (const r of incoming) {
    const k = keyOf(r, pk);
    const cur = have.get(k);
    if (!cur) { d.added++; if (d.samples.length < 5) d.samples.push({ key: k, kind: 'added' }); continue; }
    const fields = columns.filter((c) => c in r && !same(r[c], cur[c]));
    if (!fields.length) { d.unchanged++; continue; }
    if (IMMUTABLE.includes(table)) { d.refused++; if (d.samples.length < 5) d.samples.push({ key: k, kind: 'refused', fields }); continue; }
    d.changed++;
    if (d.samples.length < 5) d.samples.push({ key: k, kind: 'changed', fields });
  }
  return d;
}

/** Checks the package shape before anything is compared. */
export function checkPackage(p: unknown): { tables: Record<string, Row[]> } | { error: string } {
  const pkg = p as { format?: string; version?: number; tables?: Record<string, unknown> };
  if (!pkg || pkg.format !== PACKAGE_FORMAT) return { error: 'This file is not an SLK Ops data package' };
  if (pkg.version !== PACKAGE_VERSION) return { error: `Package version ${String(pkg.version)} is not supported (expected ${PACKAGE_VERSION})` };
  if (!pkg.tables || typeof pkg.tables !== 'object') return { error: 'The package has no tables' };
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(pkg.tables)) {
    if (EXPORT_ONLY.includes(name)) continue;
    if (!IMPORT_ORDER.includes(name)) return { error: `Unknown table ${name}` };
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) return { error: `Table ${name} must be a list of rows` };
    tables[name] = rows as Row[];
  }
  return { tables };
}
