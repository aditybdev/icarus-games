import { describe, expect, it } from 'vitest';
import {
  dateSeedUTC,
  haptics,
  mulberry32,
  osPrefersReducedMotion,
  setHapticsEnabled,
} from './index';

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('differs across seeds and stays in [0, 1)', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let same = true;
    for (let i = 0; i < 100; i++) {
      const va = a();
      expect(va).toBeGreaterThanOrEqual(0);
      expect(va).toBeLessThan(1);
      if (va !== b()) same = false;
    }
    expect(same).toBe(false);
  });
});

describe('dateSeedUTC', () => {
  it('is stable for a fixed date', () => {
    const d = new Date(Date.UTC(2026, 9, 23));
    expect(dateSeedUTC(d)).toBe(dateSeedUTC(d));
  });

  it('changes across days', () => {
    const a = dateSeedUTC(new Date(Date.UTC(2026, 9, 23)));
    const b = dateSeedUTC(new Date(Date.UTC(2026, 9, 24)));
    expect(a).not.toBe(b);
  });

  it('returns a uint32', () => {
    const s = dateSeedUTC(new Date(Date.UTC(2031, 0, 1)));
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(2 ** 32);
  });
});

describe('haptics', () => {
  it('is a no-op without a Vibration API and never throws', () => {
    expect(() => haptics(25)).not.toThrow();
    expect(() => haptics([10, 20, 30])).not.toThrow();
  });

  it('respects the enabled toggle', () => {
    setHapticsEnabled(false);
    expect(() => haptics(15)).not.toThrow();
    setHapticsEnabled(true);
  });
});

describe('osPrefersReducedMotion', () => {
  it('returns a boolean without throwing outside a browser', () => {
    expect(typeof osPrefersReducedMotion()).toBe('boolean');
  });
});
