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
}

export interface WgStatus {
  resources: { resource: string; finished_at: string | null; rows_seen: number | null; error: string | null }[];
  counts: {
    units: number; wires: number; drums: number; runs: number; runs_pending: number; cut_only_rows: number;
    documents: number; alerts: number; countries_seen: string[]; wg_build: string | null;
  };
}
