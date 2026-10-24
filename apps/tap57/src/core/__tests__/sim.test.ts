import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@icarus/platform';
import { createBottle, rhythmPeriod, ringQ, tap, update } from '../bottle';
import { clampAim, launch, powerFor, pressureForRange, speedFor, step } from '../flight';
import { coverage, dailyOrders, perfectHit, rushOrders, scoreFor, targetCxAt, type OrderSpec } from '../orders';
import { AIM_MAX, AIM_MIN, P_FULL, SPLAT_P, V_BASE } from '../constants';

/** Smallest t' > t whose ring phase is the mid-period beat (q = 1). */
function beatAfter(t: number, period: number): number {
  const k = Math.floor(t / period);
  let beat = (k + 0.5) * period;
  if (beat <= t) beat += period;
  return beat;
}

describe('rhythm', () => {
  it('period shortens as pressure rises and clamps at the hot end', () => {
    expect(rhythmPeriod(0)).toBeCloseTo(1.5, 5);
    expect(rhythmPeriod(0.95)).toBeCloseTo(0.8, 5);
    expect(rhythmPeriod(2)).toBeCloseTo(0.8, 5); // clamped, no nonsense periods
  });

  it('ringQ is a triangle peaking mid-period', () => {
    const T = 1.5;
    expect(ringQ(0.75, T)).toBeCloseTo(1, 5);
    expect(ringQ(0, T)).toBeCloseTo(0, 5);
    expect(ringQ(0.75 + 0.15, T)).toBeCloseTo(0.8, 5);
    expect(ringQ(0.75 - 0.15, T)).toBeCloseTo(0.8, 5);
  });
});

describe('bottle pressure', () => {
  it('a perfect-beat tap adds base + full q bonus', () => {
    const b = createBottle();
    const ev = tap(b, rhythmPeriod(0) * 0.5);
    expect(ev.type).toBe('tap');
    if (ev.type !== 'tap') return;
    expect(ev.q).toBeCloseTo(1, 5);
    expect(ev.perfect).toBe(true);
    expect(b.pressure).toBeCloseTo(0.115, 5);
    expect(b.streak).toBe(1);
  });

  it('sloppy taps break the perfect streak', () => {
    const b = createBottle();
    tap(b, rhythmPeriod(0) * 0.5);
    expect(b.streak).toBe(1);
    tap(b, 0.01); // phase ≈ 0 — as sloppy as it gets
    expect(b.streak).toBe(0);
    expect(b.bestStreak).toBe(1);
  });

  it('repeated perfect taps splat at the threshold', () => {
    const b = createBottle();
    let ev = tap(b, 0.75);
    let n = 1;
    while (ev.type === 'tap' && n < 12) {
      n += 1;
      ev = tap(b, 0.75); // same absolute beat → q judged against rising period
    }
    expect(ev.type).toBe('splat');
    expect(b.splatted).toBe(true);
    expect(b.pressure).toBeGreaterThanOrEqual(SPLAT_P);
    expect(b.streak).toBe(0);
  });

  it('an on-beat cadence builds pressure into the mid bands without splatting', () => {
    const b = createBottle();
    let t = beatAfter(0, rhythmPeriod(0));
    for (let i = 0; i < 6; i += 1) {
      const ev = tap(b, t);
      expect(ev.type).toBe('tap');
      t = beatAfter(t, rhythmPeriod(b.pressure));
      update(b, 0.4); // a beat's worth of settling between taps
    }
    expect(b.pressure).toBeGreaterThan(0.5);
    expect(b.pressure).toBeLessThan(SPLAT_P);
    expect(b.bestStreak).toBe(6);
  });

  it('decay bleeds pressure but never below zero', () => {
    const b = createBottle();
    b.pressure = 0.1;
    update(b, 1);
    expect(b.pressure).toBeCloseTo(0.04, 5);
    update(b, 10);
    expect(b.pressure).toBe(0);
  });
});

describe('flight', () => {
  it('speed scales with pressure from dribble floor to full', () => {
    expect(speedFor(0)).toBeCloseTo(V_BASE * 0.45, 5);
    expect(speedFor(P_FULL)).toBeCloseTo(V_BASE, 5);
    expect(speedFor(2)).toBeCloseTo(V_BASE, 5); // capped, not hotter
    expect(speedFor(P_FULL / 2)).toBeCloseTo(V_BASE * 0.725, 5);
  });

  it('pressureForRange inverts the 45° range curve', () => {
    // Full pressure at 45° from h=1 ≈ 4.236 m; the inverse maps it back.
    const s = (V_BASE * Math.SQRT1_2) ** 2;
    const range = (V_BASE * Math.SQRT1_2 * (V_BASE * Math.SQRT1_2 + Math.sqrt(s + 2 * 9.8))) / 9.8;
    expect(pressureForRange(range)).toBeCloseTo(P_FULL, 2);
    expect(pressureForRange(0.5)).toBeGreaterThan(0);
    expect(pressureForRange(0.5)).toBeLessThan(0.3);
  });

  it('powerFor labels dribble/true/over against the band', () => {
    const band = [0.4, 0.8] as const;
    expect(powerFor(0.39, band)).toBe('dribble');
    expect(powerFor(0.4, band)).toBe('true');
    expect(powerFor(0.8, band)).toBe('true');
    expect(powerFor(0.81, band)).toBe('over');
  });

  it('clampAim enforces the envelope', () => {
    expect(clampAim(0)).toBe(AIM_MIN);
    expect(clampAim(9)).toBe(AIM_MAX);
    expect(clampAim(0.7)).toBeCloseTo(0.7, 5);
  });

  it('full-pressure 45° lands near the nozzle-height range, dribble falls far short', () => {
    // R = s(s+√(s²+2gh))/g with s = 5.8·sin45°, h = 1 → ≈4.24 m.
    const full = launch(P_FULL, Math.PI / 4);
    while (!full.landed) step(full);
    expect(full.landX).toBeGreaterThan(4.1);
    expect(full.landX).toBeLessThan(4.35);

    const weak = launch(0.1, Math.PI / 4);
    while (!weak.landed) step(weak);
    expect(weak.landX).toBeLessThan(1.6);
  });

  it('is deterministic: identical inputs land bit-identical', () => {
    const a = launch(0.73, 0.62);
    const b = launch(0.73, 0.62);
    while (!a.landed) step(a);
    while (!b.landed) step(b);
    expect(a.landX).toBe(b.landX);
  });
});

describe('orders', () => {
  const staticOrder: OrderSpec = { kind: 'burger', cx: 2.1, w: 0.44, band: [0.4, 0.68], moveAmp: 0, moveSpeed: 0 };

  it('static targets hold their center; movers oscillate around it', () => {
    expect(targetCxAt(staticOrder, 3)).toBe(2.1);
    const mover: OrderSpec = { ...staticOrder, moveAmp: 0.25, moveSpeed: 1.1 };
    expect(targetCxAt(mover, 0)).toBe(2.1);
    expect(targetCxAt(mover, Math.PI / 2.2)).toBeCloseTo(2.35, 3);
  });

  it('coverage: dead center 1, clean miss 0, edge partial', () => {
    expect(coverage(2.1, staticOrder, 0)).toBeCloseTo(1, 5);
    expect(coverage(2.6, staticOrder, 0)).toBe(0);
    const edge = coverage(2.27, staticOrder, 0);
    expect(edge).toBeGreaterThan(0.5);
    expect(edge).toBeLessThan(1);
  });

  it('perfectHit only inside the zone center', () => {
    expect(perfectHit(2.1, staticOrder, 0)).toBe(true);
    expect(perfectHit(2.15, staticOrder, 0)).toBe(true);
    expect(perfectHit(2.25, staticOrder, 0)).toBe(false);
  });

  it('scoreFor: plated is the full count, coverage rounds, clamps', () => {
    expect(scoreFor(0.4, true)).toBe(100);
    expect(scoreFor(0.5, false)).toBe(50);
    expect(scoreFor(2, false)).toBe(100);
    expect(scoreFor(0, false)).toBe(0);
  });

  it('rush book escalates: five orders, farther and then moving', () => {
    const orders = rushOrders();
    expect(orders).toHaveLength(5);
    expect(orders[0].moveAmp).toBe(0);
    expect(orders[3].moveAmp).toBeGreaterThan(0);
    expect(orders[4].cx).toBeGreaterThan(orders[0].cx);
    for (const o of orders) expect(o.band[1]).toBeLessThan(1);
  });

  it('daily book is seed-deterministic and differs across seeds', () => {
    const a = dailyOrders(mulberry32(20261024));
    const b = dailyOrders(mulberry32(20261024));
    const c = dailyOrders(mulberry32(20261025));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    for (const o of a) {
      expect(o.cx).toBeGreaterThan(1.4);
      expect(o.cx).toBeLessThan(3.9);
      expect(o.band[1]).toBeLessThan(1);
    }
  });
});
