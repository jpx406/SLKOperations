-- Face ID / fingerprint sign-in (WebAuthn passkeys) kept by SLK Ops itself. WIREGUARD stays untouched, and a
-- WIREGUARD passkey is bound to its own site, so it could not be used here anyway. One row per registered device.
CREATE TABLE passkeys (
  id            TEXT PRIMARY KEY,                       -- the credential id (base64url) the device reports
  username      TEXT NOT NULL COLLATE NOCASE,           -- user_roles.username
  public_key    TEXT NOT NULL,                          -- base64url COSE public key
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT CHECK (transports IS NULL OR json_valid(transports)),
  device_name   TEXT,
  backed_up     INTEGER NOT NULL DEFAULT 0,             -- synced passkey (iCloud Keychain, Google Password Manager)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at  TEXT
);
CREATE INDEX passkeys_user ON passkeys (username);

-- Everything WIREGUARD knows about a person, imported from its user list, and the admin's Face ID switch.
ALTER TABLE user_roles ADD COLUMN email TEXT;
ALTER TABLE user_roles ADD COLUMN wg_active INTEGER;
ALTER TABLE user_roles ADD COLUMN wg_country TEXT;
ALTER TABLE user_roles ADD COLUMN wg_field TEXT;
ALTER TABLE user_roles ADD COLUMN wg_synced_at TEXT;
ALTER TABLE user_roles ADD COLUMN passkey_allowed INTEGER NOT NULL DEFAULT 1 CHECK (passkey_allowed IN (0,1));
