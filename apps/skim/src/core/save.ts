/**
 * Skim — save shape, normalization, and mastery. Pure and unit-tested.
 * Aggregates only (bests/stats/daily) — far under the 3 MiB platform cap.
 */
import { MEDAL_GOLD_M } from './constants';
import { bestMedal, medalFor, type Medal } from './scoring';

export const SAVE_VERSION = 1;

export interface SaveData {
  v: number;
  /** Best single-throw distance (m). */
  bestM: number;
  /** Most skips in one throw. */
  bestSkips: number;
  stats: {
    throws: number;
    totalM: number;
    perfects: number;
  };
  /** Best medal ever earned (menu shows it). */
  medal: Medal | null;
  /** Daily mode bookkeeping. */
  dailyLast: string;
  dailyStreak: number;
  /** Best daily total (m); reset when the day changes. */
  dailyBestM: number | null;
  /** Selected stone skin index (collection hook). */
  stone: number;
  sfx: boolean;
  haptics: boolean;
  reducedMotion: boolean;
  seenTutorial: boolean;
}

export function emptySave(): SaveData {
  return {
    v: SAVE_VERSION,
    bestM: 0,
    bestSkips: 0,
    stats: { throws: 0, totalM: 0, perfects: 0 },
    medal: null,
    dailyLast: '',
    dailyStreak: 0,
    dailyBestM: null,
    stone: 0,
    sfx: true,
    haptics: true,
    reducedMotion: false,
    seenTutorial: false,
  };
}

function coerceCount(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
}

function coerceM(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0;
}

export function normalizeSave(raw: unknown, todayKey?: string): SaveData {
  const save = emptySave();
  if (!raw || typeof raw !== 'object') return save;
  const data = raw as Partial<SaveData>;
  if (data.v !== SAVE_VERSION) return save;
  save.bestM = coerceM(data.bestM);
  save.bestSkips = coerceCount(data.bestSkips);
  if (data.stats && typeof data.stats === 'object') {
    const s = data.stats as Record<string, unknown>;
    save.stats.throws = coerceCount(s.throws);
    save.stats.totalM = coerceM(s.totalM);
    save.stats.perfects = coerceCount(s.perfects);
  }
  if (data.medal === 'bronze' || data.medal === 'silver' || data.medal === 'gold') {
    save.medal = data.medal;
  }
  if (typeof data.dailyLast === 'string') save.dailyLast = data.dailyLast;
  save.dailyStreak = coerceCount(data.dailyStreak);
  if (typeof data.dailyBestM === 'number' && Number.isFinite(data.dailyBestM) && data.dailyBestM > 0) {
    save.dailyBestM = data.dailyBestM;
  }
  if (todayKey !== undefined && save.dailyLast !== todayKey) save.dailyBestM = null;
  if (typeof data.stone === 'number' && Number.isFinite(data.stone) && data.stone >= 0) {
    save.stone = Math.floor(data.stone);
  }
  if (typeof data.sfx === 'boolean') save.sfx = data.sfx;
  if (typeof data.haptics === 'boolean') save.haptics = data.haptics;
  if (typeof data.reducedMotion === 'boolean') save.reducedMotion = data.reducedMotion;
  if (typeof data.seenTutorial === 'boolean') save.seenTutorial = data.seenTutorial;
  return save;
}

/** Record a finished throw. Returns a NEW save; the input is never mutated. */
export function withThrowResult(
  save: SaveData,
  distanceM: number,
  skips: number,
  perfects: number,
): SaveData {
  const next: SaveData = {
    ...save,
    stats: { ...save.stats },
    bestM: Math.max(save.bestM, distanceM),
    bestSkips: Math.max(save.bestSkips, skips),
    medal: bestMedal(save.medal, medalFor(distanceM)),
  };
  next.stats.throws += 1;
  next.stats.totalM += distanceM;
  next.stats.perfects += perfects;
  return next;
}

export function withStone(save: SaveData, stone: number): SaveData {
  return { ...save, stone };
}

/**
 * Mastery 0–1000 for the shared profile: 80% best distance vs gold,
 * 20% daily-best vs a gold-and-a-half day.
 */
export function masteryFor(save: SaveData): number {
  const best = Math.min(1, save.bestM / MEDAL_GOLD_M);
  const daily = Math.min(1, (save.dailyBestM ?? 0) / (MEDAL_GOLD_M * 1.5));
  return Math.round(1000 * (0.8 * best + 0.2 * daily));
}
