/**
 * Tap the 57 — tuning constants. SI units (metres, seconds) in the sim;
 * the sim is fixed-step (DT) so every device integrates identical paths.
 */

/** Fixed sim step — 120 Hz. The frame loop accumulates and steps this. */
export const DT = 1 / 120;

export const GRAVITY = 9.8;

/* ------------------------------- pressure ------------------------------- */

/** Pressure added per tap: flat base plus a rhythm-quality bonus (q 0..1).
 *  Sized so the finest pressure step (a sloppy tap) still lets the player
 *  walk pressure onto a narrow target zone. */
export const P_ADD_BASE = 0.04;
export const P_ADD_Q = 0.075;
/** Ketchup settles — pressure bleeds off, doubling as the fine-tune lever
 *  (overshoot the mark, wait a beat, fire cooler). */
export const P_DECAY = 0.06;
/** At or past this pressure the bottle erupts on the table — order failed. */
export const SPLAT_P = 1;

/* -------------------------------- rhythm -------------------------------- */

/** Pulse period (s) at pressure 0 and at 0.95 — greed speeds the rhythm up. */
export const RHYTHM_T0 = 1.5;
export const RHYTHM_T1 = 0.8;
/** Tap quality at or above this counts as perfect (streak, pitch ladder). */
export const PERFECT_Q = 0.8;

/* --------------------------------- flight -------------------------------- */

/** Nozzle height above the plate. */
export const NOZZLE_H = 1.0;
/** Full-pressure launch speed (m/s) — range ≈3.4 m at 45°. */
export const V_BASE = 5.8;
/** Pressure at which launch speed tops out; past it only the splat awaits. */
export const P_FULL = 0.9;
/** Launch-speed fraction at zero pressure (the sad dribble floor). */
export const DRIBBLE_MIN = 0.45;
/** Aim drag maps to this launch-angle envelope (radians, 20°–70°). */
export const AIM_MIN = 0.35;
export const AIM_MAX = 1.22;
/** Blob radius (m). */
export const BLOB_R = 0.11;

/* --------------------------------- orders -------------------------------- */

export const RUSH_ORDERS = 5;
export const DAILY_ORDERS = 5;
/** Per-order score cap. */
export const ORDER_MAX = 100;
/** Blob center within this fraction of target width counts as "Plated!". */
export const PERFECT_ZONE = 0.3;

/* --------------------------------- medals --------------------------------- */

/** Rush-total medal thresholds (max 500). */
export const MEDAL_BRONZE = 180;
export const MEDAL_SILVER = 300;
export const MEDAL_GOLD = 420;
export type Medal = 'bronze' | 'silver' | 'gold';
