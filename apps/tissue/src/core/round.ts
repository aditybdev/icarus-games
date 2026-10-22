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
  FEVER_STREAK,
  GOLDEN_PULL_EVERY,
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
  /** Highest streak reached this round (for stats/save). */
  peakStreak: number;
  /**
   * The one "mercy" mis-pull for the current chain: the first snap-back
   * while streak >= 2 is forgiven (chain survives); a second one breaks it.
   * Resets whenever a new chain starts (streak returns to 1) or breaks.
   */
  mercyUsed: boolean;
  lastTier: StreakTier;
}

export interface ReleaseResult {
  /** True when the pull crossed the perforation threshold and counted. */
  accepted: boolean;
  tier: StreakTier;
  streak: number;
  finished: boolean;
  /** True when this snap-back spent the chain's one mercy mis-pull. */
  mercy: boolean;
  /** True when this snap-back broke an active chain (mercy already spent). */
  streakBroken: boolean;
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
    peakStreak: 0,
    mercyUsed: false,
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
      mercy: false,
      streakBroken: false,
    };
  }
  if (round.pullDistance < round.threshold) {
    round.phase = 'idle';
    round.pullDistance = 0;
    // Legible mis-pull cost: during a live chain the first snap-back spends
    // the chain's one mercy; the second breaks the chain outright.
    if (round.streak >= 2) {
      if (!round.mercyUsed) {
        round.mercyUsed = true;
        return {
          accepted: false,
          tier: 'none',
          streak: round.streak,
          finished: false,
          mercy: true,
          streakBroken: false,
        };
      }
      round.streak = 0;
      round.mercyUsed = false; // next chain earns a fresh mercy
      return {
        accepted: false,
        tier: 'none',
        streak: 0,
        finished: false,
        mercy: false,
        streakBroken: true,
      };
    }
    return {
      accepted: false,
      tier: 'none',
      streak: round.streak,
      finished: false,
      mercy: false,
      streakBroken: false,
    };
  }

  const now = clock.now();
  const gap = round.lastDetachAt === null ? null : now - round.lastDetachAt;
  const tier = gap === null ? 'none' : tierForGap(gap);
  round.streak = gap !== null && gap <= SPEEDY_GAP_MS ? round.streak + 1 : 1;
  if (round.streak === 1) round.mercyUsed = false; // fresh chain, fresh mercy
  round.peakStreak = Math.max(round.peakStreak, round.streak);
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
  return {
    accepted: true,
    tier,
    streak: round.streak,
    finished: round.phase === 'finished',
    mercy: false,
    streakBroken: false,
  };
}

/** The detached tissue has left the screen; the next one can pop up. */
export function flightDone(round: RoundState): void {
  if (round.phase === 'flying') round.phase = 'next';
}

/**
 * Abandon a held pull with NO scoring or streak consequences. Used by pause
 * and pointercancel — an interrupted pull must not spend the chain's mercy.
 */
export function cancelPull(round: RoundState): void {
  if (round.phase !== 'grabbing' && round.phase !== 'pulling') return;
  round.phase = 'idle';
  round.pullDistance = 0;
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

/**
 * True while the current streak chain (2+) is still inside the gap window.
 * The chain is anchored to the last successful detach, so a snap-back does
 * not break it directly — but the clock keeps running, so a slow pull or a
 * fumbled mis-pull lets the window lapse and the chain expires.
 */
export function streakAlive(round: RoundState, clock: Clock): boolean {
  return (
    round.streak >= 2 &&
    round.lastDetachAt !== null &&
    clock.now() - round.lastDetachAt <= SPEEDY_GAP_MS
  );
}

/**
 * SFX pitch multiplier for a detach. Non-tier pulls stay at 1; Speedy and
 * Blazing escalate with the streak count, capped so the pop stays musical.
 */
export function streakPitch(tier: StreakTier, streak: number): number {
  const base = tier === 'blazing' ? 1.3 : tier === 'speedy' ? 1.15 : 0;
  if (base === 0) return 1;
  return base + Math.min(Math.max(streak, 0), 10) * 0.02;
}

/**
 * Signed ms delta vs best pace for this round size: how far the elapsed
 * time sits from the pro-rated best (bestMs x pulled/size). Negative means
 * ahead of best pace. Null when there is no best yet or no tissue has been
 * pulled — nothing meaningful to compare.
 */
export function paceDeltaMs(
  round: RoundState,
  bestMs: number | null,
  clock: Clock,
): number | null {
  if (bestMs === null || round.pulled === 0 || round.startedAt === null) return null;
  const expected = (bestMs / round.size) * round.pulled;
  return elapsedMs(round, clock) - expected;
}

/** Compact signed delta for the live pace chip ("−0.4 s" / "+1.2 s"). */
export function formatPaceMs(deltaMs: number): string {
  const tenths = Math.round(Math.abs(deltaMs) / 100);
  if (tenths === 0) return '±0.0 s';
  const secs = (tenths / 10).toFixed(1);
  return `${deltaMs < 0 ? '−' : '+'}${secs} s`;
}

/** Results-screen near-miss sentence vs the previous best. */
export function formatResultsDeltaMs(deltaMs: number): string {
  const tenths = Math.round(Math.abs(deltaMs) / 100);
  if (tenths === 0) return 'Dead level with your best!';
  const secs = (tenths / 10).toFixed(1);
  return deltaMs < 0 ? `${secs} s ahead of your best!` : `${secs} s behind your best`;
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

/**
 * Variable-reward schedule: every GOLDEN_PULL_EVERY-th tissue (1-based pull
 * index, i.e. the Nth tissue to come out of the box) is "golden". Pure and
 * deterministic so it is identical across replays and trivially testable.
 */
export function isGoldenPull(pullIndex: number): boolean {
  return pullIndex > 0 && pullIndex % GOLDEN_PULL_EVERY === 0;
}

/** True once the streak reaches fever heat (visual/audio escalation). */
export function feverActive(streak: number): boolean {
  return streak >= FEVER_STREAK;
}
