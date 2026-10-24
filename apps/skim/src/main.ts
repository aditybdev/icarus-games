/**
 * Skim — main orchestration. App flow (menu / aim / flying / results),
 * platform wiring, fixed-step fair-clock loop, daily mode and juice glue.
 * Pure rules (sim, scoring, save, stones) live in ./core and are unit-tested.
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
  recordDailyCompletion,
  recordPlay,
  saveSharedProfile,
  setHapticsEnabled,
  siblingForDay,
  type IcarusProfile,
} from '@icarus/platform';
import { DAILY_THROWS, DT, THROW_MAX, THROW_MIN } from './core/constants';
import {
  clampThrow,
  createStone,
  distanceM,
  step,
  tap,
  CALM_LAKE,
  type Lake,
  type SimEvent,
  type Stone,
} from './core/sim';
import { dailyLake, formatM, medalFor, nextMedalM } from './core/scoring';
import { masteryFor, normalizeSave, withStone, withThrowResult, type SaveData } from './core/save';
import { STONE_SKINS, resolveStone, stoneUnlocked } from './core/stones';
import { AudioSfx } from './game/audio';
import { bindPointer } from './game/input';
import { Renderer } from './game/renderer';
import { UI } from './ui/ui';

type AppState = 'menu' | 'aim' | 'flying' | 'results';
type GameMode = 'play' | 'daily';

const platform = createPlatform('skim');
// Error hooks must precede any fallible construction so a constructor throw
// is still reported to the host health channel.
installErrorHooks(platform, 'skim');
const audio = new AudioSfx(platform);
const renderer = new Renderer(document.getElementById('stage') as HTMLElement);

let reducedMotion = osPrefersReducedMotion();
renderer.setReducedMotion(reducedMotion);

let save: SaveData = normalizeSave(undefined);
let profile: IcarusProfile = defaultProfile();
let appState: AppState = 'menu';
let mode: GameMode = 'play';
let paused = false;
let manualPaused = false;
let settingsFrom: 'menu' | 'pause' = 'menu';
let sfxOn = true;

/** Fair clock: advances only while unpaused, so pausing freezes the sim. */
let gameNow = 0;
/** Sim seconds since the current throw (drives waves + contact math). */
let simT = 0;
/** Ambient time for the menu/aim water (never feeds the live sim). */
let ambientT = 0;
let acc = 0;
let pauseRendered = false;

let lake: Lake = CALM_LAKE;
let stone: Stone | null = null;
let chain = 0;
let aiming: { speed01: number; angle: number } | null = null;
let throwCount = 0; // runs this session (drives first-run teaching)
let dailyThrowsLeft = 0;
let dailyTotal = 0;

/** Flick px/s → throw m/s. Tuned so a confident flick reaches THROW_MAX. */
const PX_PER_MS = 260;

function applyStoneSkin(): void {
  renderer.setSkin(STONE_SKINS[resolveStone(save)]);
}

function dailyText(): string {
  const today = dailyKeyUTC();
  if (save.dailyLast === today) {
    return `Daily done — streak ${save.dailyStreak} day${save.dailyStreak === 1 ? '' : 's'}${
      save.dailyBestM != null ? ` · best ${formatM(save.dailyBestM)}` : ''
    }`;
  }
  return save.dailyStreak > 0 ? `Daily streak: ${save.dailyStreak} days` : '';
}

function showMenu(): void {
  appState = 'menu';
  stone = null;
  aiming = null;
  ui.setHudVisible(false);
  ui.setDailyChip('');
  const sib = siblingForDay('skim');
  ui.showMenu(save, icarusScore(profile), dailyText(), `More from Icarus: ${sib.name} — ${sib.pitch}`);
  ui.showScreen('title');
  renderer.resetCamera();
}

function startRun(gameMode: GameMode): void {
  mode = gameMode;
  audio.unlock();
  ui.showScreen(null);
  if (mode === 'daily') {
    lake = dailyLake(mulberry32(dateSeedUTC()));
    dailyThrowsLeft = DAILY_THROWS;
    dailyTotal = 0;
  } else {
    lake = CALM_LAKE;
  }
  startThrow();
}

function startThrow(): void {
  appState = 'aim';
  stone = null;
  chain = 0;
  aiming = null;
  simT = 0; // daily fairness: every player throws into the same lake phase
  renderer.resetCamera();
  ui.setHudVisible(true);
  ui.setDist(0);
  ui.setChain(0);
  ui.setDailyChip(mode === 'daily' ? `Throw ${DAILY_THROWS - dailyThrowsLeft + 1}/${DAILY_THROWS}` : '');
  ui.setHint(throwCount < 2 ? 'Flick to throw!' : '');
}

function doThrow(speedPx: number, angleRad: number): void {
  if (appState !== 'aim') return;
  const speed = THROW_MIN + Math.min(1, speedPx / (PX_PER_MS * (THROW_MAX - THROW_MIN))) * (THROW_MAX - THROW_MIN);
  // Screen-right flicks dominate; clamp the angle into the skip envelope.
  const tw = clampThrow(speed, angleRad);
  stone = createStone(tw);
  aiming = null;
  appState = 'flying';
  simT = 0;
  acc = 0;
  ui.setHint('');
  audio.whoosh((tw.speed - THROW_MIN) / (THROW_MAX - THROW_MIN));
  haptics(8);
}

function onSimEvent(ev: SimEvent): void {
  if (!stone) return;
  if (ev.type === 'contact') {
    renderer.splash(ev.x, lake, simT, false);
    if (throwCount < 2) ui.setHint('Tap!');
    return;
  }
  if (ev.type === 'bounce') {
    audio.plip(stone.skips);
    ui.setHint(''); // the first successful tap ends the teaching moment
    if (ev.perfect) {
      chain += 1;
      audio.perfect(chain);
      haptics(12);
      if (chain === 5) {
        audio.setFever(true);
        renderer.setFeverVisual(true);
        ui.toast('Perfect chain — fever!');
      }
    } else {
      chain = 0;
      audio.setFever(false);
      renderer.setFeverVisual(false);
      haptics(6);
    }
    ui.setChain(chain);
    renderer.splash(stone.x, lake, simT, false);
    return;
  }
  if (ev.type === 'died') {
    audio.setFever(false);
    renderer.setFeverVisual(false);
    audio.splash();
    haptics(40);
    renderer.addShake(0.8);
    renderer.splash(stone.x, lake, simT, true);
    ui.setHint('');
    return;
  }
  if (ev.type === 'sunk') {
    finishThrow();
  }
}

function finishThrow(): void {
  if (!stone) return;
  const dist = distanceM(stone);
  const skips = stone.skips;
  const perfects = stone.perfects;
  throwCount += 1;

  const wasBest = save.bestM;
  save = withThrowResult(save, dist, skips, perfects);
  const isNewBest = dist > wasBest && wasBest > 0;

  let dailyResultText = '';
  if (mode === 'daily') {
    dailyTotal += dist;
    dailyThrowsLeft -= 1;
    if (dailyThrowsLeft <= 0) {
      const today = dailyKeyUTC();
      const prog = recordDailyCompletion(
        { dailyLast: save.dailyLast, dailyStreak: save.dailyStreak },
        today,
      );
      save = { ...save, dailyLast: prog.dailyLast, dailyStreak: prog.dailyStreak };
      if (save.dailyBestM == null || dailyTotal > save.dailyBestM) {
        save = { ...save, dailyBestM: dailyTotal };
      }
      dailyResultText = `Daily total ${formatM(dailyTotal)} · streak ${save.dailyStreak} day${
        save.dailyStreak === 1 ? '' : 's'
      }`;
    } else {
      dailyResultText = `Daily total so far: ${formatM(dailyTotal)}`;
    }
  }
  void platform.save(save);

  profile = recordPlay(profile, 'skim', masteryFor(save));
  saveSharedProfile(profile);
  platform.sendScore(dist * 10); // decimetres — leaderboard keeps one decimal

  const medal = medalFor(dist);
  const near = nextMedalM(dist);
  audio.medal(medal === 'gold' ? 3 : medal === 'silver' ? 2 : medal === 'bronze' ? 1 : 0);
  if (medal === 'gold') haptics([20, 40, 20]);

  const doneDaily = mode === 'daily' && dailyThrowsLeft <= 0;
  ui.showResults({
    distanceM: dist,
    skips,
    perfects,
    medal,
    nearText: near ? `${formatM(near.gapM)} from ${near.medal}` : 'Top of the lake — gold!',
    isNewBest: isNewBest || (wasBest === 0 && dist > 0),
    bestM: save.bestM,
    dailyText: dailyResultText,
    promoText: doneDaily ? '' : '',
  });
  appState = 'results';
  stone = null;
  ui.setHudVisible(false);
}

function onReplay(): void {
  audio.unlock();
  if (mode === 'daily' && dailyThrowsLeft <= 0) {
    showMenu();
    return;
  }
  startThrow();
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
    pauseScreenShown = appState === 'aim' || appState === 'flying';
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
  onThrow: (speed, angle) => doThrow(speed, angle),
  onTap: () => {
    audio.unlock();
    if (appState === 'flying' && stone) {
      const ev = tap(stone, simT);
      if (ev) onSimEvent(ev);
    }
  },
});

/* ---------------------------------- UI ---------------------------------- */

const ui = new UI({
  onPlay: () => startRun('play'),
  onDaily: () => startRun('daily'),
  onReplay,
  onMenu: () => {
    setPaused(false, false); // no-op unless the pause overlay is up
    showMenu();
  },
  onResume: () => setPaused(false, true),
  onPauseRestart: () => {
    setPaused(false, true);
    startThrow();
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
  onStone: (index) => {
    if (!stoneUnlocked(index, save)) return;
    save = withStone(save, index);
    void platform.save(save);
    applyStoneSkin();
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
    if (appState === 'flying' && stone) {
      acc += realDt;
      while (acc >= DT) {
        acc -= DT;
        gameNow += DT * 1000;
        simT += DT;
        const ev = step(stone, lake, simT);
        if (ev) onSimEvent(ev);
        if (!stone) break;
      }
      if (stone) {
        ui.setDist(distanceM(stone));
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

  const renderT = appState === 'flying' || appState === 'results' ? simT : ambientT;
  renderer.draw(lake, stone, renderT, appState === 'aim' ? aiming : null, chain);
  requestAnimationFrame(frame);
}

/* --------------------------------- boot --------------------------------- */

async function boot(): Promise<void> {
  const [loadedSave, loadedProfile] = await Promise.all([
    platform.load<unknown>(undefined),
    Promise.resolve(loadSharedProfile()),
  ]);
  save = normalizeSave(loadedSave, dailyKeyUTC());
  profile = loadedProfile;
  sfxOn = save.sfx;
  audio.setSfx(sfxOn);
  setHapticsEnabled(save.haptics);
  reducedMotion = save.reducedMotion || osPrefersReducedMotion();
  renderer.setReducedMotion(reducedMotion);
  applyStoneSkin();
  showMenu();
  if (!save.seenTutorial) ui.showScreen('tutorial');
  void platform.ready();
  requestAnimationFrame((t) => {
    lastFrame = t;
    frame(t);
  });
}

void boot();
