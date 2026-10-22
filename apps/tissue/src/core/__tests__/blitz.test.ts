import { describe, expect, it } from 'vitest';
import { BLITZ_DURATION_MS, blitzOver, blitzPointsFor, blitzTimeLeftMs } from '../blitz';

describe('blitz scoring', () => {
  it('locks the 30 s window', () => {
    expect(BLITZ_DURATION_MS).toBe(30000);
  });

  it('awards 1 point base, +1 per 5 streak levels', () => {
    expect(blitzPointsFor(0)).toBe(1);
    expect(blitzPointsFor(1)).toBe(1);
    expect(blitzPointsFor(4)).toBe(1);
    expect(blitzPointsFor(5)).toBe(2);
    expect(blitzPointsFor(9)).toBe(2);
    expect(blitzPointsFor(10)).toBe(3);
    expect(blitzPointsFor(25)).toBe(6);
  });

  it('clamps garbage streaks to the base point', () => {
    expect(blitzPointsFor(-3)).toBe(1);
  });

  it('tracks the remaining window and the end of the round', () => {
    expect(blitzTimeLeftMs(0)).toBe(30000);
    expect(blitzTimeLeftMs(12345)).toBe(30000 - 12345);
    expect(blitzTimeLeftMs(30000)).toBe(0);
    expect(blitzTimeLeftMs(45000)).toBe(0); // clamped, never negative
    expect(blitzOver(29999)).toBe(false);
    expect(blitzOver(30000)).toBe(true);
    expect(blitzOver(60000)).toBe(true);
  });

  it('a simulated blitz run accumulates streak-multiplied score', () => {
    // 30 pulls at a steady blazing rhythm: streak climbs 1,2,3,...,30.
    let score = 0;
    for (let streak = 1; streak <= 30; streak += 1) {
      score += blitzPointsFor(streak);
    }
    // streaks 1-4: 4x1, 5-9: 5x2, 10-14: 5x3, 15-19: 5x4, 20-24: 5x5,
    // 25-29: 5x6, 30: 1x7 -> 4+10+15+20+25+30+7 = 111.
    expect(score).toBe(111);
  });
});
