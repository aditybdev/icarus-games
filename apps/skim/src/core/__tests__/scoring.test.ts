import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@icarus/platform';
import { MEDAL_BRONZE_M, MEDAL_GOLD_M, MEDAL_SILVER_M, WAVE_CALM, WAVE_MAX, WIND_MAX } from '../constants';
import { bestMedal, dailyLake, formatM, medalFor, nextMedalM } from '../scoring';
import { emptySave, masteryFor, normalizeSave, withStone, withThrowResult } from '../save';
import { STONE_SKINS, THROWS_UNLOCK, resolveStone, stoneUnlocked, stoneUnlockHint } from '../stones';

describe('medals', () => {
  it('thresholds are strict and ordered', () => {
    expect(MEDAL_BRONZE_M).toBeLessThan(MEDAL_SILVER_M);
    expect(MEDAL_SILVER_M).toBeLessThan(MEDAL_GOLD_M);
    expect(medalFor(0)).toBeNull();
    expect(medalFor(MEDAL_BRONZE_M - 0.1)).toBeNull();
    expect(medalFor(MEDAL_BRONZE_M)).toBe('bronze');
    expect(medalFor(MEDAL_SILVER_M)).toBe('silver');
    expect(medalFor(MEDAL_GOLD_M)).toBe('gold');
    expect(medalFor(MEDAL_GOLD_M * 3)).toBe('gold');
  });

  it('nextMedalM gives the exact near-miss gap and null at gold', () => {
    expect(nextMedalM(0)).toEqual({ medal: 'bronze', gapM: MEDAL_BRONZE_M });
    expect(nextMedalM(MEDAL_BRONZE_M + 5)).toEqual({
      medal: 'silver',
      gapM: MEDAL_SILVER_M - MEDAL_BRONZE_M - 5,
    });
    expect(nextMedalM(MEDAL_GOLD_M)).toBeNull();
  });

  it('bestMedal keeps the higher medal', () => {
    expect(bestMedal(null, 'bronze')).toBe('bronze');
    expect(bestMedal('gold', 'silver')).toBe('gold');
    expect(bestMedal(null, null)).toBeNull();
  });

  it('formatM shows one decimal', () => {
    expect(formatM(42.24)).toBe('42.2 m');
    expect(formatM(7)).toBe('7.0 m');
  });
});

describe('dailyLake', () => {
  it('is deterministic from the seed and inside the wind/wave envelope', () => {
    const a = dailyLake(mulberry32(20261024));
    const b = dailyLake(mulberry32(20261024));
    expect(a).toEqual(b);
    expect(Math.abs(a.wind)).toBeLessThanOrEqual(WIND_MAX);
    expect(a.waveAmp).toBeGreaterThanOrEqual(WAVE_CALM);
    expect(a.waveAmp).toBeLessThanOrEqual(WAVE_MAX);
  });

  it('different dates give different lakes', () => {
    const a = dailyLake(mulberry32(20261024));
    const b = dailyLake(mulberry32(20261025));
    expect(a).not.toEqual(b);
  });
});

describe('save', () => {
  it('normalizes junk to an empty save', () => {
    expect(normalizeSave(undefined)).toEqual(emptySave());
    expect(normalizeSave({ v: 99 })).toEqual(emptySave());
    expect(normalizeSave('nonsense').bestM).toBe(0);
  });

  it('keeps valid fields and clamps junk', () => {
    const s = normalizeSave({
      v: 1,
      bestM: 88.5,
      bestSkips: 9,
      stats: { throws: 4, totalM: 120, perfects: 3 },
      medal: 'silver',
      stone: 1,
      dailyLast: '2026-10-24',
      dailyBestM: 140,
      sfx: false,
    });
    expect(s.bestM).toBe(88.5);
    expect(s.medal).toBe('silver');
    expect(s.sfx).toBe(false);
    expect(s.stone).toBe(1);
  });

  it('resets daily best when the day moved on', () => {
    const s = normalizeSave(
      { v: 1, dailyLast: '2026-10-23', dailyBestM: 140 },
      '2026-10-24',
    );
    expect(s.dailyBestM).toBeNull();
    expect(s.dailyLast).toBe('2026-10-23'); // streak continuity decided by kit
  });

  it('withThrowResult records bests and never mutates the input', () => {
    const s0 = emptySave();
    const s1 = withThrowResult(s0, 45.2, 6, 2);
    expect(s0.stats.throws).toBe(0); // immutable
    expect(s1.stats.throws).toBe(1);
    expect(s1.bestM).toBe(45.2);
    expect(s1.medal).toBe('bronze');
    const s2 = withThrowResult(s1, 30, 2, 0);
    expect(s2.bestM).toBe(45.2); // best kept
    expect(s2.stats.throws).toBe(2);
  });

  it('mastery caps at 1000 and grows with bests', () => {
    expect(masteryFor(emptySave())).toBe(0);
    const s = withThrowResult(emptySave(), MEDAL_GOLD_M, 1, 0);
    s.dailyBestM = MEDAL_GOLD_M * 1.5;
    expect(masteryFor(s)).toBe(1000);
  });
});

describe('stones', () => {
  it('granite is free; others gate on play', () => {
    const s = emptySave();
    expect(stoneUnlocked(0, s)).toBe(true);
    expect(stoneUnlocked(1, s)).toBe(false);
    expect(stoneUnlocked(2, s)).toBe(false);
  });

  it('slate unlocks after the throw count; meteorite needs gold', () => {
    let s = emptySave();
    for (let i = 0; i < THROWS_UNLOCK; i += 1) s = withThrowResult(s, 5, 1, 0);
    expect(stoneUnlocked(1, s)).toBe(true);
    expect(stoneUnlocked(2, s)).toBe(false);
    s = withThrowResult(s, MEDAL_GOLD_M, 1, 0);
    expect(stoneUnlocked(2, s)).toBe(true);
  });

  it('every locked-by-default stone has a hint (no dead-end locks)', () => {
    const s = emptySave();
    STONE_SKINS.forEach((_, i) => {
      if (!stoneUnlocked(i, s)) expect(stoneUnlockHint(i).length).toBeGreaterThan(0);
    });
  });

  it('resolveStone falls back to granite for locked/invalid selections', () => {
    expect(resolveStone(withStone(emptySave(), 2))).toBe(0);
    expect(resolveStone(withStone(emptySave(), 99))).toBe(0);
    let s = emptySave();
    for (let i = 0; i < THROWS_UNLOCK; i += 1) s = withThrowResult(s, 5, 1, 0);
    expect(resolveStone(withStone(s, 1))).toBe(1);
  });
});
