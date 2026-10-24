/**
 * Orders: the fry-side targets. An order is a plate zone [cx±w/2] that may
 * slide on a sinusoidal rail (deterministic from order-local time, so daily
 * seeds are fair). Coverage is the fraction of the blob's footprint on the
 * zone; a blob center inside the middle PERFECT_ZONE fraction is "Plated!".
 * Rush order specs are fixed and escalating; daily orders are seeded.
 */
import { BLOB_R, ORDER_MAX, PERFECT_ZONE } from './constants';
import { pressureForRange } from './flight';

export type OrderKind = 'fries' | 'burger' | 'hotdog';

export interface OrderSpec {
  kind: OrderKind;
  /** Zone center rest position (m along the plate). */
  cx: number;
  /** Zone width (m). */
  w: number;
  /** Target pressure band [lo, hi]. */
  band: readonly [number, number];
  /** Slide amplitude (m) and angular speed (rad/s); 0 = static plate. */
  moveAmp: number;
  moveSpeed: number;
}

export const ORDER_LABEL: Record<OrderKind, string> = {
  fries: 'Fries',
  burger: 'Burger',
  hotdog: 'Hot Dog',
};

/** Zone center at order-local time t. */
export function targetCxAt(o: OrderSpec, t: number): number {
  return o.cx + (o.moveAmp !== 0 ? o.moveAmp * Math.sin(o.moveSpeed * t) : 0);
}

/** Fraction of the blob footprint overlapping the zone at time t (0..1). */
export function coverage(landX: number, o: OrderSpec, t: number, r: number = BLOB_R): number {
  const cx = targetCxAt(o, t);
  const lo = Math.max(landX - r, cx - o.w / 2);
  const hi = Math.min(landX + r, cx + o.w / 2);
  const overlap = Math.max(0, hi - lo);
  return Math.min(1, overlap / (2 * r));
}

/** Blob center inside the zone's middle PERFECT_ZONE fraction. */
export function perfectHit(landX: number, o: OrderSpec, t: number): boolean {
  return Math.abs(landX - targetCxAt(o, t)) <= (o.w * PERFECT_ZONE) / 2;
}

/** Order score 0..ORDER_MAX. A Plated! hit is always the full count. */
export function scoreFor(cov: number, perfect: boolean): number {
  if (perfect) return ORDER_MAX;
  return Math.round(ORDER_MAX * Math.max(0, Math.min(1, cov)));
}

/* ------------------------------ order book ------------------------------ */

/** Guidance band around the pressure whose 45° range hits the zone center —
 *  skillful angles can score outside it; the band is teaching, not law. */
function bandFor(cx: number): readonly [number, number] {
  const p = pressureForRange(cx);
  return [Math.max(0.1, p - 0.16), Math.min(0.98, p + 0.16)];
}

/** Rush mode: five fixed orders, escalating (farther, hotter, then moving). */
export function rushOrders(): OrderSpec[] {
  return [
    { kind: 'fries', cx: 1.6, w: 0.5, band: bandFor(1.6), moveAmp: 0, moveSpeed: 0 },
    { kind: 'burger', cx: 2.2, w: 0.44, band: bandFor(2.2), moveAmp: 0, moveSpeed: 0 },
    { kind: 'hotdog', cx: 2.8, w: 0.6, band: bandFor(2.8), moveAmp: 0, moveSpeed: 0 },
    { kind: 'fries', cx: 3.3, w: 0.46, band: bandFor(3.3), moveAmp: 0.25, moveSpeed: 1.1 },
    { kind: 'burger', cx: 3.75, w: 0.4, band: bandFor(3.75), moveAmp: 0.3, moveSpeed: 1.5 },
  ];
}

/** Daily Diner: five seeded orders — same lineup for everyone today. */
export function dailyOrders(rng: () => number): OrderSpec[] {
  const kinds: OrderKind[] = ['fries', 'burger', 'hotdog', 'fries', 'burger'];
  return kinds.map((kind, i) => {
    const moving = i >= 3;
    const cx = 1.5 + rng() * 2.3;
    return {
      kind,
      cx,
      w: kind === 'hotdog' ? 0.56 + rng() * 0.08 : 0.38 + rng() * 0.12,
      band: bandFor(cx),
      moveAmp: moving ? 0.2 + rng() * 0.15 : 0,
      moveSpeed: moving ? 0.9 + rng() * 0.8 : 0,
    };
  });
}
