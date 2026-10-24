/**
 * The bottle: rhythm + pressure. The "57" sweet spot pulses on a period that
 * shortens as pressure rises — greed literally speeds the rhythm up. A tap is
 * answered with quality q (triangle peak mid-period); q scales the pressure
 * add. Pressure decays slowly, so holding a cadence is the skill. At or past
 * SPLAT_P the bottle erupts on the table — the two-phase near-miss top end.
 */
import { P_ADD_BASE, P_ADD_Q, P_DECAY, PERFECT_Q, RHYTHM_T0, RHYTHM_T1, SPLAT_P } from './constants';

export interface Bottle {
  pressure: number;
  taps: number;
  /** Consecutive perfect taps (drives the audio pitch ladder + fever). */
  streak: number;
  bestStreak: number;
  splatted: boolean;
}

export function createBottle(): Bottle {
  return { pressure: 0, taps: 0, streak: 0, bestStreak: 0, splatted: false };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Pulse period (s) at a given pressure: 1.5s empty → 0.8s near-max. */
export function rhythmPeriod(pressure: number): number {
  return RHYTHM_T0 + (RHYTHM_T1 - RHYTHM_T0) * clamp01(pressure / 0.95);
}

/** Position in the pulse cycle, 0..1. Deterministic from order-local time. */
export function ringPhase(t: number, period: number): number {
  const p = (t % period) / period;
  return p < 0 ? p + 1 : p;
}

/**
 * Tap quality 0..1 — triangle peak at phase 0.5 (the ring fully closed).
 * PERFECT_Q (0.8) ⇔ within ±10% of the period around the beat.
 */
export function ringQ(t: number, period: number): number {
  return 1 - Math.abs(ringPhase(t, period) - 0.5) * 2;
}

export type TapEvent =
  | { type: 'tap'; q: number; perfect: boolean; pressure: number }
  | { type: 'splat'; q: number; pressure: number };

/** Answer one tap at order-local time t. The rhythm period is read BEFORE
 *  the add so the pulse the player saw is the one they are judged against. */
export function tap(b: Bottle, t: number): TapEvent {
  const q = ringQ(t, rhythmPeriod(b.pressure));
  b.taps += 1;
  b.pressure += P_ADD_BASE + P_ADD_Q * q;
  if (b.pressure >= SPLAT_P) {
    b.splatted = true;
    b.streak = 0;
    return { type: 'splat', q, pressure: b.pressure };
  }
  const perfect = q >= PERFECT_Q;
  b.streak = perfect ? b.streak + 1 : 0;
  if (b.streak > b.bestStreak) b.bestStreak = b.streak;
  return { type: 'tap', q, perfect, pressure: b.pressure };
}

/** Pressure bleed — call once per fixed step. */
export function update(b: Bottle, dt: number): void {
  if (b.pressure > 0) b.pressure = Math.max(0, b.pressure - P_DECAY * dt);
}
