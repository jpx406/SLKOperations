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
}

export interface Session {
  username: string;
  fullName: string;
  wgRole: string | null;
  wgToken: string;
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
