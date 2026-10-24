/**
 * Skim — pure stone-skipping simulation. Deterministic, fixed-timestep,
 * allocation-free in the hot loop: step() advances the stone, tap() answers
 * a player tap against the live contact window. All rendering/input code
 * sits outside; every rule here is unit-tested.
 *
 * Water contact model: the stone planes when it meets the wave surface
 * moving downward. While a contact window is live the stone is held at the
 * contact point (timing stays honest — the ring never drifts); a tap inside
 * the window reflects it with quality-scaled retention. A missed window or
 * arriving below plane speed kills the run, and the stone then plunges with
 * water drag until it is fully sunk (the fail spectacle beat).
 */
import {
  ANGLE_MAX,
  ANGLE_MIN,
  DT,
  GRAVITY,
  HAND_HEIGHT,
  MAX_FLIGHT_S,
  MAX_SKIPS,
  PERFECT_Q,
  SINK_DEPTH,
  SINK_SPEED,
  STONE_R,
  THROW_MAX,
  THROW_MIN,
  VX_KEEP_BASE,
  VX_KEEP_Q,
  VY_FLOOR,
  VY_INBOUND,
  VY_Q,
  WINDOW_DECAY,
  WINDOW_MIN,
  WINDOW_START,
} from './constants';

export interface Lake {
  /** Lateral wind acceleration (m/s^2, + pushes downrange). */
  wind: number;
  /** Wave amplitude (m). */
  waveAmp: number;
}

export const CALM_LAKE: Lake = { wind: 0, waveAmp: 0.05 };

export interface Stone {
  x: number;
  y: number;
  vx: number;
  vy: number;
  skips: number;
  /** Sim time (s) of the most recent water contact. */
  contactT: number;
  /** True while the stone waits on a tap at the current contact. */
  awaitingTap: boolean;
  /** Run over (missed window / too slow / caps) — the stone is plunging. */
  dead: boolean;
  lastQ: number;
  perfects: number;
}

export interface Throw_ {
  speed: number;
  angle: number;
}

/** Clamp a raw flick into a legal throw. */
export function clampThrow(speed: number, angle: number): Throw_ {
  return {
    speed: Math.min(THROW_MAX, Math.max(THROW_MIN, speed)),
    angle: Math.min(ANGLE_MAX, Math.max(ANGLE_MIN, angle)),
  };
}

/** Wave surface height (m) at position x and sim time t — deterministic. */
export function waveY(lake: Lake, x: number, t: number): number {
  const a = lake.waveAmp;
  return (
    a * Math.sin(0.9 * (x - 1.2 * t)) + 0.5 * a * Math.sin(1.7 * (x + 0.8 * t))
  );
}

/** Tap window (s) for a given skip count (the stone's current skip number). */
export function tapWindow(skips: number): number {
  return Math.max(WINDOW_MIN, WINDOW_START - skips * WINDOW_DECAY);
}

export function createStone(tw: Throw_): Stone {
  return {
    x: 0,
    y: HAND_HEIGHT,
    vx: tw.speed * Math.cos(tw.angle),
    vy: tw.speed * Math.sin(tw.angle),
    skips: 0,
    contactT: -1,
    awaitingTap: false,
    dead: false,
    lastQ: 0,
    perfects: 0,
  };
}

export type SimEvent =
  | { type: 'contact'; skip: number; x: number; window: number }
  | { type: 'bounce'; q: number; perfect: boolean; x: number }
  | { type: 'died'; x: number; reason: 'missed' | 'slow' }
  | { type: 'sunk'; x: number };

/** Water drag while plunging (m/s^2 opposing motion, simple quadratic feel). */
const PLUNGE_DRAG = 6;

/**
 * Advance the sim one fixed step. Returns an event when one fires.
 * After death the stone keeps integrating with water drag until it is deep
 * enough ('sunk'), so the renderer can play the plunge out.
 */
export function step(stone: Stone, lake: Lake, t: number): SimEvent | null {
  if (stone.dead) {
    const speed = Math.hypot(stone.vx, stone.vy);
    if (speed > 0.01) {
      const drag = (PLUNGE_DRAG * DT) / Math.max(speed, 0.5);
      stone.vx *= 1 - drag;
      stone.vy *= 1 - drag;
    }
    stone.vy -= GRAVITY * DT * 0.35; // buoyant plunge: slower than free fall
    stone.x += stone.vx * DT;
    stone.y += stone.vy * DT;
    const surface = waveY(lake, stone.x, t);
    if (stone.y < surface - SINK_DEPTH) return { type: 'sunk', x: stone.x };
    return null;
  }

  if (stone.awaitingTap) {
    if (t - stone.contactT > tapWindow(stone.skips)) {
      stone.dead = true;
      stone.awaitingTap = false;
      // A missed window: the stone digs in and starts to plunge.
      stone.vx *= 0.25;
      stone.vy = Math.min(stone.vy, -1);
      return { type: 'died', x: stone.x, reason: 'missed' };
    }
    return null;
  }

  stone.vx += lake.wind * DT;
  stone.vy -= GRAVITY * DT;
  stone.x += stone.vx * DT;
  stone.y += stone.vy * DT;

  if (stone.skips >= MAX_SKIPS || t > MAX_FLIGHT_S) {
    stone.dead = true;
    stone.vy = Math.min(stone.vy, -1);
    return { type: 'died', x: stone.x, reason: 'missed' };
  }

  const surface = waveY(lake, stone.x, t);
  if (stone.vy < 0 && stone.y - STONE_R <= surface) {
    if (stone.vx < SINK_SPEED) {
      stone.dead = true;
      stone.vy = Math.min(stone.vy, -1);
      return { type: 'died', x: stone.x, reason: 'slow' };
    }
    stone.y = surface + STONE_R;
    stone.contactT = t;
    stone.awaitingTap = true;
    stone.skips += 1;
    return { type: 'contact', skip: stone.skips, x: stone.x, window: tapWindow(stone.skips) };
  }
  return null;
}

/**
 * Answer the live contact window with a tap. Returns the bounce event, or
 * null when no window is live (a stray tap mid-flight means nothing).
 */
export function tap(stone: Stone, t: number): SimEvent | null {
  if (stone.dead || !stone.awaitingTap) return null;
  const inboundVy = Math.abs(stone.vy);
  const q = Math.min(1, Math.max(0, 1 - (t - stone.contactT) / tapWindow(stone.skips)));
  const perfect = q >= PERFECT_Q;
  stone.lastQ = q;
  if (perfect) stone.perfects += 1;
  stone.vx *= VX_KEEP_BASE + VX_KEEP_Q * q;
  stone.vy = VY_FLOOR + VY_Q * q + inboundVy * VY_INBOUND;
  stone.awaitingTap = false;
  return { type: 'bounce', q, perfect, x: stone.x };
}

/** Distance skimmed so far (m from the throw line). */
export function distanceM(stone: Stone): number {
  return Math.max(0, stone.x);
}

/** Fraction of the live window remaining (0..1; 0 when no window is live). */
export function windowFrac(stone: Stone, t: number): number {
  if (!stone.awaitingTap || stone.dead) return 0;
  return Math.max(0, Math.min(1, 1 - (t - stone.contactT) / tapWindow(stone.skips)));
}
