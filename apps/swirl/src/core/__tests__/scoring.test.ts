import { describe, expect, it } from 'vitest';
import {
  CM_PER_UNIT,
  COMBO_MAX_MULTIPLIER,
  COMBO_STEP_TIME,
  MAX_HEIGHT,
  TURBO_GAIN_MAX,
  TURBO_SCORE_RATE,
} from '../constants';
import {
  canDispense,
  createCombo,
  createTurbo,
  freeSwirlScore,
  heightToCm,
  multiplierFor,
  NEATNESS_BONUS_MAX,
  POINTS_PER_UNIT,
  totalFreeScore,
  turboGainScale,
  updateCombo,
  updateTurbo,
} from '../scoring';

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

describe('combo multiplier', () => {
  it('builds one step per COMBO_STEP_TIME in the zone', () => {
    let c = createCombo();
    expect(multiplierFor(c)).toBe(1);
    c = updateCombo(c, COMBO_STEP_TIME, true);
    expect(multiplierFor(c)).toBe(2);
    c = updateCombo(c, COMBO_STEP_TIME * 2, true);
    expect(multiplierFor(c)).toBe(4);
  });

  it('decays while off-zone but never below ×1', () => {
    let c = updateCombo(createCombo(), COMBO_STEP_TIME * 2, true);
    c = updateCombo(c, 0.5, false);
    expect(multiplierFor(c)).toBe(2);
    c = updateCombo(c, 99, false);
    expect(multiplierFor(c)).toBe(1);
  });

  it('caps at COMBO_MAX_MULTIPLIER', () => {
    let c = createCombo();
    for (let i = 0; i < 20; i += 1) c = updateCombo(c, COMBO_STEP_TIME, true);
    expect(multiplierFor(c)).toBe(COMBO_MAX_MULTIPLIER);
  });

  it('survives garbage input', () => {
    const c = updateCombo({ streak: Number.NaN }, 0.016, true);
    expect(multiplierFor(c)).toBe(1);
  });
});

describe('turbo overdrive', () => {
  it('accrues bonus only while dispensing, scaled by neatness', () => {
    let t = createTurbo();
    t = updateTurbo(t, 1, false, 1);
    expect(t.score).toBe(0);
    t = updateTurbo(t, 1, true, 1);
    expect(t.score).toBeCloseTo(TURBO_SCORE_RATE, 5);
    t = updateTurbo(t, 1, true, 0.5);
    expect(t.score).toBeCloseTo(TURBO_SCORE_RATE * 1.5, 5);
  });

  it('ramps the wobble-gain scale and caps it', () => {
    expect(turboGainScale(createTurbo())).toBe(1);
    expect(turboGainScale({ time: 999, score: 0 })).toBe(TURBO_GAIN_MAX);
  });

  it('stays reachable at max height in Free Swirl (regression: dead turbo)', () => {
    // The turbo bonus only accrues while dispensing; if dispensing is gated
    // off at MAX_HEIGHT the whole overdrive is unreachable.
    expect(canDispense(true, true, MAX_HEIGHT)).toBe(true);
    expect(canDispense(true, true, MAX_HEIGHT - 0.001)).toBe(true);
  });

  it('caps dispensing at max height in Order Rush', () => {
    expect(canDispense(false, true, MAX_HEIGHT)).toBe(false);
    expect(canDispense(false, true, MAX_HEIGHT - 0.001)).toBe(true);
  });

  it('never dispenses without held input', () => {
    expect(canDispense(true, false, 0)).toBe(false);
    expect(canDispense(false, false, 0)).toBe(false);
  });
});

describe('totalFreeScore', () => {
  it('composes base + turbo under the multiplier', () => {
    const base = freeSwirlScore(3, 0);
    const combo = updateCombo(createCombo(), COMBO_STEP_TIME, true); // ×2
    const turbo = { time: 1, score: 100.9 };
    expect(totalFreeScore(3, 0, combo, turbo)).toBe((base + 100) * 2);
  });

  it('equals the base score with fresh combo and turbo', () => {
    expect(totalFreeScore(2.5, 0.1, createCombo(), createTurbo())).toBe(freeSwirlScore(2.5, 0.1));
  });
});
