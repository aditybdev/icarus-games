/**
 * Versioned save shape — pure functions, no storage APIs.
 * The platform adapter handles persistence; this module only guarantees a
 * well-formed { v, best, bestOrderStars } object no matter what was stored.
 */

import { recordDailyCompletion } from '@icarus/platform';

export const SAVE_VERSION = 1;

export interface SaveData {
  v: number;
  /** Best Free Swirl score. */
  best: number;
  /** Best total stars from a 3-order Order Rush run (0..9, legacy display). */
  bestOrderStars: number;
  /** Best total stars across any rush run, endless mode included (uncapped). */
  bestRushStars: number;
  /** Last day the Daily Rush was completed ('YYYY-MM-DD'), '' for never. */
  dailyLast: string;
  /** Consecutive-day Daily Rush streak. */
  dailyStreak: number;
  /** Best total stars earned on today's Daily Rush (resets each day). */
  dailyBestStars: number;
  /** User settings toggles; undefined = on / OS default. */
  sfx?: boolean;
  haptics?: boolean;
  reducedMotion?: boolean;
}

export const DEFAULT_SAVE: SaveData = {
  v: SAVE_VERSION,
  best: 0,
  bestOrderStars: 0,
  bestRushStars: 0,
  dailyLast: '',
  dailyStreak: 0,
  dailyBestStars: 0,
};

export const MAX_ORDER_STARS = 9;

function toNonNegativeInt(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  const n = Math.floor(value);
  return n > max ? max : n;
}

/**
 * Coerce anything found in storage into a valid current-version save.
 * Unknown/garbage/partial data degrades to defaults instead of throwing.
 */
export function normalizeSave(raw: unknown): SaveData {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SAVE };
  const r = raw as Record<string, unknown>;
  const save: SaveData = {
    v: SAVE_VERSION,
    best: toNonNegativeInt(r.best, Number.MAX_SAFE_INTEGER),
    bestOrderStars: toNonNegativeInt(r.bestOrderStars, MAX_ORDER_STARS),
    // Endless rush bests pre-date the field: fall back to the legacy 0..9 best.
    bestRushStars: toNonNegativeInt(r.bestRushStars ?? r.bestOrderStars, Number.MAX_SAFE_INTEGER),
    dailyLast: typeof r.dailyLast === 'string' ? r.dailyLast : '',
    dailyStreak: toNonNegativeInt(r.dailyStreak, Number.MAX_SAFE_INTEGER),
    dailyBestStars: toNonNegativeInt(r.dailyBestStars, MAX_ORDER_STARS),
  };
  if (typeof r.sfx === 'boolean') save.sfx = r.sfx;
  if (typeof r.haptics === 'boolean') save.haptics = r.haptics;
  if (typeof r.reducedMotion === 'boolean') save.reducedMotion = r.reducedMotion;
  return save;
}

/**
 * Icarus mastery 0–1000: Free Swirl best vs the ~1060 soft cap (70%) plus
 * the 0–9 rush-stars ladder (30%).
 */
export function masteryFor(save: SaveData): number {
  const free = Math.min(1060, save.best) / 1060;
  const rush = Math.min(MAX_ORDER_STARS, save.bestRushStars) / MAX_ORDER_STARS;
  return Math.round(free * 700 + rush * 300);
}

/** Return an updated save if `score` beats the stored Free Swirl best. */
export function withBestScore(
  save: SaveData,
  score: number,
): { save: SaveData; improved: boolean } {
  const s = toNonNegativeInt(score, Number.MAX_SAFE_INTEGER);
  if (s > save.best) {
    return { save: { ...save, v: SAVE_VERSION, best: s }, improved: true };
  }
  return { save, improved: false };
}

/** Return an updated save if `stars` beats the stored Order Rush best. */
export function withBestStars(
  save: SaveData,
  stars: number,
): { save: SaveData; improved: boolean } {
  const s = toNonNegativeInt(stars, MAX_ORDER_STARS);
  if (s > save.bestOrderStars) {
    return { save: { ...save, v: SAVE_VERSION, bestOrderStars: s }, improved: true };
  }
  return { save, improved: false };
}

/** Zero the daily best when the calendar day has moved on. */
export function withDailyDay(save: SaveData, todayKey: string): SaveData {
  if (save.dailyLast === todayKey) return save;
  return { ...save, dailyBestStars: 0 };
}

/**
 * Record a finished Daily Rush run: extends/restarts the streak via the
 * shared kit and keeps today's best stars. Same-day replays never touch
 * the streak.
 */
export function withDailyResult(
  save: SaveData,
  todayKey: string,
  stars: number,
): { save: SaveData; improved: boolean } {
  const s = toNonNegativeInt(stars, MAX_ORDER_STARS);
  const progress = recordDailyCompletion(
    { dailyLast: save.dailyLast, dailyStreak: save.dailyStreak },
    todayKey,
  );
  const improved = s > save.dailyBestStars;
  return {
    save: {
      ...save,
      dailyLast: progress.dailyLast,
      dailyStreak: progress.dailyStreak,
      dailyBestStars: improved ? s : save.dailyBestStars,
    },
    improved,
  };
}

/** Return an updated save if `stars` beats the uncapped endless-rush best. */
export function withBestRushStars(
  save: SaveData,
  stars: number,
): { save: SaveData; improved: boolean } {
  const s = toNonNegativeInt(stars, Number.MAX_SAFE_INTEGER);
  if (s > save.bestRushStars) {
    return {
      save: {
        ...save,
        v: SAVE_VERSION,
        bestRushStars: s,
        // Keep the legacy 0..9 best in step for any reader of the old field.
        bestOrderStars: Math.max(save.bestOrderStars, Math.min(MAX_ORDER_STARS, s)),
      },
      improved: true,
    };
  }
  return { save, improved: false };
}
