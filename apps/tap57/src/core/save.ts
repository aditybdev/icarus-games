/**
 * Persisted shape (platform local storage, aggregates only). Version-gated:
 * anything that is not v:1 normalizes to an empty save. The daily block
 * resets when the UTC day changes. All updaters are immutable.
 */
import { MEDAL_GOLD, type Medal } from './constants';
import { bestMedal } from './scoring';

export interface SaveData {
  v: 1;
  bestRush: number;
  medal: Medal | null;
  stats: { serves: number; plated: number; splats: number; taps: number };
  dailyLast: string | null;
  dailyStreak: number;
  dailyBest: number;
  bottle: number;
  sfx: boolean;
  haptics: boolean;
  reducedMotion: boolean;
  seenTutorial: boolean;
}

export function emptySave(): SaveData {
  return {
    v: 1,
    bestRush: 0,
    medal: null,
    stats: { serves: 0, plated: 0, splats: 0, taps: 0 },
    dailyLast: null,
    dailyStreak: 0,
    dailyBest: 0,
    bottle: 0,
    sfx: true,
    haptics: true,
    reducedMotion: false,
    seenTutorial: false,
  };
}

export function normalizeSave(raw: unknown): SaveData {
  if (!raw || typeof raw !== 'object') return emptySave();
  const r = raw as Partial<SaveData>;
  if (r.v !== 1) return emptySave();
  const base = emptySave();
  const stats = (r.stats ?? {}) as Partial<SaveData['stats']>;
  return {
    ...base,
    bestRush: typeof r.bestRush === 'number' ? r.bestRush : 0,
    medal: r.medal === 'bronze' || r.medal === 'silver' || r.medal === 'gold' ? r.medal : null,
    stats: {
      serves: stats.serves ?? 0,
      plated: stats.plated ?? 0,
      splats: stats.splats ?? 0,
      taps: stats.taps ?? 0,
    },
    dailyLast: typeof r.dailyLast === 'string' ? r.dailyLast : null,
    dailyStreak: r.dailyStreak ?? 0,
    dailyBest: r.dailyBest ?? 0,
    bottle: r.bottle ?? 0,
    sfx: r.sfx !== false,
    haptics: r.haptics !== false,
    reducedMotion: r.reducedMotion === true,
    seenTutorial: r.seenTutorial === true,
  };
}

export interface RushResult {
  total: number;
  medal: Medal | null;
  /** Orders served in the run (drives the Mustard unlock). */
  orders: number;
  plated: number;
  splats: number;
  taps: number;
}

export function withRushResult(save: SaveData, res: RushResult): SaveData {
  return {
    ...save,
    bestRush: Math.max(save.bestRush, res.total),
    medal: bestMedal(save.medal, res.medal),
    stats: {
      serves: save.stats.serves + res.orders,
      plated: save.stats.plated + res.plated,
      splats: save.stats.splats + res.splats,
      taps: save.stats.taps + res.taps,
    },
  };
}

/** Record a daily completion. Streak continues on consecutive UTC days. */
export function withDailyCompletion(save: SaveData, dayKey: string, total: number): SaveData {
  if (save.dailyLast === dayKey) {
    return { ...save, dailyBest: Math.max(save.dailyBest, total) };
  }
  const yesterday = new Date(Date.parse(`${dayKey}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const streak = save.dailyLast === yesterday ? save.dailyStreak + 1 : 1;
  return { ...save, dailyLast: dayKey, dailyStreak: streak, dailyBest: Math.max(save.dailyBest, total) };
}

export function withBottle(save: SaveData, bottle: number): SaveData {
  return { ...save, bottle };
}

/** Portfolio mastery 0..1000: rush best vs gold, daily best as the kicker. */
export function masteryFor(save: SaveData): number {
  const a = Math.min(1, save.bestRush / MEDAL_GOLD);
  const b = Math.min(1, save.dailyBest / MEDAL_GOLD);
  return Math.round(1000 * (0.8 * a + 0.2 * b));
}
