/**
 * Scoring and ranking rules. Pure module — no DOM access.
 */
import { TRACK_LENGTH } from './types';

export type Rank = 'S' | 'A' | 'B' | 'C';

/** Rank ladder: effective-time ceiling per rank (C is everything beyond B). */
export const RANK_THRESHOLDS_MS = [
  { rank: 'S', maxMs: 30_000 },
  { rank: 'A', maxMs: 45_000 },
  { rank: 'B', maxMs: 65_000 },
] as const;

/** Time that counts toward rank: elapsed plus fall penalties. */
export function effectiveTimeMs(timeMs: number, penaltyMs: number): number {
  return timeMs + penaltyMs;
}

/** Rank from the effective finish time (falls already priced in). */
export function rankFor(effMs: number): Rank {
  for (const t of RANK_THRESHOLDS_MS) {
    if (effMs <= t.maxMs) return t.rank;
  }
  return 'C';
}

/** True when rank `a` is strictly better than rank `b` (S > A > B > C). */
export function rankBeats(a: Rank, b: Rank): boolean {
  const order: Rank[] = ['C', 'B', 'A', 'S'];
  return order.indexOf(a) > order.indexOf(b);
}

/**
 * PB pace-flag position on the track (m): where a runner holding the PB's
 * average pace would be after `effMs` of effective time. Clamped to the
 * course; degenerate inputs yield 0.
 */
export function pbPaceX(effMs: number, pbMs: number): number {
  if (!(pbMs > 0) || !(effMs > 0)) return 0;
  return Math.min(TRACK_LENGTH, (effMs / pbMs) * TRACK_LENGTH);
}

/**
 * Position (0–100 %) on the HUD distance bar where a runner on pace for
 * `thresholdMs` must be after `effMs` — the sliding "beat this rank" caret.
 */
export function paceBarPct(effMs: number, thresholdMs: number): number {
  if (!(thresholdMs > 0) || !(effMs > 0)) return 0;
  return Math.min(100, (effMs / thresholdMs) * 100);
}

/**
 * Rank the current pace projects to over the full course, or null before any
 * distance has been covered (avoids the div-by-zero "instant S").
 */
export function projectedRank(effMs: number, distM: number): Rank | null {
  if (!(distM > 0)) return null;
  return rankFor(effMs / (distM / TRACK_LENGTH));
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

/**
 * Icarus mastery 0–1000 from the best effective race time. Rank anchors:
 * any finish = 200 (C), B = 500, A = 750, S = 1000, linearly interpolated
 * within each band; no finish yet = 0.
 */
export function masteryFor(bestTimeMs: number | null): number {
  if (bestTimeMs == null || !(bestTimeMs > 0)) return 0;
  if (bestTimeMs <= 30_000) return 1000;
  if (bestTimeMs <= 45_000) {
    return Math.round(750 + ((45_000 - bestTimeMs) / 15_000) * 250);
  }
  if (bestTimeMs <= 65_000) {
    return Math.round(500 + ((65_000 - bestTimeMs) / 20_000) * 250);
  }
  return 200;
}

/** "12.3 m" */
export function formatMetres(m: number): string {
  return `${m.toFixed(1)} m`;
}
