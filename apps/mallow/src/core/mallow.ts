/**
 * The roast: per-face heat accumulation over a flickering fire. Face angles
 * hang off the mallow's rotation; only the downward hemisphere heats, with a
 * cos^k peak dead-down — steady rotation toasts evenly, parking one face
 * ignites it. Ignition starts a char timer and a fire-spread panic; shake
 * flips extinguish into a singed cap, else the face locks to charcoal.
 * Everything is deterministic from mallow-local time (daily fairness).
 */
import {
  CHAR_SECONDS,
  CHARCOAL_H,
  DT,
  EXTINGUISH_FLIPS,
  FACES,
  FLAME_SPREAD,
  GUST_CALM,
  GUST_DAILY,
  HEAT_BASE,
  HEAT_FALLOFF,
  IGNITE_H,
  SINGE_CAP,
} from './constants';

export interface Fire {
  /** Order-level fire intensity multiplier (hot/cold orders). */
  scale: number;
  gustAmp: number;
  w1: number;
  p1: number;
  w2: number;
  p2: number;
}

export const CALM_FIRE: Fire = { scale: 1, gustAmp: GUST_CALM, w1: 0.9, p1: 0, w2: 2.3, p2: 1.7 };

/** Daily campfire: strong gusts, seeded phases — same wind for everyone. */
export function gustyFire(rng: () => number, scale = 1): Fire {
  return {
    scale,
    gustAmp: GUST_DAILY,
    w1: 0.7 + rng() * 0.8,
    p1: rng() * Math.PI * 2,
    w2: 1.9 + rng() * 1.2,
    p2: rng() * Math.PI * 2,
  };
}

/** Flame intensity multiplier at mallow-local time t (1 ± gustAmp). */
export function gustAt(fire: Fire, t: number): number {
  const g = Math.sin(fire.w1 * t + fire.p1) + 0.5 * Math.sin(fire.w2 * t + fire.p2);
  return Math.max(0.2, fire.scale * (1 + fire.gustAmp * (g / 1.5)));
}

export interface Mallow {
  /** Per-face doneness, 0..CHARCOAL_H. */
  faces: number[];
  /** Locked-charcoal faces. */
  charcoal: boolean[];
  /** Rotation (radians); face i sits at angle + i·2π/FACES, 0 = down. */
  angle: number;
  /** Face currently aflame, or -1. */
  flamingFace: number;
  /** Seconds the current flame has burned. */
  flameT: number;
  /** Direction flips counted toward the extinguish. */
  flips: number;
  /** Last drag direction sign for flip detection. */
  lastDir: number;
  pulled: boolean;
}

export function createMallow(): Mallow {
  return {
    faces: new Array(FACES).fill(0),
    charcoal: new Array(FACES).fill(false),
    angle: 0,
    flamingFace: -1,
    flameT: 0,
    flips: 0,
    lastDir: 0,
    pulled: false,
  };
}

/** Rotate by a drag delta (radians). Also feeds flip detection while flaming. */
export function rotate(m: Mallow, dAngle: number): void {
  m.angle += dAngle;
  const dir = dAngle > 0.001 ? 1 : dAngle < -0.001 ? -1 : 0;
  if (dir !== 0 && m.flamingFace >= 0) {
    if (m.lastDir !== 0 && dir !== m.lastDir) m.flips += 1;
    m.lastDir = dir;
  }
}

export type RoastEvent =
  | { type: 'ignited'; face: number }
  | { type: 'extinguished'; face: number }
  | { type: 'charred'; face: number }
  | null;

/** One fixed step of heat + flame state. */
export function step(m: Mallow, fire: Fire, t: number): RoastEvent {
  if (m.pulled) return null;
  const rate = HEAT_BASE * gustAt(fire, t) * (m.flamingFace >= 0 ? FLAME_SPREAD : 1);

  // Extinguish check happens before further damage.
  if (m.flamingFace >= 0 && m.flips >= EXTINGUISH_FLIPS) {
    const face = m.flamingFace;
    m.faces[face] = Math.min(m.faces[face], SINGE_CAP);
    m.flamingFace = -1;
    m.flameT = 0;
    m.flips = 0;
    m.lastDir = 0;
    return { type: 'extinguished', face };
  }

  for (let i = 0; i < FACES; i += 1) {
    if (m.charcoal[i]) continue;
    const a = m.angle + (i * 2 * Math.PI) / FACES;
    const exposure = Math.max(0, Math.cos(a)) ** HEAT_FALLOFF;
    m.faces[i] = Math.min(CHARCOAL_H, m.faces[i] + rate * exposure * DT);
  }

  if (m.flamingFace >= 0) {
    m.flameT += DT;
    if (m.flameT >= CHAR_SECONDS) {
      const face = m.flamingFace;
      m.charcoal[face] = true;
      m.faces[face] = CHARCOAL_H;
      m.flamingFace = -1;
      m.flameT = 0;
      m.flips = 0;
      m.lastDir = 0;
      return { type: 'charred', face };
    }
    return null;
  }

  for (let i = 0; i < FACES; i += 1) {
    if (!m.charcoal[i] && m.faces[i] >= IGNITE_H) {
      m.flamingFace = i;
      m.flameT = 0;
      m.flips = 0;
      m.lastDir = 0;
      return { type: 'ignited', face: i };
    }
  }
  return null;
}

/* --------------------------------- stats --------------------------------- */

export interface RoastStats {
  avg: number;
  variance: number;
  charcoalCount: number;
  flaming: boolean;
}

export function stats(m: Mallow): RoastStats {
  let sum = 0;
  let charcoalCount = 0;
  for (let i = 0; i < FACES; i += 1) {
    sum += m.faces[i];
    if (m.charcoal[i]) charcoalCount += 1;
  }
  const avg = sum / FACES;
  let v = 0;
  for (let i = 0; i < FACES; i += 1) v += (m.faces[i] - avg) ** 2;
  return { avg, variance: v / FACES, charcoalCount, flaming: m.flamingFace >= 0 };
}
