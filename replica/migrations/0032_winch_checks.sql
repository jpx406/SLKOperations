-- 6z.43: the winch data check on a job's Closure tab is kept with the job, so a refresh or another device picks up
-- where it was. One row per job: the choices on the card as JSON (which attachments are the winch files, how they
-- join, the channels, the line and the job limits, the restrictions, the run services). The files themselves and
-- the printed reports are job attachments.
CREATE TABLE winch_checks (
  job_id     TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  state      TEXT NOT NULL CHECK (json_valid(state)),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
