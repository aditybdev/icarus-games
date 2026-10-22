/**
 * Shared constants for Tissue Rush. Pure data — no DOM, no timers.
 */

export const ROUND_SIZES = [25, 50, 100] as const;
export type RoundSize = (typeof ROUND_SIZES)[number];

/** Upward drag distance (px) needed to rip a tissue free of the box. */
export const PULL_THRESHOLD_PX = 210;

/** Drag distance (px) before a grab counts as an active pull. */
export const PULL_DEADZONE_PX = 6;

/**
 * Streak gap boundaries in ms, measured between successful detaches.
 * gap <= BLAZING_GAP_MS -> "Blazing!", gap <= SPEEDY_GAP_MS -> "Speedy!".
 *
 * Tuned for the overlapped-pop flow (next sheet starts rising at grab time,
 * grabbable at popT>=0.7): the detach-to-detach floor is now the re-grab tap
 * plus a 140-230 px pull, ~0.2-0.3 s even on small phones. Blazing (350)
 * rewards top-tier flicks; Speedy (550) rewards a steady quick rhythm.
 */
export const SPEEDY_GAP_MS = 550;
export const BLAZING_GAP_MS = 350;

/** Every Nth tissue out of the box (1-based) is the golden bonus tissue. */
export const GOLDEN_PULL_EVERY = 20;

/** Streak count that turns fever mode on (pad + hats, glow, sparkles). */
export const FEVER_STREAK = 10;

/**
 * Medal target times (ms) per round size — a finish at or under the target
 * earns the medal. Tuned around a typical 0.6-0.9 s/tissue pace:
 * bronze is a casual clear (~1.2 s/tissue), silver a brisk rhythm
 * (~0.8 s/tissue), gold needs sustained Speedy streaks (~0.6-0.65 s/tissue).
 */
export const MEDAL_TARGETS_MS: Record<RoundSize, { bronze: number; silver: number; gold: number }> =
  {
    25: { bronze: 30000, silver: 20000, gold: 15500 },
    50: { bronze: 62000, silver: 42000, gold: 32000 },
    100: { bronze: 130000, silver: 88000, gold: 65000 },
  };
