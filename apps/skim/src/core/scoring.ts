/**
 * Skim — scoring, medals and the daily lake. Pure and unit-tested.
 * Score is honest distance in metres; medals are fixed thresholds (initial
 * calibration to be re-derived from playtests per BENCHMARK.md S2).
 */
import {
  DAILY_THROWS,
  MEDAL_BRONZE_M,
  MEDAL_GOLD_M,
  MEDAL_SILVER_M,
  WAVE_CALM,
  WAVE_MAX,
  WIND_MAX,
} from './constants';
import { CALM_LAKE, type Lake } from './sim';

export type Medal = 'bronze' | 'silver' | 'gold';

export const MEDALS: readonly Medal[] = ['bronze', 'silver', 'gold'];

export const MEDAL_TARGETS_M: Record<Medal, number> = {
  bronze: MEDAL_BRONZE_M,
  silver: MEDAL_SILVER_M,
  gold: MEDAL_GOLD_M,
};

/** Medal earned by a single-throw distance, or null below bronze. */
export function medalFor(distanceM: number): Medal | null {
  if (distanceM >= MEDAL_GOLD_M) return 'gold';
  if (distanceM >= MEDAL_SILVER_M) return 'silver';
  if (distanceM >= MEDAL_BRONZE_M) return 'bronze';
  return null;
}

/** Distance to the next medal up (for the near-miss delta), or null at gold. */
export function nextMedalM(distanceM: number): { medal: Medal; gapM: number } | null {
  if (distanceM < MEDAL_BRONZE_M) return { medal: 'bronze', gapM: MEDAL_BRONZE_M - distanceM };
  if (distanceM < MEDAL_SILVER_M) return { medal: 'silver', gapM: MEDAL_SILVER_M - distanceM };
  if (distanceM < MEDAL_GOLD_M) return { medal: 'gold', gapM: MEDAL_GOLD_M - distanceM };
  return null;
}

/** Best medal of two (gold > silver > bronze > none). */
export function bestMedal(a: Medal | null, b: Medal | null): Medal | null {
  if (a === 'gold' || b === 'gold') return 'gold';
  if (a === 'silver' || b === 'silver') return 'silver';
  if (a === 'bronze' || b === 'bronze') return 'bronze';
  return null;
}

/** Format a distance for HUD/results ("42.3 m"). */
export function formatM(m: number): string {
  return `${m.toFixed(1)} m`;
}

/** Daily lake from a date seed: deterministic wind + waves for everyone. */
export function dailyLake(rng: () => number): Lake {
  const wind = (rng() * 2 - 1) * WIND_MAX;
  const waveAmp = WAVE_CALM + rng() * (WAVE_MAX - WAVE_CALM);
  return { wind, waveAmp };
}

export { CALM_LAKE, DAILY_THROWS };
