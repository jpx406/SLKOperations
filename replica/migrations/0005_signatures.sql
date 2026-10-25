-- Digital sign-off on approval: who approved, when, in which role, a fingerprint of what was approved,
-- and an HMAC seal made with the server's SIGNING_KEY. A reopened approval withdraws its signature, rows are never deleted.
CREATE TABLE signatures (
  id           TEXT PRIMARY KEY,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('jra','bonus','attendance')),
  entity_id    TEXT NOT NULL,
  username     TEXT NOT NULL,
  full_name    TEXT NOT NULL,
  role         TEXT NOT NULL,
  signed_at    TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  seal         TEXT,
  revoked_at   TEXT,
  revoked_by   TEXT,
  revoke_reason TEXT
);
CREATE INDEX signatures_entity ON signatures (entity_type, entity_id, signed_at);
