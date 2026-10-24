/**
 * Golden Mallow — tuning constants. Seconds/radians; fixed-step (DT) sim so
 * every device toasts identical mallows. Heat lives per face in [0, 1.2]:
 * 0 raw, ~0.7 golden, 1.0 ignition, 1.2 charcoal.
 */

/** Fixed sim step — 120 Hz. */
export const DT = 1 / 120;

/* --------------------------------- mallow -------------------------------- */

/** Faces around the mallow's circumference. */
export const FACES = 8;
/** Base heat rate (per second) for a face dead-down over the calm fire. */
export const HEAT_BASE = 0.13;
/** Orientation falloff exponent (cos^k of angle from down, lower hemisphere). */
export const HEAT_FALLOFF = 1.5;
/** Doneness at which a face ignites. */
export const IGNITE_H = 1.0;
/** Charcoal level (locked, scorched). */
export const CHARCOAL_H = 1.2;
/** Seconds of flaming before the face chars. */
export const CHAR_SECONDS = 2.0;
/** Fire-spread multiplier while the mallow is flaming. */
export const FLAME_SPREAD = 1.6;
/** Shake flips needed to extinguish (drag direction reversals). */
export const EXTINGUISH_FLIPS = 3;
/** A singed-but-saved face caps here after an extinguish. */
export const SINGE_CAP = 0.98;

/* ---------------------------------- fire ---------------------------------- */

/** Calm campfire (play mode): mild flicker. */
export const GUST_CALM = 0.18;
/** Gusty campfire (daily): strong swings, seeded phases. */
export const GUST_DAILY = 0.45;

/* --------------------------------- scoring -------------------------------- */

export const RUSH_MALLOWS = 5;
export const DAILY_MALLOWS = 5;
export const MALLOW_MAX = 100;
/** Score caps for the fail states. */
export const CAP_CHARCOAL = 20;
export const CAP_ON_FIRE = 15;
/** Grade ladder (Frenzy-style). */
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

/** Rush-total medal thresholds (max 500). */
export const MEDAL_BRONZE = 180;
export const MEDAL_SILVER = 300;
export const MEDAL_GOLD = 420;
export type Medal = 'bronze' | 'silver' | 'gold';
