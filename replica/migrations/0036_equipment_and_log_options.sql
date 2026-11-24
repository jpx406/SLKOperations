-- 6z.53: an equipment list in Assets Inventory with types people can add (memory gauges, pick ups and anything
-- else kept by serial number), and the job log's own pick lists: the work description wording, tubing sizes,
-- location conditions and the other header values a job may not have. Removing an entry switches it off.

CREATE TABLE equipment_types (
  id      TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  name    TEXT NOT NULL,
  -- what the job log reads it for: memory_gauge, pickup, or nothing
  role    TEXT,
  sort    INTEGER NOT NULL DEFAULT 0,
  active  INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE (country, name)
);

CREATE TABLE equipment (
  id          TEXT PRIMARY KEY,
  country     TEXT NOT NULL,
  type_id     TEXT NOT NULL REFERENCES equipment_types(id) ON DELETE RESTRICT,
  serial_no   TEXT NOT NULL,
  description TEXT,
  notes       TEXT,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (country, type_id, serial_no)
);
CREATE INDEX equipment_by_type ON equipment (country, type_id, active);

CREATE TABLE job_log_options (
  id      TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  kind    TEXT NOT NULL,
  grp     TEXT NOT NULL DEFAULT '',
  value   TEXT NOT NULL,
  sort    INTEGER NOT NULL DEFAULT 0,
  active  INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE (country, kind, grp, value)
);
CREATE INDEX job_log_options_kind ON job_log_options (country, kind, active, sort);
