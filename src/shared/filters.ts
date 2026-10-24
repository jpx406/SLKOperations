// The standard filter bar (S08, S10, S13–S15): nine dimensions plus status. Values travel as repeated
// query parameters (?unit=SL-40&unit=SL-41) and are turned into SQL in one place.

export const FILTER_DIMS = [
  { key: 'year', label: 'Year' },
  { key: 'month', label: 'Month' },
  { key: 'account', label: 'Account' },
  { key: 'area', label: 'Area' },
  { key: 'domain', label: 'Service domain' },
  { key: 'service', label: 'Service' },
  { key: 'sdm', label: 'SDM' },
  { key: 'unit', label: 'Unit #' },
  { key: 'conveyance', label: 'Conveyance' },
] as const;
export type FilterKey = (typeof FILTER_DIMS)[number]['key'] | 'status';
export type Filters = Partial<Record<FilterKey, string[]>>;

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUSES = ['planned', 'ongoing', 'completed', 'canceled'];
const KEYS: FilterKey[] = [...FILTER_DIMS.map((d) => d.key), 'status'];

export function parseFilters(q: URLSearchParams): Filters {
  const out: Filters = {};
  for (const k of KEYS) {
    let v = q.getAll(k).flatMap((x) => x.split('|')).map((x) => x.trim()).filter(Boolean).slice(0, 100);
    if (k === 'year') v = v.filter((x) => /^\d{4}$/.test(x));
    if (k === 'month') v = v.filter((x) => /^(0[1-9]|1[0-2])$/.test(x));
    if (k === 'status') v = v.filter((x) => STATUSES.includes(x));
    if (v.length) out[k] = [...new Set(v)];
  }
  return out;
}

export function filtersToQuery(f: Filters): string {
  const q = new URLSearchParams();
  for (const [k, vs] of Object.entries(f)) for (const v of vs ?? []) q.append(k, v);
  return q.toString();
}

/** SQL conditions on a jobs table aliased `j`. Each condition binds one JSON array. */
export function filterSql(f: Filters): { where: string[]; binds: string[] } {
  const where: string[] = [];
  const binds: string[] = [];
  const add = (sql: string, vals: string[] | undefined) => { if (vals?.length) { where.push(sql); binds.push(JSON.stringify(vals)); } };
  const list = 'IN (SELECT value FROM json_each(?))';
  add(`strftime('%Y', j.start_date) ${list}`, f.year);
  add(`strftime('%m', j.start_date) ${list}`, f.month);
  add(`j.location ${list}`, f.account);
  add(`j.field ${list}`, f.area);
  add(`EXISTS (SELECT 1 FROM job_services s JOIN service_profiles p ON p.job_type_name = s.job_type_name WHERE s.job_id = j.id AND p.domain ${list})`, f.domain);
  add(`EXISTS (SELECT 1 FROM job_services s WHERE s.job_id = j.id AND s.job_type_name ${list})`, f.service);
  add(`j.sdm_username ${list}`, f.sdm);
  add(`j.unit_number ${list}`, f.unit);
  add(`j.conveyance ${list}`, f.conveyance);
  add(`j.status ${list}`, f.status);
  return { where, binds };
}

export const activeFilterCount = (f: Filters) => Object.values(f).reduce((a, v) => a + (v?.length ? 1 : 0), 0);
