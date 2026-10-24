-- SLK Operations D1 migration 0001 - initial schema
-- Cloudflare D1 (SQLite). Apply: npx wrangler d1 execute slkops-db --remote --file=migrations/0001_init.sql
-- Rules learnt from WIREGUARD: no semicolons inside comments, no window functions, no long UNION ALL,
-- ids are TEXT (crypto.randomUUID), times are ISO-8601 UTC TEXT, booleans are INTEGER 0 or 1.
-- Authorisation is enforced in the Worker (WRITE_RULES + role_permissions), D1 has no row level security.
-- WIREGUARD data arrives in the wg_* mirror tables and is referenced by natural keys, never written back.

PRAGMA foreign_keys = ON;

-- ===========================================================================
-- Identity and permissions (accounts live in WIREGUARD, roles live here)
-- ===========================================================================

CREATE TABLE user_roles (
  username      TEXT PRIMARY KEY COLLATE NOCASE,          -- WIREGUARD username, NESR- plus digits
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN (
                  'admin','operations_manager','maintenance_manager','sdm','deputy_sdm','sales','director','sqm',
                  'slickline_supervisor','slickline_operator','assistant_operator','crew','viewer',
                  'explosive_manager','explosive_admin','storekeeper','attendance_admin','slk_contact')),
  countries     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(countries)),   -- copied from WIREGUARD /auth/me at sign-in
  wg_role       TEXT,                                     -- last seen WIREGUARD role, for the default mapping
  employee_eid  TEXT,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  last_login_at TEXT,
  updated_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Same pattern as WIREGUARD: role x menu key x view/edit/delete. Admin always passes.
CREATE TABLE role_permissions (
  id         TEXT PRIMARY KEY,
  role       TEXT NOT NULL,
  menu_key   TEXT NOT NULL,
  can_view   INTEGER NOT NULL DEFAULT 1 CHECK (can_view IN (0,1)),
  can_edit   INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0,1)),
  can_delete INTEGER NOT NULL DEFAULT 0 CHECK (can_delete IN (0,1)),
  UNIQUE (role, menu_key)
);

-- Per-user extras on top of the role
CREATE TABLE tab_grants (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL REFERENCES user_roles(username) ON DELETE CASCADE,
  menu_key   TEXT NOT NULL,
  can_edit   INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0,1)),
  granted_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (username, menu_key)
);

-- ===========================================================================
-- WIREGUARD mirror (read-only copies, refreshed by the sync job)
-- ===========================================================================

CREATE TABLE wg_units (
  unit_number  TEXT PRIMARY KEY,                          -- SL-30, MSL-032, TRPY-01
  country      TEXT NOT NULL,
  year         INTEGER,
  wg_active    INTEGER NOT NULL DEFAULT 1,
  wg_synced_at TEXT NOT NULL
);

CREATE TABLE wg_job_types (
  name TEXT NOT NULL, country TEXT NOT NULL, wg_active INTEGER NOT NULL DEFAULT 1, wg_synced_at TEXT NOT NULL,
  PRIMARY KEY (name, country)
);
CREATE TABLE wg_job_locations (
  name TEXT NOT NULL, country TEXT NOT NULL, wg_active INTEGER NOT NULL DEFAULT 1, wg_synced_at TEXT NOT NULL,
  PRIMARY KEY (name, country)
);
CREATE TABLE wg_fields (
  name TEXT NOT NULL, country TEXT NOT NULL, wg_active INTEGER NOT NULL DEFAULT 1, wg_synced_at TEXT NOT NULL,
  PRIMARY KEY (name, country)
);
CREATE TABLE wg_rigs (
  name TEXT NOT NULL, country TEXT NOT NULL, wg_active INTEGER NOT NULL DEFAULT 1, wg_synced_at TEXT NOT NULL,
  PRIMARY KEY (name, country)
);

CREATE TABLE wg_drums (
  drum_no        TEXT PRIMARY KEY,
  drum_position  TEXT,                                    -- Upper Drum or Lower Drum
  unit_number    TEXT,                                    -- slicklineUnit
  country        TEXT,
  field          TEXT,
  wg_active      INTEGER NOT NULL DEFAULT 1,
  wg_synced_at   TEXT NOT NULL
);
CREATE INDEX wg_drums_unit ON wg_drums (unit_number);

CREATE TABLE wg_wires (
  wire_serial_number  TEXT PRIMARY KEY,
  wire_grade          TEXT,                               -- e.g. D58 Super Duplex
  wire_size           TEXT,                               -- e.g. 0.125
  manufacturer        TEXT,
  drum_no             TEXT,
  spooled_length_ft   REAL,
  remaining_length_ft REAL,
  status              TEXT,                               -- Active, Inactive, Retired
  rated_mbl_lb        REAL,
  country             TEXT,
  raw                 TEXT CHECK (raw IS NULL OR json_valid(raw)),   -- full upstream row, so nothing is lost
  wg_active           INTEGER NOT NULL DEFAULT 1,
  wg_synced_at        TEXT NOT NULL
);
CREATE INDEX wg_wires_drum ON wg_wires (drum_no);

-- Job-log runs from WIREGUARD (one row per run)
CREATE TABLE wg_runs (
  wg_id               TEXT PRIMARY KEY,
  job_date            TEXT NOT NULL,
  drss_number         TEXT,
  field_ticket        TEXT,
  run_number          INTEGER,
  wire_serial_number  TEXT,
  drum_no             TEXT,
  country             TEXT,
  job_name            TEXT,                               -- WIREGUARD job type
  location            TEXT,
  rig                 TEXT,
  field_name          TEXT,
  well                TEXT,
  well_type           TEXT,
  max_depth_ft        REAL,
  max_tension_lb      REAL,
  jarring_minutes     REAL,
  jarring_impact_count INTEGER,
  wire_cut_ft         REAL,
  hours_working       REAL,
  remaining_length_ft REAL,
  h2s_percent         REAL,
  co2_percent         REAL,
  supervisor_name     TEXT,
  approved_at         TEXT,
  entered_at          TEXT,                               -- input date, for the entry-lag KPI
  approval_status     TEXT COLLATE NOCASE,               -- imported history uses Approved, the app writes approved
  is_cut_only         INTEGER NOT NULL DEFAULT 0,         -- Maintenance Wire cut or SPOOL-AD rows, never a run
  raw                 TEXT CHECK (raw IS NULL OR json_valid(raw)),
  wg_active           INTEGER NOT NULL DEFAULT 1,
  wg_synced_at        TEXT NOT NULL
);
CREATE INDEX wg_runs_ticket ON wg_runs (field_ticket);
CREATE INDEX wg_runs_drss ON wg_runs (drss_number);
CREATE INDEX wg_runs_date ON wg_runs (job_date);
CREATE INDEX wg_runs_wire ON wg_runs (wire_serial_number, job_date);
CREATE INDEX wg_runs_drum ON wg_runs (drum_no, job_date);

-- Maintenance entries and wire tests (wrap, torsion, tension, drum MPI)
CREATE TABLE wg_documents (
  wg_id              TEXT PRIMARY KEY,
  doc_type           TEXT,
  wire_serial_number TEXT,
  drum_no            TEXT,
  test_type          TEXT,
  result             TEXT,
  test_date          TEXT,
  expiry_date        TEXT,
  approval_status    TEXT COLLATE NOCASE,
  raw                TEXT CHECK (raw IS NULL OR json_valid(raw)),
  wg_synced_at       TEXT NOT NULL
);
CREATE INDEX wg_documents_wire ON wg_documents (wire_serial_number, test_date);

-- Wire alerts. WIREGUARD's endpoint has no country filter, so country is resolved here from the wire or drum.
CREATE TABLE wg_notifications (
  wg_id              TEXT PRIMARY KEY,
  occurred_at        TEXT NOT NULL,
  severity           TEXT,                                -- server rows use severity, client-raised ones sev, normalised by the sync
  code               TEXT,
  message            TEXT,
  wire_serial_number TEXT,
  drum_no            TEXT,
  country            TEXT,                                -- NULL means admins only, as in WIREGUARD
  is_read            INTEGER NOT NULL DEFAULT 0,
  wg_synced_at       TEXT NOT NULL
);
CREATE INDEX wg_notifications_wire ON wg_notifications (wire_serial_number, occurred_at);
CREATE INDEX wg_notifications_country ON wg_notifications (country, occurred_at);

-- WIREGUARD parameters used by the ported KPIs: kpi-settings, sop-settings, sop-wire-size-thresholds,
-- wire-alloy-database, wire-retirement-reasons, and the app build stamp (key 'build_stamp').
CREATE TABLE wg_settings (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL CHECK (json_valid(value)),
  wg_synced_at TEXT NOT NULL
);

-- Records which WIREGUARD build the KPI port was last proven against.
CREATE TABLE kpi_parity_runs (
  id           TEXT PRIMARY KEY,
  wg_build     TEXT NOT NULL,
  kpis_checked INTEGER NOT NULL,
  kpis_failed  INTEGER NOT NULL,
  report       TEXT CHECK (report IS NULL OR json_valid(report)),
  run_at       TEXT NOT NULL
);

CREATE TABLE wg_sync_log (
  id          TEXT PRIMARY KEY,
  resource    TEXT NOT NULL,                               -- units, job-types, jobs ...
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  rows_seen   INTEGER,
  rows_upserted INTEGER,
  rows_deactivated INTEGER,
  error       TEXT
);
CREATE INDEX wg_sync_log_res ON wg_sync_log (resource, started_at);

-- ===========================================================================
-- Local configuration
-- ===========================================================================

CREATE TABLE service_domains (
  name TEXT PRIMARY KEY,                                   -- Well Access and Clean-out, Flow Control ...
  sort INTEGER NOT NULL DEFAULT 0
);

-- SLK Ops behaviour for each WIREGUARD job type (the service catalogue itself is WIREGUARD's)
CREATE TABLE service_profiles (
  job_type_name    TEXT PRIMARY KEY,
  domain           TEXT REFERENCES service_domains(name) ON UPDATE CASCADE ON DELETE SET NULL,
  is_plug          INTEGER NOT NULL DEFAULT 0 CHECK (is_plug IN (0,1)),
  is_fishing       INTEGER NOT NULL DEFAULT 0 CHECK (is_fishing IN (0,1)),
  is_memory        INTEGER NOT NULL DEFAULT 0 CHECK (is_memory IN (0,1)),
  is_perforation   INTEGER NOT NULL DEFAULT 0 CHECK (is_perforation IN (0,1)),
  is_explosive     INTEGER NOT NULL DEFAULT 0 CHECK (is_explosive IN (0,1)),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Lists WIREGUARD does not hold
CREATE TABLE lookup_values (
  id      TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN (
            'conveyance','well_type','casing_type','casing_od','casing_grade','fluid_type','plug_type','lock_type',
            'nipple_profile','jar_type','rope_socket_type','pressure_rating','lubricator_size','stuffing_box_type',
            'grease_panel_type','failure_category','sdm_other')),
  value   TEXT NOT NULL,
  sort    INTEGER NOT NULL DEFAULT 0,
  active  INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE (country, kind, value)
);
CREATE INDEX lookup_values_kind ON lookup_values (country, kind, active, sort);

CREATE TABLE pce (
  id                    TEXT PRIMARY KEY,
  country               TEXT NOT NULL,
  label                 TEXT NOT NULL,
  kind                  TEXT NOT NULL DEFAULT 'lubricator' CHECK (kind IN ('lubricator','wireline_valve_bop','stuffing_box','grease_injection_head','tool_trap','tool_catcher','pump_in_sub','pce_set')),
  bore_in               REAL NOT NULL CHECK (bore_in > 0),
  rating_psi            INTEGER CHECK (rating_psi IN (5000,10000,15000)),
  length_ft             REAL,
  last_pressure_test_on TEXT,
  is_rental             INTEGER NOT NULL DEFAULT 0 CHECK (is_rental IN (0,1)),
  active                INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE (country, label)
);

CREATE TABLE grease_panels (
  id         TEXT PRIMARY KEY,
  country    TEXT NOT NULL,
  label      TEXT NOT NULL,
  panel_type TEXT,                                        -- braided line only
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE (country, label)
);

-- Unit maintenance and status blocks (S37, S38). Overlap is refused by the trigger below.
CREATE TABLE unit_events (
  id          TEXT PRIMARY KEY,
  country     TEXT NOT NULL,
  unit_number TEXT NOT NULL,                              -- wg_units.unit_number
  kind        TEXT NOT NULL CHECK (kind IN ('maintenance','loan','transferred','junk','backup_on_location')),
  starts_on   TEXT NOT NULL CHECK (date(starts_on) IS NOT NULL),
  ends_on     TEXT NOT NULL CHECK (date(ends_on) IS NOT NULL),
  note        TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX unit_events_unit ON unit_events (unit_number, starts_on, ends_on);

CREATE TRIGGER unit_events_no_overlap_ins BEFORE INSERT ON unit_events
WHEN EXISTS (SELECT 1 FROM unit_events e WHERE e.unit_number = NEW.unit_number AND e.starts_on <= NEW.ends_on AND e.ends_on >= NEW.starts_on)
BEGIN SELECT RAISE(ABORT, 'unit_events overlap'); END;
CREATE TRIGGER unit_events_no_overlap_upd BEFORE UPDATE OF unit_number, starts_on, ends_on ON unit_events
WHEN EXISTS (SELECT 1 FROM unit_events e WHERE e.id <> NEW.id AND e.unit_number = NEW.unit_number AND e.starts_on <= NEW.ends_on AND e.ends_on >= NEW.starts_on)
BEGIN SELECT RAISE(ABORT, 'unit_events overlap'); END;

-- ===========================================================================
-- Jobs (S02-S08)
-- ===========================================================================

CREATE TABLE jobs (
  id            TEXT PRIMARY KEY,
  country       TEXT NOT NULL,
  -- 01 Design
  ticket_no     TEXT,                                     -- field ticket, the reconciliation key with WIREGUARD
  drss_no       TEXT,
  dmr_no        TEXT,
  sdm_username  TEXT,
  sdm_other     TEXT,
  program_in_place INTEGER CHECK (program_in_place IN (0,1)),
  status        TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','ongoing','completed','canceled')),
  run_details   TEXT,
  unit_number   TEXT,                                     -- wg_units
  start_date    TEXT CHECK (start_date IS NULL OR date(start_date) IS NOT NULL),
  end_date      TEXT CHECK (end_date IS NULL OR date(end_date) IS NOT NULL),
  location      TEXT,                                     -- wg_job_locations (account): D&WO, SAWCOD ...
  field         TEXT,                                     -- wg_fields
  rig           TEXT,                                     -- wg_rigs
  well          TEXT,
  conveyance    TEXT,
  third_party_required TEXT CHECK (third_party_required IN ('yes','no','na','other')),
  -- 02 Preparation
  account_assignment TEXT,
  well_type     TEXT,
  h2s_ppm REAL, co2_pct REAL, bht_f REAL, bhp_psi REAL, siwhp_psi REAL,
  fluid_type TEXT, fluid_weight_pcf REAL, solids_pct REAL,
  target_depth_ft REAL, top_interval_ft REAL,
  completion_details TEXT, nipple_profile TEXT, sssv_depth_ft REAL,
  min_restriction_in REAL,
  max_inclination_deg REAL CHECK (max_inclination_deg IS NULL OR max_inclination_deg BETWEEN 0 AND 180),
  target_casing_type TEXT, target_casing_od TEXT, target_casing_weight_lbft REAL, target_casing_grade TEXT,
  wellhead_connection TEXT,
  wire_serial_number TEXT,                                -- wg_wires, planned wire
  drum_no            TEXT,                                -- wg_drums
  pce_id        TEXT REFERENCES pce(id) ON DELETE SET NULL,
  pressure_rating_psi INTEGER,
  lubricator_length_ft REAL,
  stuffing_box_type TEXT,
  grease_panel_id TEXT REFERENCES grease_panels(id) ON DELETE SET NULL,
  max_tool_od_in REAL,
  toolstring    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(toolstring)),
  toolstring_length_ft REAL,
  stem_weight_lb REAL,
  jar_type      TEXT,
  special_setup TEXT CHECK (special_setup IN ('yes','no','na','other')),
  special_setup_notes TEXT,
  perforation_details TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(perforation_details)),
  fishing_details     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(fishing_details)),
  -- 03 Execution
  runs_ok       INTEGER CHECK (runs_ok IS NULL OR runs_ok >= 0),
  runs_failed   INTEGER CHECK (runs_failed IS NULL OR runs_failed >= 0),
  plug_type     TEXT,
  max_depth_ft  REAL,
  tag_depth_ft  REAL,
  max_pull_lb   REAL,
  max_overpull_lb REAL,
  jarring_minutes REAL,
  wire_cut_ft   REAL,
  survey_details TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(survey_details)),
  arrived_at    TEXT,
  rig_up_at     TEXT,
  rig_down_at   TEXT,
  op_hours_auto REAL GENERATED ALWAYS AS (
                  CASE WHEN rig_up_at IS NOT NULL AND rig_down_at IS NOT NULL
                       THEN round((julianday(rig_down_at) - julianday(rig_up_at)) * 24, 2) END) VIRTUAL,
  op_hours_override REAL CHECK (op_hours_override IS NULL OR op_hours_override >= 0),
  op_time_details TEXT,
  npt_hours     REAL NOT NULL DEFAULT 0 CHECK (npt_hours >= 0),
  failure       TEXT CHECK (failure IN ('yes','no','na','other')),
  -- 04 Closure
  job_log_signed TEXT, ticket_signed TEXT, eight_min_facts_done TEXT, prelim_report TEXT, final_report TEXT,
  job_package_url TEXT,
  report_closure_status TEXT CHECK (report_closure_status IN ('open','pending_review','closed','na')),
  report_closure_date TEXT,
  gears_no      TEXT,
  wellsite_audit TEXT, wg_runs_logged TEXT, service_order TEXT,
  failure_description TEXT,
  bonus_remarks TEXT,
  -- housekeeping
  created_by    TEXT,
  updated_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at    TEXT,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CHECK (rig_down_at IS NULL OR rig_up_at IS NULL OR julianday(rig_down_at) > julianday(rig_up_at)),
  CHECK ((coalesce(failure, '') = 'yes' OR npt_hours > 0) OR (failure_description IS NULL AND gears_no IS NULL AND report_closure_date IS NULL))
);
CREATE UNIQUE INDEX jobs_ticket_unique ON jobs (country, ticket_no) WHERE ticket_no IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX jobs_status ON jobs (country, status) WHERE deleted_at IS NULL;
CREATE INDEX jobs_start ON jobs (country, start_date) WHERE deleted_at IS NULL;
CREATE INDEX jobs_unit ON jobs (unit_number, start_date, end_date) WHERE deleted_at IS NULL;
CREATE INDEX jobs_sdm ON jobs (sdm_username);
CREATE INDEX jobs_drss ON jobs (drss_no);
CREATE INDEX jobs_wire ON jobs (wire_serial_number);
CREATE INDEX jobs_pce ON jobs (pce_id);
CREATE INDEX jobs_grease ON jobs (grease_panel_id);

CREATE VIEW job_metrics AS
SELECT j.id AS job_id,
  coalesce(j.op_hours_override, j.op_hours_auto) AS op_hours,
  j.npt_hours,
  CASE WHEN coalesce(j.op_hours_override, j.op_hours_auto) > 0
       THEN max(0, round((1 - j.npt_hours / coalesce(j.op_hours_override, j.op_hours_auto)) * 100, 1)) END AS job_efficiency_pct,
  coalesce(j.runs_ok,0) + coalesce(j.runs_failed,0) AS runs_total,
  CASE WHEN coalesce(j.runs_ok,0) + coalesce(j.runs_failed,0) > 0
       THEN round(j.runs_ok * 100.0 / (j.runs_ok + j.runs_failed), 1) END AS run_efficiency_pct
FROM jobs j WHERE j.deleted_at IS NULL;

CREATE TABLE job_services (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL CHECK (position BETWEEN 1 AND 15),
  job_type_name TEXT NOT NULL,                            -- WIREGUARD job type
  UNIQUE (job_id, position)
);
CREATE INDEX job_services_type ON job_services (job_type_name);

CREATE TABLE job_headcount (
  job_id              TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  supervisors         INTEGER NOT NULL DEFAULT 0 CHECK (supervisors BETWEEN 0 AND 3),
  operators           INTEGER NOT NULL DEFAULT 0 CHECK (operators BETWEEN 0 AND 6),
  assistant_operators INTEGER NOT NULL DEFAULT 0 CHECK (assistant_operators BETWEEN 0 AND 6),
  helpers             INTEGER NOT NULL DEFAULT 0 CHECK (helpers BETWEEN 0 AND 6)
);

CREATE TABLE employees (
  id            TEXT PRIMARY KEY,
  country       TEXT NOT NULL,
  eid           TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  title         TEXT NOT NULL,
  account       TEXT NOT NULL DEFAULT 'SLK',
  crew_role     TEXT CHECK (crew_role IN ('slickline_supervisor','slickline_operator','assistant_operator','helper','trainee','other')),
  reports_to_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  attendance_group TEXT,
  rotation      TEXT NOT NULL DEFAULT '60/30',
  wg_username   TEXT,                                     -- link to the WIREGUARD account when the person has one
  self_updated  INTEGER NOT NULL DEFAULT 0 CHECK (self_updated IN (0,1)),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (country, eid)
);
CREATE INDEX employees_reports ON employees (reports_to_id);
CREATE INDEX employees_active ON employees (country, active);

CREATE TABLE job_crew (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  crew_role   TEXT NOT NULL CHECK (crew_role IN ('slickline_supervisor','slickline_operator','assistant_operator','helper')),
  slot        INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 12),
  UNIQUE (job_id, crew_role, slot),
  UNIQUE (job_id, employee_id)
);
CREATE INDEX job_crew_emp ON job_crew (employee_id);

CREATE TABLE job_third_parties (
  id             TEXT PRIMARY KEY,
  job_id         TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  slot           INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 5),
  vendor         TEXT NOT NULL,
  po_no          TEXT,
  po_value_cents INTEGER CHECK (po_value_cents IS NULL OR po_value_cents >= 0),
  currency       TEXT NOT NULL DEFAULT 'SAR' CHECK (length(currency) = 3),
  UNIQUE (job_id, slot)
);

CREATE TABLE job_log_events (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  client_id   TEXT NOT NULL,                              -- offline replay key
  occurred_at TEXT NOT NULL,
  run_no      INTEGER,
  depth_ft    REAL,
  text        TEXT NOT NULL,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (job_id, client_id)
);
CREATE INDEX job_log_events_job ON job_log_events (job_id, occurred_at);

-- ===========================================================================
-- JRA
-- ===========================================================================

CREATE TABLE jra_templates (
  id              TEXT PRIMARY KEY,
  country         TEXT NOT NULL,
  code            TEXT NOT NULL,
  revision        TEXT NOT NULL,
  questions       TEXT NOT NULL CHECK (json_valid(questions)),
  approval_levels TEXT NOT NULL CHECK (json_valid(approval_levels)),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE (country, code, revision)
);

CREATE TABLE jras (
  id             TEXT PRIMARY KEY,
  job_id         TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  template_id    TEXT NOT NULL REFERENCES jra_templates(id) ON DELETE RESTRICT,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','approved','rejected')),
  answers        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(answers)),
  risk_score     INTEGER NOT NULL DEFAULT 0,
  approval_level TEXT,
  sent_to        TEXT,
  sent_at        TEXT,
  decided_by     TEXT,
  decided_at     TEXT,
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX jras_template ON jras (template_id);
CREATE INDEX jras_sent_to ON jras (sent_to, status);

-- ===========================================================================
-- Documents: numbering, Pre-Job Notes, 8 Min. Facts, Failure Roster
-- ===========================================================================

CREATE TABLE doc_counters (
  country TEXT NOT NULL,
  prefix  TEXT NOT NULL,
  last_no INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (country, prefix)
);
-- next number: INSERT INTO doc_counters (country, prefix, last_no) VALUES (?, ?, 1)
--   ON CONFLICT (country, prefix) DO UPDATE SET last_no = last_no + 1 RETURNING last_no

CREATE TABLE pre_job_notes (
  id              TEXT PRIMARY KEY,
  country         TEXT NOT NULL,
  job_id          TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
  log_no          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'not_sent' CHECK (status IN ('not_sent','sent')),
  current_version INTEGER NOT NULL DEFAULT 1,
  content         TEXT NOT NULL CHECK (json_valid(content)),
  main_contact_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  prepared_by     TEXT,
  saved_at        TEXT NOT NULL,
  sent_at         TEXT,
  sent_by         TEXT,
  UNIQUE (country, log_no)
);
CREATE INDEX pre_job_notes_list ON pre_job_notes (country, status, saved_at);
CREATE INDEX pre_job_notes_contact ON pre_job_notes (main_contact_id);

CREATE TABLE pre_job_note_versions (
  id       TEXT PRIMARY KEY,
  note_id  TEXT NOT NULL REFERENCES pre_job_notes(id) ON DELETE CASCADE,
  version  INTEGER NOT NULL,
  content  TEXT NOT NULL CHECK (json_valid(content)),
  saved_by TEXT,
  saved_at TEXT NOT NULL,
  UNIQUE (note_id, version)
);

CREATE TABLE eight_min_facts (
  id              TEXT PRIMARY KEY,
  country         TEXT NOT NULL,
  job_id          TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  log_no          TEXT NOT NULL,
  title           TEXT NOT NULL,
  rilr_no         TEXT,
  rig             TEXT,
  well            TEXT,
  crew_text       TEXT,
  status          TEXT NOT NULL DEFAULT 'saved' CHECK (status IN ('saved','sent')),
  current_version INTEGER NOT NULL DEFAULT 1,
  total_npt       REAL NOT NULL DEFAULT 0,
  severity        TEXT NOT NULL DEFAULT 'negligible' CHECK (severity IN ('negligible','light','serious','major','catastrophic')),
  created_by      TEXT,
  last_saved_by   TEXT,
  last_saved_at   TEXT NOT NULL,
  sent_by         TEXT,
  sent_at         TEXT,
  UNIQUE (country, log_no)
);
CREATE INDEX emf_job ON eight_min_facts (job_id);
CREATE INDEX emf_list ON eight_min_facts (country, last_saved_at);

CREATE TABLE incidents (
  id                TEXT PRIMARY KEY,
  report_id         TEXT NOT NULL REFERENCES eight_min_facts(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  what_happened     TEXT NOT NULL,
  occurred_on       TEXT NOT NULL CHECK (date(occurred_on) IS NOT NULL),
  occurred_time     TEXT,
  npt_hours         REAL NOT NULL DEFAULT 0 CHECK (npt_hours >= 0),
  severity          TEXT GENERATED ALWAYS AS (
                      CASE WHEN npt_hours <= 0 THEN 'negligible' WHEN npt_hours < 4 THEN 'light'
                           WHEN npt_hours <= 24 THEN 'serious' WHEN npt_hours <= 48 THEN 'major'
                           ELSE 'catastrophic' END) VIRTUAL,
  severity_rank     INTEGER GENERATED ALWAYS AS (
                      CASE WHEN npt_hours <= 0 THEN 0 WHEN npt_hours < 4 THEN 1 WHEN npt_hours <= 24 THEN 2
                           WHEN npt_hours <= 48 THEN 3 ELSE 4 END) VIRTUAL,
  failed_items      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(failed_items)),
  immediate_actions TEXT,
  current_situation TEXT,
  informed_client   TEXT,
  informed_nesr     TEXT,
  category          TEXT,
  UNIQUE (report_id, position)
);

CREATE TABLE eight_min_facts_versions (
  id        TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES eight_min_facts(id) ON DELETE CASCADE,
  version   INTEGER NOT NULL,
  snapshot  TEXT NOT NULL CHECK (json_valid(snapshot)),
  saved_by  TEXT,
  saved_at  TEXT NOT NULL,
  UNIQUE (report_id, version)
);

CREATE TABLE failure_roster_entries (
  id            TEXT PRIMARY KEY,
  country       TEXT NOT NULL,
  job_id        TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  incident_id   TEXT UNIQUE REFERENCES incidents(id) ON DELETE CASCADE,
  occurred_on   TEXT NOT NULL,
  well          TEXT,
  rilr_refs     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(rilr_refs)),
  category      TEXT,
  severity      TEXT CHECK (severity IN ('negligible','light','serious','major','catastrophic')),
  action_status TEXT NOT NULL DEFAULT 'open' CHECK (action_status IN ('open','in_progress','closed')),
  notes         TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX roster_date ON failure_roster_entries (country, occurred_on);
CREATE INDEX roster_job ON failure_roster_entries (job_id);

-- ===========================================================================
-- Reconciliation with WIREGUARD (S46)
-- ===========================================================================

CREATE TABLE recon_findings (
  id           TEXT PRIMARY KEY,
  country      TEXT NOT NULL,
  check_code   TEXT NOT NULL CHECK (check_code IN (
                 'no_runs','unlinked_runs','date_mismatch','unit_drum_mismatch','wire_mismatch','location_mismatch',
                 'service_mismatch','value_mismatch','runs_pending_approval')),
  severity     TEXT NOT NULL CHECK (severity IN ('info','low','medium','high')),
  job_id       TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  wg_run_ids   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(wg_run_ids)),
  detail       TEXT NOT NULL CHECK (json_valid(detail)),         -- ours vs theirs values
  fingerprint  TEXT NOT NULL,                                    -- stable hash so re-checks update, not duplicate
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','explained','resolved')),
  explained_by TEXT,
  explanation  TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  resolved_at   TEXT,
  UNIQUE (fingerprint)
);
CREATE INDEX recon_open ON recon_findings (country, status, severity);
CREATE INDEX recon_job ON recon_findings (job_id);

-- Manual links made on S46 when the ticket does not match
CREATE TABLE recon_links (
  wg_run_id  TEXT PRIMARY KEY,
  job_id     TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  linked_by  TEXT NOT NULL,
  linked_at  TEXT NOT NULL
);
CREATE INDEX recon_links_job ON recon_links (job_id);

-- ===========================================================================
-- Attendance (S17)
-- ===========================================================================

CREATE TABLE attendance_categories (
  id TEXT PRIMARY KEY, country TEXT NOT NULL, name TEXT NOT NULL, approver_email TEXT,
  UNIQUE (country, name)
);
CREATE TABLE holidays (
  id TEXT PRIMARY KEY, country TEXT NOT NULL, day TEXT NOT NULL CHECK (date(day) IS NOT NULL), name TEXT NOT NULL,
  UNIQUE (country, day)
);
CREATE TABLE attendance_entries (
  id          TEXT PRIMARY KEY,
  country     TEXT NOT NULL,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  day         TEXT NOT NULL CHECK (date(day) IS NOT NULL),
  code        TEXT NOT NULL CHECK (code IN ('P','A','AL','SL','UL','EL','PL','HL','MAL','JBFS','30','FA','JBOF','TR','JBOFS')),
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (employee_id, day)
);
CREATE INDEX attendance_day ON attendance_entries (country, day);
CREATE TABLE attendance_approvals (
  id          TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month       TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  UNIQUE (employee_id, month)
);

-- ===========================================================================
-- Inventory (S18-S20, S29, S39): append-only ledger, balances derived
-- ===========================================================================

CREATE TABLE inventory_locations (
  id        TEXT PRIMARY KEY,
  country   TEXT NOT NULL,
  inventory TEXT NOT NULL CHECK (inventory IN ('explosive','hardware','mcr')),
  code      TEXT NOT NULL,
  label     TEXT NOT NULL,
  counts_as TEXT NOT NULL CHECK (counts_as IN ('on_hand','at_well','on_order','used','junk','external')),
  sort      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (country, inventory, code)
);

CREATE TABLE inventory_items (
  id          TEXT PRIMARY KEY,
  country     TEXT NOT NULL,
  inventory   TEXT NOT NULL CHECK (inventory IN ('explosive','hardware','mcr')),
  category    TEXT NOT NULL,
  description TEXT NOT NULL,
  part_no     TEXT,
  sap_no      TEXT,
  uom         TEXT NOT NULL DEFAULT 'ea' CHECK (uom IN ('ea','m','ft','kg')),
  size        TEXT,
  par_level   REAL,
  archived_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX inventory_items_cat ON inventory_items (country, inventory, category);
CREATE INDEX inventory_items_pn ON inventory_items (country, part_no);

CREATE TABLE inventory_movements (
  id               TEXT PRIMARY KEY,
  country          TEXT NOT NULL,
  item_id          TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  kind             TEXT NOT NULL CHECK (kind IN ('receive','transfer','mobilize','consume','return','junk','order','adjust','undo')),
  qty              REAL NOT NULL CHECK (qty > 0),
  from_location_id TEXT REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  to_location_id   TEXT REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  job_id           TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  well             TEXT,
  reverses_id      TEXT UNIQUE REFERENCES inventory_movements(id) ON DELETE RESTRICT,
  note             TEXT,
  client_id        TEXT NOT NULL,
  created_by       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (country, client_id),
  CHECK (from_location_id IS NOT NULL OR to_location_id IS NOT NULL)
);
CREATE INDEX inv_mov_item ON inventory_movements (item_id, created_at);
CREATE INDEX inv_mov_job ON inventory_movements (job_id);
CREATE INDEX inv_mov_from ON inventory_movements (from_location_id);
CREATE INDEX inv_mov_to ON inventory_movements (to_location_id);
CREATE INDEX inv_mov_well ON inventory_movements (country, well);

CREATE VIEW inventory_balances AS
SELECT item_id, location_id, sum(delta) AS qty FROM (
  SELECT item_id, to_location_id AS location_id, qty AS delta FROM inventory_movements WHERE to_location_id IS NOT NULL
  UNION ALL
  SELECT item_id, from_location_id AS location_id, -qty AS delta FROM inventory_movements WHERE from_location_id IS NOT NULL
) GROUP BY item_id, location_id;

-- Refuse a movement that would drive its source location negative. The Worker uses a client_id upsert for replays.
CREATE TRIGGER inventory_no_overdraw BEFORE INSERT ON inventory_movements
WHEN NEW.from_location_id IS NOT NULL AND
     coalesce((SELECT sum(CASE WHEN m.to_location_id = NEW.from_location_id THEN m.qty ELSE -m.qty END)
               FROM inventory_movements m
               WHERE m.item_id = NEW.item_id AND (m.to_location_id = NEW.from_location_id OR m.from_location_id = NEW.from_location_id)), 0) < NEW.qty
BEGIN SELECT RAISE(ABORT, 'insufficient stock'); END;

-- ===========================================================================
-- Knowledge Hub, Quick Plan, audit
-- ===========================================================================

CREATE TABLE knowledge_docs (
  id             TEXT PRIMARY KEY,
  country        TEXT NOT NULL,
  doc_type       TEXT NOT NULL CHECK (doc_type IN ('lesson_learnt','best_practice','learning_from_incident')),
  category       TEXT NOT NULL,
  title          TEXT NOT NULL,
  summary        TEXT,
  key_action     TEXT,
  failure_types  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(failure_types)),
  published_on   TEXT,
  rilr_ref       TEXT,
  r2_key         TEXT,
  thumbnail_r2_key TEXT,
  duplicate_of   TEXT REFERENCES knowledge_docs(id) ON DELETE SET NULL,
  lesson_of_week_from TEXT,
  source_ref     TEXT,
  UNIQUE (country, source_ref)
);
CREATE INDEX kdocs_date ON knowledge_docs (country, published_on);
CREATE INDEX kdocs_dup ON knowledge_docs (duplicate_of);
CREATE VIRTUAL TABLE knowledge_fts USING fts5 (title, summary, key_action, content='knowledge_docs', content_rowid='rowid');
CREATE TRIGGER kdocs_ai AFTER INSERT ON knowledge_docs BEGIN
  INSERT INTO knowledge_fts (rowid, title, summary, key_action) VALUES (NEW.rowid, NEW.title, NEW.summary, NEW.key_action);
END;
CREATE TRIGGER kdocs_ad AFTER DELETE ON knowledge_docs BEGIN
  INSERT INTO knowledge_fts (knowledge_fts, rowid, title, summary, key_action) VALUES ('delete', OLD.rowid, OLD.title, OLD.summary, OLD.key_action);
END;
CREATE TRIGGER kdocs_au AFTER UPDATE ON knowledge_docs BEGIN
  INSERT INTO knowledge_fts (knowledge_fts, rowid, title, summary, key_action) VALUES ('delete', OLD.rowid, OLD.title, OLD.summary, OLD.key_action);
  INSERT INTO knowledge_fts (rowid, title, summary, key_action) VALUES (NEW.rowid, NEW.title, NEW.summary, NEW.key_action);
END;

CREATE TABLE quick_plan_cards (
  id              TEXT PRIMARY KEY,
  country         TEXT NOT NULL,
  title           TEXT NOT NULL,
  notes           TEXT,
  target_date     TEXT,
  unit_number     TEXT,
  column_key      TEXT NOT NULL DEFAULT 'idea',
  sort            INTEGER NOT NULL DEFAULT 0,
  promoted_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX quick_plan_col ON quick_plan_cards (country, column_key, sort);
CREATE INDEX quick_plan_job ON quick_plan_cards (promoted_job_id);

CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  username    TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  summary     TEXT
);
CREATE INDEX audit_entity ON audit_log (entity_type, entity_id, occurred_at);
CREATE INDEX audit_time ON audit_log (occurred_at);

-- ===========================================================================
-- Immutable history
-- ===========================================================================

CREATE TRIGGER pjn_versions_no_update BEFORE UPDATE ON pre_job_note_versions BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER pjn_versions_no_delete BEFORE DELETE ON pre_job_note_versions
WHEN EXISTS (SELECT 1 FROM pre_job_notes n WHERE n.id = OLD.note_id) BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER emf_versions_no_update BEFORE UPDATE ON eight_min_facts_versions BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER emf_versions_no_delete BEFORE DELETE ON eight_min_facts_versions
WHEN EXISTS (SELECT 1 FROM eight_min_facts e WHERE e.id = OLD.report_id) BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER movements_no_update BEFORE UPDATE ON inventory_movements BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER movements_no_delete BEFORE DELETE ON inventory_movements BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'immutable'); END;
