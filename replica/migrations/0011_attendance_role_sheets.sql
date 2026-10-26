-- Attendance follows Users & Roles (owner request 2026-10-26): the Headcount Roster page is gone, everyone in Users
-- & Roles gets an attendance row, and each SLK Ops role is assigned to one attendance sheet here. A person can still
-- be moved to another sheet (employees.attendance_sheet overrides the role). 'none' keeps a role off attendance,
-- for example Viewer accounts such as the sync account.
CREATE TABLE attendance_role_sheets (
  role       TEXT PRIMARY KEY,
  sheet      TEXT NOT NULL CHECK (sheet IN ('field','shop','management','none')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO attendance_role_sheets (role, sheet) VALUES
  ('foreman', 'field'), ('slickline_supervisor', 'field'), ('slickline_operator', 'field'), ('assistant_operator', 'field'), ('crew', 'field'),
  ('maintenance_supervisor', 'shop'), ('storekeeper', 'shop'), ('explosive_manager', 'shop'), ('explosive_admin', 'shop'),
  ('attendance_admin', 'shop'), ('sales', 'shop'), ('slk_contact', 'shop'),
  ('admin', 'management'), ('operations_manager', 'management'), ('maintenance_manager', 'management'), ('sdm', 'management'),
  ('deputy_sdm', 'management'), ('director', 'management'), ('sqm', 'management'),
  ('viewer', 'none');

-- people linked to an SLK Ops user take their sheet from the role from now on, unless moved by hand later
UPDATE employees SET attendance_sheet = NULL WHERE wg_username IS NOT NULL;
