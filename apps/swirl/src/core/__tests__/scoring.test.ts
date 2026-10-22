import { describe, expect, it } from 'vitest';
import { CM_PER_UNIT } from '../constants';
import { freeSwirlScore, heightToCm, NEATNESS_BONUS_MAX, POINTS_PER_UNIT } from '../scoring';

describe('heightToCm', () => {
  it('scales world units to centimeters and rounds', () => {
    expect(heightToCm(1)).toBe(CM_PER_UNIT);
    expect(heightToCm(2.04)).toBe(Math.round(2.04 * CM_PER_UNIT));
  });

  it('never returns negative', () => {
    expect(heightToCm(-5)).toBe(0);
  });
});

describe('freeSwirlScore', () => {
  it('is deterministic', () => {
    expect(freeSwirlScore(3.21, 0.4)).toBe(freeSwirlScore(3.21, 0.4));
  });

  it('is a non-negative integer', () => {
    const s = freeSwirlScore(1.234, 0.56);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
  });

  it('increases with height at fixed wobble', () => {
    expect(freeSwirlScore(4, 0.2)).toBeGreaterThan(freeSwirlScore(2, 0.2));
  });

  it('decreases with wobble at fixed height', () => {
    expect(freeSwirlScore(3, 1.2)).toBeLessThan(freeSwirlScore(3, 0));
  });

  it('awards the full neatness bonus at zero wobble', () => {
    const height = 3;
    expect(freeSwirlScore(height, 0)).toBe(
      Math.round(height * POINTS_PER_UNIT + NEATNESS_BONUS_MAX),
    );
  });

  it('awards no bonus at the topple threshold', () => {
    const height = 3;
    // wobbleRatio = wobble / height == TOPPLE_WOBBLE_RATIO -> neatness 0
    const wobble = 0.6 * height;
    expect(freeSwirlScore(height, wobble)).toBe(Math.round(height * POINTS_PER_UNIT));
  });

  it('handles zero height', () => {
    expect(freeSwirlScore(0, 0)).toBe(0);
  });
});
