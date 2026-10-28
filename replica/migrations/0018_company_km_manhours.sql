-- Owner request 2026-10-28: the company that runs a job (NESR or SAPESCO, a list kept in Administration → Companies),
-- the distance to the location (Execution), and two Closure figures worked out by the app that the SDM can
-- override: man-hours (operating hours × people assigned) and travel (distance × 2).

CREATE TABLE companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort        INTEGER NOT NULL DEFAULT 0,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO companies (id, name, sort) VALUES ('co-nesr', 'NESR', 1), ('co-sapesco', 'SAPESCO', 2);

-- The jobs table is at D1's 100-column limit, so these four sit beside it, one row per job
CREATE TABLE job_extras (
  job_id             TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  company            TEXT,
  km_to_location     REAL CHECK (km_to_location IS NULL OR km_to_location >= 0),
  man_hours_override REAL CHECK (man_hours_override IS NULL OR man_hours_override >= 0),
  travel_km_override REAL CHECK (travel_km_override IS NULL OR travel_km_override >= 0)
);
CREATE INDEX job_extras_company ON job_extras (company);
