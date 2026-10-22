/**
 * Sim test-suite: determinism, impulse/counter-torque sanity, stumble and
 * fall thresholds, long-run numerical stability, finish detection, and the
 * anti-softlock guarantee.
 */

import { describe, expect, it } from 'vitest';
import { nextRandom } from './prng';
import { effectiveTimeMs, rankFor, scoreFor } from './rules';
import { stepSim } from './sim';
import {
  DT,
  K_IMPULSE,
  LEG_BL,
  LEG_BR,
  LEG_FL,
  LEG_FR,
  MIN_H,
  NO_INPUT,
  RACE_LIMIT_MS,
  STUMBLE_RAD,
  SimInput,
  SimState,
  TRACK_LENGTH,
  createSim,
} from './types';

function run(s: SimState, input: SimInput, steps: number): void {
  for (let i = 0; i < steps; i++) stepSim(s, input);
}

function held(mask: [boolean, boolean, boolean, boolean]): SimInput {
  return { held: mask };
}

/** Scripted diagonal-pair rhythm: FL+BR stroke, then FR+BL stroke. */
function diagonalScript(s: SimState, cycles: number): void {
  for (let c = 0; c < cycles; c++) {
    run(s, held([true, false, false, true]), 21); // swing FL+BR
    run(s, NO_INPUT, 12); // drop + plant
    run(s, held([false, true, true, false]), 21); // swing FR+BL
    run(s, NO_INPUT, 12);
  }
}

function assertFiniteState(s: SimState): void {
  const nums: number[] = [
    s.body.x,
    s.body.v,
    s.body.h,
    s.body.hv,
    s.body.pitch,
    s.body.pitchVel,
    s.timeMs,
    s.penaltyMs,
    s.distance,
    s.falls,
    s.stumbleT,
  ];
  for (const leg of s.legs) {
    nums.push(leg.angle, leg.peakAngle, leg.plantX, leg.holdTime);
  }
  for (const n of nums) expect(Number.isFinite(n)).toBe(true);
}

describe('determinism', () => {
  it('same seed + same scripted inputs → identical final state', () => {
    const a = createSim('race', 42);
    const b = createSim('race', 42);
    diagonalScript(a, 30);
    diagonalScript(b, 30);
    // plus a burst of chaotic alternating input
    const rng = { rngState: 7 };
    for (let i = 0; i < 200; i++) {
      const mask: [boolean, boolean, boolean, boolean] = [
        nextRandom(rng) < 0.5,
        nextRandom(rng) < 0.5,
        nextRandom(rng) < 0.5,
        nextRandom(rng) < 0.5,
      ];
      run(a, held(mask), 6);
      run(b, held(mask), 6);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds may diverge (rng actually participates)', () => {
    const a = createSim('race', 1);
    const b = createSim('race', 2);
    // Force a stumble in both so the rng gets consumed.
    a.body.pitch = 0.7;
    b.body.pitch = 0.7;
    run(a, NO_INPUT, 5);
    run(b, NO_INPUT, 5);
    // States remain internally consistent either way.
    assertFiniteState(a);
    assertFiniteState(b);
  });
});

describe('impulse and counter-torque', () => {
  function strokeAndMeasure(legIndex: number): { dV: number; torque: number; peak: number } {
    const s = createSim('race', 5);
    const mask: [boolean, boolean, boolean, boolean] = [false, false, false, false];
    mask[legIndex] = true;
    run(s, held(mask), 36); // hold 0.3 s
    const peak = s.legs[legIndex].peakAngle;
    expect(peak).toBeGreaterThan(0.5);
    let dV = 0;
    let torque = 0;
    let planted = false;
    for (let i = 0; i < 240 && !planted; i++) {
      const v0 = s.body.v;
      stepSim(s, NO_INPUT);
      for (const e of s.events) {
        if (e.type === 'plant' && e.leg === legIndex && e.strength > 0) {
          planted = true;
          dV = s.body.v - v0;
          torque = s.body.pitchVel;
        }
      }
    }
    expect(planted).toBe(true);
    return { dV, torque, peak };
  }

  it('front-leg plant adds forward impulse ∝ swing and pitches nose up', () => {
    const { dV, torque, peak } = strokeAndMeasure(LEG_FL);
    expect(dV).toBeGreaterThan(0.2);
    expect(Math.abs(dV - K_IMPULSE * peak)).toBeLessThan(0.08);
    expect(torque).toBeGreaterThan(0);
  });

  it('back-leg plant adds similar forward impulse but pitches nose down', () => {
    const front = strokeAndMeasure(LEG_FL);
    const back = strokeAndMeasure(LEG_BL);
    expect(back.dV).toBeGreaterThan(0.2);
    expect(back.torque).toBeLessThan(0);
    // Mirror pair: impulses within 12% of each other.
    expect(Math.abs(back.dV - front.dV) / front.dV).toBeLessThan(0.12);
  });

  it('alternating diagonal pairs build real speed and cover ground', () => {
    const s = createSim('race', 11);
    diagonalScript(s, 20); // ~8.8 s of good rhythm
    expect(s.body.v).toBeGreaterThan(1.5);
    expect(s.distance).toBeGreaterThan(12);
    expect(Math.abs(s.body.pitch)).toBeLessThan(STUMBLE_RAD);
    expect(s.falls).toBe(0);
  });
});

describe('stumble, fall and recovery', () => {
  it('stumble triggers past the ~35° threshold', () => {
    const s = createSim('race', 3);
    s.body.pitch = STUMBLE_RAD + 0.09;
    stepSim(s, NO_INPUT);
    expect(s.falls).toBe(1);
    expect(s.stumbleT).toBeGreaterThan(0);
    expect(s.events.some((e) => e.type === 'stumble')).toBe(true);
    expect(s.body.v).toBeLessThanOrEqual(0.0001);
  });

  it('full flip past ~80° counts a fall, resets to track with a time penalty', () => {
    const s = createSim('race', 3);
    s.body.x = 20;
    s.body.v = 3;
    s.body.pitch = 1.5;
    stepSim(s, NO_INPUT);
    expect(s.falls).toBe(1);
    expect(s.penaltyMs).toBe(3000);
    expect(s.body.x).toBeLessThanOrEqual(18.5);
    expect(s.body.pitch).toBe(0);
    expect(s.body.v).toBe(0);
    expect(s.legs.every((l) => l.phase === 'planted')).toBe(true);
    expect(s.events.some((e) => e.type === 'fall')).toBe(true);
  });

  it('recovery never NaNs over 10k steps of random seeded inputs', () => {
    const s = createSim('race', 7);
    const rng = { rngState: 99 };
    for (let i = 0; i < 10_000; i++) {
      if (i % 12 === 0) {
        const mask: [boolean, boolean, boolean, boolean] = [
          nextRandom(rng) < 0.45,
          nextRandom(rng) < 0.45,
          nextRandom(rng) < 0.45,
          nextRandom(rng) < 0.45,
        ];
        stepSim(s, held(mask));
      } else {
        stepSim(s, NO_INPUT);
      }
      if (s.timedOut) break;
    }
    assertFiniteState(s);
    expect(s.body.x).toBeGreaterThanOrEqual(0);
    expect(s.body.h).toBeGreaterThanOrEqual(MIN_H - 1e-9);
  });

  it('never soft-locks: holding all four legs still recovers and drives on', () => {
    const s = createSim('training', 13);
    run(s, held([true, true, true, true]), 360); // hold everything 3 s
    run(s, NO_INPUT, 720); // then let go for 6 s
    assertFiniteState(s);
    expect(s.body.h).toBeGreaterThan(MIN_H + 0.1);
    expect(s.body.v).toBeLessThan(0.5);
    // …and the creature can immediately be driven forward again.
    const x0 = s.body.x;
    diagonalScript(s, 10);
    expect(s.body.x).toBeGreaterThan(x0 + 2);
  });

  it('belly-flopping with all legs held is not a propulsion exploit', () => {
    const s = createSim('training', 13);
    run(s, held([true, true, true, true]), 360); // hold everything 3 s
    expect(s.body.v).toBeLessThan(0.5);
  });
});

describe('race outcomes', () => {
  it('finish detection at 50 m', () => {
    const s = createSim('race', 17);
    s.body.x = TRACK_LENGTH - 0.05;
    s.body.v = 2;
    let sawFinish = false;
    for (let i = 0; i < 120 && !s.finished; i++) {
      stepSim(s, NO_INPUT);
      if (s.events.some((e) => e.type === 'finish')) sawFinish = true;
    }
    expect(s.finished).toBe(true);
    expect(sawFinish).toBe(true);
    expect(s.distance).toBeGreaterThanOrEqual(TRACK_LENGTH);
  });

  it('a competent diagonal rhythm finishes within the limit', () => {
    const s = createSim('race', 23);
    while (!s.finished && !s.timedOut && s.timeMs < RACE_LIMIT_MS) {
      diagonalScript(s, 1);
    }
    expect(s.finished).toBe(true);
    expect(s.timedOut).toBe(false);
  });

  it('times out when the creature never moves', () => {
    const s = createSim('race', 29);
    while (!s.timedOut && !s.finished) stepSim(s, NO_INPUT);
    expect(s.timedOut).toBe(true);
    expect(s.finished).toBe(false);
    expect(s.timeMs + s.penaltyMs).toBeGreaterThanOrEqual(RACE_LIMIT_MS);
  });

  it('finish wins when the clock hits zero on the very same step', () => {
    const s = createSim('race', 31);
    s.body.x = TRACK_LENGTH - 0.02;
    s.body.v = 5; // crosses the line within one step
    s.timeMs = RACE_LIMIT_MS - DT * 1000; // limit is reached this exact step
    stepSim(s, NO_INPUT);
    expect(s.finished).toBe(true);
    expect(s.timedOut).toBe(false);
  });

  it('a full flip at the line knocks the runner back — no finish, no best time', () => {
    const s = createSim('race', 31);
    s.body.x = TRACK_LENGTH - 0.02;
    s.body.v = 5;
    s.body.pitch = 1.5; // beyond FLIP_RAD
    stepSim(s, NO_INPUT);
    expect(s.finished).toBe(false);
    expect(s.timedOut).toBe(false);
    expect(s.body.x).toBeLessThan(TRACK_LENGTH);
    expect(s.events.some((e) => e.type === 'fall')).toBe(true);
  });

  it('fall penalties count toward the clock and can cause a timeout', () => {
    const s = createSim('race', 41);
    s.timeMs = RACE_LIMIT_MS - 2000; // 88 s on the clock
    s.penaltyMs = 2500; // effective time already past the limit next step
    stepSim(s, NO_INPUT);
    expect(s.timedOut).toBe(true);
    expect(s.finished).toBe(false);
  });

  it('training mode never finishes or times out, even past 50 m and 90 s', () => {
    const s = createSim('training', 37);
    s.body.x = TRACK_LENGTH + 5;
    s.timeMs = RACE_LIMIT_MS + 5000;
    run(s, NO_INPUT, 240);
    expect(s.finished).toBe(false);
    expect(s.timedOut).toBe(false);
  });
});

describe('rules', () => {
  it('rank thresholds match the published design', () => {
    expect(rankFor(29_999)).toBe('S');
    expect(rankFor(30_000)).toBe('S');
    expect(rankFor(30_001)).toBe('A');
    expect(rankFor(45_000)).toBe('A');
    expect(rankFor(45_001)).toBe('B');
    expect(rankFor(65_000)).toBe('B');
    expect(rankFor(65_001)).toBe('C');
  });

  it('effective time includes fall penalties', () => {
    expect(effectiveTimeMs(10_000, 3_000)).toBe(13_000);
    expect(effectiveTimeMs(10_000, 0)).toBe(10_000);
  });

  it('score rewards faster finishes and longer DNFs, never negative', () => {
    expect(scoreFor(true, 30_000, TRACK_LENGTH)).toBeGreaterThan(scoreFor(true, 60_000, TRACK_LENGTH));
    expect(scoreFor(false, RACE_LIMIT_MS, 25)).toBe(500);
    expect(scoreFor(false, RACE_LIMIT_MS, 0)).toBe(0);
    expect(scoreFor(true, 0, TRACK_LENGTH)).toBeGreaterThan(0); // degenerate clock guard
  });
});
