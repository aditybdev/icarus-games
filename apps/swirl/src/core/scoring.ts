/**
 * Free Swirl scoring — pure, deterministic functions.
 *
 * Score = height points + neatness bonus. Taller is always better;
 * a steady hand adds up to NEATNESS_BONUS_MAX extra points.
 *
 * Also home to the two Free Swirl score modifiers:
 *  - combo multiplier: streak of dispensing inside CENTER_DEAD_ZONE (P1-2)
 *  - turbo overdrive: score-per-second past MAX_HEIGHT (P2-3)
 */
import {
  CM_PER_UNIT,
  COMBO_DECAY,
  COMBO_MAX_MULTIPLIER,
  COMBO_STEP_TIME,
  TURBO_GAIN_MAX,
  TURBO_GAIN_RAMP,
  TURBO_SCORE_RATE,
} from './constants';
import { neatness } from './wobble';

/** Largest possible neatness bonus (at zero wobble). */
export const NEATNESS_BONUS_MAX = 500;

/** Points awarded per world unit of height. */
export const POINTS_PER_UNIT = 100;

/** Convert a world-unit height to the display centimeters used by the HUD. */
export function heightToCm(height: number): number {
  return Math.round(Math.max(0, height) * CM_PER_UNIT);
}

/**
 * Deterministic Free Swirl score for a finished (or toppled) swirl.
 * Always a non-negative integer; identical inputs give identical outputs.
 * The neatness bonus ramps in over the first world unit of height so an
 * empty cone earns nothing.
 */
export function freeSwirlScore(height: number, wobble: number): number {
  const h = Math.max(0, height);
  const base = h * POINTS_PER_UNIT;
  const bonusScale = Math.min(1, h);
  const bonus = neatness(wobble, h) * NEATNESS_BONUS_MAX * bonusScale;
  const score = Math.round(base + bonus);
  return score > 0 ? score : 0;
}

/* --------------------- combo multiplier (P1-2) --------------------- */

/** Streak state for the neatness combo: seconds spent dispensing in-zone. */
export interface ComboState {
  streak: number;
}

export function createCombo(): ComboState {
  return { streak: 0 };
}

/**
 * Advance the combo streak. `inDeadZone` = dispensing inside
 * CENTER_DEAD_ZONE this frame; off-zone time decays the streak.
 */
export function updateCombo(combo: ComboState, dt: number, inDeadZone: boolean): ComboState {
  let streak = combo.streak + (inDeadZone ? dt : -COMBO_DECAY * dt);
  if (!Number.isFinite(streak) || streak < 0) streak = 0;
  const maxStreak = (COMBO_MAX_MULTIPLIER - 1) * COMBO_STEP_TIME;
  if (streak > maxStreak) streak = maxStreak;
  return { streak };
}

/** Current multiplier: +1 per COMBO_STEP_TIME of streak, capped. */
export function multiplierFor(combo: ComboState): number {
  return Math.min(COMBO_MAX_MULTIPLIER, 1 + Math.floor(combo.streak / COMBO_STEP_TIME));
}

/* ---------------------- turbo overdrive (P2-3) ---------------------- */

/** Overdrive state past MAX_HEIGHT: elapsed time + accrued bonus points. */
export interface TurboState {
  time: number;
  score: number;
}

export function createTurbo(): TurboState {
  return { time: 0, score: 0 };
}

/** Advance overdrive: bonus accrues only while dispensing, scaled by neatness. */
export function updateTurbo(turbo: TurboState, dt: number, dispensing: boolean, neat: number): TurboState {
  const n = Math.min(1, Math.max(0, neat));
  return {
    time: turbo.time + dt,
    score: dispensing ? turbo.score + TURBO_SCORE_RATE * n * dt : turbo.score,
  };
}

/** Wobble-gain scale ramp while in overdrive (risk rises the longer you hold). */
export function turboGainScale(turbo: TurboState): number {
  return Math.min(TURBO_GAIN_MAX, 1 + TURBO_GAIN_RAMP * turbo.time);
}

/* ------------------------- combined free score ------------------------- */

/** Live/final Free Swirl score: (base + turbo bonus) × combo multiplier. */
export function totalFreeScore(height: number, wobble: number, combo: ComboState, turbo: TurboState): number {
  const raw = (freeSwirlScore(height, wobble) + Math.floor(turbo.score)) * multiplierFor(combo);
  return raw > 0 ? raw : 0;
}
