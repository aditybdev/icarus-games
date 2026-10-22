/**
 * Tissue Rush — main orchestration.
 * App flow (menu / countdown / playing / results), platform wiring, render
 * loop and input glue. Pure rules (round state machine, timer, streaks,
 * medals, save shape, blitz scoring) live in ./core and are unit-tested
 * with vitest.
 */
import {
  createPlatform,
  dailyKeyUTC,
  defaultProfile,
  haptics,
  icarusScore,
  installErrorHooks,
  loadSharedProfile,
  osPrefersReducedMotion,
  recordPlay,
  saveSharedProfile,
  setHapticsEnabled,
  siblingForDay,
  type IcarusProfile,
} from '@icarus/platform';
import type { RoundSize } from './core/constants';
import { BLITZ_SIZE, blitzOver, blitzPointsFor, blitzTimeLeftMs } from './core/blitz';
import { formatNextMedalMs, medalFor, nextMedalMs } from './core/medals';
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
  updatePull,
  type RoundState,
} from './core/round';
import {
  masteryFor,
  normalizeSave,
  withBestTime,
  withDailyCompletion,
  withRoundStats,
  withSkin,
  type SaveData,
} from './core/save';
import { BOX_SKINS, resolveSkin, skinUnlocked } from './core/skins';
import { AudioSfx } from './game/audio';
import { bindPointer } from './game/input';
import { Renderer } from './game/renderer';
import { UI } from './ui/ui';

type AppState = 'menu' | 'countdown' | 'playing' | 'results';
type GameMode = 'time' | 'blitz' | 'daily';

const platform = createPlatform('tissue');
// Error hooks must precede any fallible construction (renderer below) so a
// constructor throw is still reported to the host health channel.
installErrorHooks(platform, 'tissue');
const audio = new AudioSfx();
const renderer = new Renderer(document.getElementById('stage') as HTMLElement);

// Reduced-motion starts from the OS preference; the settings toggle overrides.
let reducedMotion =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
renderer.setReducedMotion(reducedMotion);

let save: SaveData = normalizeSave(undefined);
let appState: AppState = 'menu';
let paused = false;
/** User sound toggle (combined with the host audio gate). */
let sfxOn = true;
/** Cross-game profile (shared localStorage key on same-origin web). */
let profile: IcarusProfile = defaultProfile();
/** True when the user opened the pause overlay (vs. a host/visibility pause). */
let manualPaused = false;
let round: RoundState | null = null;
let mode: GameMode = 'time';
let blitzScore = 0;
let feverOn = false;
/** Keeps a broken-chain chip flash on screen for a beat before it hides. */
let streakChipHoldT = 0;

/**
 * Fair game clock in ms: only advances while unpaused, so pausing freezes
 * the round timer exactly. All core timestamps use this clock.
 */
let gameNow = 0;
const clock = { now: () => gameNow };

let grabbing = false;
let grabStartY = 0;
let lastRustleDist = 0;
let countdownT = 0;
let countdownLabel = '';
let lastRemaining = -1;

/** Fever mode (streak >= 10): audio bed + box glow + sparkle trails. */
function setFever(on: boolean): void {
  if (on === feverOn) return;
  feverOn = on;
  audio.setFever(on);
  renderer.setFeverVisual(on);
}

function applySkin(): void {
  renderer.setSkin(BOX_SKINS[resolveSkin(save)]);
}

/* ------------------------------ round flow ------------------------------ */

function startRound(
  size: RoundSize,
  opts: { skipCountdown?: boolean; mode?: GameMode } = {},
): void {
  const threshold = Math.min(Math.max(window.innerHeight * 0.32, 140), 230);
  round = createRound(size, threshold);
  mode = opts.mode ?? 'time';
  blitzScore = 0;
  setFever(false);
  streakChipHoldT = 0;
  grabbing = false;
  lastRemaining = -1;
  renderer.resetForRound();
  renderer.setGoldNext(isGoldenPull(1));
  renderer.startPop(); // first tissue rises during the countdown
  appState = 'countdown';
  // Replays/restarts skip straight to a short "GO!" flash; the full 3-2-1
  // is kept for the first entry from the menu.
  countdownT = opts.skipCountdown ? 0.39 : 2.9;
  countdownLabel = '';
  ui.showCountdown(
    mode === 'blitz'
      ? 'Blitz — 30 s score attack!'
      : mode === 'daily'
        ? 'Daily Sprint — 25 tissues'
        : `Round of ${size}`,
  );
  if (opts.skipCountdown) ui.setCountdown('GO!');
  ui.showHUD(mode === 'blitz' ? 0 : size, mode);
}

function finishRound(): void {
  if (!round || appState !== 'playing' || (mode !== 'time' && mode !== 'daily')) return;
  appState = 'results';
  setFever(false);
  const ms = elapsedMs(round, clock);
  const avg = ms / round.size;
  const prevBest = save.bestMs[round.size];
  save = withRoundStats(save, round.pulled, round.peakStreak);
  const result = withBestTime(save, round.size, ms);
  save = result.save;
  // Daily Sprint: stamp today, bump the streak and keep today's best time.
  let dailyBestText = '';
  let dailyStreakText = '';
  if (mode === 'daily') {
    const daily = withDailyCompletion(save, dailyKeyUTC(), ms);
    save = daily.save;
    dailyBestText = daily.improved
      ? `New daily best: ${formatMs(ms)}!`
      : `Daily best today: ${formatMs(save.dailyBestMs ?? ms)}`;
    dailyStreakText =
      daily.streak === 1 ? '🔥 1-day streak' : `🔥 ${daily.streak}-day streak`;
  }
  // Persist every finish: stats accumulate even when the best doesn't move,
  // and a daily completion must be saved immediately.
  void platform.save(save);
  platform.sendScore(scoreForRound(round.size, ms));
  mirrorMastery();
  const medal = medalFor(round.size, ms);
  audio.chime();
  renderer.confettiBurst();
  const sib = siblingForDay('tissue');
  ui.showResults({
    timeText: formatMs(ms),
    avgText: `${(avg / 1000).toFixed(2)}s average per tissue`,
    deltaText: prevBest === null ? '' : formatResultsDeltaMs(ms - prevBest),
    deltaAhead: prevBest !== null && ms < prevBest,
    size: round.size,
    sizeText: mode === 'daily' ? 'Daily Sprint — 25 tissues' : undefined,
    bestText: result.improved
      ? `New best: ${formatMs(save.bestMs[round.size] ?? ms)}!`
      : `Best: ${formatMs(save.bestMs[round.size] ?? ms)}`,
    newBest: result.improved,
    medal,
    nextMedalText: formatNextMedalMs(nextMedalMs(round.size, ms)),
    dailyBestText,
    dailyStreakText,
    promoText: `More from Icarus: ${sib.name} — ${sib.pitch}`,
  });
}

function finishBlitz(): void {
  if (!round || appState !== 'playing' || mode !== 'blitz') return;
  appState = 'results';
  // The clock can expire mid-pull: abandon the held tissue cleanly.
  cancelGrab();
  setFever(false);
  save = withRoundStats(save, round.pulled, round.peakStreak);
  void platform.save(save);
  platform.sendScore(blitzScore);
  audio.chime();
  renderer.confettiBurst();
  const sib = siblingForDay('tissue');
  ui.showResults({
    timeText: String(blitzScore),
    avgText: `${round.pulled} tissues in 30 s`,
    deltaText: '',
    deltaAhead: false,
    size: round.size,
    sizeText: 'Blitz — 30 s score attack',
    bestText: '',
    newBest: false,
    medal: null,
    nextMedalText: '',
    promoText: `More from Icarus: ${sib.name} — ${sib.pitch}`,
  });
}

function goToMenu(): void {
  appState = 'menu';
  round = null;
  grabbing = false;
  setFever(false);
  renderer.resetForRound();
  renderer.startPop();
  applySkin();
  ui.showMenu(save, icarusScore(profile));
}

/* ---------------------------- pause / resume ---------------------------- */

function pauseGame(): void {
  if (paused) return;
  if (appState !== 'playing' && appState !== 'countdown') return;
  paused = true;
  cancelGrab();
  audio.setEnabled(false);
  ui.setPaused(true);
}

function resumeGame(): void {
  if (!paused) return;
  paused = false;
  audio.setEnabled(platform.isAudioEnabled() && sfxOn);
  ui.setPaused(false);
  last = performance.now();
}

/* --------------------------------- input -------------------------------- */

function cancelGrab(): void {
  if (!grabbing || !round) {
    grabbing = false;
    return;
  }
  grabbing = false;
  // Pause/pointercancel abandons the pull for free — it must not spend the
  // chain's mercy (that cost is only for real mis-pulls via release()).
  cancelPull(round);
  renderer.snapBack();
}

bindPointer(renderer.domElement, {
  onDown(x, y) {
    audio.unlock();
    audio.setEnabled(platform.isAudioEnabled() && sfxOn && !paused);
    if (paused || appState !== 'playing' || !round) return;
    const rect = renderer.exposedTissueRect();
    if (!rect) return;
    const inside =
      x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
    if (!inside) return;
    if (grab(round, clock)) {
      grabbing = true;
      grabStartY = y;
      lastRustleDist = 0;
      renderer.startGrab(x, y);
      // The next sheet starts rising during the pull (not after the flyer
      // leaves the screen) so fast successive rips are physically possible.
      renderer.startPop();
      audio.rustle(round.streak >= 2 ? streakPitch('speedy', round.streak) : 1);
    }
  },
  onMove(x, y) {
    if (paused || appState !== 'playing' || !grabbing || !round) return;
    renderer.moveGrab(x, y);
    updatePull(round, grabStartY - y);
    if (Math.abs(round.pullDistance - lastRustleDist) > 16) {
      lastRustleDist = round.pullDistance;
      audio.rustle(round.streak >= 2 ? streakPitch('speedy', round.streak) : 1);
    }
  },
  onUp(x, y, vx, vy) {
    if (paused || appState !== 'playing' || !grabbing || !round) return;
    grabbing = false;
    const res = release(round, clock);
    if (res.accepted) {
      const gold = isGoldenPull(round.pulled); // the sheet just detached
      renderer.launchFlyer(x, y, vx, vy, gold);
      renderer.setGoldNext(isGoldenPull(round.pulled + 1));
      // Progress to 'next' immediately; the flyer visual is independent and
      // the next sheet is already popping (started at grab time).
      flightDone(round);
      const pitch = streakPitch(res.tier, res.streak);
      audio.pop(pitch);
      audio.whoosh(pitch);
      if (gold) {
        // Golden tissue: bonus arpeggio + gold burst + stronger haptic.
        audio.golden();
        renderer.goldBurst(x, y);
        haptics([12, 40, 12]);
      } else {
        haptics(res.tier === 'blazing' ? 15 : 12);
      }
      if (mode === 'blitz') blitzScore += blitzPointsFor(res.streak);
      setFever(feverActive(res.streak));
      if (res.streak >= 2) ui.setStreak(res.streak, res.tier === 'blazing');
      else ui.hideStreak(); // slow pull broke the chain
      if (res.tier !== 'none') {
        ui.streak(res.tier === 'blazing' ? 'Blazing!' : 'Speedy!', res.tier === 'blazing');
      }
      if (res.finished) {
        if (mode === 'blitz') finishBlitz(); // cleared the endless box early
        else finishRound();
      }
    } else {
      renderer.snapBack();
      audio.snap();
      if (res.mercy || res.streakBroken) {
        // Legible mis-pull cost: flash the chip + descending blip.
        audio.descend();
        ui.flashStreak();
        if (res.streakBroken) {
          streakChipHoldT = 0.5; // let the flash read before the chip hides
          setFever(false);
        }
      }
    }
  },
  onCancel() {
    if (paused) return;
    cancelGrab();
  },
});

/* --------------------------------- loop --------------------------------- */

let rafId = 0;
let last = performance.now();
let readySent = false;

function tick(dt: number): void {
  if (appState === 'countdown') {
    countdownT -= dt;
    const label = countdownT <= 0.4 ? 'GO!' : String(Math.ceil(countdownT - 0.4));
    if (label !== countdownLabel) {
      countdownLabel = label;
      ui.setCountdown(label);
      audio.blip(label === 'GO!' ? 3 : 3 - Number(label));
    }
    if (countdownT <= 0) {
      appState = 'playing';
      ui.hideCountdown();
    }
  }

  if (streakChipHoldT > 0) streakChipHoldT = Math.max(0, streakChipHoldT - dt);

  if (round) {
    if (appState === 'playing') {
      if (mode === 'blitz') {
        // Blitz: the HUD timer counts the window down; the chip shows score.
        const left = blitzTimeLeftMs(elapsedMs(round, clock));
        ui.setTimer(formatMs(left));
        if (blitzOver(elapsedMs(round, clock))) {
          finishBlitz();
        }
      } else {
        ui.setTimer(formatMs(elapsedMs(round, clock)));
        // Live pace vs the best time for this size (green ahead / red behind).
        const pace = paceDeltaMs(round, save.bestMs[round.size], clock);
        ui.setPace(pace === null ? null : formatPaceMs(pace), pace !== null && pace > 0);
      }
      const shown = mode === 'blitz' ? blitzScore : round.remaining;
      if (shown !== lastRemaining) {
        lastRemaining = shown;
        ui.setRemaining(shown);
      }
      // The streak chip expires the moment the gap window lapses, so a slow
      // pull or a fumbled mis-pull visibly drops the chain. A just-broken
      // chain keeps its flash on screen for a beat (streakChipHoldT).
      if (!streakAlive(round, clock)) {
        if (round.streak >= 2) setFever(false); // chain lapsed mid-flight
        if (streakChipHoldT <= 0) ui.hideStreak();
      }
    }
    renderer.update(dt, tension(round));
    const ev = renderer.pollEvents();
    if (ev.exited && round.phase === 'flying') {
      flightDone(round);
      renderer.startPop();
    }
    // State-based (not event-based) so a pop that finishes during the pull
    // itself still flips 'next' -> 'idle', and the grabbable window matches
    // exposedTissueRect exactly.
    if (round.phase === 'next' && renderer.popReady) {
      nextReady(round);
    }
  } else {
    renderer.update(dt, 0);
    renderer.pollEvents();
  }
}

function loop(now: number): void {
  rafId = requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  if (!paused) {
    gameNow += dt * 1000;
    tick(dt);
  }
  renderer.draw(
    round,
    gameNow / 1000,
    round ? tension(round) : 0,
    appState === 'playing' && !paused,
  );
  if (!readySent) {
    readySent = true;
    void platform.ready().catch(() => undefined);
  }
}

/* --------------------------------- boot --------------------------------- */

const ui = new UI({
  onPlay(size) {
    audio.unlock();
    audio.setEnabled(platform.isAudioEnabled() && sfxOn && !paused);
    audio.click();
    startRound(size, { mode: 'time' });
  },
  onBlitz() {
    audio.unlock();
    audio.setEnabled(platform.isAudioEnabled() && sfxOn && !paused);
    audio.click();
    startRound(BLITZ_SIZE, { mode: 'blitz' });
  },
  onDaily() {
    audio.unlock();
    audio.setEnabled(platform.isAudioEnabled() && sfxOn && !paused);
    audio.click();
    // Daily Sprint: a 25-tissue timed round flagged as the Icarus Daily.
    startRound(25, { mode: 'daily' });
  },
  onReplay() {
    audio.click();
    // Instant replay: skip the 3-2-1, keep just the "GO!" flash.
    if (round) startRound(round.size, { skipCountdown: true, mode });
    else goToMenu();
  },
  onMenu() {
    audio.click();
    if (paused) {
      paused = false;
      manualPaused = false;
      audio.setEnabled(platform.isAudioEnabled() && sfxOn);
      ui.setPaused(false);
    }
    goToMenu();
  },
  onResume() {
    audio.click();
    manualPaused = false;
    resumeGame();
  },
  onPause() {
    manualPaused = true;
    pauseGame();
  },
  onRestart() {
    audio.click();
    if (!round) return;
    if (paused) {
      paused = false;
      manualPaused = false;
      audio.setEnabled(platform.isAudioEnabled() && sfxOn);
      ui.setPaused(false);
      last = performance.now();
    }
    startRound(round.size, { skipCountdown: true, mode });
  },
  onSkin(index) {
    if (!skinUnlocked(index, save)) return;
    audio.click();
    save = withSkin(save, index);
    void platform.save(save);
    applySkin();
    ui.showMenu(save);
  },
});

/** Mirror the current mastery into the shared profile (never lowers it). */
function mirrorMastery(): void {
  const entry = profile.games.tissue;
  if (!entry) return;
  entry.mastery = Math.max(entry.mastery, masteryFor(save));
  saveSharedProfile(profile);
}

/** Settings overlay: three toggles mirrored into the save and the profile. */
function bindSettings(): void {
  const overlay = document.getElementById('screen-settings')!;
  const sfxBox = document.getElementById('set-sfx') as HTMLInputElement;
  const hapticsBox = document.getElementById('set-haptics') as HTMLInputElement;
  const motionBox = document.getElementById('set-motion') as HTMLInputElement;
  sfxBox.checked = save.sfx !== false;
  hapticsBox.checked = save.haptics !== false;
  motionBox.checked = reducedMotion;
  document.getElementById('btn-settings')!.addEventListener('click', () => {
    audio.unlock();
    audio.click();
    overlay.hidden = false;
  });
  document.getElementById('btn-settings-close')!.addEventListener('click', () => {
    audio.click();
    overlay.hidden = true;
  });
  sfxBox.addEventListener('change', () => {
    save = { ...save, sfx: sfxBox.checked };
    sfxOn = sfxBox.checked;
    audio.setEnabled(platform.isAudioEnabled() && sfxOn && !paused);
    profile.settings.sfx = sfxOn;
    saveSharedProfile(profile);
    void platform.save(save);
  });
  hapticsBox.addEventListener('change', () => {
    save = { ...save, haptics: hapticsBox.checked };
    setHapticsEnabled(hapticsBox.checked);
    if (hapticsBox.checked) haptics(20);
    profile.settings.haptics = hapticsBox.checked;
    saveSharedProfile(profile);
    void platform.save(save);
  });
  motionBox.addEventListener('change', () => {
    save = { ...save, reducedMotion: motionBox.checked };
    reducedMotion = motionBox.checked;
    renderer.setReducedMotion(reducedMotion);
    document.body.classList.toggle('reduced-motion', reducedMotion);
    profile.settings.reducedMotion = motionBox.checked;
    saveSharedProfile(profile);
    void platform.save(save);
  });
}

async function boot(): Promise<void> {
  // Passing today's key drops a stale dailyBestMs when the day rolled over.
  save = normalizeSave(await platform.load(normalizeSave(undefined)), dailyKeyUTC());
  // Cross-game profile: settings fall back to the shared profile, then to
  // defaults; this session is recorded with today's mastery.
  profile = loadSharedProfile();
  if (save.sfx === undefined) save.sfx = profile.settings.sfx;
  if (save.haptics === undefined) save.haptics = profile.settings.haptics;
  if (save.reducedMotion === undefined) {
    save.reducedMotion = profile.settings.reducedMotion || reducedMotion;
  }
  sfxOn = save.sfx !== false;
  reducedMotion = save.reducedMotion === true;
  renderer.setReducedMotion(reducedMotion);
  document.body.classList.toggle('reduced-motion', reducedMotion);
  setHapticsEnabled(save.haptics !== false);
  recordPlay(profile, 'tissue', masteryFor(save));
  saveSharedProfile(profile);
  bindSettings();
  goToMenu();
  window.addEventListener('resize', () => renderer.resize());
  platform.bindLifecycle({
    pause: pauseGame,
    resume: resumeGame,
    // A host/visibility resume must not dismiss a pause the user chose.
    isManualPause: () => manualPaused,
  });
  platform.onAudioEnabledChange((enabled) => {
    audio.setEnabled(enabled && sfxOn && !paused);
  });
  cancelAnimationFrame(rafId);
  last = performance.now();
  rafId = requestAnimationFrame(loop);
}

void boot();
