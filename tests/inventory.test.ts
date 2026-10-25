import { describe, expect, it } from 'vitest';
import { belowPar, checkMovement, reconcile, type LedgerRow, type Location } from '../src/shared/inventory';
import { readAllowed, ruleFor } from '../src/worker/permissions';

const loc = (id: string, counts_as: Location['counts_as']): Location => ({ id, code: id, label: id, counts_as, sort: 0 });
const bunker = loc('bunker', 'on_hand'), shop = loc('shop', 'on_hand'), well = loc('well', 'at_well'), fired = loc('fired', 'used'), junk = loc('junk', 'junk'), order = loc('order', 'on_order');
const line = [{ item_id: 'i1', qty: 2 }];

describe('movement rules', () => {
  it('accepts the normal flows', () => {
    expect(checkMovement({ kind: 'receive', from: null, to: bunker, lines: line })).toBeNull();
    expect(checkMovement({ kind: 'receive', from: order, to: bunker, lines: line })).toBeNull();
    expect(checkMovement({ kind: 'mobilize', from: bunker, to: well, lines: line, well: 'W-1' })).toBeNull();
    expect(checkMovement({ kind: 'consume', from: well, to: fired, lines: line, job_id: 'j1' })).toBeNull();
    expect(checkMovement({ kind: 'return', from: well, to: shop, lines: line, well: 'W-1' })).toBeNull();
    expect(checkMovement({ kind: 'adjust', from: null, to: bunker, lines: line })).toBeNull();
  });
  it('refuses moves that make no sense', () => {
    expect(checkMovement({ kind: 'consume', from: bunker, to: fired, lines: line, well: 'W' })).toBe("Consume can't start from bunker");
    expect(checkMovement({ kind: 'mobilize', from: bunker, to: well, lines: line })).toBe('Pick the job or type the well');
    expect(checkMovement({ kind: 'transfer', from: bunker, to: bunker, lines: line })).toBe('From and to are the same place');
    expect(checkMovement({ kind: 'adjust', from: bunker, to: shop, lines: line })).toBe('A count adjustment adds to or takes from one location');
    expect(checkMovement({ kind: 'junk', from: fired, to: junk, lines: line })).toBe("Junk can't start from fired");
    expect(checkMovement({ kind: 'receive', from: null, to: bunker, lines: [{ item_id: 'i1', qty: 0 }] })).toBe('Quantities must be more than 0');
    expect(checkMovement({ kind: 'receive', from: null, to: bunker, lines: [...line, ...line] })).toBe('An item is listed twice');
    expect(checkMovement({ kind: 'steal', from: null, to: bunker, lines: line })).toBe('Unknown movement');
  });
});

describe('job reconciliation', () => {
  const r = (kind: string, qty: number, from: LedgerRow['from_counts'], to: LedgerRow['to_counts']): LedgerRow => ({ item_id: 'i1', qty, kind, from_counts: from, to_counts: to, job_id: 'j1', well: 'W-1' });
  it('balances mobilized against consumed, returned and junked', () => {
    expect(reconcile([r('mobilize', 5, 'on_hand', 'at_well'), r('consume', 3, 'at_well', 'used'), r('return', 1, 'at_well', 'on_hand')])[0])
      .toMatchObject({ mobilized: 5, consumed: 3, returned: 1, junked: 0, open: 1 });
  });
  it('nets an undo out of the column it reverses', () => {
    const rows = [r('mobilize', 4, 'on_hand', 'at_well'), r('consume', 3, 'at_well', 'used'), r('undo', 3, 'used', 'at_well')];
    expect(reconcile(rows)[0]).toMatchObject({ mobilized: 4, consumed: 0, open: 4 });
    expect(reconcile([r('mobilize', 4, 'on_hand', 'at_well'), r('undo', 4, 'at_well', 'on_hand')])[0]).toMatchObject({ mobilized: 0, returned: 0, open: 0 });
  });
  it('ignores stock that never went to a well', () => {
    expect(reconcile([r('receive', 10, null, 'on_hand'), r('transfer', 2, 'on_hand', 'on_hand')])).toEqual([]);
  });
});

describe('par levels and rights', () => {
  it('lists items below par', () => {
    const items = [{ id: 'a', description: 'Plug', par_level: 5 }, { id: 'b', description: 'Lock', par_level: null }, { id: 'c', description: 'Prong', par_level: 2 }];
    expect(belowPar(items, new Map([['a', 3], ['c', 2]])).map((i) => [i.description, i.on_hand])).toEqual([['Plug', 3]]);
  });
  it('keeps each inventory behind its own tab', () => {
    const explosiveOnly = { inventory_explosive: { view: true, edit: true, delete: false } };
    expect(readAllowed('/api/inventory/explosive/reconciliation', explosiveOnly)).toBe(true);
    expect(readAllowed('/api/inventory/hardware', explosiveOnly)).toBe(false);
    expect(ruleFor('POST', '/api/inventory/hardware/movements')?.menu).toBe('inventory_hardware');
    expect(ruleFor('POST', '/api/inventory/explosive/movements/x/undo')?.menu).toBe('inventory_explosive');
    expect(ruleFor('DELETE', '/api/inventory/explosive/items/x')).toBeUndefined();
  });
});
