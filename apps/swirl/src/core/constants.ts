/**
 * Shared tuning constants for Swirl!
 * Pure module: no DOM, no Three.js — safe to import from vitest (node env).
 */

/** Maximum swirl height in world units (measured from the cone opening). */
export const MAX_HEIGHT = 5.6;

/** Swirl growth speed in world units per second while dispensing. */
export const GROW_RATE = 0.85;

/** Swirls shorter than this can never topple (grace period for starting). */
export const MIN_TOPPLE_HEIGHT = 0.5;

/**
 * Topple happens when wobbleRatio = wobble / max(1, height) exceeds this.
 * Higher = more forgiving.
 */
export const TOPPLE_WOBBLE_RATIO = 0.6;

/** Wobble gained per second per unit of offset beyond the dead zone. */
export const WOBBLE_GAIN = 0.6;

/** Wobble recovered per second while dispensing near-center. */
export const WOBBLE_RECOVER = 0.1;

/** |offset| below this counts as "centered" and recovers wobble. */
export const CENTER_DEAD_ZONE = 0.12;

/** Hard clamp on accumulated wobble (world units). */
export const MAX_WOBBLE = 8;

/** How far the cone can slide left/right from center (world units). */
export const CONE_RANGE = 2.6;

/** Display conversion: world units -> "cm" for the HUD meter. */
export const CM_PER_UNIT = 12;

/** Number of orders in an Order Rush run. */
export const ORDER_COUNT = 3;
