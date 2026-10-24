import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@icarus/platform';
import { CALM_FIRE, createMallow, gustAt, gustyFire, rotate, stats, step, type Mallow } from '../mallow';
import { dailyOrders, gradeFor, rushOrders, scoreMallow, GOLDEN, type OrderSpec } from '../orders';
import { CHARCOAL_H, DT, FACES } from '../constants';

const goldenOrder: OrderSpec = { ...GOLDEN, fireScale: 1 };

/** Run the sim n steps, rotating by dAngle each step, collecting events. */
function run(m: Mallow, seconds: number, dAngle = 0, fire = CALM_FIRE) {
  const events = [];
  let t = 0;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    t += DT;
    if (dAngle !== 0) rotate(m, dAngle);
    const ev = step(m, fire, t);
    if (ev) events.push(ev);
  }
  return events;
}

/** Craft a mallow with uniform faces (test fixture). */
function uniform(h: number): Mallow {
  const m = createMallow();
  m.faces.fill(h);
  return m;
}

describe('fire', () => {
  it('gusts stay inside their amplitude band and are deterministic', () => {
    for (let t = 0; t < 30; t += 0.37) {
      const g = gustAt(CALM_FIRE, t);
      expect(g).toBeGreaterThan(0.7);
      expect(g).toBeLessThan(1.3);
    }
    expect(gustAt(CALM_FIRE, 12.34)).toBe(gustAt(CALM_FIRE, 12.34));
  });

  it('daily gusty fire is seed-deterministic and differs across seeds', () => {
    const a = gustyFire(mulberry32(1));
    const b = gustyFire(mulberry32(1));
    const c = gustyFire(mulberry32(2));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    // gusty swings are wider than the calm fire
    let lo = 9;
    let hi = 0;
    for (let t = 0; t < 40; t += 0.11) {
      const g = gustAt(a, t);
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    expect(hi - lo).toBeGreaterThan(0.5);
  });
});

describe('roast', () => {
  it('steady rotation toasts evenly without igniting', () => {
    const m = createMallow();
    const events = run(m, 18, 0.05);
    const st = stats(m);
    expect(st.avg).toBeGreaterThan(0.45);
    expect(st.avg).toBeLessThan(0.9);
    expect(st.variance).toBeLessThan(0.02);
    expect(events.filter((e) => e.type === 'ignited')).toHaveLength(0);
  });

  it('parking one face over the flame ignites it in a humane window', () => {
    const m = createMallow();
    const events = run(m, 12);
    const ign = events.find((e) => e.type === 'ignited');
    expect(ign).toBeDefined();
    expect(ign!.type).toBe('ignited');
    if (ign!.type === 'ignited') expect(ign!.face).toBe(0); // dead-down face
  });

  it('unshaken flames char the face and lock it to charcoal', () => {
    const m = createMallow();
    const events = run(m, 12);
    const charred = events.find((e) => e.type === 'charred');
    expect(charred).toBeDefined();
    if (charred!.type === 'charred') {
      expect(m.charcoal[charred!.face]).toBe(true);
      expect(m.faces[charred!.face]).toBe(CHARCOAL_H);
    }
  });

  it('shake flips extinguish into a singed cap, not charcoal', () => {
    const m = createMallow();
    let t = 0;
    let ignited = false;
    // roast static until ignition
    for (let i = 0; i < 12 / DT && !ignited; i += 1) {
      t += DT;
      const ev = step(m, CALM_FIRE, t);
      if (ev?.type === 'ignited') ignited = true;
    }
    expect(ignited).toBe(true);
    // shake: alternating drags, ≥3 flips
    let extinguished = false;
    const shakes = [0.5, -0.5, 0.55, -0.55];
    for (const d of shakes) {
      rotate(m, d);
      t += DT;
      const ev = step(m, CALM_FIRE, t);
      if (ev?.type === 'extinguished') extinguished = true;
    }
    expect(extinguished).toBe(true);
    expect(m.flamingFace).toBe(-1);
    expect(m.charcoal.every((c) => !c)).toBe(true);
    expect(stats(m).avg).toBeLessThanOrEqual(0.99);
  });
});

describe('orders + scoring', () => {
  it('an even golden mallow scores top marks with the Golden tag', () => {
    const r = scoreMallow(uniform(0.7), goldenOrder);
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.tag).toBe('Golden!');
    expect(r.grade).toBe('S');
  });

  it('uneven toasting scores below even at the same average', () => {
    const even = scoreMallow(uniform(0.7), goldenOrder);
    const m = createMallow();
    for (let i = 0; i < FACES; i += 1) m.faces[i] = i % 2 === 0 ? 1.0 : 0.4; // avg 0.7
    const uneven = scoreMallow(m, goldenOrder);
    expect(uneven.score).toBeLessThan(even.score);
  });

  it('raw pull scores pocket change with the Raw tag', () => {
    const r = scoreMallow(uniform(0.1), goldenOrder);
    expect(r.score).toBeLessThanOrEqual(12);
    expect(r.tag).toBe('Raw');
  });

  it('charcoal caps the score and reads Burnt', () => {
    const m = uniform(0.7);
    m.charcoal[3] = true;
    m.faces[3] = CHARCOAL_H;
    const r = scoreMallow(m, goldenOrder);
    expect(r.score).toBeLessThanOrEqual(20);
    expect(r.tag).toBe('Burnt');
  });

  it('serving on fire caps lowest of all', () => {
    const m = uniform(0.7);
    m.flamingFace = 2;
    const r = scoreMallow(m, goldenOrder);
    expect(r.score).toBeLessThanOrEqual(15);
    expect(r.tag).toBe('On fire');
  });

  it('grade ladder boundaries', () => {
    expect(gradeFor(90)).toBe('S');
    expect(gradeFor(89)).toBe('A');
    expect(gradeFor(75)).toBe('A');
    expect(gradeFor(55)).toBe('B');
    expect(gradeFor(30)).toBe('C');
    expect(gradeFor(29)).toBe('D');
  });

  it('rush book escalates the fire; daily book is seed-deterministic', () => {
    const rush = rushOrders();
    expect(rush).toHaveLength(5);
    expect(rush[4].fireScale).toBeGreaterThan(rush[0].fireScale);
    const a = dailyOrders(mulberry32(7));
    const b = dailyOrders(mulberry32(7));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(dailyOrders(mulberry32(8))));
  });
});
