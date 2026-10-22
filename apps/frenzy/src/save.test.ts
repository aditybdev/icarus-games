import { describe, expect, it } from 'vitest';
import { masteryFor } from './sim/rules';
import {
  DEFAULT_SAVE,
  normalizeSave,
  withDailyCompletion,
  type SaveData,
} from './save';

describe('normalizeSave', () => {
  it('returns defaults for garbage input', () => {
    expect(normalizeSave(undefined)).toEqual(DEFAULT_SAVE);
    expect(normalizeSave(null)).toEqual(DEFAULT_SAVE);
    expect(normalizeSave('junk')).toEqual(DEFAULT_SAVE);
    expect(normalizeSave({ v: 2 })).toEqual(DEFAULT_SAVE);
  });

  it('keeps valid fields and fills daily defaults for pre-daily saves', () => {
    const old = { v: 1, bestTimeMs: 42_000, bestRank: 'A', sfx: false };
    const save = normalizeSave(old);
    expect(save.bestTimeMs).toBe(42_000);
    expect(save.bestRank).toBe('A');
    expect(save.sfx).toBe(false);
    expect(save.dailyLast).toBe('');
    expect(save.dailyStreak).toBe(0);
    expect(save.dailyBestMs).toBeNull();
  });

  it('sanitizes corrupt best time and rank', () => {
    expect(normalizeSave({ v: 1, bestTimeMs: -5, bestRank: 42 }).bestTimeMs).toBeNull();
    expect(normalizeSave({ v: 1, bestTimeMs: Number.NaN }).bestTimeMs).toBeNull();
    expect(normalizeSave({ v: 1, bestTimeMs: 5000, bestRank: 42 }).bestRank).toBeNull();
  });

  it('resets dailyBestMs when the stored day differs from today', () => {
    const stored: SaveData = {
      ...DEFAULT_SAVE,
      dailyLast: '2026-10-22',
      dailyStreak: 3,
      dailyBestMs: 31_000,
    };
    const rolled = normalizeSave(stored, '2026-10-23');
    expect(rolled.dailyBestMs).toBeNull();
    expect(rolled.dailyLast).toBe('2026-10-22');
    expect(rolled.dailyStreak).toBe(3);
    const sameDay = normalizeSave(stored, '2026-10-22');
    expect(sameDay.dailyBestMs).toBe(31_000);
  });
});

describe('withDailyCompletion', () => {
  it('first completion starts the streak and sets the daily best', () => {
    const r = withDailyCompletion(DEFAULT_SAVE, '2026-10-23', 33_000);
    expect(r.streak).toBe(1);
    expect(r.improved).toBe(true);
    expect(r.save.dailyLast).toBe('2026-10-23');
    expect(r.save.dailyBestMs).toBe(33_000);
  });

  it('same-day replays keep the streak and the faster time', () => {
    const first = withDailyCompletion(DEFAULT_SAVE, '2026-10-23', 33_000).save;
    const slower = withDailyCompletion(first, '2026-10-23', 40_000);
    expect(slower.streak).toBe(1);
    expect(slower.improved).toBe(false);
    expect(slower.save.dailyBestMs).toBe(33_000);
    const faster = withDailyCompletion(first, '2026-10-23', 29_000);
    expect(faster.improved).toBe(true);
    expect(faster.save.dailyBestMs).toBe(29_000);
  });

  it('a next-day completion extends the streak and resets the daily best', () => {
    const day1 = withDailyCompletion(DEFAULT_SAVE, '2026-10-22', 33_000).save;
    const day2 = withDailyCompletion(day1, '2026-10-23', 41_000);
    expect(day2.streak).toBe(2);
    expect(day2.improved).toBe(true);
    expect(day2.save.dailyBestMs).toBe(41_000);
  });

  it('a gap restarts the streak at 1', () => {
    const day1 = withDailyCompletion(DEFAULT_SAVE, '2026-10-20', 33_000).save;
    const day3 = withDailyCompletion(day1, '2026-10-23', 35_000);
    expect(day3.streak).toBe(1);
    expect(day3.save.dailyBestMs).toBe(35_000);
  });

  it('never mutates the input save', () => {
    const frozen: SaveData = Object.freeze({
      ...DEFAULT_SAVE,
      dailyLast: '2026-10-22',
      dailyStreak: 5,
      dailyBestMs: 30_000,
    });
    const r = withDailyCompletion(frozen, '2026-10-23', 28_000);
    expect(frozen.dailyBestMs).toBe(30_000);
    expect(r.save).not.toBe(frozen);
  });
});

describe('masteryFor', () => {
  it('is 0 with no finish and 1000 at S pace', () => {
    expect(masteryFor(null)).toBe(0);
    expect(masteryFor(30_000)).toBe(1000);
    expect(masteryFor(25_000)).toBe(1000);
  });

  it('hits the rank anchors and interpolates within bands', () => {
    expect(masteryFor(65_001)).toBe(200);
    expect(masteryFor(90_000)).toBe(200);
    expect(masteryFor(65_000)).toBe(500);
    expect(masteryFor(45_000)).toBe(750);
    expect(masteryFor(55_000)).toBe(625);
    expect(masteryFor(37_500)).toBe(875);
  });

  it('never returns out-of-range or NaN for degenerate input', () => {
    expect(masteryFor(0)).toBe(0);
    expect(masteryFor(-5)).toBe(0);
    expect(masteryFor(Number.NaN)).toBe(0);
  });
});
