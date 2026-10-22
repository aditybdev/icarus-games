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

/** Seconds the order-intro card stays up (tap skips it). */
export const ORDER_CARD_TIME = 1.7;

/** Settle hold after the swirl finishes toppling, before results (tap skips). */
export const TOPPLE_SETTLE_HOLD = 0.3;

/** Beat between serving one order and the next card (tap skips after the guard). */
export const BETWEEN_ORDERS_HOLD = 1.2;

/** Minimum seconds the serve beat stays up before a tap may skip it. */
export const BETWEEN_ORDERS_MIN = 0.5;

/* ------------------------- combo multiplier (P1-2) ------------------------ */

/** Seconds of in-dead-zone dispensing needed per combo step (×1→×2→…). */
export const COMBO_STEP_TIME = 1;

/** Streak seconds lost per second while not dispensing inside the dead zone. */
export const COMBO_DECAY = 1.5;

/** Highest combo multiplier. */
export const COMBO_MAX_MULTIPLIER = 5;

/* ---------------------------- turbo phase (P2-3) -------------------------- */

/** Overdrive bonus points per second at perfect neatness. */
export const TURBO_SCORE_RATE = 90;

/** Wobble-gain scale added per second spent in overdrive. */
export const TURBO_GAIN_RAMP = 0.08;

/** Cap on the overdrive wobble-gain scale. */
export const TURBO_GAIN_MAX = 2.5;

/** Seconds after reaching max height before the "TURBO!" beat fires. */
export const TURBO_BEAT_DELAY = 0.8;

/* ---------------------- perfect-serve spectacle (P2-1) -------------------- */

/** Slow-mo duration (real seconds) on a perfect serve / new best. */
export const SLOW_MO_TIME = 0.35;

/** Time scale during slow-mo. */
export const SLOW_MO_SCALE = 0.35;
