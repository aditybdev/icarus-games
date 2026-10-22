import { describe, expect, it } from 'vitest';
import {
  defaultSave,
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
