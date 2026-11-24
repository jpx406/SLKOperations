import { changeSummary, coerceForm, mergeForms, newForm, type JobForLog, type LogForm } from '../../shared/jobLogForm';
import { ApiError, api } from '../api';

// The Job log's copy on the device (6z.51), from the package's store: every change is kept in IndexedDB as it is
// typed, so closing the page or losing signal loses nothing; Save / Sync sends it as a new version, merging with
// whatever someone saved meanwhile (up to three tries).

export interface LocalLog {
  jobId: string; logId: string | null; form: LogForm; serverVer: number; baseForm: LogForm | null;
  status: 'synced' | 'offline'; savedBy?: string | null; savedAt?: string | null; createdBy?: string | null; sentAt?: string | null; sentBy?: string | null;
}
export interface ServerLog { id: string; version: number; form: LogForm; createdBy: string | null; savedBy: string | null; savedAt: string; sentBy: string | null; sentAt: string | null }
export interface LogData { job: JobForLog; crew: string[]; canEdit: boolean; log: ServerLog | null; options?: import('./Sections').LogOptions }

const DB = 'slk-joblog', STORE = 'logs';
let dbp: Promise<IDBDatabase> | null = null;
function openDB(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE, { keyPath: 'jobId' }); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return dbp;
}
async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  try {
    const db = await openDB();
    return await new Promise<T | undefined>((res, rej) => {
      const t = db.transaction(STORE, mode);
      const rq = fn(t.objectStore(STORE));
      t.oncomplete = () => res(rq ? (rq.result as T) : undefined);
      t.onerror = () => rej(t.error);
    });
  } catch { return undefined; /* private mode or storage blocked: the page still works, without the device copy */ }
}
const getLocal = (jobId: string) => idb<LocalLog>('readonly', (s) => s.get(jobId));
const putLocal = (rec: LocalLog) => idb('readwrite', (s) => s.put(rec));

export const isUnsynced = (rec: LocalLog | null) => !!rec && rec.status === 'offline';

/** Opens the log: unsynced changes on this device win; else the server copy, kept on the device too. */
export async function loadLog(data: LogData | null, jobId: string): Promise<{ rec: LocalLog; notice: string | null }> {
  const local = await getLocal(jobId);
  if (local?.status === 'offline') return { rec: { ...local, form: coerceForm(local.form), baseForm: local.baseForm ? coerceForm(local.baseForm) : null }, notice: 'Your unsynced changes on this device were put back. Save / Sync to send them.' };
  if (!data) {
    if (local) return { rec: local, notice: 'Offline: showing the copy kept on this device.' };
    return { rec: { jobId, logId: null, form: newForm(), serverVer: 0, baseForm: null, status: 'offline' }, notice: 'Offline: this log is new and is kept on this device until you are connected.' };
  }
  const s = data.log;
  const form = s ? s.form : newForm(data.job);
  const rec: LocalLog = { jobId, logId: s?.id ?? null, form, serverVer: s?.version ?? 0, baseForm: s ? form : null, status: 'synced', savedBy: s?.savedBy, savedAt: s?.savedAt, createdBy: s?.createdBy, sentAt: s?.sentAt, sentBy: s?.sentBy };
  await putLocal(rec);
  return { rec, notice: null };
}

/** Keeps the latest typing on the device (marked not synced). */
export async function stageLocal(rec: LocalLog, form: LogForm): Promise<LocalLog> {
  const next: LocalLog = { ...rec, form, status: 'offline' };
  await putLocal(next);
  return next;
}

/** Sends the device copy as a new version; merges and retries when someone saved meanwhile. */
export async function pushLog(rec: LocalLog, attempt = 0): Promise<{ rec: LocalLog; merged: boolean; ok: boolean; error?: string; signed?: boolean }> {
  type Answer = { conflict: boolean; version: number; serverForm?: LogForm; savedBy?: string; savedAt?: string; logId?: string; createdBy?: string | null; jobLogSigned?: boolean };
  let a: Answer;
  try {
    a = await api<Answer>(`/joblog/${encodeURIComponent(rec.jobId)}`, { method: 'PUT', json: { form: rec.form, base: rec.serverVer, summary: changeSummary(rec.baseForm, rec.form) } });
  } catch (e) { return { rec, merged: false, ok: false, error: e instanceof ApiError ? e.message : 'No connection' }; }
  if (a.conflict) {
    if (attempt >= 3) return { rec, merged: true, ok: false, error: 'Someone saved again while merging. Try Save / Sync once more.' };
    const theirs = coerceForm(a.serverForm);
    const merged: LocalLog = { ...rec, form: mergeForms(rec.baseForm, rec.form, theirs), serverVer: a.version, baseForm: theirs };
    const r = await pushLog(merged, attempt + 1);
    return { ...r, merged: true };
  }
  const synced: LocalLog = { ...rec, serverVer: a.version, baseForm: rec.form, status: 'synced', savedBy: a.savedBy, savedAt: a.savedAt, logId: a.logId ?? rec.logId, createdBy: a.createdBy ?? rec.createdBy };
  await putLocal(synced);
  return { rec: synced, merged: false, ok: true, signed: a.jobLogSigned };
}
