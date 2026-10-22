import { describe, expect, it } from 'vitest';
import { springEase } from './renderer';

describe('springEase (fold-flip spring)', () => {
  it('pins the endpoints exactly so the flip stays geometrically honest', () => {
    expect(springEase(0)).toBe(0);
    expect(springEase(1)).toBe(1);
    expect(springEase(-0.25)).toBe(0);
    expect(springEase(1.25)).toBe(1);
  });

  it('dips slightly below 0 during the anticipation window', () => {
    expect(springEase(0.06)).toBeLessThan(0);
    expect(springEase(0.06)).toBeGreaterThan(-0.1);
  });

  it('gently overshoots past 1 mid-flight, then settles back to 1', () => {
    let peak = -Infinity;
    for (let t = 0; t <= 1; t += 0.002) peak = Math.max(peak, springEase(t));
    expect(peak).toBeGreaterThan(1.02); // a real overshoot
    expect(peak).toBeLessThan(1.2); // gentle, not cartoonish
    expect(Math.abs(springEase(0.98) - 1)).toBeLessThan(0.02); // settled
  });
});
