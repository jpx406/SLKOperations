// Inventories (S18 explosive, S19 hardware, S29 MCR) share one append-only ledger: balances are the sum of movements,
// a movement is never edited, and a mistake is reversed with an undo movement. These rules say which moves make sense.

export const INVENTORIES = ['explosive', 'hardware', 'mcr'] as const;
export type Inventory = (typeof INVENTORIES)[number];
export const INVENTORY_MENU: Record<Inventory, string> = { explosive: 'inventory_explosive', hardware: 'inventory_hardware', mcr: 'inventory_mcr' };
export const INVENTORY_LABEL: Record<Inventory, string> = { explosive: 'Explosive inventory', hardware: 'Hardware inventory', mcr: 'MCR inventory' };

/** Default categories per inventory (slickline: power charges and igniters for setting tools, punch and cutter charges). */
export const CATEGORIES: Record<Inventory, string[]> = {
  explosive: ['Power charges', 'Igniters', 'Tubing punch charges', 'Cutter charges', 'Detonators', 'Boosters', 'Detonating cord'],
  hardware: ['Setting tools', 'Running and pulling tools', 'Gauge rings and cutters', 'Lock mandrels', 'Plugs and prongs', 'Wire and consumables', 'Spares'],
  mcr: ['Plugs', 'Lock mandrels', 'Equalizing prongs', 'Gas lift valves', 'Seal kits', 'Accessories'],
};

export type CountsAs = 'on_hand' | 'at_well' | 'on_order' | 'used' | 'junk' | 'external';

/** Locations a country gets the first time its inventory is opened (same as the seed for Saudi Arabia). */
export const DEFAULT_LOCATIONS: Record<Inventory, [code: string, label: string, counts: CountsAs][]> = {
  explosive: [['bunker', 'Explosive Bunker', 'on_hand'], ['shop', 'Slickline Shop', 'on_hand'], ['at_location', 'At Location', 'at_well'], ['fired', 'Used (Fired)', 'used'], ['junk', 'Junk', 'junk'], ['on_order', 'On Order', 'on_order'], ['supplier', 'Supplier', 'external']],
  hardware: [['warehouse', 'Warehouse', 'on_hand'], ['shop', 'Slickline Shop', 'on_hand'], ['on_unit', 'On Unit', 'on_hand'], ['at_location', 'At Location', 'at_well'], ['left_in_hole', 'Left in Hole', 'used'], ['junk', 'Junk', 'junk'], ['on_order', 'On Order', 'on_order'], ['supplier', 'Supplier', 'external']],
  mcr: [['warehouse', 'Warehouse', 'on_hand'], ['shop', 'Slickline Shop', 'on_hand'], ['at_location', 'At Location', 'at_well'], ['consumed', 'Consumed', 'used'], ['on_order', 'On Order', 'on_order'], ['supplier', 'Supplier', 'external']],
};
export interface Location { id: string; code: string; label: string; counts_as: CountsAs; sort: number }

export const KINDS = ['receive', 'order', 'transfer', 'mobilize', 'consume', 'return', 'junk', 'adjust'] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind | 'undo', string> = {
  receive: 'Receive', order: 'Order', transfer: 'Transfer', mobilize: 'Mobilize to well', consume: 'Consume', return: 'Return from well',
  junk: 'Junk', adjust: 'Count adjustment', undo: 'Undo',
};

/** Allowed source and destination per kind. null = outside the ledger (a delivery or a count correction). */
export const MOVE_RULES: Record<Kind, { from: (CountsAs | null)[]; to: (CountsAs | null)[]; needsJob?: boolean }> = {
  receive: { from: [null, 'on_order'], to: ['on_hand'] },
  order: { from: [null], to: ['on_order'] },
  transfer: { from: ['on_hand'], to: ['on_hand'] },
  mobilize: { from: ['on_hand'], to: ['at_well'], needsJob: true },
  consume: { from: ['at_well'], to: ['used'], needsJob: true },
  return: { from: ['at_well'], to: ['on_hand', 'external'], needsJob: true },
  junk: { from: ['on_hand', 'at_well'], to: ['junk'] },
  adjust: { from: [null, 'on_hand'], to: [null, 'on_hand'] },
};

export interface MovementInput { kind: string; from: Location | null; to: Location | null; lines: { item_id: string; qty: number }[]; job_id?: string | null; well?: string | null }

/** Checks a movement before it is written. The database still refuses anything that would take a location below zero. */
export function checkMovement(m: MovementInput): string | null {
  if (!(KINDS as readonly string[]).includes(m.kind)) return 'Unknown movement';
  const r = MOVE_RULES[m.kind as Kind];
  if (!r.from.includes(m.from?.counts_as ?? null)) return m.from ? `${KIND_LABEL[m.kind as Kind]} can't start from ${m.from.label}` : 'Pick where it comes from';
  if (!r.to.includes(m.to?.counts_as ?? null)) return m.to ? `${KIND_LABEL[m.kind as Kind]} can't go to ${m.to.label}` : 'Pick where it goes';
  if (!m.from && !m.to) return 'Pick a location';
  if (m.kind === 'adjust' && m.from && m.to) return 'A count adjustment adds to or takes from one location';
  if (m.from && m.to && m.from.id === m.to.id) return 'From and to are the same place';
  if (r.needsJob && !m.job_id && !String(m.well ?? '').trim()) return 'Pick the job or type the well';
  if (!m.lines.length) return 'Add at least one item';
  if (m.lines.length > 50) return 'At most 50 items per movement';
  if (new Set(m.lines.map((l) => l.item_id)).size !== m.lines.length) return 'An item is listed twice';
  if (m.lines.some((l) => !Number.isFinite(l.qty) || l.qty <= 0 || l.qty > 100000)) return 'Quantities must be more than 0';
  return null;
}

export interface LedgerRow { item_id: string; qty: number; kind: string; from_counts: CountsAs | null; to_counts: CountsAs | null; job_id: string | null; well: string | null }

/**
 * Job reconciliation (S20): per job and well, what went to the well should equal what was consumed, junked or brought back.
 * Undo movements count in the direction they move, so a reversed mistake nets out.
 */
export function reconcile(rows: LedgerRow[]) {
  const map = new Map<string, { job_id: string | null; well: string | null; item_id: string; mobilized: number; consumed: number; returned: number; junked: number }>();
  for (const r of rows) {
    if (r.from_counts !== 'at_well' && r.to_counts !== 'at_well') continue;
    // an undo is its original seen in the mirror: take it off the column the original added to
    const undo = r.kind === 'undo';
    const [fromC, toC, sign] = undo ? [r.to_counts, r.from_counts, -1] : [r.from_counts, r.to_counts, 1];
    const k = `${r.job_id ?? ''}|${(r.well ?? '').toLowerCase()}|${r.item_id}`;
    const e = map.get(k) ?? { job_id: r.job_id, well: r.well, item_id: r.item_id, mobilized: 0, consumed: 0, returned: 0, junked: 0 };
    if (toC === 'at_well') e.mobilized += sign * r.qty;
    if (fromC === 'at_well') {
      if (toC === 'used') e.consumed += sign * r.qty;
      else if (toC === 'junk') e.junked += sign * r.qty;
      else e.returned += sign * r.qty;
    }
    map.set(k, e);
  }
  return [...map.values()].map((e) => ({ ...e, open: Math.round((e.mobilized - e.consumed - e.returned - e.junked) * 1000) / 1000 }));
}

/** Items below their par level (MCR reorder banner). Par compares with stock that can be used: on hand. */
export function belowPar(items: { id: string; description: string; par_level: number | null }[], onHand: Map<string, number>) {
  return items.filter((i) => i.par_level != null && (onHand.get(i.id) ?? 0) < i.par_level).map((i) => ({ ...i, on_hand: onHand.get(i.id) ?? 0 }));
}
