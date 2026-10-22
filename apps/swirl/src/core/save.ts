/**
 * Versioned save shape — pure functions, no storage APIs.
 * The platform adapter handles persistence; this module only guarantees a
 * well-formed { v, best, bestOrderStars } object no matter what was stored.
 */

export const SAVE_VERSION = 1;

export interface SaveData {
  v: number;
  /** Best Free Swirl score. */
  best: number;
  /** Best total stars from an Order Rush run (0..9). */
  bestOrderStars: number;
}

export const DEFAULT_SAVE: SaveData = {
  v: SAVE_VERSION,
  best: 0,
  bestOrderStars: 0,
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
  return {
    v: SAVE_VERSION,
    best: toNonNegativeInt(r.best, Number.MAX_SAFE_INTEGER),
    bestOrderStars: toNonNegativeInt(r.bestOrderStars, MAX_ORDER_STARS),
  };
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
