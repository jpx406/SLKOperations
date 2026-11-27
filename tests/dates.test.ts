import { describe, expect, it } from 'vitest';
import { riyadhDate, riyadhDay, riyadhMonth, riyadhStamp, stampText } from '../src/shared/dates';

describe('Riyadh dates', () => {
  it('turns the day and month over at midnight Riyadh time, three hours before UTC', () => {
    expect(riyadhDay(Date.parse('2026-11-30T20:59:00Z'))).toBe('2026-11-30');
    expect(riyadhDay(Date.parse('2026-11-30T21:00:00Z'))).toBe('2026-12-01');
    expect(riyadhMonth(Date.parse('2026-11-30T21:30:00Z'))).toBe('2026-12');
  });

  it('prints moments in Riyadh time', () => {
    expect(riyadhStamp('2026-11-27T11:05:00Z')).toBe('27 Nov 2026, 14:05');
    expect(stampText('2026-11-27T11:05:00Z')).toBe('27 Nov 2026, 14:05 Riyadh');
    expect(riyadhDate('2026-11-27T22:00:00Z')).toBe('28 Nov 2026');
    expect(riyadhStamp(null)).toBe('—');
  });
});
