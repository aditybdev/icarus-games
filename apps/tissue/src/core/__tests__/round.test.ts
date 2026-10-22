import { describe, expect, it } from 'vitest';
import {
  BLAZING_GAP_MS,
  FEVER_STREAK,
  GOLDEN_PULL_EVERY,
  PULL_THRESHOLD_PX,
  SPEEDY_GAP_MS,
} from '../constants';
import {
  cancelPull,
  createRound,
  elapsedMs,
  feverActive,
  flightDone,
  formatMs,
  formatPaceMs,
  formatResultsDeltaMs,
  grab,
  isGoldenPull,
  nextReady,
  paceDeltaMs,
  release,
  scoreForRound,
  streakAlive,
  streakPitch,
  tension,
  tierForGap,
  updatePull,
  type RoundState,
} from '../round';

class FakeClock {
  t = 0;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

/** Grab, drag up past the threshold (or a custom distance), and release. */
function pullOnce(
  round: RoundState,
  clock: FakeClock,
  distance = PULL_THRESHOLD_PX + 40,
) {
  // Complete the previous tissue's cycle if one is still in flight.
  flightDone(round);
  nextReady(round);
  expect(grab(round, clock)).toBe(true);
  updatePull(round, distance);
  return release(round, clock);
}

describe('round timer', () => {
  it('starts on the first grab, not at round creation', () => {
    const clock = new FakeClock();
    const round = createRound(25);

    clock.advance(5000); // sitting on the ready screen
    expect(elapsedMs(round, clock)).toBe(0);
    expect(round.startedAt).toBeNull();

    expect(grab(round, clock)).toBe(true);
    expect(round.startedAt).toBe(5000);

    clock.advance(600);
    expect(elapsedMs(round, clock)).toBe(600);
  });

  it('stops exactly when remaining hits 0 and freezes afterwards', () => {
    const clock = new FakeClock();
    const round = createRound(25);

    clock.advance(2000);
    for (let i = 0; i < 24; i += 1) {
      const res = pullOnce(round, clock);
      expect(res.finished).toBe(false);
      clock.advance(400);
    }
    expect(round.remaining).toBe(1);
    flightDone(round);
    nextReady(round);
    expect(round.phase).toBe('idle');
    expect(round.finishedAt).toBeNull();

    clock.advance(123);
    const finalRes = pullOnce(round, clock);
    expect(finalRes.finished).toBe(true);
    expect(round.phase).toBe('finished');
    expect(round.remaining).toBe(0);
    expect(round.finishedAt).toBe(clock.t);

    const frozen = elapsedMs(round, clock);
    expect(frozen).toBe(round.finishedAt! - round.startedAt!);
    clock.advance(10000);
    expect(elapsedMs(round, clock)).toBe(frozen);
  });
});

describe('perforation threshold', () => {
  it('a below-threshold release snaps back and does NOT decrement', () => {
    const clock = new FakeClock();
    const round = createRound(25);

    expect(grab(round, clock)).toBe(true);
    updatePull(round, round.threshold - 1);
    expect(round.phase).toBe('pulling');
    const res = release(round, clock);

    expect(res.accepted).toBe(false);
    expect(round.remaining).toBe(25);
    expect(round.pulled).toBe(0);
    expect(round.phase).toBe('idle'); // back to grabbable
    expect(round.pullDistance).toBe(0);
  });

  it('an above-threshold release detaches and decrements', () => {
    const clock = new FakeClock();
    const round = createRound(50);

    expect(grab(round, clock)).toBe(true);
    updatePull(round, round.threshold + 1);
    expect(tension(round)).toBe(1);
    const res = release(round, clock);

    expect(res.accepted).toBe(true);
    expect(round.remaining).toBe(49);
    expect(round.pulled).toBe(1);
    expect(round.phase).toBe('flying');

    flightDone(round);
    expect(round.phase).toBe('next');
    nextReady(round);
    expect(round.phase).toBe('idle');
  });

  it('ignores grabs/releases in wrong phases', () => {
    const clock = new FakeClock();
    const round = createRound(25);

    expect(grab(round, clock)).toBe(true);
    expect(grab(round, clock)).toBe(false); // already holding one
    updatePull(round, PULL_THRESHOLD_PX + 10);
    release(round, clock);

    // Now flying: no grab possible until the next tissue pops up.
    expect(grab(round, clock)).toBe(false);
    const res = release(round, clock);
    expect(res.accepted).toBe(false);
    expect(round.remaining).toBe(24);
  });
});

describe('streak tiers', () => {
  it('classifies gaps at the exact boundaries', () => {
    expect(tierForGap(0)).toBe('blazing');
    expect(tierForGap(BLAZING_GAP_MS)).toBe('blazing');
    expect(tierForGap(BLAZING_GAP_MS + 1)).toBe('speedy');
    expect(tierForGap(SPEEDY_GAP_MS)).toBe('speedy');
    expect(tierForGap(SPEEDY_GAP_MS + 1)).toBe('none');
  });

  it('derives tiers from real pull gaps inside a round', () => {
    const clock = new FakeClock();
    const round = createRound(50);

    // First pull never has a tier (no previous detach).
    expect(pullOnce(round, clock).tier).toBe('none');
    expect(round.streak).toBe(1);

    clock.advance(200); // blazing gap
    let res = pullOnce(round, clock);
    expect(res.tier).toBe('blazing');
    expect(res.streak).toBe(2);

    clock.advance(450); // speedy gap (post-retune: 350 < gap <= 550)
    res = pullOnce(round, clock);
    expect(res.tier).toBe('speedy');
    expect(res.streak).toBe(3);

    clock.advance(800); // too slow, streak resets
    res = pullOnce(round, clock);
    expect(res.tier).toBe('none');
    expect(res.streak).toBe(1);
  });
});

describe('rapid-fire re-grab (overlapped pop)', () => {
  it('allows an immediate re-grab when the next sheet is already up', () => {
    const clock = new FakeClock();
    const round = createRound(25);

    // First rip, then flightDone + nextReady with ZERO elapsed time — the
    // path main.ts takes when the pop finished during the pull itself.
    const first = pullOnce(round, clock);
    expect(first.accepted).toBe(true);
    flightDone(round);
    nextReady(round);
    expect(round.phase).toBe('idle');
    expect(grab(round, clock)).toBe(true);

    // Gap of 0 ms between detaches must be classified blazing.
    updatePull(round, PULL_THRESHOLD_PX + 10);
    const second = release(round, clock);
    expect(second.accepted).toBe(true);
    expect(second.tier).toBe('blazing');
    expect(second.streak).toBe(2);
  });

  it('phase guards make premature flightDone/nextReady harmless', () => {
    const clock = new FakeClock();
    const round = createRound(25);

    expect(grab(round, clock)).toBe(true);
    updatePull(round, 50);
    // Renderer signalling while a pull is held must not corrupt the phase.
    flightDone(round);
    nextReady(round);
    expect(round.phase).toBe('pulling');

    updatePull(round, PULL_THRESHOLD_PX + 10);
    const res = release(round, clock);
    expect(res.accepted).toBe(true);
    expect(round.phase).toBe('flying');
  });

  it('a snap-back between rips leaves the streak gap anchored to the last detach', () => {
    const clock = new FakeClock();
    const round = createRound(50);

    expect(pullOnce(round, clock).accepted).toBe(true);
    clock.advance(150);

    // Short pull -> snap back (what pause/cancel also produces).
    flightDone(round);
    nextReady(round);
    expect(grab(round, clock)).toBe(true);
    updatePull(round, 40);
    const weak = release(round, clock);
    expect(weak.accepted).toBe(false);
    expect(round.streak).toBe(1); // untouched by the failed pull

    clock.advance(80); // 150 + 80 = 230 ms since the last detach
    const res = pullOnce(round, clock);
    expect(res.accepted).toBe(true);
    expect(res.tier).toBe('blazing');
    expect(res.streak).toBe(2);
  });
});

describe('retuned streak gaps (overlapped-pop flow)', () => {
  it('locks the post-audit tuning: speedy 550 ms, blazing 350 ms', () => {
    // The detach-to-detach floor is now pull-speed-bound (~0.2-0.3 s), so
    // both tiers must sit above it or they can never fire in real play.
    expect(BLAZING_GAP_MS).toBe(350);
    expect(SPEEDY_GAP_MS).toBe(550);
    expect(BLAZING_GAP_MS).toBeGreaterThan(300); // above the physical floor
  });

  it('a steady 500 ms rhythm chains Speedy the whole round', () => {
    const clock = new FakeClock();
    const round = createRound(25);
    expect(pullOnce(round, clock).tier).toBe('none');
    for (let i = 0; i < 24; i += 1) {
      clock.advance(500);
      const res = pullOnce(round, clock);
      expect(res.tier).toBe('speedy');
    }
    expect(round.streak).toBe(25);
  });
});

describe('streakAlive', () => {
  it('is false before a chain forms and expires once the window lapses', () => {
    const clock = new FakeClock();
    const round = createRound(25);
    expect(streakAlive(round, clock)).toBe(false);

    pullOnce(round, clock); // streak 1 — a single pull is not a chain
    expect(streakAlive(round, clock)).toBe(false);

    clock.advance(200);
    pullOnce(round, clock); // blazing, streak 2
    expect(streakAlive(round, clock)).toBe(true);

    clock.advance(SPEEDY_GAP_MS); // exactly at the window edge: still alive
    expect(streakAlive(round, clock)).toBe(true);
    clock.advance(1);
    expect(streakAlive(round, clock)).toBe(false);
  });

  it('a slow detach drops the chain immediately', () => {
    const clock = new FakeClock();
    const round = createRound(25);
    pullOnce(round, clock);
    clock.advance(200);
    pullOnce(round, clock);
    expect(round.streak).toBe(2);
    expect(streakAlive(round, clock)).toBe(true);

    clock.advance(900);
    const res = pullOnce(round, clock); // slow pull breaks the chain
    expect(res.streak).toBe(1);
    expect(streakAlive(round, clock)).toBe(false);
  });

  it('a snap-back does not kill the chain, but the clock keeps running', () => {
    const clock = new FakeClock();
    const round = createRound(25);
    pullOnce(round, clock);
    clock.advance(200);
    pullOnce(round, clock);
    expect(streakAlive(round, clock)).toBe(true);

    // Mis-pull: below-threshold release. Chain survives (gap is anchored to
    // the last detach), but the window is still draining.
    clock.advance(100);
    flightDone(round);
    nextReady(round);
    expect(grab(round, clock)).toBe(true);
    updatePull(round, 40);
    expect(release(round, clock).accepted).toBe(false);
    expect(streakAlive(round, clock)).toBe(true); // 100 ms < 550 ms

    clock.advance(SPEEDY_GAP_MS - 100 + 1); // window lapses mid-fumble
    expect(streakAlive(round, clock)).toBe(false);
  });
});

describe('streakPitch', () => {
  it('keeps non-tier pulls at 1 and escalates per tier and streak', () => {
    expect(streakPitch('none', 5)).toBe(1);
    expect(streakPitch('speedy', 2)).toBeGreaterThan(1);
    expect(streakPitch('blazing', 2)).toBeGreaterThan(streakPitch('speedy', 2));
    expect(streakPitch('speedy', 6)).toBeGreaterThan(streakPitch('speedy', 2));
  });

  it('clamps the streak so high chains stay musical', () => {
    expect(streakPitch('blazing', 500)).toBe(streakPitch('blazing', 10));
    expect(streakPitch('speedy', 0)).toBe(streakPitch('speedy', -3));
  });
});

describe('paceDeltaMs', () => {
  it('is null without a best or before the first detach', () => {
    const clock = new FakeClock();
    const round = createRound(50);
    expect(paceDeltaMs(round, null, clock)).toBeNull();
    expect(paceDeltaMs(round, 25000, clock)).toBeNull(); // pulled 0
    expect(grab(round, clock)).toBe(true); // timer started, still no detach
    clock.advance(500);
    expect(paceDeltaMs(round, 25000, clock)).toBeNull();
  });

  it('is negative while ahead of the pro-rated best pace', () => {
    const clock = new FakeClock();
    const round = createRound(50); // best 25 000 ms -> 500 ms/tissue
    clock.advance(1000);
    for (let i = 0; i < 10; i += 1) {
      pullOnce(round, clock);
      clock.advance(400); // 400 ms/tissue: ahead of pace
    }
    // elapsed 4000 (from the first grab) vs expected 10 x 500 = 5000.
    expect(paceDeltaMs(round, 25000, clock)).toBe(-1000);
  });

  it('is positive while behind the pro-rated best pace', () => {
    const clock = new FakeClock();
    const round = createRound(50);
    clock.advance(1000);
    for (let i = 0; i < 10; i += 1) {
      pullOnce(round, clock);
      clock.advance(600); // 600 ms/tissue: behind pace
    }
    // elapsed 6000 vs expected 5000.
    expect(paceDeltaMs(round, 25000, clock)).toBe(1000);
  });
});

describe('pace and delta formatting', () => {
  it('formats the live pace chip', () => {
    expect(formatPaceMs(-1400)).toBe('−1.4 s');
    expect(formatPaceMs(400)).toBe('+0.4 s');
    expect(formatPaceMs(0)).toBe('±0.0 s');
    expect(formatPaceMs(49)).toBe('±0.0 s');
  });

  it('formats the results delta sentence', () => {
    expect(formatResultsDeltaMs(400)).toBe('0.4 s behind your best');
    expect(formatResultsDeltaMs(-1200)).toBe('1.2 s ahead of your best!');
    expect(formatResultsDeltaMs(30)).toBe('Dead level with your best!');
  });
});

describe('mercy mis-pull rule', () => {
  /** Snap back (below-threshold release) on the currently grabbed tissue. */
  function snapBack(round: RoundState, clock: FakeClock) {
    flightDone(round);
    nextReady(round);
    expect(grab(round, clock)).toBe(true);
    updatePull(round, 40);
    return release(round, clock);
  }

  it('the first snap-back during a chain spends mercy and keeps the streak', () => {
    const clock = new FakeClock();
    const round = createRound(25);
    pullOnce(round, clock);
    clock.advance(200);
    pullOnce(round, clock); // streak 2
    expect(round.streak).toBe(2);

    clock.advance(100);
    const res = snapBack(round, clock);
    expect(res.accepted).toBe(false);
    expect(res.mercy).toBe(true);
    expect(res.streakBroken).toBe(false);
    expect(round.streak).toBe(2); // chain survives
    expect(round.mercyUsed).toBe(true);
  });

  it('the second snap-back in the same chain breaks the streak', () => {
    const clock = new FakeClock();
    const round = createRound(25);
    pullOnce(round, clock);
    clock.advance(200);
    pullOnce(round, clock); // streak 2

    clock.advance(100);
    expect(snapBack(round, clock).mercy).toBe(true);
    clock.advance(100);
    const res = snapBack(round, clock);
    expect(res.mercy).toBe(false);
    expect(res.streakBroken).toBe(true);
    expect(res.streak).toBe(0);
    expect(round.streak).toBe(0);
    expect(round.mercyUsed).toBe(false); // next chain earns a fresh mercy
  });

  it('a snap-back before any chain forms is free (no mercy spent)', () => {
    const clock = new FakeClock();
    const round = createRound(25);
    pullOnce(round, clock); // streak 1 — not a chain yet
    const res = snapBack(round, clock);
    expect(res.mercy).toBe(false);
    expect(res.streakBroken).toBe(false);
    expect(round.streak).toBe(1);
    expect(round.mercyUsed).toBe(false);
  });

  it('a broken chain earns a fresh mercy on the next chain', () => {
    const clock = new FakeClock();
    const round = createRound(50);
    pullOnce(round, clock);
    clock.advance(200);
    pullOnce(round, clock); // streak 2
    clock.advance(100);
    snapBack(round, clock); // mercy spent
    clock.advance(100);
    snapBack(round, clock); // chain broken -> streak 0

    // Rebuild a chain: streak 1, then 2.
    clock.advance(100);
    expect(pullOnce(round, clock).streak).toBe(1);
    clock.advance(200);
    expect(pullOnce(round, clock).streak).toBe(2);

    clock.advance(100);
    const res = snapBack(round, clock);
    expect(res.mercy).toBe(true); // fresh mercy for the new chain
    expect(round.streak).toBe(2);
  });

  it('a slow accepted pull (chain reset to 1) also refreshes mercy', () => {
    const clock = new FakeClock();
    const round = createRound(50);
    pullOnce(round, clock);
    clock.advance(200);
    pullOnce(round, clock); // streak 2
    clock.advance(100);
    snapBack(round, clock); // mercy spent, chain alive
    expect(round.mercyUsed).toBe(true);

    clock.advance(900); // let the window lapse, then a slow pull
    expect(pullOnce(round, clock).streak).toBe(1);
    expect(round.mercyUsed).toBe(false);
  });
});

describe('cancelPull (pause/pointercancel)', () => {
  it('abandons the pull for free — no mercy spent, chain untouched', () => {
    const clock = new FakeClock();
    const round = createRound(25);
    pullOnce(round, clock);
    clock.advance(200);
    pullOnce(round, clock); // streak 2, chain live

    flightDone(round);
    nextReady(round);
    expect(grab(round, clock)).toBe(true);
    updatePull(round, 120);
    cancelPull(round); // what pause/pointercancel does
    expect(round.phase).toBe('idle');
    expect(round.pullDistance).toBe(0);
    expect(round.streak).toBe(2);
    expect(round.mercyUsed).toBe(false);

    // The chain is still grabbable and scores normally afterwards.
    const res = pullOnce(round, clock);
    expect(res.accepted).toBe(true);
    expect(res.tier).toBe('blazing');
    expect(res.streak).toBe(3);
  });

  it('is a no-op outside grabbing/pulling', () => {
    const round = createRound(25);
    cancelPull(round);
    expect(round.phase).toBe('idle');
  });
});

describe('peakStreak tracking', () => {
  it('records the highest chain of the round for stats', () => {
    const clock = new FakeClock();
    const round = createRound(50);
    expect(round.peakStreak).toBe(0);
    pullOnce(round, clock);
    clock.advance(200);
    pullOnce(round, clock);
    clock.advance(200);
    pullOnce(round, clock); // streak 3
    expect(round.peakStreak).toBe(3);

    clock.advance(900);
    pullOnce(round, clock); // slow: streak back to 1
    expect(round.streak).toBe(1);
    expect(round.peakStreak).toBe(3); // peak holds
  });
});

describe('golden pull schedule', () => {
  it('marks every GOLDEN_PULL_EVERY-th tissue (1-based), never the rest', () => {
    expect(GOLDEN_PULL_EVERY).toBe(20);
    expect(isGoldenPull(0)).toBe(false);
    expect(isGoldenPull(1)).toBe(false);
    expect(isGoldenPull(19)).toBe(false);
    expect(isGoldenPull(20)).toBe(true);
    expect(isGoldenPull(21)).toBe(false);
    expect(isGoldenPull(40)).toBe(true);
    expect(isGoldenPull(100)).toBe(true);
  });
});

describe('fever threshold', () => {
  it('turns on exactly at FEVER_STREAK', () => {
    expect(FEVER_STREAK).toBe(10);
    expect(feverActive(0)).toBe(false);
    expect(feverActive(9)).toBe(false);
    expect(feverActive(10)).toBe(true);
    expect(feverActive(30)).toBe(true);
  });
});

describe('full round simulation', () => {
  it('a 50-pull round reaches finished with a sane time and score', () => {
    const clock = new FakeClock();
    const round = createRound(50);

    clock.advance(1000); // player readies up; timer must not count this
    let lastTier: string = 'none';
    for (let i = 0; i < 50; i += 1) {
      const res = pullOnce(round, clock);
      lastTier = res.tier;
      if (i < 49) {
        expect(res.finished).toBe(false);
        flightDone(round);
        nextReady(round);
        clock.advance(200);
      }
    }

    expect(round.phase).toBe('finished');
    expect(round.remaining).toBe(0);
    expect(round.pulled).toBe(50);
    expect(lastTier).toBe('blazing'); // 200 ms gaps
    expect(round.streak).toBe(50);
    expect(elapsedMs(round, clock)).toBe(49 * 200);

    const score = scoreForRound(round.size, elapsedMs(round, clock));
    // 50 tissues / 9.8 s ~= 5.1 tissues/s -> ~5102.
    expect(score).toBe(Math.round((50 / 9.8) * 1000));
  });
});

describe('formatting helpers', () => {
  it('formats mm:ss.t', () => {
    expect(formatMs(0)).toBe('00:00.0');
    expect(formatMs(83456)).toBe('01:23.4');
    expect(formatMs(59999)).toBe('00:59.9');
    expect(formatMs(60000)).toBe('01:00.0');
    expect(formatMs(3600000 + 12000 + 500)).toBe('60:12.5');
  });

  it('scores tissues per second x 1000', () => {
    expect(scoreForRound(50, 10000)).toBe(5000);
    expect(scoreForRound(25, 5000)).toBe(5000);
    expect(scoreForRound(100, 0)).toBe(0);
  });
});
