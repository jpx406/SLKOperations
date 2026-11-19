-- 6z.34: storage for the Competency module (the NESR Competency Framework System, converted to slickline).
-- The module saves through a key/value contract: shared keys (the team dataset, its audit log, backups, the roster)
-- and personal keys (theme, notifications read), which belong to one person. owner is '' for shared keys and the
-- username for personal ones. Values up to about 256 KB stay in the row, larger ones (the dataset itself, backups)
-- go to the R2 bucket under competency/ and the row keeps where.
CREATE TABLE competency_kv (
  key         TEXT NOT NULL,
  owner       TEXT NOT NULL DEFAULT '',
  value       TEXT,
  r2_key      TEXT,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  updated_by  TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (key, owner),
  CHECK ((value IS NULL) <> (r2_key IS NULL))
);
