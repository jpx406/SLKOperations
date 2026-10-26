import { describe, expect, it } from 'vitest';
import { deviceName } from '../src/worker/passkeys';
import { isOpenWrite, readAllowed, ruleFor } from '../src/worker/permissions';

const none = {};
const users = { users: { view: true, edit: true, delete: false } };

describe('Face ID / fingerprint sign-in', () => {
  it('lets everyone manage the devices on their own account, and nobody else\'s', () => {
    expect(readAllowed('/api/passkeys', none)).toBe(true);
    expect(isOpenWrite('POST', '/api/passkeys/register-options')).toBe(true);
    expect(isOpenWrite('POST', '/api/passkeys/register')).toBe(true);
    expect(isOpenWrite('DELETE', '/api/passkeys/abc')).toBe(true);
    expect(readAllowed('/api/admin/access/passkeys', none)).toBe(false);
  });
  it('keeps other people\'s devices, the Face ID switch and the WIREGUARD import in Users & Roles', () => {
    expect(readAllowed('/api/admin/access/passkeys', users)).toBe(true);
    expect(ruleFor('DELETE', '/api/admin/access/passkeys/abc')).toMatchObject({ menu: 'users', action: 'edit' });
    expect(ruleFor('PUT', '/api/admin/access/passkey-allowed')).toMatchObject({ menu: 'users', action: 'edit' });
    expect(ruleFor('POST', '/api/admin/access/wg-import')).toMatchObject({ menu: 'users', action: 'edit' });
  });
  it('names the device from the browser', () => {
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0')).toBe('Windows PC · Edge');
    expect(deviceName(undefined)).toBe('device · browser');
  });
});
