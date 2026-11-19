import { api } from '../api';

// The Competency module saves through window.storage (6z.34): get, set, delete and list by prefix, each promise-
// returning, values always text. Here that contract is served by SLK Ops (/api/competency/kv on D1, large values in
// R2). shared=true keys are the team's; shared=false keys are the signed-in person's own, kept apart on the server.

export interface CompetencyStorage {
  get(key: string, shared?: boolean): Promise<{ key: string; value: string; shared: boolean } | null>;
  set(key: string, value: string, shared?: boolean): Promise<{ key: string; value: string; shared: boolean }>;
  delete(key: string, shared?: boolean): Promise<{ key: string; deleted: true; shared: boolean }>;
  list(prefix?: string, shared?: boolean): Promise<{ keys: string[]; prefix: string; shared: boolean }>;
}

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

export const competencyStorage: CompetencyStorage = {
  async get(key, shared = false) {
    const r = await api<{ key: string; value: string | null; shared: boolean }>(`/competency/kv?${q({ key, shared: shared ? '1' : '0' })}`);
    return r.value === null ? null : { key, value: r.value, shared };
  },
  async set(key, value, shared = false) {
    return api(`/competency/kv`, { method: 'PUT', json: { key, value: String(value), shared } });
  },
  async delete(key, shared = false) {
    return api(`/competency/kv?${q({ key, shared: shared ? '1' : '0' })}`, { method: 'DELETE' });
  },
  async list(prefix = '', shared = false) {
    return api(`/competency/kv-list?${q({ prefix, shared: shared ? '1' : '0' })}`);
  },
};

/** Puts the contract where the module looks for it. Called before the module is shown. */
export function installCompetencyStorage() {
  (window as unknown as { storage: CompetencyStorage }).storage = competencyStorage;
}
