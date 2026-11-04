-- Owner request 2026-11-04: keep rig ups and tool strings as named samples to pull into a job and reconfigure.
-- Previous jobs' diagrams are offered too (read from job_diagrams): a sample is a saved copy, so later edits to the
-- job it came from don't change it. Per country, like the rest of the job data.

CREATE TABLE diagram_samples (
  id          TEXT PRIMARY KEY,
  country     TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('rigup','toolstring')),
  name        TEXT NOT NULL,
  items       TEXT NOT NULL CHECK (json_valid(items)),
  from_job_id TEXT,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (country, kind, name)
);
CREATE INDEX diagram_samples_kind ON diagram_samples (country, kind);
