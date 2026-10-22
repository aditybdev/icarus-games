import { describe, expect, it } from 'vitest';
import {
  continueTarget,
  currentTier,
  defaultSave,
  flawlessStreak,
  galleryCards,
  matchPercent,
  normalizeSave,
  shouldSuggestUndo,
  starsFor,
  totalStars,
} from './scoring';

describe('starsFor', () => {
  it('awards 3 stars for optimal play without hints', () => {
    expect(starsFor(2, 2, 0)).toBe(3);
    expect(starsFor(1, 2, 0)).toBe(3); // found a shorter solution
  });

  it('awards 2 stars for one extra fold or one hint', () => {
    expect(starsFor(3, 2, 0)).toBe(2);
    expect(starsFor(2, 2, 1)).toBe(2);
  });

  it('awards 1 star otherwise', () => {
    expect(starsFor(4, 2, 0)).toBe(1);
    expect(starsFor(2, 2, 2)).toBe(1);
    expect(starsFor(5, 2, 3)).toBe(1);
  });
});

describe('shouldSuggestUndo', () => {
  it('suggests undo two folds beyond par when not matched', () => {
    expect(shouldSuggestUndo(4, 2, false)).toBe(true);
    expect(shouldSuggestUndo(3, 2, false)).toBe(false);
    expect(shouldSuggestUndo(4, 2, true)).toBe(false);
  });
});

describe('currentTier (live HUD star preview)', () => {
  it('starts at 3 stars before any fold or hint', () => {
    expect(currentTier(0, 2, 0)).toBe(3);
    expect(currentTier(1, 2, 0)).toBe(3); // mid-solve, still on par
  });

  it('dims to 2 stars on the first extra fold or first hint', () => {
    expect(currentTier(3, 2, 0)).toBe(2);
    expect(currentTier(1, 2, 1)).toBe(2);
  });

  it('dims to 1 star beyond par+1 folds or one hint', () => {
    expect(currentTier(4, 2, 0)).toBe(1);
    expect(currentTier(0, 2, 2)).toBe(1);
  });

  it('matches starsFor exactly for every reachable combination', () => {
    for (let folds = 0; folds <= 8; folds++) {
      for (let par = 1; par <= 4; par++) {
        for (let hints = 0; hints <= 3; hints++) {
          expect(currentTier(folds, par, hints)).toBe(starsFor(folds, par, hints));
        }
      }
    }
  });
});

describe('continueTarget', () => {
  it('returns null on a fresh save (only level 1 unlocked)', () => {
    expect(continueTarget(defaultSave(30))).toBeNull();
  });

  it('jumps to the highest unlocked level with no stars', () => {
    const save = { v: 1, stars: [3, 3, 0, 0], unlocked: 3 };
    expect(continueTarget(save)).toBe(2);
  });

  it('skips over completed levels to the highest uncompleted one', () => {
    // Replayed and perfected an earlier level; progress gap at index 2.
    const save = { v: 1, stars: [3, 0, 3, 0], unlocked: 4 };
    expect(continueTarget(save)).toBe(3);
  });

  it('falls back to the last unlocked level when all unlocked are complete', () => {
    const save = { v: 1, stars: [3, 3], unlocked: 2 };
    expect(continueTarget(save)).toBe(1);
  });

  it('clamps an out-of-range unlocked count to the level list', () => {
    const save = { v: 1, stars: [3, 0], unlocked: 99 };
    expect(continueTarget(save)).toBe(1);
  });
});

describe('matchPercent (ghost-panel proximity readout)', () => {
  it('converts a 0–1 mismatch into a 0–100 match percentage', () => {
    expect(matchPercent(0)).toBe(100);
    expect(matchPercent(0.08)).toBe(92);
    expect(matchPercent(0.5)).toBe(50);
    expect(matchPercent(1)).toBe(0);
  });

  it('clamps out-of-range and non-finite input', () => {
    expect(matchPercent(-0.25)).toBe(100);
    expect(matchPercent(7)).toBe(0);
    expect(matchPercent(NaN)).toBe(0);
    expect(matchPercent(Infinity)).toBe(0);
  });
});

describe('flawlessStreak (consecutive 3-star run)', () => {
  it('is 0 when the level itself was not perfected', () => {
    expect(flawlessStreak([3, 2, 3], 1)).toBe(0);
    expect(flawlessStreak([3, 0, 3], 1)).toBe(0);
  });

  it('is 0 for out-of-range indices', () => {
    expect(flawlessStreak([3, 3], -1)).toBe(0);
    expect(flawlessStreak([3, 3], 2)).toBe(0);
  });

  it('counts the trailing run of perfect levels ending at the index', () => {
    expect(flawlessStreak([3, 3, 3], 2)).toBe(3);
    expect(flawlessStreak([2, 3, 3], 2)).toBe(2);
    expect(flawlessStreak([3, 1, 3], 2)).toBe(1);
  });

  it('stops at the first non-perfect level (streak reset)', () => {
    expect(flawlessStreak([3, 3, 2, 3, 3], 4)).toBe(2);
    expect(flawlessStreak([1, 3, 3, 3], 3)).toBe(3);
  });
});

describe('galleryCards (figure-wall unlock derivation)', () => {
  it('unlocks one card per completed level with its best stars', () => {
    const cards = galleryCards({ v: 1, stars: [3, 0, 2], unlocked: 3 });
    expect(cards).toEqual([
      { unlocked: true, stars: 3 },
      { unlocked: false, stars: 0 },
      { unlocked: true, stars: 2 },
    ]);
  });

  it('locks every card on a fresh save', () => {
    expect(galleryCards(defaultSave(30)).every((c) => !c.unlocked)).toBe(true);
  });
});

describe('save data', () => {
  it('creates a versioned default save', () => {
    const s = defaultSave(30);
    expect(s.v).toBe(1);
    expect(s.stars.length).toBe(30);
    expect(s.unlocked).toBe(1);
    expect(totalStars(s)).toBe(0);
  });

  it('normalizes corrupted or mismatched saves', () => {
    expect(normalizeSave(null, 30).v).toBe(1);
    expect(normalizeSave({ v: 99 }, 30).v).toBe(1);
    const s = normalizeSave({ v: 1, stars: [3, 2, 99, -1], unlocked: 500 }, 30);
    expect(s.stars[0]).toBe(3);
    expect(s.stars[1]).toBe(2);
    expect(s.stars[2]).toBe(0);
    expect(s.stars[3]).toBe(0);
    expect(s.unlocked).toBe(30);
  });
});
