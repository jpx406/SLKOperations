-- Roles and approval rules become data (owner request 2026-10-26), edited in Users & Roles.
--   roles           the SLK Ops roles: label, whether WIREGUARD's role mapping uses it (those can't be deleted),
--                   and whether it shipped with the app. New roles can be added, renamed and removed.
--   approval_rules  which roles approve or sign each job approval and checklist (JRA levels, closure sign-offs,
--                   bonus, the job's SDM, attendance). A rule not stored here uses the app's default.
-- user_roles loses its fixed CHECK on role (the role list is the roles table now). The table is rebuilt as in
-- 0010, with tab_grants kept aside and put back.

CREATE TABLE roles (
  key            TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  description    TEXT,
  from_wireguard INTEGER NOT NULL DEFAULT 0 CHECK (from_wireguard IN (0,1)),
  builtin        INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0,1)),
  created_by     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO roles (key, label, from_wireguard, builtin) VALUES
  ('admin', 'Admin', 1, 1), ('operations_manager', 'Ops Manager', 0, 1), ('maintenance_manager', 'Maintenance Mgr', 1, 1),
  ('sdm', 'SDM', 0, 1), ('deputy_sdm', 'Deputy SDM', 0, 1), ('sales', 'Sales', 0, 1), ('director', 'Director', 0, 1), ('sqm', 'SQM', 0, 1),
  ('slickline_supervisor', 'SLK Supervisor', 1, 1), ('slickline_operator', 'SLK Operator', 0, 1), ('assistant_operator', 'Asst. Operator', 0, 1),
  ('crew', 'Crew', 0, 1), ('viewer', 'Viewer', 1, 1), ('explosive_manager', 'Explosive Mgr', 0, 1), ('explosive_admin', 'Explosive Admin', 0, 1),
  ('storekeeper', 'Storekeeper', 0, 1), ('attendance_admin', 'Attendance Admin', 0, 1), ('slk_contact', 'SLK Contact', 0, 1),
  ('foreman', 'Foreman', 0, 1), ('maintenance_supervisor', 'Maint. Supervisor', 0, 1);

CREATE TABLE approval_rules (
  key        TEXT PRIMARY KEY,
  roles      TEXT NOT NULL CHECK (json_valid(roles)),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

PRAGMA defer_foreign_keys = on;

CREATE TABLE tab_grants_keep AS SELECT * FROM tab_grants;

CREATE TABLE user_roles_new (
  username      TEXT PRIMARY KEY COLLATE NOCASE,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer',
  countries     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(countries)),
  wg_role       TEXT,
  employee_eid  TEXT,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  last_login_at TEXT,
  updated_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  email         TEXT,
  wg_active     INTEGER,
  wg_country    TEXT,
  wg_field      TEXT,
  wg_synced_at  TEXT,
  passkey_allowed INTEGER NOT NULL DEFAULT 1 CHECK (passkey_allowed IN (0,1))
);
INSERT INTO user_roles_new SELECT username, full_name, role, countries, wg_role, employee_eid, active, last_login_at, updated_by, created_at, updated_at,
  email, wg_active, wg_country, wg_field, wg_synced_at, passkey_allowed FROM user_roles;

DROP TABLE user_roles;
ALTER TABLE user_roles_new RENAME TO user_roles;

DELETE FROM tab_grants;
INSERT INTO tab_grants SELECT * FROM tab_grants_keep;
DROP TABLE tab_grants_keep;
