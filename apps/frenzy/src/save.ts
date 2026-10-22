/**
 * Four-Leg Frenzy — save data shape and Icarus Daily helpers. Pure module.
 *
 * Persisted shape:
 *   { v: 1, bestTimeMs, bestRank, reducedMotion?, sfx?,
 *     dailyLast, dailyStreak, dailyBestMs }
 *
 * dailyLast is the last completed Daily Race day key ('YYYY-MM-DD', '' =
 * never), dailyStreak the consecutive-day completion count, dailyBestMs the
 * best daily time for dailyLast's day — reset when the day changes at load
 * (normalizeSave with todayKey), so yesterday's best never shadows today.
 */
import { recordDailyCompletion } from '@icarus/platform';

export interface SaveData {
  v: 1;
  bestTimeMs: number | null;
  bestRank: string | null;
  reducedMotion?: boolean;
  sfx?: boolean;
  /** User haptics toggle; undefined = on. */
  haptics?: boolean;
  dailyLast: string;
  dailyStreak: number;
  dailyBestMs: number | null;
}

export const DEFAULT_SAVE: SaveData = {
  v: 1,
  bestTimeMs: null,
  bestRank: null,
  dailyLast: '',
  dailyStreak: 0,
  dailyBestMs: null,
};

/**
 * Coerce unknown persisted data into the save shape. Daily fields default
 * cleanly for pre-daily saves. When todayKey is given and the stored
 * dailyLast belongs to an earlier day, dailyBestMs resets — the streak and
 * last-day stamp survive (the daily kit needs them to extend the streak).
 */
export function normalizeSave(raw: unknown, todayKey?: string): SaveData {
  const save: SaveData = { ...DEFAULT_SAVE };
  if (!raw || typeof raw !== 'object') return save;
  const data = raw as Partial<SaveData> & { v?: unknown };
  if (data.v !== 1) return save;

  const t = data.bestTimeMs;
  save.bestTimeMs =
    typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : null;
  save.bestRank = typeof data.bestRank === 'string' ? data.bestRank : null;
  if (typeof data.reducedMotion === 'boolean') save.reducedMotion = data.reducedMotion;
  if (typeof data.sfx === 'boolean') save.sfx = data.sfx;
  if (typeof data.haptics === 'boolean') save.haptics = data.haptics;

  save.dailyLast = typeof data.dailyLast === 'string' ? data.dailyLast : '';
  save.dailyStreak =
    typeof data.dailyStreak === 'number' &&
    Number.isFinite(data.dailyStreak) &&
    data.dailyStreak > 0
      ? Math.floor(data.dailyStreak)
      : 0;
  const b = data.dailyBestMs;
  save.dailyBestMs = typeof b === 'number' && Number.isFinite(b) && b > 0 ? b : null;
  if (todayKey !== undefined && save.dailyLast !== todayKey) save.dailyBestMs = null;
  return save;
}

/**
 * Fold a finished Daily Race into the save: stamps today, extends (or
 * restarts) the consecutive-day streak via the shared daily rules, and keeps
 * the faster of today's runs in dailyBestMs. Returns a NEW save object plus
 * whether the daily best improved; the input is never mutated.
 */
export function withDailyCompletion(
  save: SaveData,
  todayKey: string,
  ms: number,
): { save: SaveData; improved: boolean; streak: number } {
  const progress = recordDailyCompletion(save, todayKey);
  // When the day rolled over, the old dailyBestMs belongs to yesterday.
  const prevBest = progress.dailyLast === save.dailyLast ? save.dailyBestMs : null;
  const improved = prevBest === null || ms < prevBest;
  return {
    save: {
      ...save,
      dailyLast: progress.dailyLast,
      dailyStreak: progress.dailyStreak,
      dailyBestMs: improved ? ms : prevBest,
    },
    improved,
    streak: progress.dailyStreak,
  };
}
