import { describe, expect, it } from 'vitest';
import { ROUND_SIZES } from '../constants';
import { emptySave, normalizeSave, withBestTime, withRoundStats, withSkin } from '../save';

describe('save shape (v2)', () => {
  it('normalizes missing/garbage data to the canonical v2 shape', () => {
    expect(normalizeSave(undefined)).toEqual({
      v: 2,
      bestMs: { 25: null, 50: null, 100: null },
      stats: { roundsPlayed: 0, totalPulled: 0, bestStreak: 0 },
      skin: 0,
    });
    expect(normalizeSave(null)).toEqual(emptySave());
    expect(normalizeSave('junk')).toEqual(emptySave());
    expect(normalizeSave({ v: 2 })).toEqual(emptySave());
    expect(normalizeSave({ bestMs: 'nope' })).toEqual(emptySave());
  });

  it('keeps valid per-size best times and drops invalid ones', () => {
    const save = normalizeSave({
      v: 2,
      bestMs: { 25: 12345, 50: -5, 100: 'fast', extra: 1 },
    });
    expect(save.bestMs[25]).toBe(12345);
    expect(save.bestMs[50]).toBeNull();
    expect(save.bestMs[100]).toBeNull();
    // JSON round-trip keeps the numeric-keyed record readable.
    expect(normalizeSave(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });
});

describe('v1 -> v2 migration', () => {
  it('migrates a v1 payload, zero-filling stats and skin', () => {
    const save = normalizeSave({ v: 1, bestMs: { 25: 18000, 50: 40000 } });
    expect(save.v).toBe(2);
    expect(save.bestMs[25]).toBe(18000);
    expect(save.bestMs[50]).toBe(40000);
    expect(save.bestMs[100]).toBeNull();
    expect(save.stats).toEqual({ roundsPlayed: 0, totalPulled: 0, bestStreak: 0 });
    expect(save.skin).toBe(0);
  });

  it('keeps valid v2 stats and coerces garbage ones to zero', () => {
    const save = normalizeSave({
      v: 2,
      bestMs: { 100: 90000 },
      stats: { roundsPlayed: 312, totalPulled: 8010, bestStreak: 18 },
      skin: 2,
    });
    expect(save.stats).toEqual({ roundsPlayed: 312, totalPulled: 8010, bestStreak: 18 });
    expect(save.skin).toBe(2);

    const junk = normalizeSave({
      v: 2,
      stats: { roundsPlayed: -3, totalPulled: 'lots', bestStreak: Number.NaN },
      skin: -1,
    });
    expect(junk.stats).toEqual({ roundsPlayed: 0, totalPulled: 0, bestStreak: 0 });
    expect(junk.skin).toBe(0);
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
    // Input untouched; stats and skin carried across.
    expect(save.bestMs[50]).toBeNull();
    expect(next.stats).toEqual(save.stats);
    expect(next.skin).toBe(save.skin);
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

describe('round stats accumulation', () => {
  it('counts rounds and pulls and raises the global best streak', () => {
    let save = emptySave();
    save = withRoundStats(save, 25, 7);
    expect(save.stats).toEqual({ roundsPlayed: 1, totalPulled: 25, bestStreak: 7 });

    save = withRoundStats(save, 50, 5); // lower peak streak: bestStreak holds
    expect(save.stats).toEqual({ roundsPlayed: 2, totalPulled: 75, bestStreak: 7 });

    save = withRoundStats(save, 100, 18);
    expect(save.stats).toEqual({ roundsPlayed: 3, totalPulled: 175, bestStreak: 18 });
  });

  it('never mutates the input save', () => {
    const save = normalizeSave({ stats: { roundsPlayed: 4, totalPulled: 90, bestStreak: 3 } });
    const next = withRoundStats(save, 25, 9);
    expect(save.stats).toEqual({ roundsPlayed: 4, totalPulled: 90, bestStreak: 3 });
    expect(next.stats.roundsPlayed).toBe(5);
  });
});

describe('skin selection', () => {
  it('persists a new skin index without touching anything else', () => {
    const save = normalizeSave({ bestMs: { 25: 9000 }, skin: 0 });
    const next = withSkin(save, 2);
    expect(next.skin).toBe(2);
    expect(next.bestMs[25]).toBe(9000);
    expect(save.skin).toBe(0);
    expect(withSkin(next, 2)).toBe(next); // no-op keeps identity
  });
});
