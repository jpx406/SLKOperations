import type { AuthedUser, Env } from './env';
import { logRow } from './lib';
import { WgError, wgLogin } from './wg';

/**
 * Checks the admin's own WIREGUARD password before a delete that can't be undone. A sign-in check only: nothing in
 * WIREGUARD changes. Returns null when the password is right, else the error and status to send back. A wrong
 * password is audited against the record the admin tried to delete.
 */
export async function confirmOwnPassword(env: Env, me: AuthedUser, password: unknown, target: { entity: string; id: string }):
  Promise<{ error: string; status: 400 | 403 | 503 } | null> {
  if (typeof password !== 'string' || !password) return { error: 'Type your password to confirm', status: 400 };
  try {
    const ok = await wgLogin(env, me.username, password);
    if (ok.user.username.toLowerCase() !== me.username.toLowerCase()) throw new WgError(401, 'Wrong password');
    return null;
  } catch (e) {
    if (e instanceof WgError && e.status >= 500) return { error: 'WIREGUARD could not be reached to check your password. Try again later.', status: 503 };
    await logRow(env, me.username, 'delete_refused', target.entity, target.id, `Delete of ${target.id} refused: wrong admin password`).run();
    return { error: 'That password is not right', status: 403 };
  }
}
