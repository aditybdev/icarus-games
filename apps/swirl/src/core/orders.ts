/**
 * Order Rush data and star rating — pure, deterministic.
 *
 * An order is a target height band plus a required flavor. Stars are earned
 * by height accuracy; serving the wrong flavor caps the order at 1 star.
 */
import { MAX_HEIGHT, ORDER_COUNT } from './constants';

export type Flavor = 'vanilla' | 'strawberry' | 'mint' | 'chocolate';

export const FLAVORS: readonly Flavor[] = ['vanilla', 'strawberry', 'mint', 'chocolate'] as const;

export const FLAVOR_LABELS: Record<Flavor, string> = {
  vanilla: 'Vanilla',
  strawberry: 'Strawberry',
  mint: 'Mint',
  chocolate: 'Chocolate',
};

/** Swirl material colors (hex) per flavor. */
export const FLAVOR_COLORS: Record<Flavor, number> = {
  vanilla: 0xfff3dd,
  strawberry: 0xff9ebb,
  mint: 0xa9ecc9,
  chocolate: 0x7b4b2a,
};

export interface Order {
  /** 0-based position within the run. */
  index: number;
  flavor: Flavor;
  /** Target height in world units (center of the accepted band). */
  targetHeight: number;
  /** Half-width of the "perfect" band in world units. */
  band: number;
}

/** Half-width of the 2-star band around a target height. */
export const ORDER_BAND = 0.4;

/** Lowest possible target height (world units). */
export const ORDER_MIN_TARGET = 1.6;

/** Highest possible target height (world units). */
export const ORDER_MAX_TARGET = MAX_HEIGHT - 0.6;

/**
 * Build a run of orders from an injected RNG so runs are reproducible in
 * tests. Targets are quantized to 0.5 world units.
 */
export function createOrders(rng: () => number, count: number = ORDER_COUNT): Order[] {
  const span = ORDER_MAX_TARGET - ORDER_MIN_TARGET;
  const orders: Order[] = [];
  for (let i = 0; i < count; i += 1) {
    const flavorIndex = Math.min(FLAVORS.length - 1, Math.floor(rng() * FLAVORS.length));
    const flavor = FLAVORS[flavorIndex];
    const raw = ORDER_MIN_TARGET + rng() * span;
    const quantized = Math.round(raw * 2) / 2;
    const targetHeight = Math.min(ORDER_MAX_TARGET, Math.max(ORDER_MIN_TARGET, quantized));
    orders.push({ index: i, flavor, targetHeight, band: ORDER_BAND });
  }
  return orders;
}

/**
 * Rate a served swirl against its order.
 *  - err <= band/2          -> 3 stars
 *  - err <= band            -> 2 stars
 *  - err <= band*2          -> 1 star
 *  - otherwise              -> 0 stars
 * Wrong flavor caps the result at 1 star.
 */
export function rateOrder(order: Order, height: number, flavor: Flavor): 0 | 1 | 2 | 3 {
  // Epsilon keeps the documented inclusive boundaries float-safe.
  const EPS = 1e-9;
  const err = Math.abs(height - order.targetHeight);
  let stars: 0 | 1 | 2 | 3;
  if (err <= order.band * 0.5 + EPS) stars = 3;
  else if (err <= order.band + EPS) stars = 2;
  else if (err <= order.band * 2 + EPS) stars = 1;
  else stars = 0;
  if (flavor !== order.flavor && stars > 1) stars = 1;
  return stars;
}

/** Small deterministic PRNG (mulberry32) for reproducible order runs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
