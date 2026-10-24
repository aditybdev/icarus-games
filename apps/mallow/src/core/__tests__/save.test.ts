import { describe, expect, it } from 'vitest';
import { medalFor, nextMedalPts, bestMedal } from '../scoring';
import { emptySave, masteryFor, normalizeSave, withDailyCompletion, withRushResult, withTreat } from '../save';
import { resolveTreat, treatUnlockHint, treatUnlocked } from '../treats';

describe('medals', () => {
  it('threshold boundaries', () => {
    expect(medalFor(179)).toBeNull();
    expect(medalFor(180)).toBe('bronze');
    expect(medalFor(300)).toBe('silver');
    expect(medalFor(420)).toBe('gold');
  });

  it('nextMedalPts is the near-miss gap; null past gold', () => {
    expect(nextMedalPts(0)).toEqual({ medal: 'bronze', gap: 180 });
    expect(nextMedalPts(419)).toEqual({ medal: 'gold', gap: 1 });
    expect(nextMedalPts(420)).toBeNull();
  });

  it('bestMedal keeps the higher tier', () => {
    expect(bestMedal(null, 'bronze')).toBe('bronze');
    expect(bestMedal('gold', 'silver')).toBe('gold');
  });
});

describe('save', () => {
  it('normalizes junk and wrong versions to an empty save', () => {
    expect(normalizeSave(undefined)).toEqual(emptySave());
    expect(normalizeSave({ v: 2, bestRush: 400 })).toEqual(emptySave());
  });

  it('keeps valid fields, defaults the rest', () => {
    const s = normalizeSave({ v: 1, bestRush: 321, medal: 'silver', stats: { serves: 7, golden: 3, charred: 1 }, treat: 1 });
    expect(s.bestRush).toBe(321);
    expect(s.stats.serves).toBe(7);
    expect(s.sfx).toBe(true);
    expect(s.treat).toBe(1);
  });

  it('withRushResult accumulates, keeps bests, stays immutable', () => {
    const s0 = emptySave();
    const s1 = withRushResult(s0, { total: 200, medal: 'bronze', mallows: 5, golden: 2, charred: 1 });
    expect(s1.bestRush).toBe(200);
    expect(s1.stats).toEqual({ serves: 5, golden: 2, charred: 1 });
    const s2 = withRushResult(s1, { total: 150, medal: null, mallows: 5, golden: 0, charred: 2 });
    expect(s2.bestRush).toBe(200);
    expect(s2.medal).toBe('bronze');
    expect(s2.stats).toEqual({ serves: 10, golden: 2, charred: 3 });
    expect(s0.stats.serves).toBe(0);
  });

  it('daily completion tracks streaks across consecutive days', () => {
    let s = emptySave();
    s = withDailyCompletion(s, '2026-10-22', 300);
    expect(s.dailyStreak).toBe(1);
    s = withDailyCompletion(s, '2026-10-23', 250);
    expect(s.dailyStreak).toBe(2);
    expect(s.dailyBest).toBe(300);
    s = withDailyCompletion(s, '2026-10-23', 350);
    expect(s.dailyStreak).toBe(2);
    expect(s.dailyBest).toBe(350);
    s = withDailyCompletion(s, '2026-10-25', 100);
    expect(s.dailyStreak).toBe(1);
  });

  it('mastery is 0 empty, capped at 1000', () => {
    expect(masteryFor(emptySave())).toBe(0);
    const rich = withDailyCompletion({ ...emptySave(), bestRush: 500 }, '2026-10-24', 500);
    expect(masteryFor(rich)).toBe(1000);
  });
});

describe('treats', () => {
  it('unlock rules: classic free, PB by serves, mint by gold', () => {
    expect(treatUnlocked(0, emptySave())).toBe(true);
    expect(treatUnlocked(1, emptySave())).toBe(false);
    expect(treatUnlocked(2, emptySave())).toBe(false);
    expect(treatUnlocked(1, { ...emptySave(), stats: { serves: 10, golden: 0, charred: 0 } })).toBe(true);
    expect(treatUnlocked(2, { ...emptySave(), bestRush: 420 })).toBe(true);
  });

  it('resolveTreat falls back when the stored pick is locked', () => {
    expect(resolveTreat({ ...emptySave(), treat: 2 })).toBe(0);
    expect(resolveTreat({ ...emptySave(), treat: 2, bestRush: 430 })).toBe(2);
  });

  it('hints name the earn condition', () => {
    expect(treatUnlockHint(0)).toBe('');
    expect(treatUnlockHint(1)).toContain('10');
    expect(treatUnlockHint(2)).toContain('420');
  });

  it('withTreat stores the pick', () => {
    expect(withTreat(emptySave(), 1).treat).toBe(1);
  });
});
