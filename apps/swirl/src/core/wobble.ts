/**
 * Wobble / topple model — pure functions, fully deterministic.
 *
 * While dispensing off-center, the offset between cone and nozzle accumulates
 * into `wobble`. Dispensing near the nozzle (inside the dead zone) slowly
 * recovers wobble. A swirl topples when the wobble relative to its height
 * passes TOPPLE_WOBBLE_RATIO.
 */
import {
  CENTER_DEAD_ZONE,
  MAX_WOBBLE,
  MIN_TOPPLE_HEIGHT,
  TOPPLE_WOBBLE_RATIO,
  WOBBLE_GAIN,
  WOBBLE_RECOVER,
} from './constants';

/**
 * Advance the wobble value by `dt` seconds.
 * @param wobble     current accumulated wobble (>= 0)
 * @param offset     signed horizontal offset between cone and nozzle (world units)
 * @param dt         elapsed seconds (already clamped by caller)
 * @param dispensing whether the player is currently extruding
 */
export function updateWobble(
  wobble: number,
  offset: number,
  dt: number,
  dispensing: boolean,
): number {
  let next = wobble;
  if (dispensing && dt > 0) {
    const off = Math.abs(offset);
    if (off <= CENTER_DEAD_ZONE) {
      next -= WOBBLE_RECOVER * dt;
    } else {
      next += (off - CENTER_DEAD_ZONE) * WOBBLE_GAIN * dt;
    }
  }
  if (!Number.isFinite(next) || next < 0) next = 0;
  if (next > MAX_WOBBLE) next = MAX_WOBBLE;
  return next;
}

/** Wobble relative to swirl height. Short swirls get a stable denominator. */
export function wobbleRatio(wobble: number, height: number): number {
  return wobble / Math.max(1, height);
}

/** True when the swirl should topple over. */
export function shouldTopple(wobble: number, height: number): boolean {
  if (height < MIN_TOPPLE_HEIGHT) return false;
  return wobbleRatio(wobble, height) > TOPPLE_WOBBLE_RATIO;
}

/**
 * Neatness score in [0, 1]: 1 = perfectly steady, 0 = at the topple point.
 */
export function neatness(wobble: number, height: number): number {
  const n = 1 - wobbleRatio(wobble, height) / TOPPLE_WOBBLE_RATIO;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
