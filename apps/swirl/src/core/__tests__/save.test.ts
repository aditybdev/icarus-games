import { describe, expect, it } from 'vitest';
import {
  withDailyDay,
  withDailyResult,
  DEFAULT_SAVE,
  MAX_ORDER_STARS,
  normalizeSave,
  SAVE_VERSION,
  withBestRushStars,
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
      bestRushStars: 6,
      dailyLast: '',
      dailyStreak: 0,
      dailyBestStars: 0,
    });
  });

  it('fills partial data with defaults', () => {
    expect(normalizeSave({ best: 77 })).toEqual({
      v: SAVE_VERSION,
      best: 77,
      bestOrderStars: 0,
      bestRushStars: 0,
      dailyLast: '',
      dailyStreak: 0,
      dailyBestStars: 0,
    });
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
    const base = { ...DEFAULT_SAVE, best: 250 };
    expect(withBestScore(base, 250).improved).toBe(false);
    expect(withBestScore(base, 100).save.best).toBe(250);
  });

  it('does not mutate the input save', () => {
    const base = { ...DEFAULT_SAVE, best: 10, bestOrderStars: 1, bestRushStars: 1 };
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
    const base = { ...DEFAULT_SAVE, bestOrderStars: 7, bestRushStars: 7 };
    expect(withBestStars(base, 7).improved).toBe(false);
    expect(withBestStars(base, 3).save.bestOrderStars).toBe(7);
  });

  it('clamps stars to the maximum', () => {
    expect(withBestStars(DEFAULT_SAVE, 99).save.bestOrderStars).toBe(MAX_ORDER_STARS);
  });
});

describe('bestRushStars (endless)', () => {
  it('migrates the legacy 0..9 best when the field is absent', () => {
    expect(normalizeSave({ best: 10, bestOrderStars: 8 }).bestRushStars).toBe(8);
    expect(normalizeSave(undefined).bestRushStars).toBe(0);
  });

  it('prefers the stored endless best over the legacy one', () => {
    expect(normalizeSave({ bestOrderStars: 8, bestRushStars: 23 }).bestRushStars).toBe(23);
  });

  it('is uncapped and keeps the legacy field in step', () => {
    const { save, improved } = withBestRushStars(DEFAULT_SAVE, 23);
    expect(improved).toBe(true);
    expect(save.bestRushStars).toBe(23);
    expect(save.bestOrderStars).toBe(MAX_ORDER_STARS);
    expect(withBestRushStars(save, 12).improved).toBe(false);
  });
});

describe('daily rush', () => {
  it('normalizes missing and garbage daily fields to defaults', () => {
    expect(normalizeSave({ best: 5 }).dailyLast).toBe('');
    expect(normalizeSave({ dailyLast: 42, dailyStreak: 'x', dailyBestStars: -1 })).toEqual(
      DEFAULT_SAVE,
    );
  });

  it('keeps valid daily fields', () => {
    const save = normalizeSave({ dailyLast: '2026-10-22', dailyStreak: 4, dailyBestStars: 7 });
    expect(save.dailyLast).toBe('2026-10-22');
    expect(save.dailyStreak).toBe(4);
    expect(save.dailyBestStars).toBe(7);
  });

  it('withDailyDay zeroes the daily best only when the day moved on', () => {
    const played = { ...DEFAULT_SAVE, dailyLast: '2026-10-22', dailyStreak: 2, dailyBestStars: 5 };
    expect(withDailyDay(played, '2026-10-23').dailyBestStars).toBe(0);
    expect(withDailyDay(played, '2026-10-23').dailyStreak).toBe(2);
    expect(withDailyDay(played, '2026-10-22')).toBe(played);
  });

  it('withDailyResult starts a streak and keeps the daily best', () => {
    const { save, improved } = withDailyResult(DEFAULT_SAVE, '2026-10-23', 7);
    expect(improved).toBe(true);
    expect(save.dailyLast).toBe('2026-10-23');
    expect(save.dailyStreak).toBe(1);
    expect(save.dailyBestStars).toBe(7);
  });

  it('extends the streak on consecutive days', () => {
    const day1 = withDailyResult(DEFAULT_SAVE, '2026-10-22', 5).save;
    const day2 = withDailyResult(day1, '2026-10-23', 3).save;
    expect(day2.dailyStreak).toBe(2);
  });

  it('is idempotent on same-day replays but still tracks the daily best', () => {
    const first = withDailyResult(DEFAULT_SAVE, '2026-10-23', 5).save;
    const replay = withDailyResult(first, '2026-10-23', 8);
    expect(replay.save.dailyStreak).toBe(1);
    expect(replay.improved).toBe(true);
    expect(replay.save.dailyBestStars).toBe(8);
    const worse = withDailyResult(replay.save, '2026-10-23', 2);
    expect(worse.improved).toBe(false);
    expect(worse.save.dailyBestStars).toBe(8);
  });
});
