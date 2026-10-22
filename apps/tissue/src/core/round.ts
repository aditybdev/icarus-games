/**
 * Pure round state machine for Tissue Rush (node-testable, no DOM):
 *
 *   idle -> grabbing -> pulling -> flying -> next -> idle ... -> finished
 *
 * - The clock is injected, so tests control time exactly.
 * - The timer starts on the FIRST grab and stops the moment the last tissue
 *   detaches (remaining hits 0). No fail states — a below-threshold release
 *   simply snaps the tissue back and does not decrement the count.
 * - Streak tiers are derived from the gap between successful pulls.
 */
import {
  BLAZING_GAP_MS,
  PULL_DEADZONE_PX,
  PULL_THRESHOLD_PX,
  SPEEDY_GAP_MS,
  type RoundSize,
} from './constants';

export type RoundPhase = 'idle' | 'grabbing' | 'pulling' | 'flying' | 'next' | 'finished';

export type StreakTier = 'none' | 'speedy' | 'blazing';

export interface Clock {
  now(): number;
}

export interface RoundState {
  readonly size: RoundSize;
  /** Upward pull distance (px) required to detach a tissue. */
  readonly threshold: number;
  phase: RoundPhase;
  remaining: number;
  pulled: number;
  pullDistance: number;
  /** Clock time of the first grab; null until the round timer starts. */
  startedAt: number | null;
  /** Clock time the last tissue detached; null until finished. */
  finishedAt: number | null;
  /** Clock time of the most recent successful detach (for streak gaps). */
  lastDetachAt: number | null;
  /** Consecutive pulls each within SPEEDY_GAP_MS of the previous one. */
  streak: number;
  lastTier: StreakTier;
}

export interface ReleaseResult {
  /** True when the pull crossed the perforation threshold and counted. */
  accepted: boolean;
  tier: StreakTier;
  streak: number;
  finished: boolean;
}

export function createRound(size: RoundSize, threshold = PULL_THRESHOLD_PX): RoundState {
  return {
    size,
    threshold,
    phase: 'idle',
    remaining: size,
    pulled: 0,
    pullDistance: 0,
    startedAt: null,
    finishedAt: null,
    lastDetachAt: null,
    streak: 0,
    lastTier: 'none',
  };
}

/**
 * Pointer landed on the exposed tissue. Starts the round timer on the first
 * grab of the round. Returns false when no tissue is grabbable right now.
 */
export function grab(round: RoundState, clock: Clock): boolean {
  if (round.phase !== 'idle') return false;
  round.phase = 'grabbing';
  round.pullDistance = 0;
  if (round.startedAt === null) round.startedAt = clock.now();
  return true;
}

/** Update the current upward pull distance (px, clamped >= 0). */
export function updatePull(round: RoundState, distancePx: number): void {
  if (round.phase !== 'grabbing' && round.phase !== 'pulling') return;
  round.pullDistance = Math.max(0, distancePx);
  if (round.phase === 'grabbing' && round.pullDistance > PULL_DEADZONE_PX) {
    round.phase = 'pulling';
  }
}

/** Perforation tension for the current pull, 0..1 (1 = about to rip). */
export function tension(round: RoundState): number {
  return Math.min(1, round.pullDistance / round.threshold);
}

export function tierForGap(gapMs: number): StreakTier {
  if (gapMs <= BLAZING_GAP_MS) return 'blazing';
  if (gapMs <= SPEEDY_GAP_MS) return 'speedy';
  return 'none';
}

/**
 * Pointer released. Above the threshold the tissue detaches and counts;
 * below it the tissue snaps back to the box and the round is unaffected.
 */
export function release(round: RoundState, clock: Clock): ReleaseResult {
  if (round.phase !== 'grabbing' && round.phase !== 'pulling') {
    return {
      accepted: false,
      tier: 'none',
      streak: round.streak,
      finished: round.phase === 'finished',
    };
  }
  if (round.pullDistance < round.threshold) {
    round.phase = 'idle';
    round.pullDistance = 0;
    return { accepted: false, tier: 'none', streak: round.streak, finished: false };
  }

  const now = clock.now();
  const gap = round.lastDetachAt === null ? null : now - round.lastDetachAt;
  const tier = gap === null ? 'none' : tierForGap(gap);
  round.streak = gap !== null && gap <= SPEEDY_GAP_MS ? round.streak + 1 : 1;
  round.lastTier = tier;
  round.lastDetachAt = now;
  round.pulled += 1;
  round.remaining -= 1;
  round.pullDistance = 0;

  if (round.remaining <= 0) {
    round.remaining = 0;
    round.phase = 'finished';
    round.finishedAt = now;
  } else {
    round.phase = 'flying';
  }
  return { accepted: true, tier, streak: round.streak, finished: round.phase === 'finished' };
}

/** The detached tissue has left the screen; the next one can pop up. */
export function flightDone(round: RoundState): void {
  if (round.phase === 'flying') round.phase = 'next';
}

/** The next tissue finished its pop-up bounce and is grabbable again. */
export function nextReady(round: RoundState): void {
  if (round.phase === 'next') round.phase = 'idle';
}

/**
 * Elapsed round time in ms. Zero before the first grab; frozen at
 * finishedAt once the last tissue is out.
 */
export function elapsedMs(round: RoundState, clock: Clock): number {
  if (round.startedAt === null) return 0;
  const end = round.finishedAt ?? clock.now();
  return Math.max(0, end - round.startedAt);
}

/** Format milliseconds as mm:ss.t (e.g. 83456 -> "01:23.4"). */
export function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `${mm}:${ss}.${tenths}`;
}

/** Leaderboard score: tissues per second x 1000 (higher is faster). */
export function scoreForRound(size: number, ms: number): number {
  if (ms <= 0) return 0;
  return Math.round((size / (ms / 1000)) * 1000);
}
