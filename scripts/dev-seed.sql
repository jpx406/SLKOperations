-- Local development data only (fake people and equipment). Never run against the remote database.
-- npx wrangler d1 execute slkops-db --local --file scripts/dev-seed.sql
-- Real PCE and grease panels are entered in Database (2f), real people in Attendance (2j).

INSERT OR IGNORE INTO pce (id, country, label, kind, bore_in, rating_psi, length_ft, last_pressure_test_on) VALUES
  ('dev-pce-1', 'Saudi Arabia', 'PCE-5K-01', 'pce_set', 2.5, 5000, 24, '2026-09-30'),
  ('dev-pce-2', 'Saudi Arabia', 'PCE-10K-02', 'pce_set', 3.0, 10000, 32, '2026-10-05'),
  ('dev-pce-3', 'Saudi Arabia', 'PCE-15K-03', 'pce_set', 2.56, 15000, 16, '2026-08-12');

INSERT OR IGNORE INTO grease_panels (id, country, label, panel_type) VALUES
  ('dev-gp-1', 'Saudi Arabia', 'GP-AIR-01', 'Air'),
  ('dev-gp-2', 'Saudi Arabia', 'GP-INT-02', 'Intensifier');

INSERT OR IGNORE INTO employees (id, country, eid, full_name, title, crew_role) VALUES
  ('dev-emp-1', 'Saudi Arabia', 'E90101', 'Sample Supervisor One', 'Slickline Supervisor', 'slickline_supervisor'),
  ('dev-emp-2', 'Saudi Arabia', 'E90102', 'Sample Supervisor Two', 'Slickline Supervisor', 'slickline_supervisor'),
  ('dev-emp-3', 'Saudi Arabia', 'E90103', 'Sample Operator One', 'Slickline Operator', 'slickline_operator'),
  ('dev-emp-4', 'Saudi Arabia', 'E90104', 'Sample Operator Two', 'Slickline Operator', 'slickline_operator'),
  ('dev-emp-5', 'Saudi Arabia', 'E90105', 'Sample Assistant One', 'Assistant Operator', 'assistant_operator'),
  ('dev-emp-6', 'Saudi Arabia', 'E90106', 'Sample Helper One', 'Helper', 'helper'),
  ('dev-emp-7', 'Bahrain', 'E90201', 'Sample Operator Bahrain', 'Slickline Operator', 'slickline_operator');
