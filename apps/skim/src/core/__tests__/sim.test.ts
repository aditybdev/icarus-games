import { describe, expect, it } from 'vitest';
import {
  ANGLE_MAX,
  ANGLE_MIN,
  DT,
  GRAVITY,
  HAND_HEIGHT,
  SINK_SPEED,
  THROW_MAX,
  THROW_MIN,
  WINDOW_MIN,
  WINDOW_START,
} from '../constants';
import {
  CALM_LAKE,
  clampThrow,
  createStone,
  distanceM,
  step,
  tap,
  tapWindow,
  waveY,
  type Lake,
  type SimEvent,
  type Stone,
} from '../sim';

/** Step the sim until an event of `type` fires (or maxT seconds pass). */
function runUntil(
  stone: Stone,
  lake: Lake,
  t: { v: number },
  type: SimEvent['type'],
  maxT = 20,
): SimEvent | null {
  while (t.v < maxT) {
    t.v += DT;
    const ev = step(stone, lake, t.v);
    if (ev && ev.type === type) return ev;
  }
  return null;
}

/** Play a full run: perfect-tap every contact as soon as it opens. */
function autoPlay(speed: number, angle: number, lake: Lake = CALM_LAKE) {
  const stone = createStone(clampThrow(speed, angle));
  const t = { v: 0 };
  let bounces = 0;
  for (let i = 0; i < 120 * 45; i += 1) {
    t.v += DT;
    const ev = step(stone, lake, t.v);
    if (ev?.type === 'contact') {
      tap(stone, t.v); // instant tap = q 1
      bounces += 1;
    }
    if (ev?.type === 'sunk') break;
  }
  return { stone, bounces, t: t.v };
}

describe('clampThrow', () => {
  it('clamps speed and angle into the legal envelope', () => {
    expect(clampThrow(99, 9)).toEqual({ speed: THROW_MAX, angle: ANGLE_MAX });
    expect(clampThrow(0.1, -9)).toEqual({ speed: THROW_MIN, angle: ANGLE_MIN });
    expect(clampThrow(10, 0.2)).toEqual({ speed: 10, angle: 0.2 });
  });
});

describe('waveY', () => {
  it('is deterministic and bounded by 1.5x amplitude', () => {
    const lake: Lake = { wind: 0, waveAmp: 0.1 };
    expect(waveY(lake, 3, 2)).toBe(waveY(lake, 3, 2));
    for (let i = 0; i < 200; i += 1) {
      expect(Math.abs(waveY(lake, i * 0.7, i * 0.13))).toBeLessThanOrEqual(0.15 + 1e-9);
    }
  });
});

describe('tapWindow', () => {
  it('decays with skip count down to the floor', () => {
    expect(tapWindow(0)).toBe(WINDOW_START);
    expect(tapWindow(10)).toBeLessThan(WINDOW_START);
    expect(tapWindow(999)).toBe(WINDOW_MIN);
  });
});

describe('projectile flight', () => {
  it('falls under real gravity and first contact happens downrange', () => {
    const stone = createStone(clampThrow(10, 0.1));
    const t = { v: 0 };
    const ev = runUntil(stone, CALM_LAKE, t, 'contact');
    expect(ev?.type).toBe('contact');
    if (ev?.type !== 'contact') return;
    expect(ev.x).toBeGreaterThan(2); // flew somewhere
    expect(stone.y).toBeLessThanOrEqual(HAND_HEIGHT + 1);
    // Energy check: flight time roughly matches a 1.1 m drop at low angle.
    const dropT = Math.sqrt((2 * HAND_HEIGHT) / GRAVITY);
    expect(t.v).toBeGreaterThan(dropT * 0.6);
  });

  it('a missed window kills the run and the stone then sinks fully', () => {
    const stone = createStone(clampThrow(10, 0.1));
    const t = { v: 0 };
    expect(runUntil(stone, CALM_LAKE, t, 'contact')?.type).toBe('contact');
    const died = runUntil(stone, CALM_LAKE, t, 'died', 5);
    expect(died?.type).toBe('died');
    if (died?.type === 'died') expect(died.reason).toBe('missed');
    expect(runUntil(stone, CALM_LAKE, t, 'sunk', 10)?.type).toBe('sunk');
  });
});

describe('tap bounce', () => {
  it('instant taps preserve the most speed; late taps the least', () => {
    const mk = () => {
      const s = createStone(clampThrow(12, 0.05));
      const t = { v: 0 };
      runUntil(s, CALM_LAKE, t, 'contact');
      return { s, t };
    };
    const fast = mk();
    const fastVx = fast.s.vx;
    tap(fast.s, fast.t.v); // q = 1

    const slow = mk();
    const slowT0 = slow.t.v;
    // tap at the very end of the window
    tap(slow.s, slowT0 + tapWindow(slow.s.skips) * 0.99);

    expect(fast.s.vx).toBeGreaterThan(slow.s.vx);
    expect(fast.s.vx).toBeLessThanOrEqual(fastVx + 1e-9); // never gains
    expect(slow.s.vy).toBeGreaterThan(0); // still bounced
  });

  it('stray taps mid-flight do nothing', () => {
    const stone = createStone(clampThrow(10, 0.2));
    expect(tap(stone, 0.05)).toBeNull();
    expect(stone.vx).toBeGreaterThan(0);
  });

  it('perfect chain counts only high-q taps', () => {
    const stone = createStone(clampThrow(12, 0.05));
    const t = { v: 0 };
    runUntil(stone, CALM_LAKE, t, 'contact');
    tap(stone, t.v); // instant = perfect
    expect(stone.perfects).toBe(1);
    runUntil(stone, CALM_LAKE, t, 'contact');
    tap(stone, t.v + tapWindow(stone.skips) * 0.95); // late = not perfect
    expect(stone.perfects).toBe(1);
  });
});

describe('full runs', () => {
  it('perfect play chains many skips and travels well past bronze', () => {
    const { stone, bounces } = autoPlay(16, 0.02);
    expect(bounces).toBeGreaterThanOrEqual(5);
    expect(distanceM(stone)).toBeGreaterThan(30);
  });

  it('a weak throw with no taps sinks quickly', () => {
    const stone = createStone(clampThrow(5, 0.4));
    const t = { v: 0 };
    const ev = runUntil(stone, CALM_LAKE, t, 'sunk', 15);
    expect(ev?.type).toBe('sunk');
    expect(distanceM(stone)).toBeLessThan(40);
  });

  it('a stone that slows below plane speed dies "slow" on the next contact', () => {
    // Hand-build a nearly-stopped stone just above the surface.
    const stone = createStone(clampThrow(10, 0));
    stone.vx = SINK_SPEED * 0.5;
    stone.vy = -0.5;
    stone.y = waveY(CALM_LAKE, 0, 0) + 0.2;
    const t = { v: 0 };
    const ev = runUntil(stone, CALM_LAKE, t, 'died', 5);
    expect(ev?.type).toBe('died');
    if (ev?.type === 'died') expect(ev.reason).toBe('slow');
  });

  it('determinism: identical inputs produce identical outcomes (P2/P7)', () => {
    const a = autoPlay(12, 0.1);
    const b = autoPlay(12, 0.1);
    expect(a.stone.x).toBe(b.stone.x);
    expect(a.bounces).toBe(b.bounces);
    expect(a.stone.perfects).toBe(b.stone.perfects);
  });

  it('wind changes the outcome (daily lakes differ)', () => {
    const calm = autoPlay(12, 0.1, CALM_LAKE);
    const windy = autoPlay(12, 0.1, { wind: 0.8, waveAmp: 0.05 });
    expect(windy.stone.x).not.toBe(calm.stone.x);
  });
});
