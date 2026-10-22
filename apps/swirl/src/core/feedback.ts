/**
 * Near-miss / best-chase feedback rules — pure, deterministic, unit-tested.
 *
 * Ratios here are always "fraction of the topple threshold":
 *   ratioOfThreshold = wobbleRatio(wobble, height) / TOPPLE_WOBBLE_RATIO
 * so 0 = perfectly steady, 1 = about to topple.
 */
import { MAX_HEIGHT } from './constants';
import { POINTS_PER_UNIT } from './scoring';

/** Tension feedback fades in once the ratio passes this fraction. */
export const TENSION_START_RATIO = 0.55;

/** Ratio at/above which the swirl counts as "nearly toppled" (arms a save). */
export const NEAR_MISS_RATIO = 0.75;

/** Ratio at/below which an armed near-miss counts as recovered. */
export const RECOVERED_RATIO = 0.4;

/** A "Saved it!" only counts on a substantial swirl (world units). */
export const MIN_SAVE_HEIGHT = 2;

/** Camera micro-shake amplitude (world units) at full tension. */
export const TENSION_SHAKE_MAX = 0.05;

/**
 * Tension level in [0, 1]: 0 below TENSION_START_RATIO, ramping linearly
 * to 1 at the topple threshold. Drives the audio riser and camera shake.
 */
export function tensionLevel(ratioOfThreshold: number): number {
  if (!Number.isFinite(ratioOfThreshold) || ratioOfThreshold <= TENSION_START_RATIO) return 0;
  const t = (ratioOfThreshold - TENSION_START_RATIO) / (1 - TENSION_START_RATIO);
  return t >= 1 ? 1 : t;
}

/** Mutable near-miss tracker; one per round (reset via createNearMiss). */
export interface NearMissState {
  /** True once the ratio has entered the near-miss zone this round. */
  armed: boolean;
}

export function createNearMiss(): NearMissState {
  return { armed: false };
}

export type NearMissEvent = 'none' | 'saved';

/**
 * Advance the near-miss tracker. Returns 'saved' exactly once per
 * near-miss episode: when the ratio recovers from the near-miss zone back
 * to safe on a tall-enough swirl.
 */
export function updateNearMiss(
  state: NearMissState,
  ratioOfThreshold: number,
  height: number,
): NearMissEvent {
  if (ratioOfThreshold >= NEAR_MISS_RATIO) {
    state.armed = true;
    return 'none';
  }
  if (state.armed && ratioOfThreshold <= RECOVERED_RATIO) {
    state.armed = false;
    if (height >= MIN_SAVE_HEIGHT) return 'saved';
  }
  return 'none';
}

/** True when the live score has passed the saved best (best must exist). */
export function isNewBestPace(liveScore: number, savedBest: number): boolean {
  return savedBest > 0 && liveScore > savedBest;
}

/**
 * Height-meter fraction ([0,1]) where the saved-best marker sits, or null
 * when there is no saved best. Approximates the best score as pure height
 * points (ignoring the neatness bonus) so the tick is a stable target.
 */
export function bestMarkerFrac(
  savedBest: number,
  maxHeight: number = MAX_HEIGHT,
  pointsPerUnit: number = POINTS_PER_UNIT,
): number | null {
  if (!Number.isFinite(savedBest) || savedBest <= 0) return null;
  if (maxHeight <= 0 || pointsPerUnit <= 0) return null;
  const frac = savedBest / pointsPerUnit / maxHeight;
  return frac >= 1 ? 1 : frac;
}
