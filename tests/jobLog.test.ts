import { describe, expect, it } from 'vitest';
import { filterSql, filtersToQuery, parseFilters } from '../src/shared/filters';
import { JOB_LOG_COLUMNS, displayValue, jobLogTable, type JobLogRow } from '../src/shared/jobLog';
import { columnLetter, crc32, csv, workbook } from '../src/shared/xlsx';
import { readAllowed } from '../src/worker/permissions';

const dec = new TextDecoder();

/** Reads a stored zip back by its central directory, checking each entry's CRC. */
function unzip(bytes: Uint8Array): Record<string, string> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const crc = v.getUint32(p + 16, true), size = v.getUint32(p + 24, true), nameLen = v.getUint16(p + 28, true), local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const lnl = v.getUint16(local + 26, true);
    const data = bytes.subarray(local + 30 + lnl, local + 30 + lnl + size);
    expect(crc32(data)).toBe(crc);
    out[name] = dec.decode(data);
    p += 46 + nameLen;
  }
  return out;
}

describe('xlsx writer', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('names columns past Z', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
  it('writes a workbook with text, numbers, a frozen header and escaped values', () => {
    const files = unzip(workbook('Job Log', ['Ticket', 'Depth'], [['=1+1 <A&B>', 1234.5], [null, 0]], [12, 10]));
    expect(Object.keys(files)).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']);
    const sheet = files['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">=1+1 &lt;A&amp;B&gt;</t></is></c>');
    expect(sheet).toContain('<c r="B2"><v>1234.5</v></c>');
    expect(sheet).toContain('<c r="B3"><v>0</v></c>');
    expect(sheet).not.toContain('r="A3"');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<autoFilter ref="A1:B3"/>');
  });
});

describe('csv', () => {
  it('quotes, adds a BOM and defuses formulas', () => {
    expect(csv(['a', 'b'], [['x,y', '=SUM(A1)'], ['say "hi"', -3]])).toBe('﻿a,b\r\n"x,y",\'=SUM(A1)\r\n"say ""hi""",-3');
  });
});

describe('filters', () => {
  it('parses repeated and piped values, drops junk', () => {
    const f = parseFilters(new URLSearchParams('unit=SL-40&unit=SL-41|SL-42&year=26&year=2026&month=13&month=02&status=open&status=planned'));
    expect(f).toEqual({ unit: ['SL-40', 'SL-41', 'SL-42'], year: ['2026'], month: ['02'], status: ['planned'] });
    expect(filtersToQuery({ unit: ['SL-40', 'SL 41'] })).toBe('unit=SL-40&unit=SL+41');
  });
  it('binds one JSON list per active filter', () => {
    const { where, binds } = filterSql({ unit: ['SL-40'], service: ['Gauge Cutter'] });
    expect(where).toHaveLength(2);
    expect(where[0]).toContain('job_services');
    expect(where[1]).toContain('j.unit_number');
    expect(binds).toEqual(['["Gauge Cutter"]', '["SL-40"]']);
    expect(filterSql({}).where).toEqual([]);
  });
});

describe('job log', () => {
  const row = {
    id: '1', status: 'completed', failure: 'na', report_closure_status: 'pending_review', services: 'Gauge Cutter\u001fDrift', npt_hours: 0, runs_ok: 3,
  } as unknown as JobLogRow;
  it('shows codes as words and lists joined', () => {
    expect(displayValue(row, 'status')).toBe('Completed');
    expect(displayValue(row, 'failure')).toBe('N/A');
    expect(displayValue(row, 'report_closure_status')).toBe('Pending review');
    expect(displayValue(row, 'services')).toBe('Gauge Cutter, Drift');
    expect(displayValue(row, 'npt_hours')).toBe(0);
    expect(displayValue(row, 'well')).toBeNull();
  });
  it('keeps revenue out and lines the table up with the columns', () => {
    expect(JOB_LOG_COLUMNS.some((c) => String(c.key).includes('revenue'))).toBe(false);
    const t = jobLogTable([row]);
    expect(t.header).toHaveLength(JOB_LOG_COLUMNS.length);
    expect(t.rows[0]).toHaveLength(JOB_LOG_COLUMNS.length);
  });
  it('needs the Job Log tab', () => {
    expect(readAllowed('/api/job-log', { job_log: { view: true, edit: false, delete: false } })).toBe(true);
    expect(readAllowed('/api/job-log/options', { jobs: { view: true, edit: true, delete: true } })).toBe(false);
  });
});
