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
 */
export const SPEEDY_GAP_MS = 450;
export const BLAZING_GAP_MS = 250;
