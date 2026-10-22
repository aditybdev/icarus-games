import { describe, expect, it } from 'vitest';
import { dailyLevelIndex, DAILY_LEVEL_COUNT } from './daily';
import { LEVELS } from './levels';

/** UTC-noon date for a given day, avoiding DST edge noise. */
function day(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

describe('dailyLevelIndex (Daily Fold picker)', () => {
  it('is deterministic for the same UTC date', () => {
    const a = dailyLevelIndex(day(2026, 3, 14));
    const b = dailyLevelIndex(new Date('2026-03-14T23:59:59Z'));
    expect(a).toBe(b);
    expect(LEVELS[a]).toBeDefined();
  });

  it('always returns a valid level index', () => {
    for (let d = 1; d <= 28; d++) {
      const i = dailyLevelIndex(day(2026, 2, d));
      expect(Number.isInteger(i)).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(DAILY_LEVEL_COUNT);
      expect(i).toBeLessThan(LEVELS.length);
    }
  });

  it('varies across different dates', () => {
    const seen = new Set<number>();
    for (let d = 1; d <= 31; d++) seen.add(dailyLevelIndex(day(2026, 1, d)));
    // 31 days over 30 levels: a fixed PRNG will repeat some, but must not
    // collapse onto a single level.
    expect(seen.size).toBeGreaterThan(1);
  });

  it('respects an explicit level count', () => {
    const i = dailyLevelIndex(day(2026, 3, 14), 5);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(5);
  });
});
