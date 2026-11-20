-- 6z.35: Competency users are set in SLK Ops Users & Roles, on the person's main user. The Competency role is
-- separate from the SLK Ops role. can_edit says whether that role may change Competency data, from its role
-- definition when it was set. The other columns are what the Competency employee register needs about the person
-- and are copied into it when Competency opens. employee_id blank means the same as the username.
CREATE TABLE competency_users (
  username     TEXT PRIMARY KEY,
  role         TEXT NOT NULL DEFAULT 'Viewer',
  can_edit     INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0,1)),
  employee_id  TEXT,
  position     TEXT,
  grade        INTEGER CHECK (grade IS NULL OR grade BETWEEN 6 AND 12),
  segment      TEXT NOT NULL DEFAULT 'SLK',
  location     TEXT,
  hire_date    TEXT,
  mentor       TEXT,
  status       TEXT NOT NULL DEFAULT 'Active',
  updated_by   TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
