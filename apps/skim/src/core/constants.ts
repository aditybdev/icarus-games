/**
 * Skim — tuning constants. One place for every number that shapes feel.
 * Sim units are METRES and SECONDS (fixed 120 Hz stepping, like Frenzy);
 * the renderer scales metres to pixels.
 */

/** Fixed sim step (s). 120 Hz keeps contact detection tight at high speed. */
export const DT = 1 / 120;

/** Earth gravity (m/s^2) — the sim is a real projectile, not scripted. */
export const GRAVITY = 9.8;

/** Stone radius (m). */
export const STONE_R = 0.06;

/** Release point above the water plane (m). */
export const HAND_HEIGHT = 1.1;

/** Throw speed range (m/s) mapped from flick speed. */
export const THROW_MIN = 5;
export const THROW_MAX = 17;

/** Launch angle clamp (radians from horizontal; + = upward). */
export const ANGLE_MIN = -0.18;
export const ANGLE_MAX = 0.45;

/**
 * Tap window per skip (s): starts generous and decays with chain length —
 * the shrinking window is the core tension ("decaying tap-window").
 */
export const WINDOW_START = 0.4;
export const WINDOW_DECAY = 0.011;
export const WINDOW_MIN = 0.16;

/** Tap quality → velocity retention (q in [0,1], 1 = instant tap).
 *  Even a perfect tap keeps only 0.97 — endless q=1 play must still bleed
 *  speed or the run never ends and gold loses all meaning. */
export const VX_KEEP_BASE = 0.82;
export const VX_KEEP_Q = 0.15;
/** Bounce vertical speed (m/s): floor + quality bonus + a bit of inbound. */
export const VY_FLOOR = 1.6;
export const VY_Q = 2.6;
export const VY_INBOUND = 0.25;

/** Below this horizontal speed (m/s) at contact the stone cannot plane. */
export const SINK_SPEED = 1.6;

/** Perfect-tap threshold on q (drives chain/fever + score bonus). */
export const PERFECT_Q = 0.75;

/** Sim safety caps. */
export const MAX_SKIPS = 60;
export const MAX_FLIGHT_S = 40;
/** Sim ends once the sunken stone is this far below the surface (m). */
export const SINK_DEPTH = 1.5;

/** Daily lake: seeded wind (m/s^2 lateral) and wave amplitude (m). */
export const WIND_MAX = 0.8;
export const WAVE_CALM = 0.05;
export const WAVE_MAX = 0.14;

/** Medal distance thresholds (m) — initial calibration; re-derive from
 *  playtest distribution per BENCHMARK.md S2 (bronze <=2 runs median,
 *  silver ~3-attempt, gold top-decile). */
export const MEDAL_BRONZE_M = 30;
export const MEDAL_SILVER_M = 75;
export const MEDAL_GOLD_M = 150;

/** Daily mode: throws per daily run. */
export const DAILY_THROWS = 3;
