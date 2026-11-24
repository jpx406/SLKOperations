// Navigation: groups, their sub-pages, the menu key that gates each page, and which screen (S-ID) it is.
// Menu keys match role_permissions in replica/migrations/0002_seed.sql.

export interface Page { key: string; label: string; path: string; screen: string; milestone?: string }
export interface Group { label: string; pages: Page[] }

export const NAV: Group[] = [
  // 6z.44 (owner request 2026-11-21): the SLK Activity Dashboard first, Equipment after Service Quality
  { label: 'SLK Activity Dashboard', pages: [{ key: 'sales_dashboard', label: 'SLK Activity Dashboard', path: '/sales', screen: 'S33', milestone: '4' }] },
  {
    label: 'Operation',
    pages: [
      { key: 'schedule', label: 'Schedule', path: '/operation/schedule', screen: 'S02' },
      { key: 'jobs', label: 'Jobs', path: '/operation/jobs', screen: 'S03' },
      { key: 'job_log', label: 'Job Log', path: '/operation/job-log', screen: 'S08', milestone: '2g' },
      // 6z.54: the Risk Tool and Crew Check out of the Competency Framework
      { key: 'job_risk_profile', label: 'Job Risk Profile', path: '/operation/job-risk-profile', screen: 'S08b', milestone: '6' },
      { key: 'pre_job_notes', label: 'Pre-Job Notes', path: '/operation/pre-job-notes', screen: 'S09', milestone: '3' },
      { key: 'quick_plan', label: 'Opportunities', path: '/operation/opportunities', screen: 'S25', milestone: '3' },
    ],
  },
  {
    label: 'Service Quality',
    pages: [
      { key: 'statistics', label: 'Statistics', path: '/quality/statistics', screen: 'S13', milestone: '2i' },
      { key: 'npt_analysis', label: 'NPT Analysis', path: '/quality/npt', screen: 'S14', milestone: '2i' },
      // 6z.43: 8 Min. Facts as Q-Incidents and the Failure Roster as the Incidents Dashboard (addresses unchanged)
      { key: 'eight_min_facts', label: 'Q-Incidents', path: '/operation/8-min-facts', screen: 'S11', milestone: '2h' },
      { key: 'failure_roster', label: 'Incidents Dashboard', path: '/operation/failure-roster', screen: 'S10', milestone: '2h' },
    ],
  },
  // 6z.47 (owner request 2026-11-22): the rig up, tool string and winch tools on their own, without a job
  {
    label: 'Utilities',
    pages: [
      { key: 'utilities', label: 'Rig Up Diagram', path: '/utilities/rig-up', screen: 'U1', milestone: '6' },
      { key: 'utilities', label: 'Tool String Diagram', path: '/utilities/tool-string', screen: 'U2', milestone: '6' },
      { key: 'utilities', label: 'Winch Report', path: '/utilities/winch', screen: 'U3', milestone: '6' },
    ],
  },
  {
    // 6z.44: Utilization and Wire KPIs first, then Hardware, the Assets Inventory (was its own Maintenance menu), the
    // wires and the reconciliation. The Explosive and MCR inventories are out of the menu; their pages and rights stay.
    label: 'Equipment',
    pages: [
      { key: 'utilization', label: 'Utilization', path: '/quality/utilization', screen: 'S15', milestone: '3' },
      { key: 'statistics', label: 'Wire KPIs', path: '/quality/wire-kpis', screen: 'D3', milestone: '3' },
      { key: 'inventory_hardware', label: 'Hardware', path: '/inventory/hardware', screen: 'S19', milestone: '3' },
      { key: 'database', label: 'Assets Inventory', path: '/operation/database', screen: 'S24', milestone: '2f' },
      { key: 'wires', label: 'Wires', path: '/wires', screen: 'S30', milestone: '3' },
      // checks SLK Ops jobs against WIREGUARD's runs (moved here from Operation, owner request 2026-10-26)
      { key: 'reconciliation', label: 'Reconciliation', path: '/wires/reconciliation', screen: 'S46', milestone: '2e' },
    ],
  },
  // 6z.35 (owner request 2026-11-20): the Knowledge Hub and Competency, each its own menu
  { label: 'Knowledge Hub', pages: [{ key: 'knowledge_hub', label: 'Knowledge Hub', path: '/knowledge', screen: 'S21', milestone: '3' }] },
  { label: 'Competency', pages: [{ key: 'competency', label: 'Competency', path: '/competency', screen: 'S16', milestone: '3' }] },
  // 6z.40 (owner request 2026-11-21): the Career Development Plan out of Competency, its own menu under it
  { label: 'Career Development', pages: [{ key: 'career_development', label: 'Career Development', path: '/career', screen: 'S16b', milestone: '3' }] },
  {
    label: 'Bonus',
    pages: [
      { key: 'bonus', label: 'Bonus Report', path: '/bonus/report', screen: 'S32', milestone: '4' },
      { key: 'bonus', label: 'Bonus Analysis', path: '/bonus/analysis', screen: 'S32', milestone: '4' },
      { key: 'bonus', label: 'Bonus Rules', path: '/bonus/rules', screen: 'S32', milestone: '4' },
      // attendance sits under Bonus (6z.35)
      { key: 'attendance', label: 'Attendance', path: '/attendance', screen: 'S17', milestone: '2j' },
    ],
  },
  {
    label: 'Administration',
    pages: [
      { key: 'users', label: 'Users & Roles', path: '/admin/users', screen: 'S34', milestone: '2a' },
      { key: 'audit', label: 'Audit trail', path: '/admin/audit', screen: 'S49', milestone: '6' },
      { key: 'form_templates', label: 'Form templates', path: '/admin/form-templates', screen: 'S48', milestone: '6' },
      { key: 'companies', label: 'Companies', path: '/admin/companies', screen: 'S50', milestone: '6' },
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
  utilities: 'Utilities (rig up, tool string and winch report without a job)',
  // out of the menu (6z.44), still rights: the pages open by address and Explosive is used on the job
  inventory_explosive: 'Explosive inventory',
  inventory_mcr: 'MCR inventory',
  ai_assistant: 'Help assistant',
  job_design: 'Job · 01 Design',
  job_preparation: 'Job · 02 Preparation',
  job_execution: 'Job · 03 Execution',
  job_closure: 'Job · 04 Closure',
  slk_ops: 'SLK Operations Hub (the whole app, with the Knowledge Hub, Competency and Career Development)',
};

/** The job stages sit under Jobs in the rights list. */
const AFTER: Record<string, string[]> = { jobs: ['job_design', 'job_preparation', 'job_execution', 'job_closure'] };

/** Menu keys grouped like the top navigation (Admin Manual 5.1: the grant checklist follows the nav clusters). */
export function menuClusters(keys: readonly string[]): { label: string; keys: string[] }[] {
  // the module right comes first (6z.33): it decides which of the three modules a role opens
  const seen = new Set<string>(keys.includes('slk_ops') ? ['slk_ops'] : []);
  const out = NAV.map((g) => {
    const ks = [...new Set(g.pages.flatMap((p) => [p.key, ...(AFTER[p.key] ?? [])]))].filter((k) => keys.includes(k) && !seen.has(k));
    ks.forEach((k) => seen.add(k));
    return { label: g.label, keys: ks };
  }).filter((g) => g.keys.length);
  const other = keys.filter((k) => !seen.has(k));
  const modules = keys.includes('slk_ops') ? [{ label: 'Modules', keys: ['slk_ops'] }] : [];
  return [...modules, ...out, ...(other.length ? [{ label: 'Other', keys: other }] : [])];
}

export const canView = (menus: Record<string, { view: boolean }>, key: string) => !!menus[key]?.view;

export function visibleNav(menus: Record<string, { view: boolean }>): Group[] {
  return NAV.map((g) => ({ ...g, pages: g.pages.filter((p) => canView(menus, p.key)) })).filter((g) => g.pages.length);
}
