// The two Excel imports of the Competency module (CDP Progress Tracker and Job Details) read the first sheet as rows
// (6z.34). This stands in for SheetJS with the app's own reader, so no outside Excel library is shipped. Shared-string
// cells come back as text; number cells (including Excel dates, as serial numbers) come back as numbers, which the
// module's date parser already handles.

import { readXlsx } from '../../shared/xlsxRead';

type Cell = string | number | null;
export interface Book { SheetNames: string[]; Sheets: Record<string, Cell[][]> }

const colNo = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const asValue = (v: string | undefined): Cell => (v === undefined ? null : /^-?\d+(\.\d+)?(E-?\d+)?$/i.test(v) ? Number(v) : v);

/** The first sheet as rows of cells, row 1 first, empty cells as null. */
export async function sheetRows(data: ArrayBuffer | Uint8Array): Promise<Cell[][]> {
  const sheet = await readXlsx(data instanceof Uint8Array ? data : new Uint8Array(data));
  const rows: Cell[][] = [];
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) continue;
    const r = Number(m[2]) - 1, c = colNo(m[1]);
    (rows[r] ??= [])[c] = asValue(cell.v);
  }
  // fill the gaps so every row is a real array, as SheetJS gives with header: 1
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    rows[r] = Array.from({ length: row.length }, (_, i) => row[i] ?? null);
  }
  return rows;
}

/** The calls the module makes: XLSX.read(buf) then XLSX.utils.sheet_to_json(ws, { header: 1 }). read is async here. */
export const XLSX = {
  async read(data: ArrayBuffer | Uint8Array): Promise<Book> {
    return { SheetNames: ['Sheet1'], Sheets: { Sheet1: await sheetRows(data) } };
  },
  utils: {
    sheet_to_json(ws: Cell[][]): Cell[][] { return ws; },
  },
};
