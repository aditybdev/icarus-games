/**
 * Persisted shape (platform local storage, aggregates only). Version-gated;
 * all updaters immutable. serves counts mallows (drives the recipe unlocks).
 */
import { MEDAL_GOLD, type Medal } from './constants';
import { bestMedal } from './scoring';

export interface SaveData {
  v: 1;
  bestRush: number;
  medal: Medal | null;
  stats: { serves: number; golden: number; charred: number };
  dailyLast: string | null;
  dailyStreak: number;
  dailyBest: number;
  treat: number;
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
    stats: { serves: 0, golden: 0, charred: 0 },
    dailyLast: null,
    dailyStreak: 0,
    dailyBest: 0,
    treat: 0,
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
      golden: stats.golden ?? 0,
      charred: stats.charred ?? 0,
    },
    dailyLast: typeof r.dailyLast === 'string' ? r.dailyLast : null,
    dailyStreak: r.dailyStreak ?? 0,
    dailyBest: r.dailyBest ?? 0,
    treat: r.treat ?? 0,
    sfx: r.sfx !== false,
    haptics: r.haptics !== false,
    reducedMotion: r.reducedMotion === true,
    seenTutorial: r.seenTutorial === true,
  };
}

export interface RushResult {
  total: number;
  medal: Medal | null;
  /** Mallows roasted in the run. */
  mallows: number;
  golden: number;
  charred: number;
}

export function withRushResult(save: SaveData, res: RushResult): SaveData {
  return {
    ...save,
    bestRush: Math.max(save.bestRush, res.total),
    medal: bestMedal(save.medal, res.medal),
    stats: {
      serves: save.stats.serves + res.mallows,
      golden: save.stats.golden + res.golden,
      charred: save.stats.charred + res.charred,
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

export function withTreat(save: SaveData, treat: number): SaveData {
  return { ...save, treat };
}

/** Portfolio mastery 0..1000: rush best vs gold, daily best as the kicker. */
export function masteryFor(save: SaveData): number {
  const a = Math.min(1, save.bestRush / MEDAL_GOLD);
  const b = Math.min(1, save.dailyBest / MEDAL_GOLD);
  return Math.round(1000 * (0.8 * a + 0.2 * b));
}
