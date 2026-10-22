import { describe, expect, it } from 'vitest';
import {
  dailyDoneToday,
  dailyKeyUTC,
  dateSeedUTC,
  defaultProfile,
  defineSave,
  haptics,
  icarusScore,
  mergeProfiles,
  mulberry32,
  normalizeProfile,
  osPrefersReducedMotion,
  prevDailyKey,
  recordDailyCompletion,
  recordPlay,
  setHapticsEnabled,
  siblingForDay,
} from './index';

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('differs across seeds and stays in [0, 1)', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let same = true;
    for (let i = 0; i < 100; i++) {
      const va = a();
      expect(va).toBeGreaterThanOrEqual(0);
      expect(va).toBeLessThan(1);
      if (va !== b()) same = false;
    }
    expect(same).toBe(false);
  });
});

describe('dateSeedUTC', () => {
  it('is stable for a fixed date', () => {
    const d = new Date(Date.UTC(2026, 9, 23));
    expect(dateSeedUTC(d)).toBe(dateSeedUTC(d));
  });

  it('changes across days', () => {
    const a = dateSeedUTC(new Date(Date.UTC(2026, 9, 23)));
    const b = dateSeedUTC(new Date(Date.UTC(2026, 9, 24)));
    expect(a).not.toBe(b);
  });

  it('returns a uint32', () => {
    const s = dateSeedUTC(new Date(Date.UTC(2031, 0, 1)));
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(2 ** 32);
  });
});

describe('haptics', () => {
  it('is a no-op without a Vibration API and never throws', () => {
    expect(() => haptics(25)).not.toThrow();
    expect(() => haptics([10, 20, 30])).not.toThrow();
  });

  it('respects the enabled toggle', () => {
    setHapticsEnabled(false);
    expect(() => haptics(15)).not.toThrow();
    setHapticsEnabled(true);
  });
});

describe('osPrefersReducedMotion', () => {
  it('returns a boolean without throwing outside a browser', () => {
    expect(typeof osPrefersReducedMotion()).toBe('boolean');
  });
});

describe('dailyKeyUTC / prevDailyKey', () => {
  it('formats a UTC date as YYYY-MM-DD', () => {
    expect(dailyKeyUTC(new Date(Date.UTC(2026, 9, 23)))).toBe('2026-10-23');
    expect(dailyKeyUTC(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01-05');
  });

  it('walks back across month and year boundaries', () => {
    expect(prevDailyKey('2026-10-01')).toBe('2026-09-30');
    expect(prevDailyKey('2026-01-01')).toBe('2025-12-31');
    expect(prevDailyKey('2024-03-01')).toBe('2024-02-29'); // leap year
  });
});

describe('recordDailyCompletion', () => {
  it('starts the streak at 1 on the first completion', () => {
    expect(recordDailyCompletion({ dailyLast: '', dailyStreak: 0 }, '2026-10-23')).toEqual({
      dailyLast: '2026-10-23',
      dailyStreak: 1,
    });
  });

  it('extends the streak on consecutive days', () => {
    const p = recordDailyCompletion({ dailyLast: '2026-10-22', dailyStreak: 4 }, '2026-10-23');
    expect(p).toEqual({ dailyLast: '2026-10-23', dailyStreak: 5 });
  });

  it('restarts the streak after a gap', () => {
    const p = recordDailyCompletion({ dailyLast: '2026-10-20', dailyStreak: 9 }, '2026-10-23');
    expect(p).toEqual({ dailyLast: '2026-10-23', dailyStreak: 1 });
  });

  it('is idempotent for same-day replays', () => {
    const p = recordDailyCompletion({ dailyLast: '2026-10-23', dailyStreak: 3 }, '2026-10-23');
    expect(p).toEqual({ dailyLast: '2026-10-23', dailyStreak: 3 });
  });
});

describe('dailyDoneToday', () => {
  it('detects same-day completion', () => {
    expect(dailyDoneToday({ dailyLast: '2026-10-23', dailyStreak: 2 }, '2026-10-23')).toBe(true);
    expect(dailyDoneToday({ dailyLast: '2026-10-22', dailyStreak: 2 }, '2026-10-23')).toBe(false);
    expect(dailyDoneToday({ dailyLast: '', dailyStreak: 0 }, '2026-10-23')).toBe(false);
  });
});

interface TinySave {
  v: 1 | 2;
  score: number;
  name: string;
}

const tinyDefaults: TinySave = { v: 2, score: 0, name: 'anon' };

const tinySave = defineSave<TinySave>({
  version: 2,
  defaults: tinyDefaults,
  sanitize(raw) {
    return {
      v: 2,
      score:
        typeof raw.score === 'number' && Number.isFinite(raw.score) && raw.score >= 0
          ? Math.floor(raw.score)
          : 0,
      name: typeof raw.name === 'string' ? raw.name : 'anon',
    };
  },
  migrate(raw, fromVersion) {
    if (fromVersion < 2) return { ...raw, name: 'anon', v: 2 };
    return raw;
  },
});

describe('defineSave', () => {
  it('returns a deep copy of defaults for garbage', () => {
    expect(tinySave.normalize(undefined)).toEqual(tinyDefaults);
    expect(tinySave.normalize(null)).toEqual(tinyDefaults);
    expect(tinySave.normalize('junk')).toEqual(tinyDefaults);
    expect(tinySave.normalize([1, 2])).toEqual(tinyDefaults);
    const copy = tinySave.normalize(undefined);
    expect(copy).not.toBe(tinyDefaults);
  });

  it('sanitizes a current-version payload field by field', () => {
    expect(tinySave.normalize({ v: 2, score: 42, name: 'ada' })).toEqual({
      v: 2,
      score: 42,
      name: 'ada',
    });
    expect(tinySave.normalize({ v: 2, score: -3, name: 7 })).toEqual(tinyDefaults);
  });

  it('migrates older payloads to the current version', () => {
    expect(tinySave.normalize({ v: 1, score: 9 })).toEqual({ v: 2, score: 9, name: 'anon' });
  });

  it('preserves unknown fields and the version stamp from newer saves', () => {
    const out = tinySave.normalize({ v: 3, score: 5, name: 'bea', futureField: { x: 1 } });
    expect(out.score).toBe(5);
    expect((out as unknown as Record<string, unknown>).futureField).toEqual({ x: 1 });
    expect((out as unknown as Record<string, unknown>).v).toBe(3);
  });

  it('falls back to defaults when migrate throws', () => {
    const boom = defineSave<TinySave>({
      version: 2,
      defaults: tinyDefaults,
      sanitize: () => tinyDefaults,
      migrate: () => {
        throw new Error('corrupt');
      },
    });
    expect(boom.normalize({ v: 1, score: 3 })).toEqual(tinyDefaults);
  });
});

describe('normalizeProfile', () => {
  it('returns defaults for garbage', () => {
    expect(normalizeProfile(undefined).games).toEqual({});
    expect(normalizeProfile('junk').settings.sfx).toBe(true);
  });

  it('coerces settings and clamps mastery to 0–1000', () => {
    const p = normalizeProfile({
      settings: { sfx: false, haptics: true, reducedMotion: false },
      games: { swirl: { plays: 3, lastPlayed: '2026-10-23', mastery: 4200 } },
    });
    expect(p.settings.sfx).toBe(false);
    expect(p.games.swirl.mastery).toBe(1000);
    expect(p.games.swirl.plays).toBe(3);
  });
});

describe('mergeProfiles', () => {
  it('unions games without double-counting a mirrored entry', () => {
    const a = defaultProfile();
    a.games.swirl = { plays: 5, lastPlayed: '2026-10-20', mastery: 300 };
    const b = defaultProfile();
    b.games.swirl = { plays: 5, lastPlayed: '2026-10-23', mastery: 450 };
    b.games.fold = { plays: 2, lastPlayed: '2026-10-22', mastery: 100 };
    const m = mergeProfiles(a, b);
    expect(m.games.swirl).toEqual({ plays: 5, lastPlayed: '2026-10-23', mastery: 450 });
    expect(m.games.fold.mastery).toBe(100);
  });
});

describe('recordPlay + icarusScore', () => {
  it('bumps plays, stamps today, and never lowers mastery', () => {
    const p = defaultProfile();
    recordPlay(p, 'swirl', 500, '2026-10-23');
    recordPlay(p, 'swirl', 400, '2026-10-23');
    expect(p.games.swirl.plays).toBe(2);
    expect(p.games.swirl.mastery).toBe(500);
    expect(p.games.swirl.lastPlayed).toBe('2026-10-23');
  });

  it('sums mastery across games', () => {
    const p = defaultProfile();
    recordPlay(p, 'swirl', 500, '2026-10-23');
    recordPlay(p, 'fold', 250, '2026-10-23');
    expect(icarusScore(p)).toBe(750);
    expect(icarusScore(defaultProfile())).toBe(0);
  });
});

describe('siblingForDay', () => {
  it('never returns the game itself and is deterministic per seed', () => {
    for (const id of ['swirl', 'fold', 'frenzy', 'tissue']) {
      for (let seed = 0; seed < 12; seed++) {
        const s = siblingForDay(id, seed);
        expect(s.id).not.toBe(id);
        expect(s.name.length).toBeGreaterThan(0);
        expect(siblingForDay(id, seed)).toEqual(s);
      }
    }
  });
});
