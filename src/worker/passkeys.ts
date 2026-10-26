import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { Hono, type Context } from 'hono';
import type { AppBindings, Env } from './env';
import { openSession } from './session';
import { importWgUsers, wgUserActive } from './wgUsers';

// Face ID / fingerprint sign-in with WebAuthn passkeys, kept by SLK Ops (WIREGUARD is never written to).
//
// - A signed-in person registers the device they are on (Account menu). The passkey belongs to this site only.
// - "Sign in with Face ID / fingerprint" uses any passkey on the device, or one synced to it (iCloud Keychain,
//   Google Password Manager). Windows Hello counts too.
// - QR sign-in for a laptop: the laptop shows a QR code and a four-digit code; the person scans it with the phone
//   that has their passkey, checks the code matches, and confirms with Face ID. The laptop then signs in.
//   The laptop's poll carries a secret only it holds, so the approval can only be collected by the screen that
//   showed the code. Everything expires in three minutes and is single-use.
//
// Every sign-in also checks the person is active in SLK Ops, allowed to use Face ID (Users & Roles), and still
// active in WIREGUARD.

const CHALLENGE_S = 180;
const QR_S = 180;

/** The site the passkey belongs to: the address the browser is on. */
function rp(c: Context<AppBindings>) {
  const u = new URL(c.req.url);
  return { rpID: u.hostname, origin: u.origin, rpName: 'SLK Operations' };
}

export function deviceName(ua: string | undefined) {
  const s = ua ?? '';
  const browser = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'browser';
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Macintosh/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows PC' : 'device';
  return `${os} · ${browser}`;
}

const randomHex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(s: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const audit = (env: Env, username: string, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), username, action, 'passkey', id, summary.slice(0, 1000)).run();

interface UserRow { username: string; full_name: string; wg_role: string | null; countries: string; active: number; passkey_allowed: number }
interface PasskeyRow { id: string; username: string; public_key: string; counter: number; transports: string | null; device_name: string | null }

async function authOptions(c: Context<AppBindings>) {
  const options = await generateAuthenticationOptions({ rpID: rp(c).rpID, userVerification: 'required', allowCredentials: [] });
  const challengeId = randomHex(16);
  await c.env.KV.put(`pk:auth:${challengeId}`, options.challenge, { expirationTtl: CHALLENGE_S });
  return { options, challengeId };
}

/** Checks a Face ID / fingerprint answer; returns the person, or why not. */
async function verifyAssertion(c: Context<AppBindings>, challengeId: string | undefined, response: AuthenticationResponseJSON | undefined)
  : Promise<{ user: UserRow; device: string } | { error: string; status: 400 | 401 | 403 }> {
  if (!challengeId || !response?.id) return { error: 'Invalid request', status: 400 };
  const env = c.env;
  const challenge = await env.KV.get(`pk:auth:${challengeId}`);
  if (!challenge) return { error: 'The Face ID request expired. Try again.', status: 400 };
  await env.KV.delete(`pk:auth:${challengeId}`); // single use, whatever happens next
  const cred = await env.DB.prepare('SELECT * FROM passkeys WHERE id = ?').bind(response.id).first<PasskeyRow>();
  if (!cred) return { error: 'This device is not set up for Face ID sign-in. Sign in with your password, then set it up from your account menu.', status: 401 };
  const { rpID, origin } = rp(c);
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: cred.id, publicKey: isoBase64URL.toBuffer(cred.public_key), counter: cred.counter, transports: cred.transports ? JSON.parse(cred.transports) : undefined },
    });
  } catch (e) {
    return { error: `Face ID could not be verified: ${(e as Error).message}`, status: 400 };
  }
  if (!v.verified) return { error: 'Face ID could not be verified', status: 401 };
  // a counter that stops moving forward (when the device keeps one at all) is the sign of a copied key
  const next = v.authenticationInfo.newCounter;
  if (next !== 0 && next <= cred.counter) return { error: 'This device could not be verified. Sign in with your password.', status: 401 };
  const user = await env.DB.prepare('SELECT username, full_name, wg_role, countries, active, passkey_allowed FROM user_roles WHERE username = ?').bind(cred.username).first<UserRow>();
  if (!user || !user.active) return { error: 'Your SLK Ops access is switched off. Ask an administrator.', status: 403 };
  if (!user.passkey_allowed) return { error: 'Face ID sign-in is switched off for your account. Sign in with your password.', status: 403 };
  if (await wgUserActive(env, user.username) === 'no') return { error: 'Your WIREGUARD account is not active. Ask an administrator.', status: 403 };
  await env.DB.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').bind(next, new Date().toISOString(), cred.id).run();
  return { user, device: cred.device_name ?? 'a registered device' };
}

async function signIn(c: Context<AppBindings>, user: UserRow, method: 'passkey' | 'qr', how: string) {
  await openSession(c, { username: user.username, fullName: user.full_name, wgRole: user.wg_role, countries: JSON.parse(user.countries || '[]'), method });
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE user_roles SET last_login_at = ? WHERE username = ?').bind(new Date().toISOString(), user.username),
    c.env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), user.username, 'login', 'auth', user.username, how),
  ]);
}

// ---- before sign-in -------------------------------------------------------------------------------------------

export const passkeyAuth = new Hono<AppBindings>();

passkeyAuth.post('/passkey/options', async (c) => c.json(await authOptions(c)));

passkeyAuth.post('/passkey/verify', async (c) => {
  const b = await c.req.json<{ challengeId?: string; response?: AuthenticationResponseJSON }>().catch(() => ({} as { challengeId?: string; response?: AuthenticationResponseJSON }));
  const r = await verifyAssertion(c, b.challengeId, b.response);
  if ('error' in r) return c.json({ error: r.error }, r.status);
  await signIn(c, r.user, 'passkey', `Signed in with Face ID / fingerprint (${r.device})`);
  return c.json({ username: r.user.username });
});

interface QrRecord { pollHash: string; code: string; status: 'pending' | 'approved' | 'denied' | 'used'; device: string; where: string | null; created: number; username?: string; challengeId?: string }
const qrKey = (id: string) => `qr:${id}`;
async function qrGet(env: Env, id: string) {
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  const raw = await env.KV.get(qrKey(id));
  return raw ? JSON.parse(raw) as QrRecord : null;
}
const qrPut = (env: Env, id: string, r: QrRecord) =>
  env.KV.put(qrKey(id), JSON.stringify(r), { expirationTtl: Math.max(60, QR_S - Math.floor((Date.now() - r.created) / 1000)) });

/** The laptop asks for a QR code. */
passkeyAuth.post('/qr/start', async (c) => {
  const id = randomHex(16);
  const poll = randomHex(32);
  const code = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
  const cf = (c.req.raw as Request & { cf?: { city?: string; country?: string } }).cf;
  const where = [cf?.city, cf?.country].filter(Boolean).join(', ') || null;
  await qrPut(c.env, id, { pollHash: await sha256(poll), code, status: 'pending', device: deviceName(c.req.header('user-agent')), where, created: Date.now() });
  return c.json({ id, poll, code, url: `${rp(c).origin}/qr/${id}`, expiresIn: QR_S });
});

/** The laptop polls; on approval this response carries its session cookie. */
passkeyAuth.get('/qr/:id/status', async (c) => {
  const id = c.req.param('id');
  const r = await qrGet(c.env, id);
  if (!r) return c.json({ status: 'expired' });
  if (await sha256(c.req.header('x-qr-poll') ?? '') !== r.pollHash) return c.json({ error: 'Not this screen' }, 403);
  if (r.status !== 'approved' || !r.username) return c.json({ status: r.status === 'used' ? 'expired' : r.status });
  const user = await c.env.DB.prepare('SELECT username, full_name, wg_role, countries, active, passkey_allowed FROM user_roles WHERE username = ?').bind(r.username).first<UserRow>();
  await c.env.KV.delete(qrKey(id)); // collected once
  if (!user || !user.active) return c.json({ status: 'denied' });
  await signIn(c, user, 'qr', `Signed in on ${r.device} by scanning a QR code, confirmed with Face ID on the phone`);
  return c.json({ status: 'approved', username: user.username });
});

/** The phone reads what it is about to approve. */
passkeyAuth.get('/qr/:id/info', async (c) => {
  const r = await qrGet(c.env, c.req.param('id'));
  if (!r || r.status === 'used') return c.json({ status: 'expired' });
  return c.json({ status: r.status, code: r.code, device: r.device, where: r.where, expiresAt: r.created + QR_S * 1000 });
});

passkeyAuth.post('/qr/:id/options', async (c) => {
  const id = c.req.param('id');
  const r = await qrGet(c.env, id);
  if (!r || r.status !== 'pending') return c.json({ error: 'This QR code has expired. Make a new one on the laptop.' }, 400);
  const o = await authOptions(c);
  await qrPut(c.env, id, { ...r, challengeId: o.challengeId });
  return c.json(o);
});

passkeyAuth.post('/qr/:id/approve', async (c) => {
  const id = c.req.param('id');
  const r = await qrGet(c.env, id);
  if (!r || r.status !== 'pending') return c.json({ error: 'This QR code has expired. Make a new one on the laptop.' }, 400);
  const b = await c.req.json<{ challengeId?: string; response?: AuthenticationResponseJSON }>().catch(() => ({} as { challengeId?: string; response?: AuthenticationResponseJSON }));
  if (!b.challengeId || b.challengeId !== r.challengeId) return c.json({ error: 'Start again from the QR code' }, 400);
  const v = await verifyAssertion(c, b.challengeId, b.response);
  if ('error' in v) return c.json({ error: v.error }, v.status);
  await qrPut(c.env, id, { ...r, status: 'approved', username: v.user.username, challengeId: undefined });
  return c.json({ ok: true, name: v.user.full_name });
});

passkeyAuth.post('/qr/:id/deny', async (c) => {
  const id = c.req.param('id');
  const r = await qrGet(c.env, id);
  if (r && r.status === 'pending') await qrPut(c.env, id, { ...r, status: 'denied' });
  return c.json({ ok: true });
});

// ---- signed in: your own devices ----------------------------------------------------------------------------

export const passkeys = new Hono<AppBindings>();

passkeys.get('/', async (c) => {
  const u = c.get('user');
  const [list, row] = await Promise.all([
    c.env.DB.prepare('SELECT id, device_name, backed_up, created_at, last_used_at FROM passkeys WHERE username = ? ORDER BY created_at').bind(u.username).all(),
    c.env.DB.prepare('SELECT passkey_allowed FROM user_roles WHERE username = ?').bind(u.username).first<{ passkey_allowed: number }>(),
  ]);
  return c.json({ allowed: !!row?.passkey_allowed, devices: list.results });
});

passkeys.post('/register-options', async (c) => {
  const u = c.get('user');
  const row = await c.env.DB.prepare('SELECT passkey_allowed FROM user_roles WHERE username = ?').bind(u.username).first<{ passkey_allowed: number }>();
  if (!row?.passkey_allowed) return c.json({ error: 'Face ID sign-in is switched off for your account. Ask an administrator.' }, 403);
  const existing = await c.env.DB.prepare('SELECT id, transports FROM passkeys WHERE username = ?').bind(u.username).all<{ id: string; transports: string | null }>();
  const { rpID, rpName } = rp(c);
  const options = await generateRegistrationOptions({
    rpName, rpID, userName: u.username, userDisplayName: u.fullName, userID: new Uint8Array(new TextEncoder().encode(u.username.toUpperCase())),
    attestationType: 'none',
    excludeCredentials: existing.results.map((x) => ({ id: x.id, transports: x.transports ? JSON.parse(x.transports) : undefined })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  await c.env.KV.put(`pk:reg:${u.username.toLowerCase()}`, options.challenge, { expirationTtl: 300 });
  return c.json(options);
});

passkeys.post('/register', async (c) => {
  const u = c.get('user');
  const b = await c.req.json<{ response?: RegistrationResponseJSON }>().catch(() => ({} as { response?: RegistrationResponseJSON }));
  const challenge = await c.env.KV.get(`pk:reg:${u.username.toLowerCase()}`);
  if (!challenge || !b.response) return c.json({ error: 'The set-up request expired. Try again.' }, 400);
  await c.env.KV.delete(`pk:reg:${u.username.toLowerCase()}`);
  const { rpID, origin } = rp(c);
  let v;
  try {
    v = await verifyRegistrationResponse({ response: b.response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  } catch (e) {
    return c.json({ error: `This device could not be set up: ${(e as Error).message}` }, 400);
  }
  if (!v.verified) return c.json({ error: 'This device could not be set up' }, 400);
  const { credential, credentialBackedUp } = v.registrationInfo;
  const device = deviceName(c.req.header('user-agent'));
  await c.env.DB.prepare('INSERT INTO passkeys (id, username, public_key, counter, transports, device_name, backed_up) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(credential.id, u.username, isoBase64URL.fromBuffer(credential.publicKey), credential.counter, credential.transports ? JSON.stringify(credential.transports) : null, device, credentialBackedUp ? 1 : 0).run();
  await audit(c.env, u.username, 'create', credential.id, `Set up Face ID / fingerprint sign-in on ${device}`);
  return c.json({ ok: true, device });
});

passkeys.delete('/:id', async (c) => {
  const u = c.get('user');
  const r = await c.env.DB.prepare('DELETE FROM passkeys WHERE id = ? AND username = ? RETURNING device_name').bind(c.req.param('id'), u.username).first<{ device_name: string }>();
  if (!r) return c.json({ error: 'Device not found' }, 404);
  await audit(c.env, u.username, 'delete', c.req.param('id'), `Removed Face ID sign-in from ${r.device_name}`);
  return c.json({ ok: true });
});

// ---- Users & Roles: devices per person, the Face ID switch, and the WIREGUARD import -------------------------

export const passkeyAdmin = new Hono<AppBindings>();

passkeyAdmin.get('/passkeys', async (c) => {
  const username = c.req.query('username');
  const { results } = username
    ? await c.env.DB.prepare('SELECT id, username, device_name, backed_up, created_at, last_used_at FROM passkeys WHERE username = ? ORDER BY created_at').bind(username).all()
    : await c.env.DB.prepare('SELECT username, count(*) AS devices, max(last_used_at) AS last_used_at FROM passkeys GROUP BY username').all();
  return c.json(results);
});

passkeyAdmin.delete('/passkeys/:id', async (c) => {
  const r = await c.env.DB.prepare('DELETE FROM passkeys WHERE id = ? RETURNING username, device_name').bind(c.req.param('id')).first<{ username: string; device_name: string }>();
  if (!r) return c.json({ error: 'Device not found' }, 404);
  await audit(c.env, c.get('user').username, 'delete', c.req.param('id'), `Removed ${r.username}'s Face ID sign-in on ${r.device_name}`);
  return c.json({ ok: true });
});

passkeyAdmin.put('/passkey-allowed', async (c) => {
  const b = await c.req.json<{ username?: string; allowed?: boolean }>().catch(() => ({} as { username?: string; allowed?: boolean }));
  if (!b.username || typeof b.allowed !== 'boolean') return c.json({ error: 'username and allowed are required' }, 400);
  const r = await c.env.DB.prepare('UPDATE user_roles SET passkey_allowed = ?, updated_by = ?, updated_at = ? WHERE username = ?')
    .bind(b.allowed ? 1 : 0, c.get('user').username, new Date().toISOString(), b.username).run();
  if (!r.meta.changes) return c.json({ error: 'User not found' }, 404);
  await audit(c.env, c.get('user').username, 'edit', b.username, `${b.allowed ? 'Allowed' : 'Switched off'} Face ID sign-in for ${b.username}`);
  return c.json({ ok: true });
});

passkeyAdmin.post('/wg-import', async (c) => c.json(await importWgUsers(c.env, c.get('user').username)));
