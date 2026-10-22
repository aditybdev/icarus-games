/**
 * Free Swirl scoring — pure, deterministic functions.
 *
 * Score = height points + neatness bonus. Taller is always better;
 * a steady hand adds up to NEATNESS_BONUS_MAX extra points.
 */
import { CM_PER_UNIT } from './constants';
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
