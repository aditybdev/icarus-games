import { describe, expect, it } from 'vitest';
import { ORDER_COUNT } from '../constants';
import {
  createOrders,
  FLAVORS,
  mulberry32,
  ORDER_BAND,
  ORDER_MAX_TARGET,
  ORDER_MIN_TARGET,
  rateOrder,
  type Order,
} from '../orders';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return { index: 0, flavor: 'vanilla', targetHeight: 3, band: ORDER_BAND, ...overrides };
}

describe('createOrders', () => {
  it('creates the requested number of orders with sequential indexes', () => {
    const orders = createOrders(mulberry32(42));
    expect(orders).toHaveLength(ORDER_COUNT);
    expect(orders.map((o) => o.index)).toEqual([0, 1, 2]);
  });

  it('only uses known flavors and in-range targets', () => {
    const orders = createOrders(mulberry32(7), 25);
    for (const o of orders) {
      expect(FLAVORS).toContain(o.flavor);
      expect(o.targetHeight).toBeGreaterThanOrEqual(ORDER_MIN_TARGET);
      expect(o.targetHeight).toBeLessThanOrEqual(ORDER_MAX_TARGET);
      expect(o.band).toBe(ORDER_BAND);
    }
  });

  it('is deterministic for the same seed', () => {
    expect(createOrders(mulberry32(99))).toEqual(createOrders(mulberry32(99)));
  });

  it('differs across seeds', () => {
    expect(createOrders(mulberry32(1))).not.toEqual(createOrders(mulberry32(2)));
  });
});

describe('rateOrder', () => {
  it('gives 3 stars for a perfect serve', () => {
    expect(rateOrder(makeOrder(), 3, 'vanilla')).toBe(3);
  });

  it('gives 3 stars at the inner band edge (inclusive)', () => {
    expect(rateOrder(makeOrder(), 3 + ORDER_BAND * 0.5, 'vanilla')).toBe(3);
  });

  it('gives 2 stars within the band', () => {
    expect(rateOrder(makeOrder(), 3 + ORDER_BAND * 0.75, 'vanilla')).toBe(2);
    expect(rateOrder(makeOrder(), 3 + ORDER_BAND, 'vanilla')).toBe(2);
  });

  it('gives 1 star within twice the band', () => {
    expect(rateOrder(makeOrder(), 3 + ORDER_BAND * 1.5, 'vanilla')).toBe(1);
    expect(rateOrder(makeOrder(), 3 + ORDER_BAND * 2, 'vanilla')).toBe(1);
  });

  it('gives 0 stars beyond twice the band', () => {
    expect(rateOrder(makeOrder(), 3 + ORDER_BAND * 2.01, 'vanilla')).toBe(0);
    expect(rateOrder(makeOrder(), 0, 'vanilla')).toBe(0);
  });

  it('is symmetric above and below the target', () => {
    expect(rateOrder(makeOrder(), 3 - ORDER_BAND * 0.75, 'vanilla')).toBe(2);
    expect(rateOrder(makeOrder(), 3 + ORDER_BAND * 0.75, 'vanilla')).toBe(2);
  });

  it('caps at 1 star for the wrong flavor', () => {
    expect(rateOrder(makeOrder(), 3, 'mint')).toBe(1);
    expect(rateOrder(makeOrder({ flavor: 'chocolate' }), 3 + ORDER_BAND, 'vanilla')).toBe(1);
  });

  it('keeps 0 stars for a bad serve with the wrong flavor', () => {
    expect(rateOrder(makeOrder(), 0, 'mint')).toBe(0);
  });
});
