-- 6z.51: the Job log · Sequence of Events becomes one form per job (header, the events with run and depth, crew
-- hours and the two signatures), saved with every version kept, from the owner's job log package. The old
-- one-entry-at-a-time events are moved into each job's form as its first version and kept where they were.

CREATE TABLE job_logs (
  id              TEXT PRIMARY KEY,
  job_id          TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  current_version INTEGER NOT NULL DEFAULT 0,
  form            TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(form)),
  created_by      TEXT,
  saved_by        TEXT,
  saved_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_by         TEXT,
  sent_at         TEXT,
  sent_version    INTEGER,
  email_to        TEXT,
  email_cc        TEXT
);

CREATE TABLE job_log_versions (
  id             TEXT PRIMARY KEY,
  log_id         TEXT NOT NULL REFERENCES job_logs(id) ON DELETE CASCADE,
  version        INTEGER NOT NULL,
  form           TEXT NOT NULL CHECK (json_valid(form)),
  change_summary TEXT,
  created_by     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (log_id, version)
);
CREATE INDEX job_log_versions_log ON job_log_versions (log_id, version);

-- each job with old entries gets a form: the header from the job, a row per entry in Riyadh time (UTC+3)
INSERT INTO job_logs (id, job_id, current_version, form, created_by, saved_by)
SELECT lower(hex(randomblob(16))), j.id, 1,
  json_object(
    'ticket', coalesce(j.ticket_no, ''), 'well', coalesce(j.well, ''), 'customer', coalesce(j.location, ''), 'jobType', '',
    'rig', coalesce(j.rig, ''), 'date', coalesce(substr(j.start_date, 1, 10), ''),
    'rows', (SELECT json_group_array(json(r)) FROM (
      SELECT json_object(
        'id', e.client_id, 'date', date(datetime(e.occurred_at, '+3 hours')), 'time', strftime('%H:%M', datetime(e.occurred_at, '+3 hours')),
        'run', coalesce(CAST(e.run_no AS TEXT), ''), 'depth', coalesce(CAST(e.depth_ft AS TEXT), ''), 'desc', e.text, 'remark', '') AS r
      FROM job_log_events e WHERE e.job_id = j.id ORDER BY e.occurred_at, e.created_at)),
    'dayHrs', '', 'nightHrs', '', 'engNames', json_array(), 'engId', '', 'engSig', NULL, 'fmName', '', 'fmId', '', 'fmDate', '', 'fmSig', NULL),
  NULL, NULL
FROM jobs j WHERE EXISTS (SELECT 1 FROM job_log_events e WHERE e.job_id = j.id);

INSERT INTO job_log_versions (id, log_id, version, form, change_summary, created_by)
SELECT lower(hex(randomblob(16))), l.id, 1, l.form, 'Moved from the old sequence of events', 'SLK Operations Hub' FROM job_logs l;
