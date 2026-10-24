/**
 * Golden Mallow — main orchestration. App flow (menu / roast phases /
 * results), platform wiring, fixed-step fair-clock loop, daily mode and
 * juice glue. Pure rules (roast sim, orders, scoring, save, treats) live in
 * ./core and are unit-tested with vitest.
 *
 * One mallow: card (1.5s, skippable) → roast (drag-rotate, tap to pull) →
 * judge (1.4s beat) → next mallow. simT is mallow-local so a daily seed
 * gives everyone the same wind for the same mallow.
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
import { DT, RUSH_MALLOWS } from './core/constants';
import {
  CALM_FIRE,
  createMallow,
  gustAt,
  gustyFire,
  rotate,
  step,
  type Fire,
  type Mallow,
  type RoastEvent,
} from './core/mallow';
import { dailyOrders, rushOrders, scoreMallow, type OrderSpec } from './core/orders';
import { medalFor, nextMedalPts } from './core/scoring';
import {
  masteryFor,
  normalizeSave,
  withDailyCompletion,
  withRushResult,
  withTreat,
  type SaveData,
} from './core/save';
import { TREATS, resolveTreat, treatUnlocked } from './core/treats';
import { AudioSfx } from './game/audio';
import { bindPointer } from './game/input';
import { Renderer, type DrawState } from './game/renderer';
import { UI, type MallowBadge } from './ui/ui';

type AppState = 'menu' | 'play' | 'results';
type Phase = 'card' | 'roast' | 'judge';
type GameMode = 'rush' | 'daily';

const platform = createPlatform('mallow');
// Error hooks must precede any fallible construction so a constructor throw
// is still reported to the host health channel.
installErrorHooks(platform, 'mallow');
const audio = new AudioSfx(platform);
const renderer = new Renderer(document.getElementById('stage') as HTMLElement);

let reducedMotion = osPrefersReducedMotion();
renderer.setReducedMotion(reducedMotion);

let save: SaveData = normalizeSave(undefined);
let profile: IcarusProfile = defaultProfile();
let appState: AppState = 'menu';
let phase: Phase = 'roast';
let mode: GameMode = 'rush';
let paused = false;
let manualPaused = false;
let settingsFrom: 'menu' | 'pause' = 'menu';
let sfxOn = true;

/** Mallow-local sim seconds — the daily-fair clock for heat + wind. */
let simT = 0;
let ambientT = 0;
let acc = 0;
let pauseRendered = false;

let orders: OrderSpec[] = [];
let fires: Fire[] = [];
let orderIndex = 0;
let mallow: Mallow = createMallow();
let phaseT = 0; // seconds remaining in card/judge beats
let total = 0;
let goldenCount = 0;
let charredCount = 0;
let badges: MallowBadge[] = [];
let runCount = 0; // runs this session (drives first-run teaching)
let rotatedOnce = false;
/** Creak throttle: one soft creak per ~third of a turn of dragging. */
let creakAcc = 0;

function fire(): Fire {
  return fires[orderIndex] ?? CALM_FIRE;
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
  audio.sizzleOff();
  ui.setHudVisible(false);
  const sib = siblingForDay('mallow');
  ui.showMenu(save, icarusScore(profile), dailyText(), `More from Icarus: ${sib.name} — ${sib.pitch}`);
  ui.showScreen('title');
}

function startRun(gameMode: GameMode): void {
  mode = gameMode;
  audio.unlock();
  audio.setCrackle(true);
  ui.showScreen(null);
  orders = gameMode === 'daily' ? dailyOrders(mulberry32(dateSeedUTC())) : rushOrders();
  // One wind pattern per mallow, seeded from the date + mallow index so
  // everyone roasts the same campfire (daily fairness).
  fires = orders.map((o, i) =>
    gameMode === 'daily'
      ? gustyFire(mulberry32(dateSeedUTC() + i * 7919), o.fireScale)
      : { ...CALM_FIRE, scale: o.fireScale },
  );
  orderIndex = 0;
  total = 0;
  goldenCount = 0;
  charredCount = 0;
  badges = [];
  rotatedOnce = false;
  appState = 'play';
  ui.setHudVisible(true);
  ui.setScore(0);
  startMallow();
}

function startMallow(): void {
  mallow = createMallow();
  simT = 0; // daily fairness: everyone roasts into the same wind phase
  phase = 'card';
  phaseT = 1.5;
  const o = orders[orderIndex];
  ui.setOrderChip(`Mallow ${orderIndex + 1}/${orders.length} — ${o.label}`);
  ui.setHint(runCount < 1 && orderIndex === 0 ? 'Drag to rotate!' : '');
}

function pullMallow(): void {
  if (phase !== 'roast' || mallow.pulled) return;
  mallow.pulled = true;
  audio.sizzleOff();
  audio.pull();
  const o = orders[orderIndex];
  const res = scoreMallow(mallow, o);
  total += res.score;
  if (res.tag === 'Golden!') goldenCount += 1;
  if (res.tag === 'Burnt' || res.tag === 'On fire') charredCount += 1;
  badges.push({ score: res.score, grade: res.grade, tag: res.tag });
  ui.setScore(total);
  ui.setHint('');
  const perfect = res.tag === 'Golden!';
  renderer.floatText(0.5, 0.42, perfect ? `Golden! +${res.score}` : `+${res.score} ${res.tag}`, perfect ? 'score' : res.score < 30 ? 'fail' : 'score');
  if (perfect) {
    audio.golden();
    haptics([12, 30, 12]);
  } else if (res.tag === 'Burnt' || res.tag === 'On fire') {
    audio.burnt();
    haptics(40);
  } else {
    haptics(8);
  }
  phase = 'judge';
  phaseT = 1.4;
}

function onRoastEvent(ev: RoastEvent): void {
  if (!ev) return;
  if (ev.type === 'ignited') {
    audio.ignite();
    audio.sizzleOn();
    haptics(40);
    renderer.addShake(0.7);
    renderer.floatText(0.5, 0.42, 'On fire!', 'fail');
    ui.toast('On fire — shake it out!');
    ui.setHint('Shake! Drag back and forth!');
    return;
  }
  if (ev.type === 'extinguished') {
    audio.sizzleOff();
    audio.extinguish();
    haptics(12);
    renderer.floatText(0.5, 0.42, 'Saved!', 'score');
    ui.setHint('');
    return;
  }
  // charred: the face is lost — burnt thud, no sizzle left
  audio.sizzleOff();
  audio.burnt();
  haptics(50);
  renderer.addShake(0.5);
  renderer.floatText(0.5, 0.42, 'Charred…', 'fail');
}

function nextMallow(): void {
  orderIndex += 1;
  if (orderIndex < orders.length) {
    startMallow();
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
    mallows: orders.length,
    golden: goldenCount,
    charred: charredCount,
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

  profile = recordPlay(profile, 'mallow', masteryFor(save));
  saveSharedProfile(profile);
  platform.sendScore(total * 10);

  const near = nextMedalPts(total);
  audio.medal(medal === 'gold' ? 3 : medal === 'silver' ? 2 : medal === 'bronze' ? 1 : 0);
  if (medal === 'gold') haptics([20, 40, 20]);

  ui.showResults({
    total,
    medal,
    badges,
    isNewBest: total > wasBest,
    bestRush: save.bestRush,
    nearText: near ? `${near.gap} pts from ${near.medal}` : 'Top of the campfire — gold!',
    statsText: `${goldenCount} golden · ${charredCount} burnt`,
    dailyText: dailyResultText,
    promoText: '',
  });
  appState = 'results';
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
  onRotate: (dAngle) => {
    audio.unlock();
    if (appState !== 'play' || paused || phase !== 'roast' || mallow.pulled) return;
    rotate(mallow, dAngle);
    if (!rotatedOnce) {
      rotatedOnce = true;
      ui.setHint('Tap to pull when it looks right!');
    }
    creakAcc += Math.abs(dAngle);
    if (creakAcc > 2.1) {
      creakAcc = 0;
      audio.creak();
    }
  },
  onPull: () => {
    audio.unlock();
    if (appState !== 'play' || paused) return;
    if (phase === 'card') {
      phase = 'roast'; // card is a beat, not a gate — a tap skips it
      phaseT = 0;
      return;
    }
    pullMallow();
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
  onTreat: (index) => {
    if (!treatUnlocked(index, save)) return;
    save = withTreat(save, index);
    void platform.save(save);
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
            if (phase === 'card') phase = 'roast';
            else nextMallow();
            if (appState !== 'play') break;
          }
        } else if (phase === 'roast') {
          const ev = step(mallow, fire(), simT);
          if (ev) onRoastEvent(ev);
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

  // Avg doneness for the gauge, computed inline (no per-frame allocation).
  let avg = 0;
  if (appState === 'play' && phase !== 'card') {
    for (let i = 0; i < mallow.faces.length; i += 1) avg += mallow.faces[i];
    avg /= mallow.faces.length;
  }

  const f = fire();
  const state: DrawState = {
    mallow: appState === 'play' ? mallow : null,
    fire: f,
    order: appState === 'play' ? orders[orderIndex] : null,
    t: appState === 'play' ? simT : ambientT,
    phase: appState === 'play' ? phase : 'menu',
    avg,
    orderLabel: appState === 'play' ? orders[orderIndex].label : '',
    orderIndex,
    orderCount: orders.length || RUSH_MALLOWS,
    treat: TREATS[resolveTreat(save)],
    gustNow: gustAt(f, appState === 'play' ? simT : ambientT),
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
  showMenu();
  if (!save.seenTutorial) ui.showScreen('tutorial');
  void platform.ready();
  requestAnimationFrame((t) => {
    lastFrame = t;
    frame(t);
  });
}

void boot();
