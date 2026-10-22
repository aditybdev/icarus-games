import { describe, expect, it } from 'vitest';
import { MAX_HEIGHT } from '../constants';
import {
  bestMarkerFrac,
  createNearMiss,
  isNewBestPace,
  MIN_SAVE_HEIGHT,
  NEAR_MISS_RATIO,
  RECOVERED_RATIO,
  TENSION_START_RATIO,
  tensionLevel,
  updateNearMiss,
} from '../feedback';
import { POINTS_PER_UNIT } from '../scoring';

describe('tensionLevel', () => {
  it('is 0 below the start ratio', () => {
    expect(tensionLevel(0)).toBe(0);
    expect(tensionLevel(TENSION_START_RATIO)).toBe(0);
    expect(tensionLevel(TENSION_START_RATIO - 0.01)).toBe(0);
  });

  it('ramps linearly to 1 at the topple threshold', () => {
    const mid = tensionLevel((TENSION_START_RATIO + 1) / 2);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(tensionLevel(1)).toBe(1);
  });

  it('clamps above the threshold and rejects non-finite input', () => {
    expect(tensionLevel(1.5)).toBe(1);
    expect(tensionLevel(Number.NaN)).toBe(0);
    expect(tensionLevel(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('increases monotonically across the band', () => {
    let prev = 0;
    for (let r = TENSION_START_RATIO; r <= 1; r += 0.05) {
      const t = tensionLevel(r);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });
});

describe('updateNearMiss', () => {
  it('arms in the near-miss zone and fires saved on recovery', () => {
    const s = createNearMiss();
    expect(updateNearMiss(s, 0.3, 3)).toBe('none');
    expect(updateNearMiss(s, NEAR_MISS_RATIO, 3)).toBe('none');
    expect(s.armed).toBe(true);
    expect(updateNearMiss(s, 0.6, 3)).toBe('none'); // still between zones
    expect(updateNearMiss(s, RECOVERED_RATIO, 3)).toBe('saved');
    expect(s.armed).toBe(false);
  });

  it('does not fire on short swirls', () => {
    const s = createNearMiss();
    updateNearMiss(s, NEAR_MISS_RATIO + 0.1, MIN_SAVE_HEIGHT - 0.1);
    expect(updateNearMiss(s, 0.1, MIN_SAVE_HEIGHT - 0.1)).toBe('none');
  });

  it('does not fire without first entering the near-miss zone', () => {
    const s = createNearMiss();
    expect(updateNearMiss(s, 0.5, 4)).toBe('none');
    expect(updateNearMiss(s, 0.1, 4)).toBe('none');
  });

  it('fires only once per near-miss episode', () => {
    const s = createNearMiss();
    updateNearMiss(s, 0.9, 4);
    expect(updateNearMiss(s, 0.2, 4)).toBe('saved');
    expect(updateNearMiss(s, 0.1, 4)).toBe('none');
    // A new episode re-arms.
    updateNearMiss(s, 0.8, 4);
    expect(updateNearMiss(s, 0.2, 4)).toBe('saved');
  });

  it('stays armed while hovering above the recovered ratio', () => {
    const s = createNearMiss();
    updateNearMiss(s, 0.9, 4);
    updateNearMiss(s, RECOVERED_RATIO + 0.01, 4);
    expect(s.armed).toBe(true);
  });
});

describe('isNewBestPace', () => {
  it('is true only when live score passes an existing best', () => {
    expect(isNewBestPace(500, 400)).toBe(true);
    expect(isNewBestPace(400, 400)).toBe(false);
    expect(isNewBestPace(300, 400)).toBe(false);
  });

  it('is false when there is no saved best', () => {
    expect(isNewBestPace(500, 0)).toBe(false);
  });
});

describe('bestMarkerFrac', () => {
  it('is null without a saved best', () => {
    expect(bestMarkerFrac(0)).toBeNull();
    expect(bestMarkerFrac(Number.NaN)).toBeNull();
    expect(bestMarkerFrac(-10)).toBeNull();
  });

  it('maps a pure-height best onto the meter', () => {
    const best = MAX_HEIGHT * POINTS_PER_UNIT * 0.5;
    expect(bestMarkerFrac(best)).toBeCloseTo(0.5);
  });

  it('clamps at the top of the meter', () => {
    expect(bestMarkerFrac(999999)).toBe(1);
  });

  it('is null for degenerate scales', () => {
    expect(bestMarkerFrac(100, 0)).toBeNull();
    expect(bestMarkerFrac(100, MAX_HEIGHT, 0)).toBeNull();
  });
});
