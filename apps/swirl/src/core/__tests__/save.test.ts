import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SAVE,
  MAX_ORDER_STARS,
  normalizeSave,
  SAVE_VERSION,
  withBestScore,
  withBestStars,
} from '../save';

describe('normalizeSave', () => {
  it('returns defaults for missing or non-object data', () => {
    expect(normalizeSave(undefined)).toEqual(DEFAULT_SAVE);
    expect(normalizeSave(null)).toEqual(DEFAULT_SAVE);
    expect(normalizeSave('junk')).toEqual(DEFAULT_SAVE);
    expect(normalizeSave(42)).toEqual(DEFAULT_SAVE);
  });

  it('returns defaults for empty objects', () => {
    expect(normalizeSave({})).toEqual(DEFAULT_SAVE);
  });

  it('preserves valid fields and stamps the current version', () => {
    expect(normalizeSave({ v: 1, best: 120, bestOrderStars: 6 })).toEqual({
      v: SAVE_VERSION,
      best: 120,
      bestOrderStars: 6,
    });
  });

  it('fills partial data with defaults', () => {
    expect(normalizeSave({ best: 77 })).toEqual({ v: SAVE_VERSION, best: 77, bestOrderStars: 0 });
  });

  it('rejects negative, NaN and non-numeric values', () => {
    expect(normalizeSave({ best: -5, bestOrderStars: Number.NaN })).toEqual(DEFAULT_SAVE);
    expect(normalizeSave({ best: 'lots' })).toEqual(DEFAULT_SAVE);
  });

  it('floors floats and clamps stars to the maximum', () => {
    const save = normalizeSave({ best: 123.9, bestOrderStars: 42 });
    expect(save.best).toBe(123);
    expect(save.bestOrderStars).toBe(MAX_ORDER_STARS);
  });

  it('normalizes unknown future versions back to the current version', () => {
    expect(normalizeSave({ v: 99, best: 10 }).v).toBe(SAVE_VERSION);
  });
});

describe('withBestScore', () => {
  it('updates when the score beats the stored best', () => {
    const { save, improved } = withBestScore(DEFAULT_SAVE, 250);
    expect(improved).toBe(true);
    expect(save.best).toBe(250);
    expect(save.v).toBe(SAVE_VERSION);
  });

  it('keeps the stored best on ties or lower scores', () => {
    const base = { v: SAVE_VERSION, best: 250, bestOrderStars: 0 };
    expect(withBestScore(base, 250).improved).toBe(false);
    expect(withBestScore(base, 100).save.best).toBe(250);
  });

  it('does not mutate the input save', () => {
    const base = { v: SAVE_VERSION, best: 10, bestOrderStars: 1 };
    withBestScore(base, 500);
    expect(base.best).toBe(10);
  });

  it('ignores invalid scores', () => {
    expect(withBestScore(DEFAULT_SAVE, -3).improved).toBe(false);
    expect(withBestScore(DEFAULT_SAVE, Number.NaN).improved).toBe(false);
  });
});

describe('withBestStars', () => {
  it('updates when stars beat the stored best', () => {
    const { save, improved } = withBestStars(DEFAULT_SAVE, 7);
    expect(improved).toBe(true);
    expect(save.bestOrderStars).toBe(7);
  });

  it('keeps the stored best otherwise', () => {
    const base = { v: SAVE_VERSION, best: 0, bestOrderStars: 7 };
    expect(withBestStars(base, 7).improved).toBe(false);
    expect(withBestStars(base, 3).save.bestOrderStars).toBe(7);
  });

  it('clamps stars to the maximum', () => {
    expect(withBestStars(DEFAULT_SAVE, 99).save.bestOrderStars).toBe(MAX_ORDER_STARS);
  });
});
