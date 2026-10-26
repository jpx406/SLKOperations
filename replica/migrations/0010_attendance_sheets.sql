-- Attendance by role (owner request 2026-10-26). Three sheets, each with who fills and who approves:
--   field       operators and helpers   filled by the Foreman, approved by the SDM
--   shop        support staff           filled by the Maintenance Supervisor, approved by the Maintenance Manager
--   management  management              filled by the person or an Admin, approved by the Operations Manager
-- Two new SLK Ops roles, foreman and maintenance_supervisor. The role list is a CHECK on user_roles, and SQLite
-- can't change a CHECK in place, so the table is rebuilt. tab_grants points at user_roles with ON DELETE CASCADE,
-- so its rows are kept aside first and put back afterwards

ALTER TABLE employees ADD COLUMN attendance_sheet TEXT CHECK (attendance_sheet IS NULL OR attendance_sheet IN ('field','shop','management'));
UPDATE employees SET attendance_sheet = CASE
  WHEN crew_role IN ('slickline_supervisor','slickline_operator','assistant_operator','helper','trainee') THEN 'field'
  ELSE 'shop' END;

PRAGMA defer_foreign_keys = on;

CREATE TABLE tab_grants_keep AS SELECT * FROM tab_grants;

CREATE TABLE user_roles_new (
  username      TEXT PRIMARY KEY COLLATE NOCASE,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN (
                  'admin','operations_manager','maintenance_manager','sdm','deputy_sdm','sales','director','sqm',
                  'slickline_supervisor','slickline_operator','assistant_operator','crew','viewer',
                  'explosive_manager','explosive_admin','storekeeper','attendance_admin','slk_contact',
                  'foreman','maintenance_supervisor')),
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
INSERT INTO user_roles_new (username, full_name, role, countries, wg_role, employee_eid, active, last_login_at, updated_by, created_at, updated_at,
  email, wg_active, wg_country, wg_field, wg_synced_at, passkey_allowed)
SELECT username, full_name, role, countries, wg_role, employee_eid, active, last_login_at, updated_by, created_at, updated_at,
  email, wg_active, wg_country, wg_field, wg_synced_at, passkey_allowed FROM user_roles;

DROP TABLE user_roles;
ALTER TABLE user_roles_new RENAME TO user_roles;

DELETE FROM tab_grants;
INSERT INTO tab_grants SELECT * FROM tab_grants_keep;
DROP TABLE tab_grants_keep;

-- Tabs for the new roles: a Foreman starts from the Slickline Supervisor's tabs, a Maintenance Supervisor from the
-- Storekeeper's, and both can fill attendance. The Admin adjusts either in Users & Roles.
INSERT OR IGNORE INTO role_permissions (id, role, menu_key, can_view, can_edit, can_delete)
SELECT lower(hex(randomblob(16))), 'foreman', menu_key, can_view, can_edit, can_delete FROM role_permissions WHERE role = 'slickline_supervisor';
INSERT OR IGNORE INTO role_permissions (id, role, menu_key, can_view, can_edit, can_delete)
SELECT lower(hex(randomblob(16))), 'maintenance_supervisor', menu_key, can_view, can_edit, can_delete FROM role_permissions WHERE role = 'storekeeper';
INSERT OR IGNORE INTO role_permissions (id, role, menu_key, can_view, can_edit, can_delete) VALUES (lower(hex(randomblob(16))), 'foreman', 'attendance', 1, 1, 0);
INSERT OR IGNORE INTO role_permissions (id, role, menu_key, can_view, can_edit, can_delete) VALUES (lower(hex(randomblob(16))), 'maintenance_supervisor', 'attendance', 1, 1, 0);
UPDATE role_permissions SET can_view = 1, can_edit = 1 WHERE menu_key = 'attendance' AND role IN ('foreman', 'maintenance_supervisor', 'sdm', 'maintenance_manager', 'operations_manager');
