/**
 * Medal rules for Tissue Rush (node-testable, no DOM). Targets are pure data
 * in constants.ts; these helpers classify a finish time and compute the gap
 * to the next medal up.
 */
import { MEDAL_TARGETS_MS, type RoundSize } from './constants';

export type Medal = 'bronze' | 'silver' | 'gold';

/** Ordered worst -> best so index comparisons mean "strictly better". */
export const MEDAL_ORDER: readonly Medal[] = ['bronze', 'silver', 'gold'];

/** The medal a finish time earns for this size, or null when over bronze. */
export function medalFor(size: RoundSize, ms: number): Medal | null {
  const t = MEDAL_TARGETS_MS[size];
  if (ms <= t.gold) return 'gold';
  if (ms <= t.silver) return 'silver';
  if (ms <= t.bronze) return 'bronze';
  return null;
}

/** The best medal ever earned for a size (null when no qualifying finish). */
export function bestMedalFor(size: RoundSize, bestMs: number | null): Medal | null {
  return bestMs === null ? null : medalFor(size, bestMs);
}

/**
 * Milliseconds the finish time sits above the next better medal's target —
 * the "next medal in 1.3 s" hook. Null when the time is already gold (or
 * faster): there is no next medal.
 */
export function nextMedalMs(size: RoundSize, ms: number): number | null {
  const t = MEDAL_TARGETS_MS[size];
  if (ms <= t.gold) return null;
  if (ms <= t.silver) return ms - t.gold;
  if (ms <= t.bronze) return ms - t.silver;
  return ms - t.bronze;
}

/** Results-screen line for the chase: "next medal in 1.3 s" ("" at gold). */
export function formatNextMedalMs(gapMs: number | null): string {
  if (gapMs === null) return '';
  const secs = (Math.ceil(gapMs / 100) / 10).toFixed(1);
  return `next medal in ${secs} s`;
}
