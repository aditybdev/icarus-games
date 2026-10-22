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

export interface SaveData {
  v: number;
  /** stars[i] = best star count for level i (0 = not completed). */
  stars: number[];
  /** number of levels unlocked (1-based count; level 1 always unlocked). */
  unlocked: number;
}

export const SAVE_VERSION = 1;

export function defaultSave(levelCount: number): SaveData {
  return { v: SAVE_VERSION, stars: new Array(levelCount).fill(0), unlocked: 1 };
}

/** Validate / migrate a loaded save object. */
export function normalizeSave(raw: unknown, levelCount: number): SaveData {
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
  return { v: SAVE_VERSION, stars, unlocked };
}

export function totalStars(save: SaveData): number {
  return save.stars.reduce((a, b) => a + b, 0);
}
