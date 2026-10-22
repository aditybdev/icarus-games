import { describe, expect, it } from 'vitest';
import { ROUND_SIZES } from '../constants';
import { emptySave, normalizeSave, withBestTime } from '../save';

describe('save shape', () => {
  it('normalizes missing/garbage data to the canonical shape', () => {
    expect(normalizeSave(undefined)).toEqual({
      v: 1,
      bestMs: { 25: null, 50: null, 100: null },
    });
    expect(normalizeSave(null)).toEqual(emptySave());
    expect(normalizeSave('junk')).toEqual(emptySave());
    expect(normalizeSave({ v: 1 })).toEqual(emptySave());
    expect(normalizeSave({ bestMs: 'nope' })).toEqual(emptySave());
  });

  it('keeps valid per-size best times and drops invalid ones', () => {
    const save = normalizeSave({
      v: 1,
      bestMs: { 25: 12345, 50: -5, 100: 'fast', extra: 1 },
    });
    expect(save.bestMs[25]).toBe(12345);
    expect(save.bestMs[50]).toBeNull();
    expect(save.bestMs[100]).toBeNull();
    // JSON round-trip keeps the numeric-keyed record readable.
    expect(normalizeSave(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });
});

describe('best-time updates per round size', () => {
  it('records the first time for a size as an improvement', () => {
    const save = emptySave();
    const { save: next, improved } = withBestTime(save, 50, 20123);
    expect(improved).toBe(true);
    expect(next.bestMs[50]).toBe(20123);
    expect(next.bestMs[25]).toBeNull();
    expect(next.bestMs[100]).toBeNull();
    // Input untouched.
    expect(save.bestMs[50]).toBeNull();
  });

  it('only improves when the new time is strictly faster', () => {
    const start = normalizeSave({ bestMs: { 25: 10000 } });

    const slower = withBestTime(start, 25, 12000);
    expect(slower.improved).toBe(false);
    expect(slower.save).toBe(start); // unchanged identity

    const equal = withBestTime(start, 25, 10000);
    expect(equal.improved).toBe(false);

    const faster = withBestTime(start, 25, 9876);
    expect(faster.improved).toBe(true);
    expect(faster.save.bestMs[25]).toBe(9876);
  });

  it('tracks best times independently for every round size', () => {
    let save = emptySave();
    for (const [i, size] of ROUND_SIZES.entries()) {
      const result = withBestTime(save, size, 5000 + i * 1000);
      save = result.save;
      expect(result.improved).toBe(true);
    }
    expect(save.bestMs).toEqual({ 25: 5000, 50: 6000, 100: 7000 });

    // A slow 100-run must not touch the 25/50 records.
    const res = withBestTime(save, 100, 99999);
    expect(res.improved).toBe(false);
    expect(res.save.bestMs[25]).toBe(5000);
    expect(res.save.bestMs[50]).toBe(6000);
  });
});
