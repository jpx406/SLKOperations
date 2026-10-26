// Unit events on the schedule, as the WL Operations Hub splits them: maintenance events (with a type) and unit
// status events (loan, transferred, junk, backup on location), which may stay open with no end date.

export const MAINTENANCE_TYPES = ['Cable Maintenance', 'Mechanic', 'Electrical', 'Hydraulic', 'Pressure Test', 'Inspection / Certification', 'Other'] as const;

export const STATUS_KINDS = ['loan', 'transferred', 'junk', 'backup_on_location'] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

export const EVENT_LABEL: Record<string, string> = {
  maintenance: 'Maintenance', loan: 'Loan', transferred: 'Transferred', junk: 'Junk', backup_on_location: 'Backup on location',
};

/** ends_on for a status event with no end date yet. */
export const OPEN_END = '9999-12-31';
export const isOpenEnd = (d: string | null | undefined) => d === OPEN_END;
