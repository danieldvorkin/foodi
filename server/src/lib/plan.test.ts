import { describe, expect, it } from 'vitest';
import { addDays, dayLabel, weekDates, weekLabel, weekStart } from '@foodi/shared';

describe('plan weeks', () => {
  it('starts weeks on Monday and walks days without timezone drift', () => {
    expect(weekStart('2026-09-17')).toBe('2026-09-14'); // a Thursday
    expect(weekStart('2026-09-14')).toBe('2026-09-14'); // Monday stays
    expect(weekStart('2026-09-20')).toBe('2026-09-14'); // Sunday belongs to the week before
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekDates('2026-09-17')).toEqual(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']);
  });
  it('labels days and weeks the way a person would', () => {
    expect(dayLabel('2026-09-17')).toBe('Thu 17 Sep');
    expect(dayLabel('2026-09-17', true)).toBe('Thu');
    expect(weekLabel('2026-09-14')).toBe('14–20 Sep');
    expect(weekLabel('2026-09-28')).toBe('28 Sep – 4 Oct');
  });
});
