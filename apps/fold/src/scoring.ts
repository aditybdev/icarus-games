/**
 * Pure scoring rules for Fold. Node-testable, no DOM.
 */

export const HINTS_PER_LEVEL = 3;

/**
 * Stars for a completed level (1–3):
 *   3 — solved within the optimal fold count, no hints used
 *   2 — solved with at most one extra fold and at most one hint
 *   1 — everything else (level still completes)
 */
export function starsFor(foldsUsed: number, optimal: number, hintsUsed: number): 1 | 2 | 3 {
  if (foldsUsed <= optimal && hintsUsed === 0) return 3;
  if (foldsUsed <= optimal + 1 && hintsUsed <= 1) return 2;
  return 1;
}

/**
 * After two folds beyond par with no silhouette match, gently suggest Undo.
 */
export function shouldSuggestUndo(foldsUsed: number, optimal: number, matched: boolean): boolean {
  return !matched && foldsUsed >= optimal + 2;
}

/**
 * Live HUD preview: the star tier the player would earn if the level were
 * completed right now (`foldsSoFar` may be below par mid-solve). Delegates to
 * `starsFor` so the HUD preview can never drift from the awarded result.
 */
export function currentTier(foldsSoFar: number, optimal: number, hintsUsed: number): 1 | 2 | 3 {
  return starsFor(foldsSoFar, optimal, hintsUsed);
}

export interface SaveData {
  v: number;
  /** stars[i] = best star count for level i (0 = not completed). */
  stars: number[];
  /** number of levels unlocked (1-based count; level 1 always unlocked). */
  unlocked: number;
  /** Last day the Daily Fold was completed ('YYYY-MM-DD'), or '' for never. */
  dailyLast: string;
  /** Consecutive-day Daily Fold completion streak. */
  dailyStreak: number;
  /** Best star rating earned on TODAY's daily level (0–3; resets on day change). */
  dailyBestStars: number;
  /** User settings toggles; undefined = on / OS default. */
  sfx?: boolean;
  haptics?: boolean;
  reducedMotion?: boolean;
  /** First-launch tutorial has been seen (undefined/false = show it). */
  seenTutorial?: boolean;
}

export const SAVE_VERSION = 1;

export function defaultSave(levelCount: number): SaveData {
  return {
    v: SAVE_VERSION,
    stars: new Array(levelCount).fill(0),
    unlocked: 1,
    dailyLast: '',
    dailyStreak: 0,
    dailyBestStars: 0,
  };
}

/**
 * Validate / migrate a loaded save object. Old saves without the daily fields
 * are tolerated (defaults filled in). When `todayKey` is given and differs
 * from `dailyLast`, `dailyBestStars` resets — it only tracks TODAY's daily.
 */
export function normalizeSave(raw: unknown, levelCount: number, todayKey?: string): SaveData {
  const fallback = defaultSave(levelCount);
  if (typeof raw !== 'object' || raw === null) return fallback;
  const obj = raw as Partial<SaveData>;
  if (obj.v !== SAVE_VERSION) return fallback;
  const stars = new Array<number>(levelCount).fill(0);
  if (Array.isArray(obj.stars)) {
    for (let i = 0; i < levelCount; i++) {
      const s = obj.stars[i];
      stars[i] = typeof s === 'number' && s >= 0 && s <= 3 ? Math.floor(s) : 0;
    }
  }
  let unlocked = typeof obj.unlocked === 'number' ? Math.floor(obj.unlocked) : 1;
  unlocked = Math.max(1, Math.min(levelCount, unlocked));
  const dailyLast = typeof obj.dailyLast === 'string' ? obj.dailyLast : '';
  let dailyStreak = typeof obj.dailyStreak === 'number' ? Math.floor(obj.dailyStreak) : 0;
  if (dailyStreak < 0) dailyStreak = 0;
  const rawBest = obj.dailyBestStars;
  let dailyBestStars =
    typeof rawBest === 'number' && rawBest >= 0 && rawBest <= 3 ? Math.floor(rawBest) : 0;
  // A new day (or no daily ever completed) means today's best starts at 0.
  if (todayKey !== undefined && dailyLast !== todayKey) dailyBestStars = 0;
  const save: SaveData = { v: SAVE_VERSION, stars, unlocked, dailyLast, dailyStreak, dailyBestStars };
  if (typeof obj.sfx === 'boolean') save.sfx = obj.sfx;
  if (typeof obj.haptics === 'boolean') save.haptics = obj.haptics;
  if (typeof obj.reducedMotion === 'boolean') save.reducedMotion = obj.reducedMotion;
  if (typeof obj.seenTutorial === 'boolean') save.seenTutorial = obj.seenTutorial;
  return save;
}

export function totalStars(save: SaveData): number {
  return save.stars.reduce((a, b) => a + b, 0);
}

/**
 * Icarus mastery 0–1000: total stars vs the full 3★-every-level clear —
 * linear, matching the in-game chase.
 */
export function masteryFor(save: SaveData): number {
  const max = save.stars.length * 3;
  if (max <= 0) return 0;
  return Math.round((totalStars(save) / max) * 1000);
}

/**
 * Proximity readout for the ghost panel: converts the engine's raw 0–1
 * silhouette mismatch into a 0–100 "match %" (100 = perfect match).
 * Non-finite input (defensive) reads as 0%.
 */
export function matchPercent(mismatch: number): number {
  if (!Number.isFinite(mismatch)) return 0;
  const m = Math.min(1, Math.max(0, mismatch));
  return Math.round((1 - m) * 100);
}

/**
 * Flawless streak: the number of consecutive 3-star completions ending at
 * `levelIndex`, derived purely from the star array. 0 when that level's best
 * is not 3★ (any <3★ completion resets the streak).
 */
export function flawlessStreak(stars: readonly number[], levelIndex: number): number {
  if (levelIndex < 0 || levelIndex >= stars.length || stars[levelIndex] !== 3) return 0;
  let n = 0;
  for (let i = levelIndex; i >= 0 && stars[i] === 3; i--) n++;
  return n;
}

export interface GalleryCard {
  unlocked: boolean;
  stars: number;
}

/**
 * Origami gallery derivation: each completed level (any stars) unlocks its
 * figure card, which displays the best star count earned.
 */
export function galleryCards(save: SaveData): GalleryCard[] {
  return save.stars.map((s) => ({ unlocked: s > 0, stars: s }));
}

/**
 * Title-screen "Continue" target: index of the highest unlocked level with
 * no stars yet (i.e. where the player left off). Returns null on a fresh
 * save (only level 1 unlocked) so the button stays hidden. If every
 * unlocked level is complete, returns the last unlocked level for replay.
 */
export function continueTarget(save: SaveData): number | null {
  const hi = Math.min(save.unlocked, save.stars.length) - 1;
  if (hi < 1) return null; // unlocked <= 1: nothing to continue to
  for (let i = hi; i >= 0; i--) {
    if ((save.stars[i] ?? 0) === 0) return i;
  }
  return hi;
}
