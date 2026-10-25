// Pre-Job Notes (S26): the handover form's content, its checks, and the standard notes it starts with.

export interface ToolRow { conveyance: string; config: string; details: string }
export interface Contact { name: string; mobile: string; email: string }
export interface NoteContent {
  client: string; rig_type: string; rdd_dept: string; casing: string; suite_no: string; date_from: string; date_to: string;
  toolstrings: ToolRow[]; important_notes: string; sme: Contact; main_contact_id: string; extra_contact_ids: string[];
}

/** Written for SLK Ops: the reminders a slickline crew passes on before a job. Editable on every note. */
export const STANDARD_NOTES = [
  'Notify the client representative and the RDD 24 hours before arrival on location.',
  'Confirm the well is handed over with valid permits and isolations before rig-up.',
  'Pressure-test the lubricator and PCE to the agreed value and record it before running in hole.',
  'Report any restriction, overpull or tag shallower than plan to the SDM before continuing.',
  'Stop the job and call the SDM if conditions differ from this note.',
].map((l) => `• ${l}`).join('\n');

export const emptyNote = (): NoteContent => ({
  client: 'Saudi Aramco', rig_type: '', rdd_dept: '', casing: '', suite_no: '', date_from: '', date_to: '',
  toolstrings: [{ conveyance: '', config: '', details: '' }], important_notes: STANDARD_NOTES, sme: { name: '', mobile: '', email: '' },
  main_contact_id: '', extra_contact_ids: [],
});

const s = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const date = (v: unknown) => { const d = s(v, 10); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''; };

/** Cleans a note from the editor. Rig type, RDD department, casing, suite # and the main contact are required (manual §3.7). */
export function cleanNote(input: unknown): { content: NoteContent } | { error: string } {
  const b = (input ?? {}) as Record<string, unknown>;
  const c: NoteContent = {
    client: s(b.client, 120), rig_type: s(b.rig_type, 60), rdd_dept: s(b.rdd_dept, 60), casing: s(b.casing, 40), suite_no: s(b.suite_no, 40),
    date_from: date(b.date_from), date_to: date(b.date_to),
    toolstrings: (Array.isArray(b.toolstrings) ? b.toolstrings : []).slice(0, 12).map((r) => {
      const x = (r ?? {}) as Record<string, unknown>;
      return { conveyance: s(x.conveyance, 60), config: s(x.config, 1000), details: s(x.details, 2000) };
    }).filter((r) => r.conveyance || r.config || r.details),
    important_notes: s(b.important_notes, 6000),
    sme: (() => { const x = (b.sme ?? {}) as Record<string, unknown>; return { name: s(x.name, 120), mobile: s(x.mobile, 30), email: s(x.email, 120) }; })(),
    main_contact_id: s(b.main_contact_id, 64),
    extra_contact_ids: [...new Set((Array.isArray(b.extra_contact_ids) ? b.extra_contact_ids : []).map((x) => s(x, 64)).filter(Boolean))].slice(0, 10),
  };
  const missing = [!c.rig_type && 'rig type', !c.rdd_dept && 'RDD department', !c.casing && 'casing size', !c.suite_no && 'suite #', !c.main_contact_id && 'main contact'].filter(Boolean);
  if (missing.length) return { error: `Fill in the ${missing.join(', ')}` };
  if (c.date_from && c.date_to && c.date_to < c.date_from) return { error: 'The date range ends before it starts' };
  if (c.sme.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.sme.email)) return { error: 'The SME email looks wrong' };
  c.extra_contact_ids = c.extra_contact_ids.filter((x) => x !== c.main_contact_id);
  return { content: c };
}

/** Next document number from a counter value: PJN-0001 … */
export const pjnNo = (n: number) => `PJN-${String(n).padStart(4, '0')}`;
