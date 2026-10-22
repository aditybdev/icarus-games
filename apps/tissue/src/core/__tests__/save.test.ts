import { describe, expect, it } from 'vitest';
import { ROUND_SIZES } from '../constants';
import {
  emptySave,
  masteryFor,
  normalizeSave,
  withBestTime,
  withDailyCompletion,
  withRoundStats,
  withSkin,
} from '../save';

describe('save shape (v2)', () => {
  it('normalizes missing/garbage data to the canonical v2 shape', () => {
    expect(normalizeSave(undefined)).toEqual({
      v: 2,
      bestMs: { 25: null, 50: null, 100: null },
      stats: { roundsPlayed: 0, totalPulled: 0, bestStreak: 0 },
      skin: 0,
      dailyLast: '',
      dailyStreak: 0,
      dailyBestMs: null,
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

describe('daily fields (Icarus Daily)', () => {
  it('defaults cleanly for old saves that predate the daily fields', () => {
    const save = normalizeSave({ v: 2, bestMs: { 25: 9000 }, skin: 1 });
    expect(save.dailyLast).toBe('');
    expect(save.dailyStreak).toBe(0);
    expect(save.dailyBestMs).toBeNull();
    // The rest of the payload is untouched.
    expect(save.bestMs[25]).toBe(9000);
    expect(save.skin).toBe(1);
  });

  it('keeps valid daily fields and coerces garbage ones', () => {
    const save = normalizeSave({
      v: 2,
      dailyLast: '2026-10-22',
      dailyStreak: 7,
      dailyBestMs: 15234,
    });
    expect(save.dailyLast).toBe('2026-10-22');
    expect(save.dailyStreak).toBe(7);
    expect(save.dailyBestMs).toBe(15234);
    // JSON round-trip keeps the fields readable.
    expect(normalizeSave(JSON.parse(JSON.stringify(save)))).toEqual(save);

    const junk = normalizeSave({
      v: 2,
      dailyLast: 42,
      dailyStreak: -3,
      dailyBestMs: 'fast',
    });
    expect(junk.dailyLast).toBe('');
    expect(junk.dailyStreak).toBe(0);
    expect(junk.dailyBestMs).toBeNull();
  });

  it('resets dailyBestMs at load when the stored day is not today', () => {
    const raw = {
      v: 2,
      dailyLast: '2026-10-22',
      dailyStreak: 3,
      dailyBestMs: 15234,
    };
    const rolled = normalizeSave(raw, '2026-10-23');
    expect(rolled.dailyBestMs).toBeNull();
    // Last day and streak survive the rollover (streak math is shared kit).
    expect(rolled.dailyLast).toBe('2026-10-22');
    expect(rolled.dailyStreak).toBe(3);

    const sameDay = normalizeSave(raw, '2026-10-22');
    expect(sameDay.dailyBestMs).toBe(15234);
  });
});

describe('daily completion', () => {
  it('stamps today, starts the streak at 1 and records the first time', () => {
    const save = emptySave();
    const { save: next, improved, streak } = withDailyCompletion(save, '2026-10-23', 20123);
    expect(improved).toBe(true);
    expect(streak).toBe(1);
    expect(next.dailyLast).toBe('2026-10-23');
    expect(next.dailyStreak).toBe(1);
    expect(next.dailyBestMs).toBe(20123);
    // Input untouched.
    expect(save.dailyLast).toBe('');
    expect(save.dailyBestMs).toBeNull();
  });

  it('same-day replays keep the streak and only improve on a faster run', () => {
    let save = withDailyCompletion(emptySave(), '2026-10-23', 20123).save;

    const slower = withDailyCompletion(save, '2026-10-23', 25000);
    expect(slower.improved).toBe(false);
    expect(slower.streak).toBe(1); // same day: streak untouched
    expect(slower.save.dailyBestMs).toBe(20123);

    save = slower.save;
    const faster = withDailyCompletion(save, '2026-10-23', 18000);
    expect(faster.improved).toBe(true);
    expect(faster.streak).toBe(1);
    expect(faster.save.dailyBestMs).toBe(18000);
  });

  it('a next-day completion extends the streak and starts a fresh best', () => {
    const day1 = withDailyCompletion(emptySave(), '2026-10-22', 20123).save;
    const day2 = withDailyCompletion(day1, '2026-10-23', 26000);
    expect(day2.improved).toBe(true); // yesterday's best is stale
    expect(day2.streak).toBe(2);
    expect(day2.save.dailyLast).toBe('2026-10-23');
    expect(day2.save.dailyBestMs).toBe(26000);
    expect(day1.dailyStreak).toBe(1); // input untouched
  });

  it('a missed day restarts the streak at 1', () => {
    const old = withDailyCompletion(emptySave(), '2026-10-20', 20123).save;
    const afterGap = withDailyCompletion(old, '2026-10-23', 22000);
    expect(afterGap.streak).toBe(1);
    expect(afterGap.improved).toBe(true);
    expect(afterGap.save.dailyBestMs).toBe(22000);
  });
});

describe('masteryFor', () => {
  it('is 0 with no finishes and 1000 at gold pace on all sizes', () => {
    expect(masteryFor(emptySave())).toBe(0);
    const save = emptySave();
    save.bestMs = { 25: 15500, 50: 32000, 100: 65000 };
    expect(masteryFor(save)).toBe(1000);
  });

  it('any finish earns 200 per size; anchors interpolate within bands', () => {
    const save = emptySave();
    save.bestMs = { 25: 40000, 50: null, 100: null };
    expect(masteryFor(save)).toBe(Math.round(200 / 3));
    const bronze = emptySave();
    bronze.bestMs = { 25: 30000, 50: 62000, 100: 130000 };
    expect(masteryFor(bronze)).toBe(450);
    const silver = emptySave();
    silver.bestMs = { 25: 20000, 50: 42000, 100: 88000 };
    expect(masteryFor(silver)).toBe(700);
    const mid = emptySave();
    mid.bestMs = { 25: 25000, 50: null, 100: null }; // halfway bronze→silver on 25
    expect(masteryFor(mid)).toBe(Math.round(575 / 3));
  });

  it('never returns NaN for degenerate input', () => {
    const save = emptySave();
    save.bestMs = { 25: 0, 50: -3, 100: Number.NaN };
    expect(masteryFor(save)).toBe(0);
  });
});

describe('normalizeSave settings passthrough', () => {
  it('keeps boolean settings and omits non-booleans', () => {
    const save = normalizeSave({ v: 2, sfx: false, haptics: 'yes', reducedMotion: true });
    expect(save.sfx).toBe(false);
    expect(save.haptics).toBeUndefined();
    expect(save.reducedMotion).toBe(true);
  });
});
