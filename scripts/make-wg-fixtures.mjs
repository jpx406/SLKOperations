// Builds the mock WIREGUARD data from WIREGUARD's own CSV exports.
//   node scripts/make-wg-fixtures.mjs [path-to-DATA_SLK-folder]
// Writes mock-wireguard/fixtures.json (reference lists) and mock-wireguard/data.json (wires, drums,
// job-log runs, maintenance entries and tests, alerts), shaped like WIREGUARD's API rows (snake_case).
// Every person is replaced by a placeholder: names become "Supervisor 07", usernames NESR-95xxx.
// Users in the mock are fake test accounts in mock-wireguard/users.json, never WIREGUARD's users.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const src = process.argv[2] ?? 'C:/Users/JuanCeron/nesr/SLK__Wireguard_v2/slkwireguard-backend/Clau_updates/DATA_SLK/New folder';

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const read = (f) => parseCsv(readFileSync(join(src, f), 'utf8').replace(/^\uFEFF/, ''));
const list = (f) => read(f).map((r) => ({ name: r.name, country: r.country, active: r.active !== 'false' ? 1 : 0 }));
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v) => (v === '' || v == null ? null : v);

// --- pseudonyms, stable within one run -----------------------------------------------------------
const names = new Map();
const pseudoName = (v) => {
  if (!v) return null;
  if (!names.has(v)) names.set(v, `Supervisor ${String(names.size + 1).padStart(2, '0')}`);
  return names.get(v);
};
const ids = new Map();
const pseudoUser = (v) => {
  if (!v) return null;
  if (!ids.has(v)) ids.set(v, `NESR-95${String(ids.size + 1).padStart(3, '0')}`);
  return ids.get(v);
};

// --- reference lists --------------------------------------------------------------------------------
const fixtures = {
  source: 'WIREGUARD CSV exports, DATA_SLK',
  units: read('units.csv').map((r) => ({ unit_number: r.unitNumber, country: r.country, year: num(r.year) })),
  job_types: list('wireguard-job-types (2).csv'),
  job_locations: list('wireguard-locations (1).csv'),
  fields: list('wireguard-fields (3).csv'),
  rigs: list('wireguard-rigs (2).csv'),
};

// --- wires, drums --------------------------------------------------------------------------------------
const wires = read('wires.csv').map((r) => ({
  wire_serial_number: r.wireSerialNumber, wire_grade: str(r.wireGrade), wire_size: str(r.wireSize), manufacturer: str(r.manufacturer),
  drum_no: str(r.drumNo), spooled_date: str(r.spooledDate), spooled_length: str(r.spooledLength), po_number: null,
  status: str(r.status) ?? 'Active', rated_mbl: num(r.ratedMBL), od_reduction_percent: num(r.odReductionPercent),
  notes: null, country: str(r.country), field: str(r.field),
}));
const drums = read('drums.csv').map((r) => ({
  drum_no: r.drumNo, drum_position: str(r.drumPosition), slickline_unit: str(r.slicklineUnit),
  country: str(r.country), field: str(r.field), active: r.active === '0' ? 0 : 1,
}));

// --- job-log runs -------------------------------------------------------------------------------------
const jobs = read('joblog.csv').map((r, i) => ({
  id: `run-${String(i + 1).padStart(5, '0')}`,
  drss_number: str(r.drssNumber), field_ticket: str(r.fieldTicket), wire_serial_number: str(r.wireSerialNumber), drum_no: str(r.drumNo),
  country: str(r.country), job_date: r.jobDate, job_name: str(r.jobName), location: str(r.location), rig: str(r.rig),
  field_name: str(r.fieldName), well_rig: str(r.wellRig), well_type: str(r.wellType),
  h2s_percent: num(r.h2sPercent), co2_percent: num(r.co2Percent), bottomhole_pressure: num(r.bottomholePressure), bottomhole_temp: num(r.bottomholeTemp),
  supervisor_name: pseudoName(r.supervisorName), remarks: null, run_remarks: null, run_number: num(r.runNumber),
  hours_working: num(r.hoursWorking), max_depth: num(r.maxDepth), max_tension: num(r.maxTension),
  jarring: num(r.jarringMinutes) > 0 ? 1 : 0, jarring_depth: num(r.jarringDepth), jarring_impact_count: num(r.jarringImpactCount),
  jarring_minutes: num(r.jarringMinutes), wire_cut_feet: num(r.wireCutFeet),
  cumulative_hours_working: num(r.cumulativeHoursWorking), cumulative_jar_minutes: num(r.cumulativeJarMinutes), remaining_length_feet: num(r.remainingLengthFeet),
  seq: i + 1, input_date: str(r.approvedAt) ?? r.jobDate, entered_by: null, created_at: `${r.jobDate}T12:00:00.000Z`,
  approval_status: str(r.approvalStatus) ?? 'pending', approved_by: pseudoUser(r.approvedBy), approved_at: str(r.approvedAt),
}));

// Edge cases the export is too clean to contain, so the sync and reconciliation get exercised:
jobs.slice(-4).forEach((j) => { j.approval_status = 'pending'; j.approved_by = null; j.approved_at = null; });  // awaiting approval
jobs.slice(-6, -4).forEach((j) => { j.country = null; });                    // country-less legacy rows (Admin-only in WIREGUARD)
jobs[0].approval_status = 'Approved';                                          // imported history writes it capitalised
jobs.push({ ...jobs[1], id: 'run-cut-0001', job_name: 'Maintenance Wire cut', run_number: 0, hours_working: 0, max_depth: 0,
  max_tension: 0, jarring_minutes: 0, location: 'Shop', rig: 'Shop', well_rig: '0', well_type: 'Shop', wire_cut_feet: 150, field_ticket: null, seq: jobs.length + 1 });

// --- maintenance entries and tests ---------------------------------------------------------------------
const documents = read('maintenance-entries.csv').map((r, i) => ({
  id: `doc-${String(i + 1).padStart(5, '0')}`,
  doc_type: r.docType, wire_serial_number: str(r.wireSerialNumber), drum_no: str(r.drumNo), filename: 'mock.pdf', size_bytes: 0, r2_key: 'mock',
  uploaded_at: str(r.uploadedAt), uploaded_by: pseudoUser(r.uploadedBy), sap_number: null, test_type: str(r.testType), spool_type: str(r.spoolType),
  number_of_runs: num(r.numberOfRuns),
  test_data: JSON.stringify({ wrapsAchieved: num(r.wrapsAchieved), fractureObserved: str(r.fractureObserved), revolutionsAchieved: num(r.revolutionsAchieved), measuredBreakingTensionLbs: num(r.measuredBreakingTensionLbs) }),
  result: str(r.result), test_date: str(r.testDate), expiry_date: str(r.expiryDate), performed_by: pseudoName(r.performedBy),
  approval_status: str(r.approvalStatus) ?? 'pending', approved_by: pseudoUser(r.approvedBy), approved_at: str(r.approvedAt),
}));

// --- alerts: a few, derived from the data, in WIREGUARD's notification row shape --------------------
const notifications = [];
const lastTest = new Map();
for (const d of documents) if (d.wire_serial_number && d.expiry_date) lastTest.set(d.wire_serial_number, d.expiry_date > (lastTest.get(d.wire_serial_number) ?? '') ? d.expiry_date : lastTest.get(d.wire_serial_number));
for (const [serial, expiry] of [...lastTest].slice(0, 6)) {
  notifications.push({ id: `ntf-${notifications.length + 1}`, occurred_at: `${expiry}T05:00:00.000Z`, severity: 'warn',
    message: `Wire ${serial}: latest test expires ${expiry}`, wire_serial_number: serial, drum_no: null, code: 'TEST_EXPIRY', read: 0, webhook_status: null });
}
notifications.push({ id: 'ntf-orphan', occurred_at: '2026-10-20T05:00:00.000Z', sev: 'crit', message: 'Client-raised alert with no wire or drum',
  wire_serial_number: null, drum_no: null, code: 'MANUAL', read: 0, webhook_status: null });

// --- settings the KPIs need (illustrative values, WIREGUARD's real ones come from its endpoints) -------
const settings = {
  'kpi-settings': [],
  'sop-settings': [{ key: 'pre_job_test_days', value: 30 }, { key: 'used_wire_mbl_pct', value: 50 }],
  'sop-wire-size-thresholds': [],
  'wire-alloy-database': [],
  'wire-retirement-reasons': [{ id: 'rr-1', name: 'Failed torsion test', active: 1 }],
};

writeFileSync(new URL('../mock-wireguard/fixtures.json', import.meta.url), JSON.stringify(fixtures, null, 1) + '\n');
writeFileSync(new URL('../mock-wireguard/data.json', import.meta.url), JSON.stringify({ wires, drums, jobs, documents, notifications, settings }) + '\n');
console.log({
  units: fixtures.units.length, job_types: fixtures.job_types.length, fields: fixtures.fields.length, rigs: fixtures.rigs.length,
  wires: wires.length, drums: drums.length, runs: jobs.length, documents: documents.length, notifications: notifications.length,
  pseudonymised: { names: names.size, usernames: ids.size },
});
