-- 6z.55: Quick Plan is now Opportunities. Each card records the expected services (a JSON list of job types), the
-- client, field and well, and the expected temperature and pressure. The unit is no longer asked for, the old
-- column stays for cards that had one.

ALTER TABLE quick_plan_cards ADD COLUMN services TEXT;
ALTER TABLE quick_plan_cards ADD COLUMN client TEXT;
ALTER TABLE quick_plan_cards ADD COLUMN field TEXT;
ALTER TABLE quick_plan_cards ADD COLUMN well TEXT;
ALTER TABLE quick_plan_cards ADD COLUMN temperature_f REAL;
ALTER TABLE quick_plan_cards ADD COLUMN pressure_psi REAL;

-- Files can now be kept with an opportunity too. The entity check is part of the table, so the table is rebuilt
-- with the same columns, rows and indexes.
CREATE TABLE attachments_new (
  id           TEXT PRIMARY KEY,
  country      TEXT NOT NULL,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('job','knowledge','opportunity')),
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
  deleted_by   TEXT,
  template_id  TEXT,
  package_item TEXT
);
INSERT INTO attachments_new (id, country, entity_type, entity_id, category, file_name, content_type, size_bytes, sha256, r2_key, note, uploaded_by, uploaded_at, deleted_at, deleted_by, template_id, package_item)
SELECT id, country, entity_type, entity_id, category, file_name, content_type, size_bytes, sha256, r2_key, note, uploaded_by, uploaded_at, deleted_at, deleted_by, template_id, package_item FROM attachments;
DROP TABLE attachments;
ALTER TABLE attachments_new RENAME TO attachments;
CREATE INDEX attachments_entity ON attachments (entity_type, entity_id, deleted_at);
CREATE INDEX attachments_package ON attachments (entity_id, template_id, package_item);
