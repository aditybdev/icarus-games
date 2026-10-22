/**
 * Swirl! — main orchestration.
 * Game-state machine (title / orderCard / playing / toppling / between /
 * results), platform wiring, render loop, and all mode logic. Pure rules
 * (scoring, wobble, orders, save) live in ./core and are unit-tested.
 */
import { createPlatform } from '@icarus/platform';
import {
  GROW_RATE,
  MAX_HEIGHT,
  ORDER_COUNT,
  TOPPLE_WOBBLE_RATIO,
} from './core/constants';
import {
  createOrders,
  FLAVOR_COLORS,
  mulberry32,
  rateOrder,
  type Flavor,
  type Order,
} from './core/orders';
import { freeSwirlScore, heightToCm } from './core/scoring';
import { normalizeSave, withBestScore, withBestStars, type SaveData } from './core/save';
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
  input.pointerTargetX = null;
  world.swirl.reset();
  world.updateStrand(false);
  audio.stopDispense();
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
}

/* ------------------------------ mode flow ------------------------------ */

function startFree(): void {
  mode = 'free';
  resetRound();
  coneTargetX = 0;
  world.setConeX(0);
  setFlavor('vanilla');
  ui.showHUD('free');
  ui.setOrderLabel('');
  syncHud();
  state = 'playing';
}

function startRush(): void {
  mode = 'rush';
  orders = createOrders(mulberry32((Date.now() % 2147483647) >>> 0));
  orderIdx = 0;
  totalStars = 0;
  showCurrentOrderCard();
}

function showCurrentOrderCard(): void {
  const order = orders[orderIdx];
  resetRound();
  coneTargetX = 0;
  world.setConeX(0);
  ui.showHUD('rush');
  ui.setOrderLabel(`Order ${orderIdx + 1}/${ORDER_COUNT}`);
  ui.setBand(order.targetHeight / MAX_HEIGHT, order.band / MAX_HEIGHT);
  ui.showOrderCard(order, ORDER_COUNT);
  setFlavor(selectedFlavor); // keep previous selection; player may switch
  syncHud();
  state = 'orderCard';
  stateTimer = 1.7;
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
  audio.chime();
  const score = freeSwirlScore(height, wobble);
  const result = withBestScore(save, score);
  save = result.save;
  if (result.improved) void platform.save(save);
  platform.sendScore(score);
  const neat = Math.round(neatness(wobble, height) * 100);
  ui.showResults({
    title: 'Nice swirl!',
    scoreText: `${score} pts · ${heightToCm(height)} cm · ${neat}% neat`,
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
  audio.stopDispense();
  if (!toppled && height > 0.02) {
    // Round off the peak for the served swirl.
    finished = true;
    swirlDirty = true;
    rebuildSwirl(true);
  }
  if (stars >= 2) {
    audio.chime();
  } else if (stars === 1) {
    audio.starBlip(0);
  } else {
    audio.fail();
  }
  ui.toast(toppled ? `It toppled! 0 stars` : `Order served: ${'★'.repeat(stars) || '0 stars'}`);
  state = 'between';
  stateTimer = 1.5;
}

function advanceAfterOrder(): void {
  orderIdx += 1;
  if (orderIdx < ORDER_COUNT) {
    showCurrentOrderCard();
    return;
  }
  const result = withBestStars(save, totalStars);
  save = result.save;
  if (result.improved) void platform.save(save);
  platform.sendScore(totalStars);
  ui.showResults({
    title: 'Rush complete!',
    scoreText: `Total: ${totalStars} / ${ORDER_COUNT * 3} stars`,
    stars: { earned: totalStars, max: ORDER_COUNT * 3 },
    bestText: result.improved
      ? `New best: ${save.bestOrderStars}/9 stars!`
      : `Best: ${save.bestOrderStars}/9 stars`,
    newBest: result.improved,
  });
  state = 'results';
}

function startTopple(): void {
  state = 'toppling';
  dispensing = false;
  audio.stopDispense();
  audio.topple();
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
  world.setConeX(0);
  coneTargetX = 0;
  // Idle demo swirl on the title screen.
  setFlavor('vanilla');
  world.swirl.rebuild(3.0, 0, true);
  ui.showTitle(save.best, save.bestOrderStars);
}

/* ---------------------------- pause / resume ---------------------------- */

let rafId = 0;

function pauseGame(): void {
  if (paused) return;
  paused = true;
  cancelAnimationFrame(rafId);
  dispensing = false;
  audio.stopDispense();
  audio.setEnabled(false);
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
  wobble = updateWobble(wobble, offset, dt, dispensing);
  if (swirlDirty) rebuildSwirl();

  // Sway: amplitude and frequency grow with the wobble ratio.
  const ratio = wobbleRatio(wobble, height) / TOPPLE_WOBBLE_RATIO;
  const sway = Math.sin(time * (2.2 + ratio * 5)) * ratio * 0.1;
  world.swirl.group.rotation.z = sway;

  world.updateStrand(dispensing);
  syncHud();

  if (shouldTopple(wobble, height)) {
    startTopple();
    return;
  }
  if (mode === 'free' && height >= MAX_HEIGHT) {
    ui.toast('Max height!');
    finishFree();
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
    if (toppleSettled) stateTimer = 0.4;
  } else {
    stateTimer -= dt;
    if (stateTimer <= 0) {
      if (mode === 'free') {
        finished = false;
        const score = freeSwirlScore(height, wobble);
        const result = withBestScore(save, score);
        save = result.save;
        if (result.improved) void platform.save(save);
        platform.sendScore(score);
        ui.showResults({
          title: 'It toppled!',
          scoreText: `${score} pts · ${heightToCm(height)} cm`,
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
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  time += dt;
  update(dt);
  world.render(time);
  if (!readySent) {
    readySent = true;
    void platform.ready().catch(() => undefined);
  }
}

/* --------------------------------- boot --------------------------------- */

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
