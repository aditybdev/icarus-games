/**
 * Tissue Rush — main orchestration.
 * App flow (menu / countdown / playing / results), platform wiring, render
 * loop and input glue. Pure rules (round state machine, timer, streaks,
 * save shape) live in ./core and are unit-tested with vitest.
 */
import { createPlatform } from '@icarus/platform';
import type { RoundSize } from './core/constants';
import {
  createRound,
  elapsedMs,
  flightDone,
  formatMs,
  grab,
  nextReady,
  release,
  scoreForRound,
  tension,
  updatePull,
  type RoundState,
} from './core/round';
import { normalizeSave, withBestTime, type SaveData } from './core/save';
import { AudioSfx } from './game/audio';
import { bindPointer } from './game/input';
import { Renderer } from './game/renderer';
import { UI } from './ui/ui';

type AppState = 'menu' | 'countdown' | 'playing' | 'results';

const platform = createPlatform('tissue');
const audio = new AudioSfx();
const renderer = new Renderer(document.getElementById('stage') as HTMLElement);

let save: SaveData = normalizeSave(undefined);
let appState: AppState = 'menu';
let paused = false;
let round: RoundState | null = null;

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

/* ------------------------------ round flow ------------------------------ */

function startRound(size: RoundSize): void {
  const threshold = Math.min(Math.max(window.innerHeight * 0.32, 140), 230);
  round = createRound(size, threshold);
  grabbing = false;
  lastRemaining = size;
  renderer.resetForRound();
  renderer.startPop(); // first tissue rises during the countdown
  appState = 'countdown';
  countdownT = 2.9;
  countdownLabel = '';
  ui.showCountdown(size);
  ui.showHUD(size);
}

function finishRound(): void {
  if (!round || appState !== 'playing') return;
  appState = 'results';
  const ms = elapsedMs(round, clock);
  const avg = ms / round.size;
  const result = withBestTime(save, round.size, ms);
  save = result.save;
  if (result.improved) void platform.save(save);
  platform.sendScore(scoreForRound(round.size, ms));
  audio.chime();
  renderer.confettiBurst();
  ui.showResults({
    timeText: formatMs(ms),
    avgText: `${(avg / 1000).toFixed(2)}s average per tissue`,
    size: round.size,
    bestText: result.improved
      ? `New best: ${formatMs(save.bestMs[round.size] ?? ms)}!`
      : `Best: ${formatMs(save.bestMs[round.size] ?? ms)}`,
    newBest: result.improved,
  });
}

function goToMenu(): void {
  appState = 'menu';
  round = null;
  grabbing = false;
  renderer.resetForRound();
  renderer.startPop();
  ui.showMenu(save.bestMs);
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
  audio.setEnabled(platform.isAudioEnabled());
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
  updatePull(round, 0); // force below-threshold
  release(round, clock);
  renderer.snapBack();
}

bindPointer(renderer.domElement, {
  onDown(x, y) {
    audio.unlock();
    audio.setEnabled(platform.isAudioEnabled() && !paused);
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
      audio.rustle();
    }
  },
  onMove(x, y) {
    if (paused || !grabbing || !round) return;
    renderer.moveGrab(x, y);
    updatePull(round, grabStartY - y);
    if (Math.abs(round.pullDistance - lastRustleDist) > 16) {
      lastRustleDist = round.pullDistance;
      audio.rustle();
    }
  },
  onUp(x, y, vx, vy) {
    if (paused || !grabbing || !round) return;
    grabbing = false;
    const res = release(round, clock);
    if (res.accepted) {
      renderer.launchFlyer(x, y, vx, vy);
      audio.pop();
      audio.whoosh();
      if (res.tier !== 'none') {
        ui.streak(res.tier === 'blazing' ? 'Blazing!' : 'Speedy!', res.tier === 'blazing');
      }
      if (res.finished) {
        finishRound();
      }
    } else {
      renderer.snapBack();
      audio.snap();
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

  if (round) {
    if (appState === 'playing') {
      ui.setTimer(formatMs(elapsedMs(round, clock)));
      if (round.remaining !== lastRemaining) {
        lastRemaining = round.remaining;
        ui.setRemaining(round.remaining);
      }
    }
    renderer.update(dt, tension(round));
    const ev = renderer.pollEvents();
    if (ev.exited && round.phase === 'flying') {
      flightDone(round);
      renderer.startPop();
    }
    if (ev.popped && round.phase === 'next') {
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
    audio.setEnabled(platform.isAudioEnabled() && !paused);
    audio.click();
    startRound(size);
  },
  onReplay() {
    audio.click();
    if (round) startRound(round.size);
    else goToMenu();
  },
  onMenu() {
    audio.click();
    if (paused) {
      paused = false;
      audio.setEnabled(platform.isAudioEnabled());
      ui.setPaused(false);
    }
    goToMenu();
  },
  onResume() {
    audio.click();
    resumeGame();
  },
  onPause() {
    pauseGame();
  },
});

async function boot(): Promise<void> {
  save = normalizeSave(await platform.load(normalizeSave(undefined)));
  goToMenu();
  window.addEventListener('resize', () => renderer.resize());
  platform.bindLifecycle({ pause: pauseGame, resume: resumeGame });
  platform.onAudioEnabledChange((enabled) => {
    audio.setEnabled(enabled && !paused);
  });
  cancelAnimationFrame(rafId);
  last = performance.now();
  rafId = requestAnimationFrame(loop);
}

window.addEventListener('error', (e) => {
  platform.reportError('tissue', e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  platform.reportError('tissue', e.reason);
});

void boot();
