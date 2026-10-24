-- SLK Operations: first migration (0001_init)
-- A Slickline operations hub modelled on the WL Operations Hub's features (replica/recon.md).
-- Postgres 15+ on Supabase. Slickline-specific lists live in replica/seed_slk.sql, not here.
-- Conventions: uuid ids, timestamptz in UTC (shown in Asia/Riyadh in the UI), money as integer cents + currency,
-- every row scoped to a country (tenant), access via Row Level Security plus server-action checks for
-- field-level edit rights (see architecture.md, "Access rules").

create extension if not exists pgcrypto;
create extension if not exists btree_gist;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------------------
-- Tenancy, people, permissions
-- ---------------------------------------------------------------------------

create table countries (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                    -- 'SA'
  name text not null,
  timezone text not null default 'Asia/Riyadh',
  weekend_days int[] not null default '{5,6}',  -- ISO dow: Fri, Sat
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type app_role as enum (
  'admin','operations_manager','maintenance_manager','sdm','deputy_sdm','sales','director',
  'sqm','slickline_supervisor','slickline_operator','assistant_operator','crew','viewer',
  'explosive_manager','explosive_admin','storekeeper','attendance_admin','slk_contact'
);

-- Tabs a user can open. Role defaults live in code (lib/permissions.ts); rows here are extra grants.
create type app_tab as enum (
  'schedule','jobs','job_log','pre_job_notes','database','failure_roster','eight_min_facts','quick_plan',
  'statistics','npt_analysis','utilization','competency',
  'bonus_report','bonus_analysis','sales_dashboard',
  'attendance','inventory_explosive','inventory_hardware','inventory_mcr',
  'wire_summary','wire_book','knowledge_hub','admin_users','admin_ai'
);

-- One row per signed-in account; id = auth.users.id
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  country_id uuid not null references countries(id) on delete restrict,
  email text not null,
  full_name text not null,
  role app_role not null default 'viewer',
  employee_id uuid,                               -- fk added after employees
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index on profiles (lower(email));
create index on profiles (country_id, role);

create table tab_grants (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  tab app_tab not null,
  can_edit boolean not null default false,
  granted_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, tab)
);

-- RLS helpers (security definer so policies can read profiles without recursion)
create or replace function auth_country() returns uuid language sql stable security definer set search_path = public as
$$ select country_id from profiles where id = auth.uid() and active $$;

create or replace function auth_role() returns app_role language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and active $$;

create or replace function auth_has_role(roles app_role[]) returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select role = any(roles) or role = 'admin' from profiles where id = auth.uid() and active), false) $$;

create table employees (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete restrict,
  eid text not null,
  full_name text not null,
  title text not null,
  account text not null default 'SLK',              -- account assignment: SLK | WL | UNC ...
  crew_role text check (crew_role in ('slickline_supervisor','slickline_operator','assistant_operator','helper','trainee','other')),
  reports_to_id uuid references employees(id) on delete set null,
  attendance_group text,                            -- e.g. 'Shop Team — Ops Manager'
  rotation text not null default '60/30',
  self_updated boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_id, eid)
);
create index on employees (country_id, active);
create index on employees (reports_to_id);
create index employees_name_trgm on employees using gin (full_name gin_trgm_ops);

alter table profiles add constraint profiles_employee_fk foreign key (employee_id) references employees(id) on delete set null;
create index on profiles (employee_id);

-- ---------------------------------------------------------------------------
-- Equipment database and lookups (S24) — data, not enums, so a Slickline line can load its own lists
-- ---------------------------------------------------------------------------

create table lookup_values (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete cascade,
  kind text not null check (kind in (
    'account','area','conveyance','conveyance_vendor','well_type','casing_type','casing_od','casing_grade',
    'wire_type','wire_size','plug_type','grease_panel_type','fluid_type','failure_category','sdm_other',
    'pressure_rating','lubricator_size','stuffing_box_type','jar_type','rope_socket_type','lock_type','nipple_profile')),
  value text not null,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_id, kind, value)
);
create index on lookup_values (country_id, kind, active, sort);

create table service_domains (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete cascade,
  name text not null,                               -- Well Access & Clean-out, Flow Control, Surveys & Diagnostics, ...
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_id, name)
);

create table services (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete cascade,
  name text not null,                               -- Gauge Cutter / Drift Run, Set Plug, Pull GLV, Memory Gauge Survey ...
  domain_id uuid references service_domains(id) on delete set null,
  is_perforation boolean not null default false,    -- tubing punch / e-slickline perforating: unlocks Perforation Details
  is_pipe_recovery boolean not null default false,  -- fishing: unlocks Fishing Details
  is_plug boolean not null default false,           -- set/pull plug or lock: unlocks Plug / Lock details
  is_memory boolean not null default false,         -- memory gauges / PLT: unlocks Survey Details
  is_explosive boolean not null default false,      -- needs explosives mobilized (inventory link)
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_id, name)
);
create index on services (domain_id);

create table units (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete cascade,
  code text not null,                               -- 'SLK-01', 'SLK-SKID-02', 'MEM-1'
  kind text not null default 'truck' check (kind in ('truck','skid','offshore_package','memory_crew')),
  division text,                                    -- for schedule filters
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_id, code)
);

create table pce (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete cascade,
  label text not null,                              -- 'LUB-01 (3" 10K)'
  kind text not null default 'lubricator' check (kind in ('lubricator','wireline_valve_bop','stuffing_box','grease_injection_head','tool_trap','tool_catcher','pump_in_sub','pce_set')),
  bore_in numeric(5,3) not null,                    -- 2.500; used by the clearance check vs max tool OD
  rating_psi int check (rating_psi in (5000,10000,15000)),
  length_ft numeric,                                -- lubricator length must exceed toolstring length
  last_pressure_test_on date,
  is_rental boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_id, label)
);

create table grease_panels (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete cascade,
  label text not null,
  panel_type text,                                  -- Air | Intensifier; braided line only (solid wire uses a stuffing box)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_id, label)
);

create table wires (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete cascade,
  serial_no text not null,
  wire_type text not null,                          -- Solid | Braided | Digital (e-slickline)
  material text,                                    -- Carbon steel (IPS) | 316 SS | Supa 75 | GD31Mo | Galvanized
  size text not null,                               -- 0.108" | 0.125" | 0.140" | 3/16" | 7/32"
  od_in numeric(5,3),
  breaking_strength_lb int,                         -- for the max safe pull warning
  length_ft int,                                    -- current length on the drum, reduced by cut-backs
  unit_id uuid references units(id) on delete set null,
  cut_back_alert_runs int not null default 10,      -- runs since last cut-back before an alert (per material)
  last_cut_at date,
  last_torsion_test_at date,
  reel_no text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_id, serial_no)
);
create index on wires (unit_id);

-- Unit maintenance and status blocks (S37, S38). Two blocks on one unit may not overlap.
create table unit_events (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  kind text not null check (kind in ('maintenance','loan','transferred','junk','backup_on_location')),
  starts_on date not null,
  ends_on date not null,
  note text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_event_dates check (ends_on >= starts_on),
  constraint unit_events_no_overlap exclude using gist (
    unit_id with =, daterange(starts_on, ends_on, '[]') with &&)
);
create index on unit_events (country_id, starts_on, ends_on);

-- ---------------------------------------------------------------------------
-- Jobs (S02-S08)
-- ---------------------------------------------------------------------------

create type job_status as enum ('planned','ongoing','completed','canceled');
create type yes_no_na as enum ('yes','no','na','other');

create table jobs (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete restrict,
  product_line text not null default 'SLK' check (product_line in ('SLK','WL')),

  -- 01 Design (Sales / SDM fields)
  ticket_no text,                                   -- nullable while drafting; unique when set
  dmr_no text,
  sdm_id uuid references profiles(id) on delete set null,
  sdm_other text,
  program_in_place boolean,
  status job_status not null default 'planned',
  run_details text,
  unit_id uuid references units(id) on delete set null,
  start_date date,
  end_date date,
  account text,
  area text,
  rig_site text,
  well text,
  conveyance text,
  third_party_required yes_no_na,

  -- 02 Preparation
  account_assignment text,
  well_type text,
  h2s_ppm numeric, co2_pct numeric,
  target_depth_ft numeric, top_interval_ft numeric,  -- slickline target / work interval
  completion_details text,                          -- tubing size, nipple profiles and depths, SSSV, GLM stations
  nipple_profile text, sssv_depth_ft numeric,
  bht_f numeric, bhp_psi numeric, siwhp_psi numeric,
  fluid_type text, fluid_weight_pcf numeric, solids_pct numeric,
  min_restriction_in numeric, max_inclination_deg numeric check (max_inclination_deg between 0 and 180),
  target_casing_type text, target_casing_od text, target_casing_weight_lbft numeric, target_casing_grade text,
  wellhead_connection text,
  ref_log_requested yes_no_na,
  ref_log_request_date date,
  conveyance_vendor_count int check (conveyance_vendor_count between 1 and 3),
  conveyance_vendors text[] not null default '{}',
  wire_id uuid references wires(id) on delete set null,
  wire_type text, wire_size text, wire_length_ft numeric,
  pce_required boolean,
  max_tool_od_in numeric, pce_id uuid references pce(id) on delete set null,   -- lubricator / PCE set
  pressure_rating_psi int,
  lubricator_length_ft numeric,
  stuffing_box_type text,
  grease_panel_id uuid references grease_panels(id) on delete set null,      -- braided line only
  -- toolstring: [{component:'rope socket'|'stem'|'knuckle joint'|'spang jar'|'hydraulic jar'|'accelerator'|'running tool'|..., od_in, length_ft, weight_lb}]
  toolstring jsonb not null default '[]',
  toolstring_length_ft numeric,
  stem_weight_lb numeric,
  jar_type text,
  special_setup yes_no_na,
  special_setup_notes text,
  perforation_details jsonb not null default '{}',
  pipe_recovery_details jsonb not null default '{}',

  -- 03 Execution
  perf_footage_ft numeric,
  runs_ok int check (runs_ok >= 0),
  runs_failed int check (runs_failed >= 0),
  plug_type text,                                   -- plug / lock type set or pulled
  max_depth_ft numeric,
  tag_depth_ft numeric,                             -- depth tagged (fill / TD)
  max_pull_lb numeric,                              -- highest weight indicator reading
  max_overpull_lb numeric,
  jarring_minutes numeric,
  wire_cut_ft numeric,                              -- wire cut back after the job (feeds the wire log)
  survey_details jsonb not null default '{}',       -- memory gauge stops, gradients, PBU times
  arrived_at timestamptz,
  rig_up_at timestamptz,
  rig_down_at timestamptz,
  op_hours_auto numeric generated always as (
    case when rig_up_at is not null and rig_down_at is not null
      then round((extract(epoch from (rig_down_at - rig_up_at)) / 3600)::numeric, 2) end) stored,
  op_hours_override numeric check (op_hours_override >= 0),   -- SDM / Ops Manager only
  op_time_details text,
  npt_hours numeric not null default 0 check (npt_hours >= 0),
  failure yes_no_na,

  -- 04 Closure
  job_log_signed yes_no_na,
  ticket_signed yes_no_na,
  eight_min_facts_done yes_no_na,
  prelim_report yes_no_na,
  final_report yes_no_na,
  job_package_url text,
  report_closure_status text check (report_closure_status in ('open','pending_review','closed','na')),
  report_closure_date date,
  gears_no text,
  wellsite_audit yes_no_na,
  opsminer_uploaded yes_no_na,
  service_order yes_no_na,
  failure_description text,
  bonus_remarks text,

  created_by uuid references profiles(id) on delete set null,
  updated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,                           -- soft delete; hard delete is admin-only

  constraint job_dates check (end_date is null or start_date is null or end_date >= start_date),
  constraint job_rig_times check (rig_down_at is null or rig_up_at is null or rig_down_at > rig_up_at),
  constraint job_ref_log check (ref_log_request_date is null or ref_log_requested = 'yes'),
  constraint job_failure_fields check (
    (failure = 'yes' or npt_hours > 0)
    or (failure_description is null and gears_no is null and report_closure_date is null))
);
create unique index jobs_ticket_unique on jobs (country_id, ticket_no) where ticket_no is not null and deleted_at is null;
create index on jobs (country_id, status) where deleted_at is null;
create index on jobs (country_id, start_date desc) where deleted_at is null;
create index on jobs (unit_id, start_date, end_date) where deleted_at is null;
create index on jobs (sdm_id);
create index on jobs (wire_id);
create index on jobs (pce_id);
create index on jobs (grease_panel_id);
create index on jobs (created_by);
create index jobs_search_trgm on jobs using gin ((coalesce(ticket_no,'') || ' ' || coalesce(well,'') || ' ' || coalesce(rig_site,'')) gin_trgm_ops);

create table job_services (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  position int not null check (position between 1 and 15),
  service_id uuid not null references services(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, position)
);
create index on job_services (service_id);

-- Planned head count (S05) and assigned people. Caps are a first guess for slickline crews — confirm with ops.
create table job_headcount (
  job_id uuid primary key references jobs(id) on delete cascade,
  supervisors int not null default 0 check (supervisors between 0 and 3),
  operators int not null default 0 check (operators between 0 and 6),
  assistant_operators int not null default 0 check (assistant_operators between 0 and 6),
  helpers int not null default 0 check (helpers between 0 and 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table job_crew (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete restrict,
  crew_role text not null check (crew_role in ('slickline_supervisor','slickline_operator','assistant_operator','helper')),
  slot int not null check (slot between 1 and 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, crew_role, slot),
  unique (job_id, employee_id)
);
create index on job_crew (employee_id);

create table job_third_parties (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  slot int not null check (slot between 1 and 5),
  vendor text not null,
  po_no text,
  po_value_cents bigint check (po_value_cents >= 0),
  currency char(3) not null default 'SAR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, slot)
);

-- Sequence of events (S42). client_id makes offline replays idempotent.
create table job_log_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  client_id uuid not null,
  occurred_at timestamptz not null,
  run_no int,
  depth_ft numeric,
  text text not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, client_id)
);
create index on job_log_events (job_id, occurred_at);

-- Computed job metrics in one place, so the board, Job Log and analytics agree.
create view job_metrics with (security_invoker = true) as
select j.id as job_id,
  coalesce(j.op_hours_override, j.op_hours_auto) as op_hours,
  j.npt_hours,
  case when coalesce(j.op_hours_override, j.op_hours_auto) > 0
    then round((1 - j.npt_hours / coalesce(j.op_hours_override, j.op_hours_auto)) * 100, 1) end as job_efficiency_pct,
  coalesce(j.runs_ok,0) + coalesce(j.runs_failed,0) as runs_total,
  case when coalesce(j.runs_ok,0) + coalesce(j.runs_failed,0) > 0
    then round(j.runs_ok::numeric / (j.runs_ok + j.runs_failed) * 100, 1) end as run_efficiency_pct
from jobs j where j.deleted_at is null;

-- ---------------------------------------------------------------------------
-- JRA (S28) — template is versioned data loaded from the controlled QAF12069 form
-- ---------------------------------------------------------------------------

create table jra_templates (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete cascade,
  code text not null,                               -- 'QAF12069'
  revision text not null,
  questions jsonb not null,                         -- [{id:'A1', section:'A', text, points_if:{yes:n,no:n}}]
  approval_levels jsonb not null,                   -- [{min_score, level}]
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_id, code, revision)
);

create table jras (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references jobs(id) on delete cascade,
  template_id uuid not null references jra_templates(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','sent','approved','rejected')),
  answers jsonb not null default '{}',              -- {A1:'yes', A2:'na', ...}
  risk_score int not null default 0,                -- computed server-side from template
  approval_level text,
  sent_to uuid references profiles(id) on delete set null,
  sent_at timestamptz,
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on jras (template_id);
create index on jras (sent_to, status);

-- ---------------------------------------------------------------------------
-- Document numbers (EM-0001, PJN-0001) per country, gap-free under concurrency
-- ---------------------------------------------------------------------------

create table doc_counters (
  country_id uuid not null references countries(id) on delete cascade,
  prefix text not null,
  last_no int not null default 0,
  primary key (country_id, prefix)
);

create or replace function next_doc_no(p_country uuid, p_prefix text) returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_country is distinct from auth_country() then raise exception 'wrong country'; end if;
  insert into doc_counters (country_id, prefix, last_no) values (p_country, p_prefix, 1)
  on conflict (country_id, prefix) do update set last_no = doc_counters.last_no + 1
  returning last_no into n;
  return p_prefix || '-' || lpad(n::text, 4, '0');
end $$;

-- ---------------------------------------------------------------------------
-- Pre-Job Notes (S09, S26, S27) — every save is an immutable version
-- ---------------------------------------------------------------------------

create table pre_job_notes (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete restrict,
  job_id uuid not null unique references jobs(id) on delete restrict,
  log_no text not null,
  status text not null default 'not_sent' check (status in ('not_sent','sent')),
  current_version int not null default 1,
  content jsonb not null,                           -- latest snapshot: job info, toolstrings[], notes, contacts
  main_contact_id uuid references employees(id) on delete set null,
  prepared_by uuid references profiles(id) on delete set null,
  saved_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_id, log_no)
);
create index on pre_job_notes (country_id, status, saved_at desc);
create index on pre_job_notes (main_contact_id);

create table pre_job_note_versions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references pre_job_notes(id) on delete cascade,
  version int not null,
  content jsonb not null,
  saved_by uuid references profiles(id) on delete set null,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (note_id, version)
);

-- ---------------------------------------------------------------------------
-- 8 Min. Facts (S11, S12), incidents, Failure Roster (S10)
-- ---------------------------------------------------------------------------

create type severity as enum ('negligible','light','serious','major','catastrophic');

create or replace function severity_for_npt(h numeric) returns severity language sql immutable as $$
  select case when h is null or h <= 0 then 'negligible'::severity
              when h < 4 then 'light' when h <= 24 then 'serious'
              when h <= 48 then 'major' else 'catastrophic' end::severity $$;

create table eight_min_facts (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete restrict,
  job_id uuid not null references jobs(id) on delete restrict,
  log_no text not null,
  title text not null,
  rilr_no text,
  rig_site text, well text,
  crew_text text,
  status text not null default 'saved' check (status in ('saved','sent')),
  current_version int not null default 1,
  total_npt numeric not null default 0,
  severity severity not null default 'negligible',
  created_by uuid references profiles(id) on delete set null,
  last_saved_by uuid references profiles(id) on delete set null,
  last_saved_at timestamptz not null default now(),
  sent_by uuid references profiles(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_id, log_no)
);
create index on eight_min_facts (job_id);
create index on eight_min_facts (country_id, last_saved_at desc);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references eight_min_facts(id) on delete cascade,
  position int not null,
  what_happened text not null,
  occurred_on date not null,
  occurred_time time,
  npt_hours numeric not null default 0 check (npt_hours >= 0),
  severity severity generated always as (severity_for_npt(npt_hours)) stored,
  failed_items jsonb not null default '[]',         -- [{asset, sn}]
  immediate_actions text,
  current_situation text,
  informed_client text,
  informed_nesr text,
  category text,                                    -- roster category, e.g. 'Tool Stuck'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, position) deferrable initially deferred
);

create table eight_min_facts_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references eight_min_facts(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,                          -- report + incidents as saved
  saved_by uuid references profiles(id) on delete set null,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, version)
);

create table failure_roster_entries (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete restrict,
  job_id uuid references jobs(id) on delete set null,
  incident_id uuid unique references incidents(id) on delete cascade,   -- null = added by hand (S40)
  occurred_on date not null,
  well text,
  rilr_refs text[] not null default '{}',
  category text,
  severity severity,
  action_status text not null default 'open' check (action_status in ('open','in_progress','closed')),
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on failure_roster_entries (country_id, occurred_on desc);
create index on failure_roster_entries (job_id);

-- Called by the save-8MF server action inside its transaction:
-- rolls incidents up to the report, the job and the roster.
-- security definer: an SQM may file an 8MF without having job-edit rights, but the roll-up must still land.
create or replace function sync_eight_min_facts(p_report uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r eight_min_facts; v_job uuid;
begin
  select * into r from eight_min_facts where id = p_report for update;
  if r.country_id is distinct from auth_country()
     or not auth_has_role('{operations_manager,sdm,deputy_sdm,sqm,slickline_supervisor,slickline_operator}') then
    raise exception 'not allowed';
  end if;
  v_job := r.job_id;

  update eight_min_facts e set
    total_npt = coalesce((select sum(npt_hours) from incidents where report_id = p_report), 0),
    severity  = coalesce((select max(severity) from incidents where report_id = p_report), 'negligible')
  where e.id = p_report;

  update jobs set
    npt_hours = (select coalesce(sum(i.npt_hours),0) from incidents i join eight_min_facts e on e.id = i.report_id where e.job_id = v_job),
    failure = 'yes', eight_min_facts_done = 'yes'
  where id = v_job;

  insert into failure_roster_entries (country_id, job_id, incident_id, occurred_on, well, rilr_refs, category, severity)
  select r.country_id, v_job, i.id, i.occurred_on, r.well,
         case when r.rilr_no is null then '{}' else array[r.rilr_no] end, i.category, i.severity
  from incidents i where i.report_id = p_report
  on conflict (incident_id) do update set
    occurred_on = excluded.occurred_on, well = excluded.well, rilr_refs = excluded.rilr_refs,
    category = excluded.category, severity = excluded.severity;
end $$;

-- ---------------------------------------------------------------------------
-- Attendance (S17)
-- ---------------------------------------------------------------------------

create table attendance_categories (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete cascade,
  name text not null,                               -- group label shown on the sheet
  approver_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_id, name)
);

create table holidays (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete cascade,
  day date not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_id, day)
);

create table attendance_entries (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  day date not null,
  code text not null check (code in ('P','A','AL','SL','UL','EL','PL','HL','MAL','JBFS','30','FA','JBOF','TR','JBOFS')),
  updated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, day)
);
create index on attendance_entries (country_id, day);

create table attendance_approvals (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, month)
);

-- ---------------------------------------------------------------------------
-- Inventory (S18-S20, S29, S39) — an append-only movement ledger; balances are derived
-- ---------------------------------------------------------------------------

create table inventory_locations (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete cascade,
  inventory text not null check (inventory in ('explosive','hardware','mcr')),
  code text not null,                               -- bunker, gun_shop, inside_guns, at_location, on_order, warehouse...
  label text not null,
  counts_as text not null check (counts_as in ('on_hand','at_well','on_order','used','junk','external')),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_id, inventory, code)
);

create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete cascade,
  inventory text not null check (inventory in ('explosive','hardware','mcr')),
  category text not null,                           -- Charges, Detonators, Carriers, ESUB ...
  description text not null,
  part_no text,
  sap_no text,
  uom text not null default 'ea' check (uom in ('ea','m','ft','kg')),
  size text,                                        -- MCR stock-by-size
  par_level numeric,                                -- MCR reorder alert
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on inventory_items (country_id, part_no);   -- not unique: the same PN appears on items with different SAP numbers
create index on inventory_items (country_id, inventory, category) where archived_at is null;
create index inventory_items_trgm on inventory_items using gin ((description || ' ' || coalesce(part_no,'') || ' ' || coalesce(sap_no,'')) gin_trgm_ops);

create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete restrict,
  item_id uuid not null references inventory_items(id) on delete restrict,
  kind text not null check (kind in ('receive','transfer','mobilize','consume','return','junk','order','adjust','undo')),
  qty numeric not null check (qty > 0),
  from_location_id uuid references inventory_locations(id) on delete restrict,
  to_location_id uuid references inventory_locations(id) on delete restrict,
  job_id uuid references jobs(id) on delete set null,
  well text,
  reverses_id uuid unique references inventory_movements(id) on delete restrict,
  note text,
  client_id uuid not null,                          -- idempotency key from the form
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_id, client_id),
  constraint movement_has_side check (from_location_id is not null or to_location_id is not null)
);
create index on inventory_movements (item_id, created_at desc);
create index on inventory_movements (job_id);
create index on inventory_movements (from_location_id);
create index on inventory_movements (to_location_id);
create index on inventory_movements (country_id, well);

create view inventory_balances with (security_invoker = true) as
select item_id, location_id, sum(delta) as qty from (
  select item_id, to_location_id as location_id, qty as delta from inventory_movements where to_location_id is not null
  union all
  select item_id, from_location_id, -qty from inventory_movements where from_location_id is not null
) m group by item_id, location_id;

-- Single entry point for movements: locks the item, refuses to drive a location negative.
create or replace function record_movement(
  p_item uuid, p_kind text, p_qty numeric, p_from uuid, p_to uuid,
  p_job uuid, p_well text, p_note text, p_client uuid) returns uuid
language plpgsql security invoker as $$
declare v_id uuid; v_country uuid; v_have numeric;
begin
  select country_id into v_country from inventory_items where id = p_item for update;
  select id into v_id from inventory_movements where country_id = v_country and client_id = p_client;
  if v_id is not null then return v_id; end if;           -- replayed submit
  if p_from is not null then
    select coalesce(sum(qty),0) into v_have from inventory_balances where item_id = p_item and location_id = p_from;
    if v_have < p_qty then raise exception 'insufficient stock: % available', v_have using errcode = 'P0001'; end if;
  end if;
  insert into inventory_movements (country_id, item_id, kind, qty, from_location_id, to_location_id, job_id, well, note, client_id, created_by)
  values (v_country, p_item, p_kind, p_qty, p_from, p_to, p_job, p_well, p_note, p_client, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Wire log (S30, S31): runs, cut-backs, torsion/wrap tests per slickline wire
create table wire_events (
  id uuid primary key default gen_random_uuid(),
  wire_id uuid not null references wires(id) on delete cascade,
  kind text not null check (kind in ('run','cut_back','torsion_test','wrap_test','reel_change','new_rope_socket','inspection','transfer')),
  occurred_on date not null,
  job_id uuid references jobs(id) on delete set null,
  max_depth_ft numeric,
  max_pull_lb numeric,
  cut_ft numeric check (cut_ft >= 0),
  torsion_turns numeric,                            -- torsion test result (turns to failure over the test length)
  test_passed boolean,
  length_after_ft numeric,
  note text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on wire_events (wire_id, occurred_on desc);
create index on wire_events (job_id);

-- ---------------------------------------------------------------------------
-- Knowledge Hub (S21), Quick Plan (S25), audit
-- ---------------------------------------------------------------------------

create table knowledge_docs (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete cascade,
  doc_type text not null check (doc_type in ('lesson_learnt','best_practice','learning_from_incident')),
  category text not null,
  title text not null,
  summary text,
  key_action text,
  failure_types text[] not null default '{}',
  published_on date,
  rilr_ref text,
  file_path text,                                   -- Supabase Storage key
  thumbnail_path text,
  duplicate_of uuid references knowledge_docs(id) on delete set null,
  lesson_of_week_from date,
  source_ref text,                                  -- SharePoint id for sync, unique per country
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_id, source_ref)
);
create index on knowledge_docs (country_id, published_on desc);
create index on knowledge_docs using gin (failure_types);
create index on knowledge_docs (duplicate_of);
create index knowledge_docs_fts on knowledge_docs using gin (to_tsvector('english', title || ' ' || coalesce(summary,'') || ' ' || coalesce(key_action,'')));

create table quick_plan_cards (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id) on delete cascade,
  title text not null,
  notes text,
  target_date date,
  unit_id uuid references units(id) on delete set null,
  column_key text not null default 'idea',
  sort int not null default 0,
  promoted_job_id uuid references jobs(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on quick_plan_cards (country_id, column_key, sort);
create index on quick_plan_cards (unit_id);
create index on quick_plan_cards (promoted_job_id);

create table audit_log (
  id bigint generated always as identity primary key,
  country_id uuid not null references countries(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  entity text not null,
  entity_id uuid not null,
  action text not null,
  diff jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on audit_log (entity, entity_id, created_at desc);
create index on audit_log (country_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

do $$ declare t text; begin
  for t in select table_name from information_schema.columns
           where table_schema = 'public' and column_name = 'updated_at'
             and table_name in (select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE')
  loop
    execute format('create trigger %I_updated_at before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- Immutable version tables
create or replace function forbid_change() returns trigger language plpgsql as $$
begin raise exception '% rows are immutable', tg_table_name; end $$;
create trigger pjn_versions_immutable before update or delete on pre_job_note_versions for each row execute function forbid_change();
create trigger emf_versions_immutable before update or delete on eight_min_facts_versions for each row execute function forbid_change();
create trigger movements_immutable before update or delete on inventory_movements for each row execute function forbid_change();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Rule of thumb: read = same country (+ tab access checked in the app); write = role list below.
-- Field-level rights (SALES / SDM badges) are enforced in server actions via lib/permissions.ts.
-- ---------------------------------------------------------------------------

do $$ declare t text; begin
  for t in select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
  loop execute format('alter table %I enable row level security', t); end loop;
end $$;

-- Tables with a country_id: same-country read
do $$ declare t text; begin
  for t in select c.table_name from information_schema.columns c
           join information_schema.tables tb on tb.table_name = c.table_name and tb.table_schema = 'public' and tb.table_type = 'BASE TABLE'
           where c.table_schema='public' and c.column_name='country_id' and c.table_name <> 'profiles'
  loop
    execute format('create policy %I on %I for select using (country_id = auth_country())', t || '_read', t);
  end loop;
end $$;

create policy countries_read on countries for select using (id = auth_country());
create policy profiles_read on profiles for select using (country_id = auth_country());
create policy profiles_admin on profiles for all using (auth_has_role('{admin}') and country_id = auth_country())
  with check (country_id = auth_country());
create policy tab_grants_read on tab_grants for select using (profile_id = auth.uid() or auth_has_role('{admin}'));
create policy tab_grants_admin on tab_grants for all using (auth_has_role('{admin}')) with check (auth_has_role('{admin}'));

-- Equipment database: Ops / Maintenance managers
create policy units_write on units for all using (country_id = auth_country() and auth_has_role('{operations_manager,maintenance_manager}')) with check (country_id = auth_country());
create policy pce_write on pce for all using (country_id = auth_country() and auth_has_role('{operations_manager,maintenance_manager}')) with check (country_id = auth_country());
create policy grease_panels_write on grease_panels for all using (country_id = auth_country() and auth_has_role('{operations_manager,maintenance_manager}')) with check (country_id = auth_country());
create policy lookups_write on lookup_values for all using (country_id = auth_country() and auth_has_role('{operations_manager,maintenance_manager}')) with check (country_id = auth_country());
create policy services_write on services for all using (country_id = auth_country() and auth_has_role('{operations_manager}')) with check (country_id = auth_country());
create policy unit_events_write on unit_events for all using (country_id = auth_country() and auth_has_role('{operations_manager,maintenance_manager,sdm,deputy_sdm}')) with check (country_id = auth_country());

-- Jobs: operational roles edit; viewers and crew read only
create policy jobs_insert on jobs for insert with check (country_id = auth_country() and auth_has_role('{operations_manager,sdm,deputy_sdm,sales,sqm,slickline_supervisor,slickline_operator}'));
create policy jobs_update on jobs for update using (country_id = auth_country() and auth_has_role('{operations_manager,sdm,deputy_sdm,sales,sqm,slickline_supervisor,slickline_operator}')) with check (country_id = auth_country());
create policy jobs_delete on jobs for delete using (country_id = auth_country() and auth_has_role('{admin}'));

-- Child rows of a job follow the job's country and the same writer roles
do $$ declare t text; begin
  foreach t in array array['job_services','job_headcount','job_crew','job_third_parties','job_log_events','jras'] loop
    execute format($f$create policy %1$I on %2$I for select using (exists (select 1 from jobs j where j.id = job_id and j.country_id = auth_country()))$f$, t || '_read', t);
    execute format($f$create policy %1$I on %2$I for all using (exists (select 1 from jobs j where j.id = job_id and j.country_id = auth_country()) and auth_has_role('{operations_manager,sdm,deputy_sdm,sales,sqm,slickline_supervisor,slickline_operator}')) with check (exists (select 1 from jobs j where j.id = job_id and j.country_id = auth_country()))$f$, t || '_write', t);
  end loop;
end $$;

create policy pjn_write on pre_job_notes for all using (country_id = auth_country() and auth_has_role('{slk_contact,operations_manager,sdm,deputy_sdm,slickline_supervisor}')) with check (country_id = auth_country());
create policy pjn_versions_read on pre_job_note_versions for select using (exists (select 1 from pre_job_notes n where n.id = note_id and n.country_id = auth_country()));
create policy pjn_versions_insert on pre_job_note_versions for insert with check (exists (select 1 from pre_job_notes n where n.id = note_id and n.country_id = auth_country()));

create policy emf_write on eight_min_facts for all using (country_id = auth_country() and auth_has_role('{operations_manager,sdm,deputy_sdm,sqm,slickline_supervisor,slickline_operator}')) with check (country_id = auth_country());
create policy incidents_read on incidents for select using (exists (select 1 from eight_min_facts e where e.id = report_id and e.country_id = auth_country()));
create policy incidents_write on incidents for all using (exists (select 1 from eight_min_facts e where e.id = report_id and e.country_id = auth_country()) and auth_has_role('{operations_manager,sdm,deputy_sdm,sqm,slickline_supervisor,slickline_operator}')) with check (exists (select 1 from eight_min_facts e where e.id = report_id and e.country_id = auth_country()));
create policy emf_versions_read on eight_min_facts_versions for select using (exists (select 1 from eight_min_facts e where e.id = report_id and e.country_id = auth_country()));
create policy emf_versions_insert on eight_min_facts_versions for insert with check (exists (select 1 from eight_min_facts e where e.id = report_id and e.country_id = auth_country()));
create policy roster_write on failure_roster_entries for all using (country_id = auth_country() and auth_has_role('{operations_manager,sdm,deputy_sdm,sqm}')) with check (country_id = auth_country());

create policy employees_write on employees for all using (country_id = auth_country() and auth_has_role('{attendance_admin,operations_manager}')) with check (country_id = auth_country());
create policy attendance_write on attendance_entries for all using (country_id = auth_country() and auth_has_role('{attendance_admin,operations_manager,sdm,deputy_sdm,sqm}')) with check (country_id = auth_country());
create policy attendance_approvals_read on attendance_approvals for select using (exists (select 1 from employees e where e.id = employee_id and e.country_id = auth_country()));
create policy attendance_approvals_write on attendance_approvals for all
  using (auth_has_role('{attendance_admin,operations_manager,sdm}') and exists (select 1 from employees e where e.id = employee_id and e.country_id = auth_country()))
  with check (auth_has_role('{attendance_admin,operations_manager,sdm}') and exists (select 1 from employees e where e.id = employee_id and e.country_id = auth_country()));
create policy attendance_categories_write on attendance_categories for all using (country_id = auth_country() and auth_has_role('{operations_manager}')) with check (country_id = auth_country());
create policy holidays_write on holidays for all using (country_id = auth_country() and auth_has_role('{operations_manager,attendance_admin}')) with check (country_id = auth_country());

-- Explosives stay with explosive roles; slickline hardware and consumables also with stores and maintenance.
create or replace function can_edit_inventory(p_inventory text) returns boolean language sql stable as $$
  select case when p_inventory = 'explosive' then auth_has_role('{explosive_manager,explosive_admin}')
              else auth_has_role('{explosive_manager,explosive_admin,storekeeper,maintenance_manager,operations_manager}') end $$;
create policy inv_items_write on inventory_items for all using (country_id = auth_country() and can_edit_inventory(inventory)) with check (country_id = auth_country() and can_edit_inventory(inventory));
create policy inv_locations_write on inventory_locations for all using (country_id = auth_country() and auth_has_role('{explosive_admin}')) with check (country_id = auth_country());
create policy inv_movements_insert on inventory_movements for insert with check (country_id = auth_country() and can_edit_inventory((select i.inventory from inventory_items i where i.id = item_id)));

create policy wire_events_read on wire_events for select using (exists (select 1 from wires c where c.id = wire_id and c.country_id = auth_country()));
create policy wire_events_write on wire_events for all
  using (auth_has_role('{operations_manager,maintenance_manager,slickline_supervisor,slickline_operator}') and exists (select 1 from wires c where c.id = wire_id and c.country_id = auth_country()))
  with check (auth_has_role('{operations_manager,maintenance_manager,slickline_supervisor,slickline_operator}') and exists (select 1 from wires c where c.id = wire_id and c.country_id = auth_country()));
create policy wires_write on wires for all using (country_id = auth_country() and auth_has_role('{operations_manager,maintenance_manager}')) with check (country_id = auth_country());

create policy kdocs_write on knowledge_docs for all using (country_id = auth_country() and auth_has_role('{sqm,operations_manager}')) with check (country_id = auth_country());
create policy quick_plan_write on quick_plan_cards for all using (country_id = auth_country() and auth_has_role('{operations_manager,sdm,deputy_sdm,sales}')) with check (country_id = auth_country());
create policy jra_templates_write on jra_templates for all using (country_id = auth_country() and auth_has_role('{sqm}')) with check (country_id = auth_country());
create policy audit_insert on audit_log for insert with check (country_id = auth_country());
-- doc_counters: read-only to users; writes only through next_doc_no() (security definer).
