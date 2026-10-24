// Builds mock-wireguard/fixtures.json from WIREGUARD's own CSV exports (reference lists only, no people).
//   node scripts/make-wg-fixtures.mjs [path-to-DATA_SLK-folder]
// Users in the mock are fake test accounts defined in mock-wireguard/users.json, never WIREGUARD's real users.

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

const fixtures = {
  source: 'WIREGUARD CSV exports, DATA_SLK',
  units: read('units.csv').map((r) => ({ unit_number: r.unitNumber, country: r.country, year: Number(r.year) || null })),
  job_types: list('wireguard-job-types (2).csv'),
  job_locations: list('wireguard-locations (1).csv'),
  fields: list('wireguard-fields (3).csv'),
  rigs: list('wireguard-rigs (2).csv'),
};

writeFileSync(new URL('../mock-wireguard/fixtures.json', import.meta.url), JSON.stringify(fixtures, null, 1) + '\n');
console.log(Object.fromEntries(Object.entries(fixtures).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])));
