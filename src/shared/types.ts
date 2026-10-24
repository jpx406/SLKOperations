import type { ToolPart, WireTest } from './toolstring';

export type Role =
  | 'admin' | 'operations_manager' | 'maintenance_manager' | 'sdm' | 'deputy_sdm' | 'sales' | 'director' | 'sqm'
  | 'slickline_supervisor' | 'slickline_operator' | 'assistant_operator' | 'crew' | 'viewer'
  | 'explosive_manager' | 'explosive_admin' | 'storekeeper' | 'attendance_admin' | 'slk_contact';

export type JobStatus = 'planned' | 'ongoing' | 'completed' | 'canceled';
export type YesNo = 'yes' | 'no' | 'na' | 'other';

export interface MenuRight { view: boolean; edit: boolean; delete: boolean }

export interface Me {
  username: string;
  fullName: string;
  role: Role;
  wgRole: string | null;
  countries: string[];
  menus: Record<string, MenuRight>;
}

export interface Job {
  id: string;
  country: string;
  ticket_no: string | null;
  drss_no: string | null;
  sdm_username: string | null;
  status: JobStatus;
  run_details: string | null;
  unit_number: string | null;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  field: string | null;
  rig: string | null;
  well: string | null;
  conveyance: string | null;
  arrived_at: string | null;
  rig_up_at: string | null;
  rig_down_at: string | null;
  runs_ok: number | null;
  runs_failed: number | null;
  max_depth_ft: number | null;
  tag_depth_ft: number | null;
  max_pull_lb: number | null;
  jarring_minutes: number | null;
  wire_cut_ft: number | null;
  npt_hours: number;
  failure: YesNo | null;
  op_hours_override: number | null;
  op_hours_auto: number | null;
  op_hours: number | null;
  job_efficiency_pct: number | null;
  run_efficiency_pct: number | null;
  services: string[];
  // Design extras
  dmr_no: string | null; program_in_place: number | null; third_party_required: YesNo | null;
  // 02 Preparation
  account_assignment: string | null; well_type: string | null;
  h2s_ppm: number | null; co2_pct: number | null; bht_f: number | null; bhp_psi: number | null; siwhp_psi: number | null;
  fluid_type: string | null; fluid_weight_pcf: number | null; solids_pct: number | null;
  target_depth_ft: number | null; top_interval_ft: number | null; completion_details: string | null; nipple_profile: string | null;
  sssv_depth_ft: number | null; min_restriction_in: number | null; max_inclination_deg: number | null;
  target_casing_type: string | null; target_casing_od: string | null; target_casing_weight_lbft: number | null; target_casing_grade: string | null;
  wellhead_connection: string | null; wire_serial_number: string | null; drum_no: string | null;
  pce_id: string | null; pressure_rating_psi: number | null; lubricator_length_ft: number | null; stuffing_box_type: string | null;
  grease_panel_id: string | null; max_tool_od_in: number | null; toolstring: ToolPart[]; toolstring_length_ft: number | null;
  stem_weight_lb: number | null; jar_type: string | null; special_setup: YesNo | null; special_setup_notes: string | null;
  // 03 Execution extras
  plug_type: string | null; max_overpull_lb: number | null; op_time_details: string | null;
  survey_details: Record<string, unknown>; fishing_details: Record<string, unknown>; perforation_details: Record<string, unknown>;
  // 04 Closure
  job_log_signed: YesNo | null; ticket_signed: YesNo | null; eight_min_facts_done: YesNo | null; prelim_report: YesNo | null; final_report: YesNo | null;
  job_package_url: string | null; report_closure_status: 'open' | 'pending_review' | 'closed' | 'na' | null; report_closure_date: string | null;
  gears_no: string | null; wellsite_audit: YesNo | null; wg_runs_logged: YesNo | null; service_order: string | null;
  failure_description: string | null; bonus_remarks: string | null; revenue_cents: number | null; revenue_currency: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Unit { unit_number: string; country: string; year: number | null; wg_active: number }

export interface Lookups {
  units: Unit[];
  jobTypes: string[];
  locations: string[];
  fields: string[];
  rigs: string[];
  conveyances: string[];
  /** Local lists by kind (well_type, casing_type, plug_type …) for the user's countries. */
  lists: Record<string, string[]>;
  pce: { id: string; country: string; label: string; kind: string; bore_in: number; rating_psi: number | null; length_ft: number | null; active: number }[];
  greasePanels: { id: string; country: string; label: string; panel_type: string | null; active: number }[];
  serviceProfiles: { job_type_name: string; domain: string | null; is_plug: number; is_fishing: number; is_memory: number; is_perforation: number; is_explosive: number }[];
}

export interface Employee { id: string; country: string; eid: string; full_name: string; title: string; crew_role: string | null }

export interface CrewMember { employee_id: string; crew_role: 'slickline_supervisor' | 'slickline_operator' | 'assistant_operator' | 'helper'; slot?: number; full_name?: string; eid?: string }

export interface JobCrew {
  headcount: { supervisors: number; operators: number; assistant_operators: number; helpers: number };
  crew: CrewMember[];
  caps: { supervisors: number; operators: number; assistant_operators: number; helpers: number };
}

export interface WireOptions {
  unit: string | null;
  drums: { drum_no: string; drum_position: string | null; wire_serial_number: string | null; wire_grade: string | null; wire_size: string | null;
    status: string | null; rated_mbl_lb: number | null; remaining_length_ft: number | null; spooled_length_ft: number | null }[];
  tests: (WireTest & { wire_serial_number: string })[];
  tensionDays: number;
}

export interface WgStatus {
  resources: { resource: string; finished_at: string | null; rows_seen: number | null; error: string | null }[];
  counts: {
    units: number; wires: number; drums: number; runs: number; runs_pending: number; cut_only_rows: number;
    documents: number; alerts: number; countries_seen: string[]; wg_build: string | null;
  };
}
