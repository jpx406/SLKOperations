import type { Me, Role } from '../shared/types';

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  WIREGUARD: Fetcher;
  ASSETS: Fetcher;
  APP_URL: string;
  IDLE_MINUTES: string;
  WG_SYNC_USERNAME?: string;
  WG_SYNC_PASSWORD?: string;
  /** WIREGUARD runs dated before this are history and never reported as unlinked. */
  RECON_START_DATE?: string;
  /** Where people open WIREGUARD to fix a run. */
  WG_APP_URL?: string;
}

export interface Session {
  username: string;
  fullName: string;
  wgRole: string | null;
  wgToken: string;
  /** Countries WIREGUARD showed at sign-in; seeds a new person's access only. */
  countries: string[];
  createdAt: number;
  lastSeen: number;
  validatedAt: number;
}

export interface AuthedUser extends Me {
  role: Role;
  sessionId: string;
}

export type AppBindings = { Bindings: Env; Variables: { user: AuthedUser } };
