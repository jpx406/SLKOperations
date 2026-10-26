-- Attendance categories become data (owner request 2026-10-26), managed in Users & Roles → Attendance categories:
-- name, order, who fills (the foreman of their crew, the fill roles for everyone, or each person their own row),
-- one or two approval steps, and whether days on assigned jobs fill in by themselves (and with which code).
-- A new category, Field Supervisors / Engineers: days from their jobs, reviewed by the SDM, approved by the
-- Operations Manager. Operators & Helpers also fill from their jobs now.

CREATE TABLE attendance_sheets (
  key            TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  sort           INTEGER NOT NULL DEFAULT 0,
  fill_scope     TEXT NOT NULL DEFAULT 'any' CHECK (fill_scope IN ('crew','any','self')),
  two_step       INTEGER NOT NULL DEFAULT 0 CHECK (two_step IN (0,1)),
  auto_from_jobs INTEGER NOT NULL DEFAULT 0 CHECK (auto_from_jobs IN (0,1)),
  job_code       TEXT NOT NULL DEFAULT 'JBFS',
  builtin        INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0,1)),
  created_by     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO attendance_sheets (key, label, sort, fill_scope, two_step, auto_from_jobs, job_code, builtin) VALUES
  ('field', 'Operators & Helpers', 1, 'crew', 0, 1, 'JBFS', 1),
  ('field_staff', 'Field Supervisors / Engineers', 2, 'any', 1, 1, 'JBFS', 1),
  ('shop', 'Support Staff (Shop)', 3, 'any', 0, 0, 'JBFS', 1),
  ('management', 'Management', 4, 'self', 0, 0, 'JBFS', 1);

-- the role → category map, without a fixed list of categories
CREATE TABLE attendance_role_sheets_new (
  role       TEXT PRIMARY KEY,
  sheet      TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO attendance_role_sheets_new SELECT role, sheet, updated_by, updated_at FROM attendance_role_sheets;
DROP TABLE attendance_role_sheets;
ALTER TABLE attendance_role_sheets_new RENAME TO attendance_role_sheets;
UPDATE attendance_role_sheets SET sheet = 'field_staff', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE role = 'slickline_supervisor';

-- a person moved by hand to another category (employees.attendance_sheet keeps its old fixed list, so a new column)
ALTER TABLE employees ADD COLUMN attendance_category TEXT;
UPDATE employees SET attendance_category = attendance_sheet WHERE attendance_sheet IS NOT NULL;

-- the first of two approval steps (the second is attendance_approvals)
CREATE TABLE attendance_reviews (
  id          TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month       TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  reviewed_by TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  UNIQUE (employee_id, month)
);
