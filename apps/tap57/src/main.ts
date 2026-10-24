/**
 * Tap the 57 — main orchestration. App flow (menu / order phases / results),
 * platform wiring, fixed-step fair-clock loop, daily mode and juice glue.
 * Pure rules (bottle rhythm, flight, orders, scoring, save) live in ./core
 * and are unit-tested with vitest.
 *
 * One order: card (1.5s, skippable) → build (rhythm taps) → aim (drag) →
 * flight (blob) → judge (1.3s beat) → next order. simT is order-local so a
 * daily seed produces identical mover/rhythm conditions for everyone.
 */
import {
  createPlatform,
  dailyKeyUTC,
  dateSeedUTC,
  defaultProfile,
  haptics,
  icarusScore,
  installErrorHooks,
  loadSharedProfile,
  mulberry32,
  osPrefersReducedMotion,
  recordPlay,
  saveSharedProfile,
  setHapticsEnabled,
  siblingForDay,
  type IcarusProfile,
} from '@icarus/platform';
import { DT, RUSH_ORDERS } from './core/constants';
import { createBottle, tap, update, type Bottle } from './core/bottle';
import { launch, step, type Blob } from './core/flight';
import {
  coverage,
  dailyOrders,
  ORDER_LABEL,
  perfectHit,
  rushOrders,
  scoreFor,
  type OrderSpec,
} from './core/orders';
import { medalFor, nextMedalPts } from './core/scoring';
import { masteryFor, normalizeSave, withBottle, withDailyCompletion, withRushResult, type SaveData } from './core/save';
import { BOTTLE_SKINS, bottleUnlocked, resolveBottle } from './core/bottles';
import { AudioSfx } from './game/audio';
import { bindPointer } from './game/input';
import { Renderer, type DrawState } from './game/renderer';
import { UI, type OrderBadges } from './ui/ui';

type AppState = 'menu' | 'play' | 'results';
type Phase = 'card' | 'build' | 'aim' | 'flight' | 'judge';
type GameMode = 'rush' | 'daily';

const platform = createPlatform('tap57');
// Error hooks must precede any fallible construction so a constructor throw
// is still reported to the host health channel.
installErrorHooks(platform, 'tap57');
const audio = new AudioSfx(platform);
const renderer = new Renderer(document.getElementById('stage') as HTMLElement);

let reducedMotion = osPrefersReducedMotion();
renderer.setReducedMotion(reducedMotion);

let save: SaveData = normalizeSave(undefined);
let profile: IcarusProfile = defaultProfile();
let appState: AppState = 'menu';
let phase: Phase = 'build';
let mode: GameMode = 'rush';
let paused = false;
let manualPaused = false;
let settingsFrom: 'menu' | 'pause' = 'menu';
let sfxOn = true;

/** Order-local sim seconds — the daily-fair clock for rhythm/movers/decay. */
let simT = 0;
let ambientT = 0;
let acc = 0;
let pauseRendered = false;

let orders: OrderSpec[] = [];
let orderIndex = 0;
let bottle: Bottle = createBottle();
let blob: Blob | null = null;
let aimAngle = Math.PI / 4;
let phaseT = 0; // seconds remaining in card/judge beats
let total = 0;
let platedCount = 0;
let splatCount = 0;
let runTaps = 0;
let feverOn = false;
let badges: OrderBadges[] = [];
let runCount = 0; // runs this session (drives first-run teaching)

function applyBottleSkin(): void {
  renderer.setSkin(BOTTLE_SKINS[resolveBottle(save)]);
}

function dailyText(): string {
  const today = dailyKeyUTC();
  if (save.dailyLast === today) {
    return `Daily done — streak ${save.dailyStreak} day${save.dailyStreak === 1 ? '' : 's'} · best ${save.dailyBest}`;
  }
  return save.dailyStreak > 0 ? `Daily streak: ${save.dailyStreak} days` : '';
}

function showMenu(): void {
  appState = 'menu';
  blob = null;
  setFever(false);
  ui.setHudVisible(false);
  const sib = siblingForDay('tap57');
  ui.showMenu(save, icarusScore(profile), dailyText(), `More from Icarus: ${sib.name} — ${sib.pitch}`);
  ui.showScreen('title');
}

function setFever(on: boolean): void {
  if (on === feverOn) return;
  feverOn = on;
  audio.setFever(on);
}

function startRun(gameMode: GameMode): void {
  mode = gameMode;
  audio.unlock();
  ui.showScreen(null);
  orders = gameMode === 'daily' ? dailyOrders(mulberry32(dateSeedUTC())) : rushOrders();
  orderIndex = 0;
  total = 0;
  platedCount = 0;
  splatCount = 0;
  runTaps = 0;
  badges = [];
  appState = 'play';
  ui.setHudVisible(true);
  ui.setScore(0);
  startOrder();
}

function startOrder(): void {
  bottle = createBottle();
  blob = null;
  aimAngle = Math.PI / 4;
  simT = 0; // daily fairness: everyone taps into the same order phase
  phase = 'card';
  phaseT = 1.5;
  setFever(false);
  const o = orders[orderIndex];
  ui.setOrderChip(`Order ${orderIndex + 1}/${orders.length} — ${ORDER_LABEL[o.kind]}`);
  ui.setHint(runCount < 1 && orderIndex === 0 ? 'Tap the 57 in rhythm!' : '');
}

function fire(): void {
  if (phase !== 'aim' || bottle.splatted) return;
  blob = launch(bottle.pressure, aimAngle);
  phase = 'flight';
  audio.squirt(bottle.pressure);
  haptics(10);
  ui.setHint('');
}

function judgeOrder(landX: number): void {
  const o = orders[orderIndex];
  const cov = coverage(landX, o, simT);
  const perf = perfectHit(landX, o, simT);
  const score = scoreFor(cov, perf);
  total += score;
  if (perf) platedCount += 1;
  runTaps += bottle.taps;
  badges.push({ label: ORDER_LABEL[o.kind], score, plated: perf, splat: false });
  ui.setScore(total);
  renderer.servedBounce();
  renderer.floatText(landX, perf ? `Plated! +${score}` : `+${score}`, 'score');
  if (perf) {
    audio.plated();
    haptics([12, 30, 12]);
  } else {
    haptics(6);
  }
  phase = 'judge';
  phaseT = 1.3;
}

function splatOrder(): void {
  splatCount += 1;
  runTaps += bottle.taps;
  badges.push({ label: ORDER_LABEL[orders[orderIndex].kind], score: 0, plated: false, splat: true });
  audio.splat();
  haptics(50);
  renderer.addShake(0.85);
  renderer.splatAt(0.35);
  renderer.floatText(0.5, `Splat at ${Math.round(bottle.pressure * 100)}% — one tap too many`, 'splat');
  setFever(false);
  phase = 'judge';
  phaseT = 1.6;
}

function nextOrder(): void {
  orderIndex += 1;
  if (orderIndex < orders.length) {
    startOrder();
  } else {
    finishRun();
  }
}

function finishRun(): void {
  runCount += 1;
  const medal = medalFor(total);
  const wasBest = save.bestRush;
  save = withRushResult(save, {
    total,
    medal,
    orders: orders.length,
    plated: platedCount,
    splats: splatCount,
    taps: runTaps,
  });

  let dailyResultText = '';
  if (mode === 'daily') {
    const before = save.dailyStreak;
    save = withDailyCompletion(save, dailyKeyUTC(), total);
    dailyResultText = `Daily total ${total} · streak ${save.dailyStreak} day${save.dailyStreak === 1 ? '' : 's'}${
      save.dailyStreak > before ? ' — new day!' : ''
    }`;
  }
  void platform.save(save);

  profile = recordPlay(profile, 'tap57', masteryFor(save));
  saveSharedProfile(profile);
  platform.sendScore(total * 10);

  const near = nextMedalPts(total);
  audio.medal(medal === 'gold' ? 3 : medal === 'silver' ? 2 : medal === 'bronze' ? 1 : 0);
  if (medal === 'gold') haptics([20, 40, 20]);

  ui.showResults({
    total,
    medal,
    nearText: near ? `${near.gap} pts from ${near.medal}` : 'Top of the diner — gold!',
    isNewBest: total > wasBest,
    bestRush: save.bestRush,
    badges,
    statsText: `${platedCount} plated · ${splatCount} splat${splatCount === 1 ? '' : 's'} · ${runTaps} taps`,
    dailyText: dailyResultText,
    promoText: '',
    replayLabel: mode === 'daily' ? 'Back to menu' : 'Rush again',
  });
  appState = 'results';
  blob = null;
  ui.setHudVisible(false);
}

function onReplay(): void {
  audio.unlock();
  if (mode === 'daily') {
    showMenu();
    return;
  }
  startRun(mode);
}

/* ------------------------------ pause/resume ------------------------------ */

/** body.paused has exactly one owner (setPaused) — the frenzy desync lesson. */
let pauseScreenShown = false;

function setPaused(on: boolean, manual: boolean): void {
  if (on === paused) return;
  paused = on;
  manualPaused = on ? manual : false;
  audio.setPaused(on);
  document.body.classList.toggle('paused', on);
  if (on) {
    // The pause overlay only makes sense mid-run; host pauses in menus just
    // freeze the clock and mute.
    pauseScreenShown = appState === 'play';
    if (pauseScreenShown) ui.showScreen('pause');
  } else {
    if (pauseScreenShown) ui.showScreen(null);
    pauseScreenShown = false;
    pauseRendered = false;
  }
}

platform.bindLifecycle({
  pause: () => setPaused(true, false),
  resume: () => setPaused(false, false),
  isManualPause: () => manualPaused,
});

/* --------------------------------- input --------------------------------- */

bindPointer(renderer.el, {
  onTap: () => {
    audio.unlock();
    if (appState !== 'play' || paused) return;
    if (phase === 'card') {
      phase = 'build'; // card is a beat, not a gate — a tap skips it
      phaseT = 0;
      return;
    }
    if (phase !== 'build') return;
    const ev = tap(bottle, simT);
    renderer.tapSquash();
    if (ev.type === 'splat') {
      splatOrder();
      return;
    }
    audio.thock(bottle.streak);
    haptics(ev.perfect ? 10 : 5);
    if (bottle.streak === 5) {
      setFever(true);
      ui.toast('Perfect rhythm — fever!');
    } else if (bottle.streak === 0) {
      setFever(false);
    }
  },
  onAimStart: () => {
    if (appState !== 'play' || paused) return;
    if (phase === 'build' && !bottle.splatted) {
      phase = 'aim';
      aimAngle = Math.PI / 4;
      if (runCount < 1) ui.setHint('Let go to squirt!');
    }
  },
  onAim: (angle) => {
    if (phase !== 'aim') return;
    aimAngle = angle;
  },
  onFire: (angle) => {
    if (appState !== 'play' || paused) return;
    aimAngle = angle;
    fire();
  },
});

/* ---------------------------------- UI ---------------------------------- */

const ui = new UI({
  onPlay: () => startRun('rush'),
  onDaily: () => startRun('daily'),
  onReplay,
  onMenu: () => {
    setPaused(false, false); // no-op unless the pause overlay is up
    showMenu();
  },
  onResume: () => setPaused(false, true),
  onPauseRestart: () => {
    setPaused(false, true);
    startRun(mode);
  },
  onPause: () => setPaused(true, true),
  onSettings: (open) => {
    if (open) {
      settingsFrom = appState === 'menu' ? 'menu' : 'pause';
      ui.syncSettings(save.sfx, save.haptics, save.reducedMotion);
      ui.showScreen('settings');
    } else {
      ui.showScreen(settingsFrom === 'pause' ? 'pause' : appState === 'menu' ? 'title' : null);
    }
  },
  onHowto: () => ui.showScreen('tutorial'),
  onTutorialDone: () => {
    save = { ...save, seenTutorial: true };
    void platform.save(save);
    ui.showScreen(appState === 'menu' ? 'title' : null);
  },
  onBottle: (index) => {
    if (!bottleUnlocked(index, save)) return;
    save = withBottle(save, index);
    void platform.save(save);
    applyBottleSkin();
    ui.showMenu(save, icarusScore(profile), dailyText(), '');
  },
  onToggleSfx: (on) => {
    save = { ...save, sfx: on };
    void platform.save(save);
    sfxOn = on;
    audio.setSfx(on);
  },
  onToggleHaptics: (on) => {
    save = { ...save, haptics: on };
    void platform.save(save);
    setHapticsEnabled(on);
  },
  onToggleMotion: (on) => {
    save = { ...save, reducedMotion: on };
    void platform.save(save);
    reducedMotion = on;
    renderer.setReducedMotion(on);
    document.body.classList.toggle('reduced-motion', on);
  },
});

// Esc closes dialogs (Playables design SHOULD; never preventDefault'd away).
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const tutorial = document.getElementById('screen-tutorial')!;
  const settings = document.getElementById('screen-settings')!;
  if (!tutorial.hidden) {
    document.getElementById('btn-tutorial-got')!.click();
  } else if (!settings.hidden) {
    document.getElementById('btn-settings-close')!.click();
  }
});

/* ------------------------------- main loop ------------------------------- */

let lastFrame = performance.now();

function frame(now: number): void {
  const realDt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  if (!paused) {
    if (appState === 'play') {
      acc += realDt;
      while (acc >= DT) {
        acc -= DT;
        simT += DT;
        if (phase === 'card' || phase === 'judge') {
          phaseT -= DT;
          if (phaseT <= 0) {
            if (phase === 'card') phase = 'build';
            else nextOrder();
            if (appState !== 'play') break;
          }
        } else if (phase === 'build' || phase === 'aim') {
          update(bottle, DT); // ketchup settles — the fine-tune lever
        } else if (phase === 'flight' && blob) {
          step(blob);
          if (blob.landed) {
            const lx = blob.landX;
            blob = null;
            judgeOrder(lx);
          }
        }
      }
    } else {
      ambientT += realDt;
    }
  }

  // Paused: draw one frozen frame behind the overlay, then stop (battery).
  if (paused && pauseRendered) {
    requestAnimationFrame(frame);
    return;
  }
  if (paused) pauseRendered = true;

  const state: DrawState = {
    order: appState === 'play' ? orders[orderIndex] : null,
    bottle: appState === 'play' ? bottle : null,
    blob,
    t: appState === 'play' ? simT : ambientT,
    phase: appState === 'play' ? phase : 'menu',
    aimAngle,
    streak: bottle.streak,
    fever: feverOn,
    orderLabel: appState === 'play' ? ORDER_LABEL[orders[orderIndex].kind] : '',
    orderIndex,
    orderCount: orders.length || RUSH_ORDERS,
  };
  renderer.draw(state);
  requestAnimationFrame(frame);
}

/* --------------------------------- boot --------------------------------- */

async function boot(): Promise<void> {
  const [loadedSave, loadedProfile] = await Promise.all([
    platform.load<unknown>(undefined),
    Promise.resolve(loadSharedProfile()),
  ]);
  save = normalizeSave(loadedSave);
  profile = loadedProfile;
  sfxOn = save.sfx;
  audio.setSfx(sfxOn);
  setHapticsEnabled(save.haptics);
  reducedMotion = save.reducedMotion || osPrefersReducedMotion();
  renderer.setReducedMotion(reducedMotion);
  document.body.classList.toggle('reduced-motion', reducedMotion);
  applyBottleSkin();
  showMenu();
  if (!save.seenTutorial) ui.showScreen('tutorial');
  void platform.ready();
  requestAnimationFrame((t) => {
    lastFrame = t;
    frame(t);
  });
}

void boot();
