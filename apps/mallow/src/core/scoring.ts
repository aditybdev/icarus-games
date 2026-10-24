/**
 * Rush-total medals + formatting. Fixed thresholds; the near-miss gap is the
 * results-screen retention line.
 */
import { MEDAL_BRONZE, MEDAL_GOLD, MEDAL_SILVER, type Medal } from './constants';

export function medalFor(total: number): Medal | null {
  if (total >= MEDAL_GOLD) return 'gold';
  if (total >= MEDAL_SILVER) return 'silver';
  if (total >= MEDAL_BRONZE) return 'bronze';
  return null;
}

/** Points to the next medal, or null when gold is already held. */
export function nextMedalPts(total: number): { medal: Medal; gap: number } | null {
  if (total < MEDAL_BRONZE) return { medal: 'bronze', gap: MEDAL_BRONZE - total };
  if (total < MEDAL_SILVER) return { medal: 'silver', gap: MEDAL_SILVER - total };
  if (total < MEDAL_GOLD) return { medal: 'gold', gap: MEDAL_GOLD - total };
  return null;
}

export function bestMedal(a: Medal | null, b: Medal | null): Medal | null {
  const rank = (m: Medal | null): number => (m === null ? 0 : m === 'bronze' ? 1 : m === 'silver' ? 2 : 3);
  return rank(a) >= rank(b) ? a : b;
}
