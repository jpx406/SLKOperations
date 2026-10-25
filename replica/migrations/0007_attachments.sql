-- Files kept in R2 (bucket slkops-files) with a job or a Knowledge Hub entry. The row holds what the file is, the R2 key
-- and a SHA-256 of its bytes. Removing a file hides it (deleted_at) but keeps the object, like the rest of the app.
CREATE TABLE attachments (
  id           TEXT PRIMARY KEY,
  country      TEXT NOT NULL,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('job','knowledge')),
  entity_id    TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN ('photo','ticket','job_log','jra_form','report','permit','document','other')),
  file_name    TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256       TEXT NOT NULL,
  r2_key       TEXT NOT NULL UNIQUE,
  note         TEXT,
  uploaded_by  TEXT NOT NULL,
  uploaded_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at   TEXT,
  deleted_by   TEXT
);
CREATE INDEX attachments_entity ON attachments (entity_type, entity_id, deleted_at);
