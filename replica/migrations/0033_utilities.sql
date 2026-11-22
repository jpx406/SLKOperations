-- 6z.47: Utilities, the Rig Up Diagram, the Tool String Diagram and the Winch Report used on their own, without a
-- job. Each piece of work is a project: its kind, a name, and its data as JSON (the typed job details, the diagram
-- rows, or the winch check). Projects can be saved, opened, duplicated and deleted. A project's files (winch
-- recordings and the reports made from them) are kept in R2 and listed in utility_files. A duplicate points at the
-- same stored files, so deleting a project removes its rows only and leaves the stored files.
CREATE TABLE utility_projects (
  id         TEXT PRIMARY KEY,
  country    TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('rigup','toolstring','winch')),
  name       TEXT NOT NULL,
  data       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX utility_projects_kind ON utility_projects (kind, country, updated_at);

CREATE TABLE utility_files (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES utility_projects(id) ON DELETE CASCADE,
  category     TEXT NOT NULL DEFAULT 'document',
  file_name    TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL CHECK (size_bytes > 0),
  r2_key       TEXT NOT NULL,
  note         TEXT,
  uploaded_by  TEXT NOT NULL,
  uploaded_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX utility_files_project ON utility_files (project_id, uploaded_at);

-- the right is utilities: each role starts with the rights it has on Jobs (admins have every right already)
INSERT INTO role_permissions (id, role, menu_key, can_view, can_edit, can_delete)
SELECT lower(hex(randomblob(16))), role, 'utilities', can_view, can_edit, can_delete FROM role_permissions
WHERE menu_key = 'jobs' AND role <> 'admin'
  AND role NOT IN (SELECT role FROM role_permissions WHERE menu_key = 'utilities');
