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
  /** Cloudflare Email Service binding for the daily digest; absent until the sender domain is onboarded. */
  EMAIL?: { send(message: { to: string; from: { email: string; name?: string }; subject: string; html: string; text: string }): Promise<unknown> };
  EMAIL_FROM?: string;
  /** Worker secret for the AI Agent; without it the agent says it isn't set up. */
  ANTHROPIC_API_KEY?: string;
  /** Optional: route the agent through Cloudflare AI Gateway (its Anthropic endpoint URL). */
  ANTHROPIC_BASE_URL?: string;
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
  /** Until when bonus and revenue pages are open after re-entering the password (step-up). */
  stepUpUntil?: number;
}

export interface AuthedUser extends Me {
  role: Role;
  sessionId: string;
}

export type AppBindings = { Bindings: Env; Variables: { user: AuthedUser } };
