/**
 * Pure save-data helpers (node-testable, no DOM). The persisted shape is:
 *
 *   {
 *     v: 2,
 *     bestMs: { 25: number|null, 50: number|null, 100: number|null },
 *     stats: { roundsPlayed: number, totalPulled: number, bestStreak: number },
 *     skin: number,
 *   }
 *
 * bestMs holds the best (shortest) total round time per round size.
 * stats.bestStreak is GLOBAL (not per size): streak rules are size-agnostic
 * and a single "best streak 18" line reads cleanly on the menu card.
 * v1 payloads ({ v: 1, bestMs }) migrate cleanly: stats zero-fill, skin 0.
 */
import { ROUND_SIZES, type RoundSize } from './constants';

export interface SaveStats {
  roundsPlayed: number;
  totalPulled: number;
  bestStreak: number;
}

export interface SaveData {
  v: 2;
  bestMs: Record<RoundSize, number | null>;
  stats: SaveStats;
  /** Index into the box-skin list (core/skins.ts); 0 = classic. */
  skin: number;
}

export function emptySave(): SaveData {
  return {
    v: 2,
    bestMs: { 25: null, 50: null, 100: null },
    stats: { roundsPlayed: 0, totalPulled: 0, bestStreak: 0 },
    skin: 0,
  };
}

function coerceCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/** Coerce unknown persisted data (v0/v1/v2/garbage) into the v2 shape. */
export function normalizeSave(raw: unknown): SaveData {
  const save = emptySave();
  if (!raw || typeof raw !== 'object') return save;
  const data = raw as { bestMs?: unknown; stats?: unknown; skin?: unknown };
  const best = data.bestMs;
  if (best && typeof best === 'object') {
    for (const size of ROUND_SIZES) {
      const value = (best as Record<string, unknown>)[String(size)];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        save.bestMs[size] = value;
      }
    }
  }
  const stats = data.stats;
  if (stats && typeof stats === 'object') {
    const s = stats as Record<string, unknown>;
    save.stats.roundsPlayed = coerceCount(s.roundsPlayed);
    save.stats.totalPulled = coerceCount(s.totalPulled);
    save.stats.bestStreak = coerceCount(s.bestStreak);
  }
  if (typeof data.skin === 'number' && Number.isFinite(data.skin) && data.skin >= 0) {
    save.skin = Math.floor(data.skin);
  }
  return save;
}

/**
 * Record a finished round. Returns a NEW save object plus whether the best
 * time for that round size improved. The input save is never mutated.
 */
export function withBestTime(
  save: SaveData,
  size: RoundSize,
  ms: number,
): { save: SaveData; improved: boolean } {
  const current = save.bestMs[size];
  if (current !== null && ms >= current) return { save, improved: false };
  const bestMs: Record<RoundSize, number | null> = { ...save.bestMs, [size]: ms };
  return { save: { ...save, bestMs }, improved: true };
}

/**
 * Accumulate per-round stats: one more round played, its pulls added, and the
 * global best streak raised when this round's peak streak beat it. Returns a
 * NEW save object; the input is never mutated.
 */
export function withRoundStats(save: SaveData, pulled: number, peakStreak: number): SaveData {
  return {
    ...save,
    stats: {
      roundsPlayed: save.stats.roundsPlayed + 1,
      totalPulled: save.stats.totalPulled + Math.max(0, Math.floor(pulled)),
      bestStreak: Math.max(save.stats.bestStreak, Math.max(0, Math.floor(peakStreak))),
    },
  };
}

/** Persist the selected box-skin index. Returns a NEW save object. */
export function withSkin(save: SaveData, skin: number): SaveData {
  if (skin === save.skin) return save;
  return { ...save, skin: Math.max(0, Math.floor(skin)) };
}
