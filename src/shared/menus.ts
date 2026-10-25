// Navigation: groups, their sub-pages, the menu key that gates each page, and which screen (S-ID) it is.
// Menu keys match role_permissions in replica/migrations/0002_seed.sql.

export interface Page { key: string; label: string; path: string; screen: string; milestone?: string }
export interface Group { label: string; pages: Page[] }

export const NAV: Group[] = [
  {
    label: 'Operation',
    pages: [
      { key: 'schedule', label: 'Schedule', path: '/operation/schedule', screen: 'S02' },
      { key: 'jobs', label: 'Jobs', path: '/operation/jobs', screen: 'S03' },
      { key: 'job_log', label: 'Job Log', path: '/operation/job-log', screen: 'S08', milestone: '2g' },
      { key: 'reconciliation', label: 'Reconciliation', path: '/operation/reconciliation', screen: 'S46', milestone: '2e' },
      { key: 'pre_job_notes', label: 'Pre-Job Notes', path: '/operation/pre-job-notes', screen: 'S09', milestone: '3' },
      { key: 'failure_roster', label: 'Failure Roster', path: '/operation/failure-roster', screen: 'S10', milestone: '2h' },
      { key: 'eight_min_facts', label: '8 Min. Facts', path: '/operation/8-min-facts', screen: 'S11', milestone: '2h' },
      { key: 'quick_plan', label: 'Quick Plan', path: '/operation/quick-plan', screen: 'S25', milestone: '3' },
      { key: 'database', label: 'Database', path: '/operation/database', screen: 'S24', milestone: '2f' },
    ],
  },
  {
    label: 'Service Quality',
    pages: [
      { key: 'statistics', label: 'Statistics', path: '/quality/statistics', screen: 'S13', milestone: '2i' },
      { key: 'npt_analysis', label: 'NPT Analysis', path: '/quality/npt', screen: 'S14', milestone: '2i' },
      { key: 'utilization', label: 'Utilization', path: '/quality/utilization', screen: 'S15', milestone: '3' },
      { key: 'competency', label: 'Competency', path: '/quality/competency', screen: 'S16', milestone: '3' },
      { key: 'statistics', label: 'Wire KPIs', path: '/quality/wire-kpis', screen: 'D3', milestone: '3' },
    ],
  },
  {
    label: 'Bonus',
    pages: [
      { key: 'bonus', label: 'Bonus Report', path: '/bonus/report', screen: 'S32', milestone: '4' },
      { key: 'bonus', label: 'Bonus Analysis', path: '/bonus/analysis', screen: 'S32', milestone: '4' },
      { key: 'bonus', label: 'Bonus Rules', path: '/bonus/rules', screen: 'S32', milestone: '4' },
    ],
  },
  { label: 'Sales Dashboard', pages: [{ key: 'sales_dashboard', label: 'Sales Dashboard', path: '/sales', screen: 'S33', milestone: '4' }] },
  {
    label: 'Attendance',
    pages: [
      { key: 'attendance', label: 'Attendance', path: '/attendance', screen: 'S17', milestone: '2j' },
      { key: 'headcount_roster', label: 'Headcount Roster', path: '/attendance/roster', screen: 'S44', milestone: '2j' },
    ],
  },
  {
    label: 'Inventory',
    pages: [
      { key: 'inventory_explosive', label: 'Explosive', path: '/inventory/explosive', screen: 'S18', milestone: '2k' },
      { key: 'inventory_hardware', label: 'Hardware', path: '/inventory/hardware', screen: 'S19', milestone: '3' },
      { key: 'inventory_mcr', label: 'MCR', path: '/inventory/mcr', screen: 'S29', milestone: '3' },
    ],
  },
  { label: 'Wires', pages: [{ key: 'wires', label: 'Wires', path: '/wires', screen: 'S30', milestone: '3' }] },
  { label: 'Knowledge Hub', pages: [{ key: 'knowledge_hub', label: 'Knowledge Hub', path: '/knowledge', screen: 'S21', milestone: '3' }] },
  {
    label: 'Administration',
    pages: [
      { key: 'users', label: 'Users & Roles', path: '/admin/users', screen: 'S34', milestone: '2a' },
      { key: 'ai_agent', label: 'AI Agent', path: '/admin/ai-agent', screen: 'S35', milestone: '5' },
      { key: 'users', label: 'Data export & import', path: '/admin/data', screen: 'S47', milestone: '4' },
    ],
  },
];

/** Labels for every menu key, used by Users & Roles. Keys without a page of their own are listed under "Other". */
export const MENU_LABELS: Record<string, string> = {
  // the first page with a key names it (Statistics, not the Wire KPIs page that shares its key)
  ...Object.fromEntries(NAV.flatMap((g) => g.pages.map((p) => [p.key, p.key === 'bonus' ? 'Bonus' : p.label])).reverse()),
  audit: 'Audit trail',
  ai_assistant: 'Help assistant',
};

/** Menu keys grouped like the top navigation (Admin Manual 5.1: the grant checklist follows the nav clusters). */
export function menuClusters(keys: readonly string[]): { label: string; keys: string[] }[] {
  const seen = new Set<string>();
  const out = NAV.map((g) => {
    const ks = [...new Set(g.pages.map((p) => p.key))].filter((k) => keys.includes(k) && !seen.has(k));
    ks.forEach((k) => seen.add(k));
    return { label: g.label, keys: ks };
  }).filter((g) => g.keys.length);
  const other = keys.filter((k) => !seen.has(k));
  return other.length ? [...out, { label: 'Other', keys: other }] : out;
}

export const canView = (menus: Record<string, { view: boolean }>, key: string) => !!menus[key]?.view;

export function visibleNav(menus: Record<string, { view: boolean }>): Group[] {
  return NAV.map((g) => ({ ...g, pages: g.pages.filter((p) => canView(menus, p.key)) })).filter((g) => g.pages.length);
}
