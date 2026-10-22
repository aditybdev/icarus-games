import { describe, expect, it } from 'vitest';
import {
  CENTER_DEAD_ZONE,
  MAX_WOBBLE,
  MIN_TOPPLE_HEIGHT,
  TOPPLE_WOBBLE_RATIO,
} from '../constants';
import { neatness, shouldTopple, updateWobble, wobbleRatio } from '../wobble';

describe('updateWobble', () => {
  it('grows while dispensing off-center beyond the dead zone', () => {
    const next = updateWobble(0, CENTER_DEAD_ZONE + 1, 1, true);
    expect(next).toBeGreaterThan(0);
  });

  it('does not grow for offsets inside the dead zone', () => {
    const next = updateWobble(1, CENTER_DEAD_ZONE * 0.5, 1, true);
    expect(next).toBeLessThan(1);
  });

  it('recovers while dispensing centered', () => {
    const next = updateWobble(2, 0, 1, true);
    expect(next).toBeLessThan(2);
    expect(next).toBeGreaterThanOrEqual(0);
  });

  it('is unchanged when not dispensing', () => {
    expect(updateWobble(1.5, 5, 1, false)).toBe(1.5);
  });

  it('never goes below zero', () => {
    expect(updateWobble(0.01, 0, 10, true)).toBe(0);
  });

  it('clamps at MAX_WOBBLE', () => {
    expect(updateWobble(MAX_WOBBLE - 0.001, 100, 10, true)).toBe(MAX_WOBBLE);
  });

  it('sanitizes non-finite input to zero', () => {
    expect(updateWobble(Number.NaN, 0, 0.016, false)).toBe(0);
  });

  it('scales with offset magnitude', () => {
    const small = updateWobble(0, CENTER_DEAD_ZONE + 0.5, 1, true);
    const large = updateWobble(0, CENTER_DEAD_ZONE + 2, 1, true);
    expect(large).toBeGreaterThan(small);
  });
});

describe('wobbleRatio', () => {
  it('uses max(1, height) as denominator', () => {
    expect(wobbleRatio(0.5, 0.2)).toBeCloseTo(0.5);
    expect(wobbleRatio(1, 4)).toBeCloseTo(0.25);
  });
});

describe('shouldTopple', () => {
  it('never topples below the minimum height', () => {
    expect(shouldTopple(MAX_WOBBLE, MIN_TOPPLE_HEIGHT - 0.01)).toBe(false);
  });

  it('does not topple exactly at the threshold', () => {
    const height = 4;
    const wobble = TOPPLE_WOBBLE_RATIO * height; // ratio exactly == threshold
    expect(shouldTopple(wobble, height)).toBe(false);
  });

  it('topples just past the threshold', () => {
    const height = 4;
    const wobble = TOPPLE_WOBBLE_RATIO * height + 0.001;
    expect(shouldTopple(wobble, height)).toBe(true);
  });

  it('tolerates more absolute wobble on taller swirls', () => {
    const wobble = 1.2;
    expect(shouldTopple(wobble, 1.5)).toBe(true); // ratio 0.8
    expect(shouldTopple(wobble, 4)).toBe(false); // ratio 0.3
  });
});

describe('neatness', () => {
  it('is 1 with no wobble', () => {
    expect(neatness(0, 3)).toBe(1);
  });

  it('is 0 at the topple threshold', () => {
    const height = 3;
    expect(neatness(TOPPLE_WOBBLE_RATIO * height, height)).toBe(0);
  });

  it('decreases monotonically with wobble', () => {
    const height = 3;
    let prev = 1;
    for (let w = 0; w <= TOPPLE_WOBBLE_RATIO * height; w += 0.1) {
      const n = neatness(w, height);
      expect(n).toBeLessThanOrEqual(prev + 1e-9);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
      prev = n;
    }
  });
});
