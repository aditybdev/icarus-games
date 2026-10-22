/**
 * Scoring and ranking rules. Pure module — no DOM access.
 */

export type Rank = 'S' | 'A' | 'B' | 'C';

/** Time that counts toward rank: elapsed plus fall penalties. */
export function effectiveTimeMs(timeMs: number, penaltyMs: number): number {
  return timeMs + penaltyMs;
}

/** Rank from the effective finish time (falls already priced in). */
export function rankFor(effMs: number): Rank {
  if (effMs <= 30_000) return 'S';
  if (effMs <= 45_000) return 'A';
  if (effMs <= 65_000) return 'B';
  return 'C';
}

/**
 * Speed-derived score: average cm/s over the course when finished, otherwise
 * distance covered. Submitted to the host leaderboard.
 */
export function scoreFor(finished: boolean, effMs: number, distanceM: number): number {
  if (finished) {
    return Math.max(1, Math.round((50_000 * 1000) / Math.max(1, effMs)));
  }
  return Math.max(0, Math.round(distanceM * 20));
}

/** "23.4 s" */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** "12.3 m" */
export function formatMetres(m: number): string {
  return `${m.toFixed(1)} m`;
}
