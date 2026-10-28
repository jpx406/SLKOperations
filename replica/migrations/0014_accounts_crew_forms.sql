-- Owner request 2026-10-28.
--   account_colors   each account (the job's location) gets a light colour when its first job is created, so the
--                    schedule, the job board and the job log can be read by account at a glance.
--   job_crew         a crew member can be replaced or taken off a job from a date. start_date and end_date are
--                    the days the person is on the job (NULL = the job's own start or end). Attendance follows them.
--                    The row is rebuilt without UNIQUE (job_id, crew_role, slot), since a replacement takes the
--                    place of the person who left.
--   jra_templates    become the form templates managed in Administration: a name, the kind (the JRA risk
--                    assessment or a checklist), the job stage it belongs to, the file it was made from, and who
--                    made or changed it.
--   job_forms        a checklist template filled in on a job.
--   role_permissions the four job stages get their own rights (job_design ... job_closure), seeded from each
--                    role's Jobs rights so nothing changes until an admin edits them.

CREATE TABLE account_colors (
  account    TEXT PRIMARY KEY,
  color      TEXT NOT NULL CHECK (color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

PRAGMA defer_foreign_keys = on;

CREATE TABLE job_crew_new (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  crew_role   TEXT NOT NULL CHECK (crew_role IN ('slickline_supervisor','slickline_operator','assistant_operator','helper')),
  slot        INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 12),
  start_date  TEXT CHECK (start_date IS NULL OR date(start_date) IS NOT NULL),
  end_date    TEXT CHECK (end_date IS NULL OR date(end_date) IS NOT NULL),
  replaces_id TEXT,
  change_note TEXT,
  changed_by  TEXT,
  changed_at  TEXT,
  UNIQUE (job_id, employee_id)
);
INSERT INTO job_crew_new (id, job_id, employee_id, crew_role, slot) SELECT id, job_id, employee_id, crew_role, slot FROM job_crew;
DROP TABLE job_crew;
ALTER TABLE job_crew_new RENAME TO job_crew;
CREATE INDEX job_crew_emp ON job_crew (employee_id);
CREATE INDEX job_crew_job ON job_crew (job_id);

ALTER TABLE jra_templates ADD COLUMN name TEXT;
ALTER TABLE jra_templates ADD COLUMN kind TEXT NOT NULL DEFAULT 'jra' CHECK (kind IN ('jra','checklist'));
ALTER TABLE jra_templates ADD COLUMN stage TEXT NOT NULL DEFAULT 'preparation' CHECK (stage IN ('design','preparation','execution','closure'));
ALTER TABLE jra_templates ADD COLUMN source_file TEXT;
ALTER TABLE jra_templates ADD COLUMN created_by TEXT;
ALTER TABLE jra_templates ADD COLUMN updated_by TEXT;
ALTER TABLE jra_templates ADD COLUMN updated_at TEXT;
UPDATE jra_templates SET name = 'Job Risk Assessment' WHERE name IS NULL;

CREATE TABLE job_forms (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  template_id  TEXT NOT NULL REFERENCES jra_templates(id) ON DELETE RESTRICT,
  answers      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(answers)),
  remarks      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(remarks)),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed')),
  completed_by TEXT,
  completed_at TEXT,
  updated_by   TEXT,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (job_id, template_id)
);
CREATE INDEX job_forms_template ON job_forms (template_id);

INSERT OR IGNORE INTO role_permissions (id, role, menu_key, can_view, can_edit, can_delete)
  SELECT lower(hex(randomblob(16))), p.role, s.value, p.can_view, p.can_edit, 0
  FROM role_permissions p, json_each('["job_design","job_preparation","job_execution","job_closure"]') s
  WHERE p.menu_key = 'jobs';
