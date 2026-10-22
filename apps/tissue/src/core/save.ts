/**
 * Pure save-data helpers (node-testable, no DOM). The persisted shape is:
 *
 *   { v: 1, bestMs: { 25: number|null, 50: number|null, 100: number|null } }
 *
 * bestMs holds the best (shortest) total round time per round size.
 */
import { ROUND_SIZES, type RoundSize } from './constants';

export interface SaveData {
  v: 1;
  bestMs: Record<RoundSize, number | null>;
}

export function emptySave(): SaveData {
  return { v: 1, bestMs: { 25: null, 50: null, 100: null } };
}

/** Coerce unknown persisted data into the canonical save shape. */
export function normalizeSave(raw: unknown): SaveData {
  const save = emptySave();
  if (!raw || typeof raw !== 'object') return save;
  const best = (raw as { bestMs?: unknown }).bestMs;
  if (!best || typeof best !== 'object') return save;
  for (const size of ROUND_SIZES) {
    const value = (best as Record<string, unknown>)[String(size)];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      save.bestMs[size] = value;
    }
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
  return { save: { v: 1, bestMs }, improved: true };
}
