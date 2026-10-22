/**
 * Blitz mode (30 s score-attack) — pure scoring rules, node-testable.
 * The round core (round.ts) is reused verbatim with a large size; this module
 * only owns the clock window and the streak-multiplied score.
 */

/** Fixed blitz round length: 30 seconds from the first grab. */
export const BLITZ_DURATION_MS = 30000;

/** Box size used for blitz: effectively endless inside the 30 s window. */
export const BLITZ_SIZE = 100;

/**
 * Points for one detach at the given post-pull streak. Base 1 point per
 * tissue, +1 for every 5 streak levels held (streak 1-4 -> 1 pt,
 * 5-9 -> 2 pts, 10-14 -> 3 pts, ...). Slow pulls (streak 1) always score.
 */
export function blitzPointsFor(streak: number): number {
  return 1 + Math.floor(Math.max(0, streak) / 5);
}

/** Milliseconds left in the blitz window (clamped at 0). */
export function blitzTimeLeftMs(elapsedMs: number): number {
  return Math.max(0, BLITZ_DURATION_MS - Math.max(0, elapsedMs));
}

/** True once the 30 s blitz window has fully elapsed. */
export function blitzOver(elapsedMs: number): boolean {
  return elapsedMs >= BLITZ_DURATION_MS;
}
