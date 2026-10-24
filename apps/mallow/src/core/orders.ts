/**
 * Orders: how the camper likes it. Each order is a doneness window with a
 * perfect center and a fire-intensity tweak; scoring is triangular closeness
 * to the perfect, multiplied by evenness, with hard caps for the fail
 * states. Rush book is fixed and escalating; daily book is seeded.
 */
import { CAP_CHARCOAL, CAP_ON_FIRE, MALLOW_MAX, type Grade } from './constants';
import { stats, type Mallow } from './mallow';

export interface OrderSpec {
  label: string;
  /** Preferred doneness window [lo, hi] and its perfect center. */
  lo: number;
  hi: number;
  perfect: number;
  /** Fire intensity multiplier for this mallow. */
  fireScale: number;
}

export const LIGHTLY: Omit<OrderSpec, 'fireScale'> = { label: 'Lightly toasted', lo: 0.35, hi: 0.55, perfect: 0.45 };
export const GOLDEN: Omit<OrderSpec, 'fireScale'> = { label: 'Golden', lo: 0.55, hi: 0.85, perfect: 0.7 };
export const WELLDONE: Omit<OrderSpec, 'fireScale'> = { label: 'Well-done', lo: 0.8, hi: 1.0, perfect: 0.88 };

/** Rush book: five fixed orders, hotter fires toward the end. */
export function rushOrders(): OrderSpec[] {
  return [
    { ...GOLDEN, fireScale: 1.0 },
    { ...LIGHTLY, fireScale: 0.95 },
    { ...GOLDEN, fireScale: 1.1 },
    { ...WELLDONE, fireScale: 1.0 },
    { ...GOLDEN, fireScale: 1.25 },
  ];
}

/** Daily Campfire: seeded windows + fire scales (gusts themselves are seeded
 *  per mallow in main, so each mallow has its own wind for everyone). */
export function dailyOrders(rng: () => number): OrderSpec[] {
  const picks = [GOLDEN, LIGHTLY, WELLDONE, GOLDEN, WELLDONE];
  return picks.map((p) => ({ ...p, fireScale: 0.9 + rng() * 0.4 }));
}

export interface MallowScore {
  score: number;
  grade: Grade;
  /** Results-badge label: the fail/near language is the retention line. */
  tag: 'Golden!' | 'Toasty' | 'Raw' | 'Dark' | 'Burnt' | 'On fire';
}

export function gradeFor(score: number): Grade {
  if (score >= 90) return 'S';
  if (score >= 75) return 'A';
  if (score >= 55) return 'B';
  if (score >= 30) return 'C';
  return 'D';
}

export function scoreMallow(m: Mallow, o: OrderSpec): MallowScore {
  const st = stats(m);
  if (st.flaming) {
    return { score: Math.min(CAP_ON_FIRE, MALLOW_MAX), grade: gradeFor(CAP_ON_FIRE), tag: 'On fire' };
  }

  // Triangular closeness, deliberately tight: the raw side gives partial
  // credit, the burnt side falls off fast — greed is where grades are lost.
  const delta = st.avg - o.perfect;
  const span = delta < 0 ? o.perfect * 0.38 : (1.05 - o.perfect) * 0.5;
  const closeness = Math.max(0, 1 - Math.abs(delta) / span);
  const evenness = Math.max(0, 1 - st.variance / 0.03);
  let score = Math.round(MALLOW_MAX * closeness * (0.65 + 0.35 * evenness));

  let tag: MallowScore['tag'];
  if (st.charcoalCount > 0) {
    score = Math.min(score, CAP_CHARCOAL);
    tag = 'Burnt';
  } else if (st.avg < o.lo * 0.55) {
    tag = 'Raw';
    score = Math.min(score, 12);
  } else if (Math.abs(st.avg - o.perfect) <= 0.06 && evenness > 0.6) {
    tag = 'Golden!';
  } else if (st.avg > o.hi) {
    tag = 'Dark';
  } else {
    tag = 'Toasty';
  }
  return { score, grade: gradeFor(score), tag };
}
