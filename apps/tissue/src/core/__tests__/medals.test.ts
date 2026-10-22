import { describe, expect, it } from 'vitest';
import { MEDAL_TARGETS_MS, ROUND_SIZES } from '../constants';
import { bestMedalFor, formatNextMedalMs, medalFor, nextMedalMs } from '../medals';

describe('medal targets (pure data sanity)', () => {
  it('every size has strictly ordered bronze > silver > gold targets', () => {
    for (const size of ROUND_SIZES) {
      const t = MEDAL_TARGETS_MS[size];
      expect(t.bronze).toBeGreaterThan(t.silver);
      expect(t.silver).toBeGreaterThan(t.gold);
    }
  });

  it('targets sit in a playable per-tissue pace band (~0.55-1.4 s/tissue)', () => {
    for (const size of ROUND_SIZES) {
      const t = MEDAL_TARGETS_MS[size];
      expect(t.gold / size).toBeGreaterThan(550); // under ~0.55 s/t is superhuman
      expect(t.bronze / size).toBeLessThan(1400); // casual players must clear bronze
    }
  });
});

describe('medalFor', () => {
  it('classifies at the exact target boundaries (inclusive)', () => {
    const t = MEDAL_TARGETS_MS[25];
    expect(medalFor(25, t.gold)).toBe('gold');
    expect(medalFor(25, t.gold + 1)).toBe('silver');
    expect(medalFor(25, t.silver)).toBe('silver');
    expect(medalFor(25, t.silver + 1)).toBe('bronze');
    expect(medalFor(25, t.bronze)).toBe('bronze');
    expect(medalFor(25, t.bronze + 1)).toBeNull();
  });

  it('is per-size: the same ms earns different medals on different sizes', () => {
    expect(medalFor(25, 31000)).toBeNull();
    expect(medalFor(50, 31000)).toBe('gold');
  });
});

describe('bestMedalFor / nextMedalMs', () => {
  it('derives the medal from a stored best time', () => {
    expect(bestMedalFor(50, null)).toBeNull();
    expect(bestMedalFor(50, MEDAL_TARGETS_MS[50].silver - 1)).toBe('silver');
  });

  it('reports the gap to the next better medal, null at gold', () => {
    const t = MEDAL_TARGETS_MS[100];
    expect(nextMedalMs(100, t.gold)).toBeNull();
    expect(nextMedalMs(100, t.gold - 500)).toBeNull(); // faster than gold
    expect(nextMedalMs(100, t.gold + 1300)).toBe(1300); // silver chasing gold
    expect(nextMedalMs(100, t.silver + 2000)).toBe(2000); // bronze chasing silver
    expect(nextMedalMs(100, t.bronze + 99999)).toBe(99999); // no medal yet
  });

  it('formats the next-medal chase line', () => {
    expect(formatNextMedalMs(null)).toBe('');
    expect(formatNextMedalMs(1300)).toBe('next medal in 1.3 s');
    expect(formatNextMedalMs(1250)).toBe('next medal in 1.3 s'); // ceil to tenths
    expect(formatNextMedalMs(1201)).toBe('next medal in 1.3 s');
    expect(formatNextMedalMs(1200)).toBe('next medal in 1.2 s');
  });
});
