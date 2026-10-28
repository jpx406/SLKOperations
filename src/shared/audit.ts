// Administration → Audit trail: the areas of the app each audit entry belongs to (from its entity type), and the
// words for its actions. An entity type no area lists shows under Other.

export const AUDIT_AREAS = {
  auth: { label: 'Sign-in', types: ['auth'] },
  jobs: { label: 'Jobs', types: ['job', 'jra', 'unit_event', 'account_color'] },
  forms: { label: 'Form templates', types: ['form_template'] },
  files: { label: 'Files', types: ['attachments'] },
  users: { label: 'Users & Roles', types: ['user_role', 'user', 'role', 'role_permissions', 'tab_grants', 'approval_rule', 'passkey', 'employee'] },
  attendance: { label: 'Attendance', types: ['attendance', 'attendance_sheet', 'attendance_categories', 'attendance_role_sheets', 'holidays'] },
  quality: { label: 'Reports & quality', types: ['pre_job_note', 'eight_min_facts', 'incident', 'failure_roster', 'quick_plan', 'quick_plan_cards', 'signature', 'signatures'] },
  bonus: { label: 'Bonus & sales', types: ['bonus', 'bonus_rules', 'statements', 'sales'] },
  inventory: { label: 'Inventory & wires', types: ['inventory', 'inventory_item', 'inventory_movement', 'wire', 'reconciliation'] },
  database: { label: 'Database', types: ['company', 'lookup_values', 'service_profiles', 'pce', 'grease_panels', 'knowledge', 'knowledge_docs'] },
  system: { label: 'System', types: ['ai_settings', 'data', 'data_package', 'sync'] },
  other: { label: 'Other', types: [] as string[] },
} as const;
export type AuditArea = keyof typeof AUDIT_AREAS;

export const areaOf = (entityType: string): AuditArea =>
  (Object.entries(AUDIT_AREAS).find(([, a]) => (a.types as readonly string[]).includes(entityType))?.[0] as AuditArea | undefined) ?? 'other';

/** Plain words for the actions written to the trail; unknown ones show as they are. */
export const ACTION_LABEL: Record<string, string> = {
  login: 'Signed in', login_failed: 'Sign-in failed', logout: 'Signed out', session_ended: 'Session ended', step_up: 'Confirmed password',
  create: 'Created', edit: 'Changed', update: 'Changed', delete: 'Deleted', remove: 'Removed', upload: 'Uploaded', import: 'Imported', export: 'Exported',
  approve: 'Approved', reject: 'Rejected', decide: 'Decided', review: 'Reviewed', complete: 'Completed', reopen: 'Reopened', revise: 'New revision',
  send: 'Sent', notify: 'Notified', move: 'Moved', reset: 'Reset', run: 'Ran', digest: 'Digest sent', sign: 'Signed', revoke: 'Withdrew',
};
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a.replace(/_/g, ' ');

/** Actions shown in red: failures and removals. */
export const isWarning = (a: string) => /fail|delete|remove|reject|revoke|session_ended/.test(a);
