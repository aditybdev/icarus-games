/**
 * Swirl! — main orchestration.
 * Game-state machine (title / orderCard / playing / toppling / between /
 * results), platform wiring, render loop, and all mode logic. Pure rules
 * (scoring, wobble, orders, save) live in ./core and are unit-tested.
 */
import * as THREE from 'three';
import { createPlatform } from '@icarus/platform';
import {
  BETWEEN_ORDERS_HOLD,
  BETWEEN_ORDERS_MIN,
  CENTER_DEAD_ZONE,
  GROW_RATE,
  MAX_HEIGHT,
  ORDER_CARD_TIME,
  ORDER_COUNT,
  SLOW_MO_SCALE,
  SLOW_MO_TIME,
  TOPPLE_SETTLE_HOLD,
  TOPPLE_WOBBLE_RATIO,
  TURBO_BEAT_DELAY,
} from './core/constants';
import {
  bestMarkerFrac,
  createNearMiss,
  isNewBestPace,
  TENSION_SHAKE_MAX,
  tensionLevel,
  updateNearMiss,
  type NearMissState,
} from './core/feedback';
import {
  createEndlessOrder,
  createOrders,
  FLAVOR_COLORS,
  mulberry32,
  rateOrder,
  type Flavor,
  type Order,
} from './core/orders';
import {
  createCombo,
  createTurbo,
  heightToCm,
  multiplierFor,
  totalFreeScore,
  turboGainScale,
  updateCombo,
  updateTurbo,
} from './core/scoring';
import {
  normalizeSave,
  withBestRushStars,
  withBestScore,
  type SaveData,
} from './core/save';
import { neatness, shouldTopple, updateWobble, wobbleRatio } from './core/wobble';
import { AudioSfx } from './game/audio';
import { bindInput, steerWithKeys, type InputState } from './game/input';
import { World } from './game/world';
import { UI, type Mode } from './ui/ui';

type GameState = 'title' | 'orderCard' | 'playing' | 'toppling' | 'between' | 'results';

const platform = createPlatform('swirl');
const audio = new AudioSfx();

// Register error reporters before any fallible setup (renderer creation etc.).
window.addEventListener('error', (e) => {
  platform.reportError('swirl', e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  platform.reportError('swirl', e.reason);
});

let save: SaveData = normalizeSave(undefined);
let state: GameState = 'title';
let mode: Mode = 'free';
let paused = false;
/** True when the user opened the pause overlay (vs. a host/visibility pause). */
let manualPaused = false;

// Round state.
let height = 0;
let wobble = 0;
let dispensing = false;
let coneTargetX = 0;
let swirlDirty = false;
let lastRebuild = 0;
let finished = false;

// Order Rush state.
let orders: Order[] = [];
let orderIdx = 0;
let totalStars = 0;
let selectedFlavor: Flavor = 'vanilla';
let endless = false;
let rushRng: () => number = mulberry32(1);
let lastServeStars = 0;
let lastServeToppled = false;

// Feedback state.
let nearMiss: NearMissState = createNearMiss();
let liveScore = 0;
/** Session-only flag: "New best pace!" toast fires at most once per session. */
let bestPaceToastShown = false;
/** Free Swirl height milestones already celebrated this round (fractions of MAX_HEIGHT). */
const MILESTONE_FRACS = [0.25, 0.5, 0.75] as const;
let milestonesHit = 0;
/** Rush: one-shot flash when the fill first enters the 3★ zone. */
let bandFlashFired = false;
/** Currently shown flavor-mismatch hint target (null = none). */
let flavorHint: Flavor | null = null;
/** Free Swirl combo + turbo overdrive state. */
let combo = createCombo();
let turbo = createTurbo();
let turboBeatFired = false;
let maxToastShown = false;
/** Perfect-serve slow-mo time remaining (real seconds). */
let slowMo = 0;
const REDUCED_MOTION =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const tmpTip = new THREE.Vector3();

// Timers / animation state.
let time = 0;
let stateTimer = 0;
let toppleAngle = 0;
let toppleVel = 0;
let toppleDir = 1;
let toppleSettled = false;

const REBUILD_INTERVAL = 0.09; // rebuild tube at most ~11x/sec while growing

const world = new World(document.getElementById('stage') as HTMLElement);

const input: InputState = bindInput(
  world.renderer.domElement,
  (x, y) => world.pointerToWorldX(x, y),
  () => {
    audio.unlock();
    audio.setEnabled(platform.isAudioEnabled() && !paused);
  },
);

/* ------------------------------- helpers ------------------------------- */

/** Guarded haptics — a no-op on iOS/desktop, free juice on Android. */
function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

function currentLean(): number {
  return wobble * (wobbleRatio(wobble, height) / TOPPLE_WOBBLE_RATIO) * 0.9;
}

function rebuildSwirl(force = false): void {
  if (!swirlDirty && !force) return;
  const now = time;
  if (!force && now - lastRebuild < REBUILD_INTERVAL) return;
  lastRebuild = now;
  swirlDirty = false;
  if (height <= 0.02) return;
  world.swirl.rebuild(height, currentLean(), finished);
}

function resetRound(): void {
  height = 0;
  wobble = 0;
  dispensing = false;
  finished = false;
  swirlDirty = false;
  toppleAngle = 0;
  toppleVel = 0;
  toppleSettled = false;
  liveScore = 0;
  milestonesHit = 0;
  combo = createCombo();
  turbo = createTurbo();
  turboBeatFired = false;
  maxToastShown = false;
  nearMiss = createNearMiss();
  input.pointerTargetX = null;
  world.swirl.reset();
  world.updateStrand(false);
  world.setShake(0);
  audio.stopDispense();
  audio.setTension(0);
}

/** Slow-mo + sprinkle burst + camera orbit on a perfect serve / new best. */
function spectacle(palette: number[]): void {
  if (REDUCED_MOTION) return;
  slowMo = SLOW_MO_TIME;
  world.sprinkles.burst(world.swirlTipWorld(tmpTip), palette);
}

function setFlavor(flavor: Flavor): void {
  selectedFlavor = flavor;
  world.swirl.setFlavor(flavor);
  world.dispenser.setLampColor(FLAVOR_COLORS[flavor]);
  ui.setFlavor(flavor);
}

function syncHud(): void {
  ui.setHeight(height);
  ui.setHeightFill(height / MAX_HEIGHT);
  ui.setWobble(wobbleRatio(wobble, height) / TOPPLE_WOBBLE_RATIO);
  if (mode === 'free') {
    ui.setScore(liveScore);
    ui.setCombo(multiplierFor(combo));
    ui.setTurboMeter(height >= MAX_HEIGHT);
  }
  // Flavor-mismatch fairness: pulse the button the current order needs.
  const order =
    mode === 'rush' && (state === 'playing' || state === 'orderCard')
      ? orders[orderIdx]
      : undefined;
  const hintTarget = order && selectedFlavor !== order.flavor ? order.flavor : null;
  if (hintTarget !== flavorHint) {
    flavorHint = hintTarget;
    ui.setFlavorHint(hintTarget);
  }
}

/* ------------------------------ mode flow ------------------------------ */

function startFree(): void {
  mode = 'free';
  resetRound();
  slowMo = 0;
  world.setSpectacle(null);
  coneTargetX = 0;
  world.setConeX(0);
  setFlavor('vanilla');
  ui.showHUD('free');
  ui.setOrderLabel('');
  ui.setBestMarker(bestMarkerFrac(save.best));
  syncHud();
  state = 'playing';
}

function startRush(): void {
  mode = 'rush';
  slowMo = 0;
  world.setSpectacle(null);
  rushRng = mulberry32((Date.now() % 2147483647) >>> 0);
  orders = createOrders(rushRng);
  endless = false;
  orderIdx = 0;
  totalStars = 0;
  showCurrentOrderCard();
}

function showCurrentOrderCard(): void {
  const order = orders[orderIdx];
  resetRound();
  bandFlashFired = false;
  coneTargetX = 0;
  world.setConeX(0);
  ui.showHUD('rush');
  ui.setOrderLabel(endless ? `Order ${orderIdx + 1}` : `Order ${orderIdx + 1}/${ORDER_COUNT}`);
  ui.setBand(order.targetHeight / MAX_HEIGHT, order.band / MAX_HEIGHT);
  ui.showOrderCard(order, endless ? null : ORDER_COUNT);
  setFlavor(selectedFlavor); // keep previous selection; player may switch
  ui.setBestMarker(null); // Rush meter shows the target band instead
  state = 'orderCard';
  stateTimer = ORDER_CARD_TIME;
  syncHud();
}

function beginOrder(): void {
  ui.hideOrderCard();
  state = 'playing';
}

function finishFree(): void {
  finished = true;
  swirlDirty = true;
  rebuildSwirl(true);
  audio.stopDispense();
  audio.setTension(0);
  world.setShake(0);
  audio.chime();
  const score = totalFreeScore(height, wobble, combo, turbo);
  const result = withBestScore(save, score);
  save = result.save;
  if (result.improved) {
    void platform.save(save);
    spectacle([0xffb630, 0xff8fb2, 0x8fe3bd, 0xffffff]);
  }
  platform.sendScore(score);
  const neat = Math.round(neatness(wobble, height) * 100);
  ui.showResults({
    title: 'Nice swirl!',
    scoreText: `${score} pts · ${heightToCm(height)} cm · ${neat}% neat`,
    countUp: { to: score, suffix: ` pts · ${heightToCm(height)} cm · ${neat}% neat` },
    stars: null,
    bestText: result.improved ? `New best: ${save.best} pts!` : `Best: ${save.best} pts`,
    newBest: result.improved,
  });
  state = 'results';
}

function serveOrder(toppled: boolean): void {
  const order = orders[orderIdx];
  const stars = toppled ? 0 : rateOrder(order, height, selectedFlavor);
  totalStars += stars;
  lastServeStars = stars;
  lastServeToppled = toppled;
  audio.stopDispense();
  audio.setTension(0);
  world.setShake(0);
  if (!toppled && height > 0.02) {
    // Round off the peak for the served swirl.
    finished = true;
    swirlDirty = true;
    rebuildSwirl(true);
  }
  if (stars === 3) {
    audio.chime();
    spectacle([FLAVOR_COLORS[order.flavor], 0xffffff, 0xffb630]);
  } else if (stars >= 2) {
    audio.chime();
  } else if (stars === 1) {
    audio.starBlip(0);
  } else {
    audio.fail();
  }
  ui.toast(toppled ? `It toppled! 0 stars` : `Order served: ${'★'.repeat(stars) || '0 stars'}`);
  state = 'between';
  stateTimer = BETWEEN_ORDERS_HOLD;
}

function advanceAfterOrder(): void {
  orderIdx += 1;
  if (orderIdx < orders.length) {
    showCurrentOrderCard();
    return;
  }
  const result = withBestRushStars(save, totalStars);
  save = result.save;
  if (result.improved) void platform.save(save);
  platform.sendScore(totalStars);
  ui.showResults({
    title: lastServeToppled
      ? 'It toppled!'
      : endless
        ? `Order ${orderIdx} served!`
        : 'Rush complete!',
    scoreText: `Total: ${totalStars} stars`,
    stars: { earned: lastServeStars, max: 3 },
    bestText: result.improved
      ? `New best: ${save.bestRushStars} stars!`
      : `Best: ${save.bestRushStars} stars`,
    newBest: result.improved,
    continueRush: !lastServeToppled,
  });
  state = 'results';
}

function continueRush(): void {
  endless = true;
  orders.push(createEndlessOrder(rushRng, orderIdx));
  showCurrentOrderCard();
}

function startTopple(): void {
  state = 'toppling';
  dispensing = false;
  audio.stopDispense();
  audio.setTension(0);
  world.setShake(0);
  audio.topple();
  vibrate([40, 40, 90]);
  world.updateStrand(false);
  const lean = currentLean();
  toppleDir = lean >= 0 ? -1 : 1;
  if (Math.abs(lean) < 0.01) toppleDir = Math.random() < 0.5 ? -1 : 1;
  toppleAngle = 0;
  toppleVel = 0.4;
  toppleSettled = false;
}

function goToTitle(): void {
  state = 'title';
  resetRound();
  slowMo = 0;
  world.setSpectacle(null);
  world.setConeX(0);
  coneTargetX = 0;
  // Idle demo swirl on the title screen.
  setFlavor('vanilla');
  world.swirl.rebuild(3.0, 0, true);
  ui.showTitle(save.best, save.bestRushStars);
}

/* ---------------------------- pause / resume ---------------------------- */

let rafId = 0;

function pauseGame(): void {
  if (paused) return;
  paused = true;
  cancelAnimationFrame(rafId);
  dispensing = false;
  audio.stopDispense();
  audio.setTension(0);
  audio.setEnabled(false);
  world.setShake(0);
  ui.setPaused(true);
}

function resumeGame(): void {
  if (!paused) return;
  paused = false;
  audio.setEnabled(platform.isAudioEnabled());
  ui.setPaused(false);
  last = performance.now();
  rafId = requestAnimationFrame(loop);
}

/* -------------------------------- update -------------------------------- */

function updatePlaying(dt: number): void {
  const wantsDispense = input.dispensing && height < MAX_HEIGHT;
  if (wantsDispense && !dispensing) {
    audio.unlock();
    audio.startDispense();
  } else if (!wantsDispense && dispensing) {
    audio.stopDispense();
    swirlDirty = true;
    rebuildSwirl(true); // settle final shape on release
  }
  dispensing = wantsDispense;

  const offset = world.coneX; // nozzle is fixed at x = 0
  if (dispensing) {
    height = Math.min(MAX_HEIGHT, height + GROW_RATE * dt);
    swirlDirty = true;
  }
  // Combo streak: time dispensing inside the dead zone builds the multiplier.
  combo = updateCombo(combo, dt, dispensing && Math.abs(offset) <= CENTER_DEAD_ZONE);
  // Turbo overdrive past max height: bonus accrues while dispensing, and the
  // wobble gain ramps the longer the player holds (risk/reward).
  const isTurbo = mode === 'free' && height >= MAX_HEIGHT;
  if (isTurbo) {
    if (!maxToastShown) {
      maxToastShown = true;
      ui.toast('Max height!');
    }
    turbo = updateTurbo(turbo, dt, dispensing, neatness(wobble, height));
    if (!turboBeatFired && turbo.time >= TURBO_BEAT_DELAY) {
      turboBeatFired = true;
      ui.toast('TURBO!');
      audio.starBlip(2);
      vibrate(25);
    }
  }
  wobble = updateWobble(wobble, offset, dt, dispensing, isTurbo ? turboGainScale(turbo) : 1);
  if (swirlDirty) rebuildSwirl();

  // Sway: amplitude and frequency grow with the wobble ratio.
  const ratio = wobbleRatio(wobble, height) / TOPPLE_WOBBLE_RATIO;
  const sway = Math.sin(time * (2.2 + ratio * 5)) * ratio * 0.1;
  world.swirl.group.rotation.z = sway;

  // Near-topple tension: rising audio riser + camera micro-shake, and a
  // "Saved it!" celebration when the ratio recovers from near-miss to safe.
  const tension = tensionLevel(ratio);
  audio.setTension(tension);
  world.setShake(tension * TENSION_SHAKE_MAX);
  if (updateNearMiss(nearMiss, ratio, height) === 'saved') {
    ui.toast('Saved it!');
    audio.starBlip(2);
  }

  // Free Swirl live score + one-time "New best pace!" celebration.
  if (mode === 'free') {
    liveScore = totalFreeScore(height, wobble, combo, turbo);
    if (!bestPaceToastShown && isNewBestPace(liveScore, save.best)) {
      bestPaceToastShown = true;
      ui.toast('New best pace!');
      audio.starBlip(1);
    }
    // Height milestones: toast + blip + haptic at 25/50/75% of max.
    if (milestonesHit < MILESTONE_FRACS.length && height >= MAX_HEIGHT * MILESTONE_FRACS[milestonesHit]) {
      const cm = heightToCm(MAX_HEIGHT * MILESTONE_FRACS[milestonesHit]);
      milestonesHit += 1;
      ui.toast(`${cm} cm!`);
      audio.starBlip(0);
      vibrate(25);
    }
  }

  // Rush: one-time band flash when the fill enters the 3★ zone.
  if (mode === 'rush' && !bandFlashFired) {
    const order = orders[orderIdx];
    if (order && Math.abs(height - order.targetHeight) <= order.band / 2) {
      bandFlashFired = true;
      ui.flashBand();
      audio.starBlip(0);
    }
  }

  world.updateStrand(dispensing);
  syncHud();

  if (shouldTopple(wobble, height)) {
    startTopple();
    return;
  }
}

function updateToppling(dt: number): void {
  if (!toppleSettled) {
    toppleVel += 7.5 * dt;
    toppleAngle += toppleVel * dt;
    const maxAngle = 1.7;
    if (toppleAngle >= maxAngle) {
      toppleAngle = maxAngle;
      toppleVel = -toppleVel * 0.22;
      if (Math.abs(toppleVel) < 0.6) toppleSettled = true;
    }
    world.swirl.group.rotation.z = toppleDir * toppleAngle;
    if (toppleSettled) stateTimer = TOPPLE_SETTLE_HOLD;
  } else {
    stateTimer -= dt;
    if (stateTimer <= 0) {
      if (mode === 'free') {
        finished = false;
        const score = totalFreeScore(height, wobble, combo, turbo);
        const result = withBestScore(save, score);
        save = result.save;
        if (result.improved) {
          void platform.save(save);
          spectacle([0xffb630, 0xff8fb2, 0x8fe3bd, 0xffffff]);
        }
        platform.sendScore(score);
        ui.showResults({
          title: 'It toppled!',
          scoreText: `${score} pts · ${heightToCm(height)} cm`,
          countUp: { to: score, suffix: ` pts · ${heightToCm(height)} cm` },
          stars: null,
          bestText: result.improved ? `New best: ${save.best} pts!` : `Best: ${save.best} pts`,
          newBest: result.improved,
        });
        state = 'results';
      } else {
        serveOrder(true);
      }
    }
  }
}

function update(dt: number): void {
  // Cone steering (shared by all play states).
  if (state === 'playing' || state === 'orderCard') {
    if (input.pointerTargetX !== null) coneTargetX = input.pointerTargetX;
    coneTargetX = steerWithKeys(coneTargetX, input.keys, dt);
    const next = world.coneX + (coneTargetX - world.coneX) * Math.min(1, dt * 10);
    world.setConeX(next);
  }

  switch (state) {
    case 'title':
      world.swirl.group.rotation.y += dt * 0.5;
      world.setConeX(Math.sin(time * 0.55) * 1.1);
      break;
    case 'orderCard':
      stateTimer -= dt;
      if (stateTimer <= 0) beginOrder();
      break;
    case 'playing':
      updatePlaying(dt);
      break;
    case 'toppling':
      updateToppling(dt);
      break;
    case 'between':
      // Let the served swirl gently settle, then move on.
      world.swirl.group.rotation.z *= Math.max(0, 1 - dt * 4);
      stateTimer -= dt;
      if (stateTimer <= 0) advanceAfterOrder();
      break;
    case 'results':
      break;
  }
}

/* --------------------------------- loop --------------------------------- */

let last = performance.now();
let readySent = false;

function loop(now: number): void {
  rafId = requestAnimationFrame(loop);
  const rawDt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  let dt = rawDt;
  if (slowMo > 0) {
    slowMo = Math.max(0, slowMo - rawDt);
    dt = rawDt * SLOW_MO_SCALE;
    world.setSpectacle(1 - slowMo / SLOW_MO_TIME);
    if (slowMo === 0) world.setSpectacle(null);
  }
  time += dt;
  update(dt);
  world.render(time, dt);
  if (!readySent) {
    readySent = true;
    void platform.ready().catch(() => undefined);
  }
}

/* --------------------------------- boot --------------------------------- */

// Tap-to-skip fast paths: order-intro card, topple settle, inter-order beat.
// Ignores taps on real buttons (they keep their own behavior) and while
// paused (the pause overlay owns input then).
window.addEventListener('pointerdown', (e) => {
  if (paused) return;
  if ((e.target as HTMLElement | null)?.closest?.('button')) return;
  if (state === 'orderCard') {
    audio.unlock();
    beginOrder();
  } else if (state === 'toppling' && toppleSettled) {
    stateTimer = 0;
  } else if (state === 'between' && stateTimer <= BETWEEN_ORDERS_HOLD - BETWEEN_ORDERS_MIN) {
    stateTimer = 0;
  }
});

const ui = new UI({
  onMode(m) {
    audio.unlock();
    audio.setEnabled(platform.isAudioEnabled() && !paused);
    audio.click();
    // Leaving the pause overlay via any path must restart the render loop.
    manualPaused = false;
    resumeGame();
    if (m === 'free') startFree();
    else startRush();
  },
  onDone() {
    audio.click();
    if (state !== 'playing') return;
    if (mode === 'free') finishFree();
    else serveOrder(false);
  },
  onReplay() {
    audio.click();
    manualPaused = false;
    resumeGame();
    if (mode === 'free') startFree();
    else startRush();
  },
  onMenu() {
    audio.click();
    manualPaused = false;
    resumeGame();
    goToTitle();
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
  onFlavor(flavor) {
    audio.click();
    setFlavor(flavor);
  },
  onStarReveal(index) {
    audio.starBlip(index);
    vibrate(15);
  },
  onContinueRush() {
    audio.click();
    continueRush();
  },
});

async function boot(): Promise<void> {
  save = normalizeSave(await platform.load(normalizeSave(undefined)));
  goToTitle();
  window.addEventListener('resize', () => world.resize());
  platform.bindLifecycle({
    pause: pauseGame,
    resume: () => {
      // A host/visibility resume must not dismiss a pause the user chose.
      if (!manualPaused) resumeGame();
    },
  });
  platform.onAudioEnabledChange((enabled) => {
    audio.setEnabled(enabled && !paused);
  });
  rafId = requestAnimationFrame(loop);
}

void boot();
