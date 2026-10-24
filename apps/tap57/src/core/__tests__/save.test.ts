import { describe, expect, it } from 'vitest';
import { medalFor, nextMedalPts, bestMedal } from '../scoring';
import { emptySave, masteryFor, normalizeSave, withBottle, withDailyCompletion, withRushResult } from '../save';
import { bottleUnlockHint, bottleUnlocked, resolveBottle } from '../bottles';

describe('medals', () => {
  it('threshold boundaries', () => {
    expect(medalFor(179)).toBeNull();
    expect(medalFor(180)).toBe('bronze');
    expect(medalFor(299)).toBe('bronze');
    expect(medalFor(300)).toBe('silver');
    expect(medalFor(419)).toBe('silver');
    expect(medalFor(420)).toBe('gold');
    expect(medalFor(500)).toBe('gold');
  });

  it('nextMedalPts is the near-miss gap; null past gold', () => {
    expect(nextMedalPts(0)).toEqual({ medal: 'bronze', gap: 180 });
    expect(nextMedalPts(181)).toEqual({ medal: 'silver', gap: 119 });
    expect(nextMedalPts(419)).toEqual({ medal: 'gold', gap: 1 });
    expect(nextMedalPts(420)).toBeNull();
  });

  it('bestMedal keeps the higher tier', () => {
    expect(bestMedal(null, 'bronze')).toBe('bronze');
    expect(bestMedal('gold', 'silver')).toBe('gold');
    expect(bestMedal('bronze', null)).toBe('bronze');
  });
});

describe('save', () => {
  it('normalizes junk and wrong versions to an empty save', () => {
    expect(normalizeSave(undefined)).toEqual(emptySave());
    expect(normalizeSave({ v: 2, bestRush: 400 })).toEqual(emptySave());
    expect(normalizeSave('garbage')).toEqual(emptySave());
  });

  it('keeps valid fields, defaults the rest', () => {
    const s = normalizeSave({ v: 1, bestRush: 321, medal: 'silver', stats: { serves: 4, plated: 2, splats: 1, taps: 40 }, bottle: 1 });
    expect(s.bestRush).toBe(321);
    expect(s.medal).toBe('silver');
    expect(s.stats.serves).toBe(4);
    expect(s.sfx).toBe(true);
    expect(s.bottle).toBe(1);
  });

  it('withRushResult accumulates stats, keeps bests, stays immutable', () => {
    const s0 = emptySave();
    const s1 = withRushResult(s0, { total: 200, medal: 'bronze', orders: 5, plated: 1, splats: 1, taps: 30 });
    expect(s1.bestRush).toBe(200);
    expect(s1.medal).toBe('bronze');
    expect(s1.stats).toEqual({ serves: 5, plated: 1, splats: 1, taps: 30 });
    const s2 = withRushResult(s1, { total: 150, medal: null, orders: 5, plated: 0, splats: 2, taps: 25 });
    expect(s2.bestRush).toBe(200); // never regresses
    expect(s2.medal).toBe('bronze');
    expect(s2.stats).toEqual({ serves: 10, plated: 1, splats: 3, taps: 55 });
    expect(s0.stats.serves).toBe(0); // inputs untouched
  });

  it('daily completion tracks streaks across consecutive days', () => {
    let s = emptySave();
    s = withDailyCompletion(s, '2026-10-22', 300);
    expect(s.dailyStreak).toBe(1);
    expect(s.dailyBest).toBe(300);
    s = withDailyCompletion(s, '2026-10-23', 250);
    expect(s.dailyStreak).toBe(2);
    expect(s.dailyBest).toBe(300);
    s = withDailyCompletion(s, '2026-10-23', 350); // same day: best only
    expect(s.dailyStreak).toBe(2);
    expect(s.dailyBest).toBe(350);
    s = withDailyCompletion(s, '2026-10-25', 100); // gap: streak resets
    expect(s.dailyStreak).toBe(1);
  });

  it('mastery is 0 empty, capped at 1000, monotone', () => {
    expect(masteryFor(emptySave())).toBe(0);
    const rich = withDailyCompletion({ ...emptySave(), bestRush: 500 }, '2026-10-24', 500);
    expect(masteryFor(rich)).toBe(1000);
    const mid = { ...emptySave(), bestRush: 210 };
    expect(masteryFor(mid)).toBeGreaterThan(0);
    expect(masteryFor(mid)).toBeLessThan(1000);
  });
});

describe('bottles', () => {
  it('unlock rules: classic free, mustard by serves, sriracha by gold', () => {
    const s0 = emptySave();
    expect(bottleUnlocked(0, s0)).toBe(true);
    expect(bottleUnlocked(1, s0)).toBe(false);
    expect(bottleUnlocked(2, s0)).toBe(false);
    const served = { ...emptySave(), stats: { serves: 10, plated: 0, splats: 0, taps: 0 } };
    expect(bottleUnlocked(1, served)).toBe(true);
    expect(bottleUnlocked(2, served)).toBe(false);
    expect(bottleUnlocked(2, { ...emptySave(), bestRush: 420 })).toBe(true);
  });

  it('resolveBottle falls back when the stored pick is locked', () => {
    expect(resolveBottle({ ...emptySave(), bottle: 2 })).toBe(0);
    const rich = { ...emptySave(), bottle: 2, bestRush: 430 };
    expect(resolveBottle(rich)).toBe(2);
  });

  it('hints name the earn condition', () => {
    expect(bottleUnlockHint(0)).toBe('');
    expect(bottleUnlockHint(1)).toContain('10');
    expect(bottleUnlockHint(2)).toContain('420');
  });

  it('withBottle stores the pick', () => {
    expect(withBottle(emptySave(), 1).bottle).toBe(1);
  });
});
