/**
 * Game controller for Fold: wires the pure engine, renderer, audio, DOM UI
 * and platform adapter together.
 */

import type { Platform } from '@icarus/platform';
import {
  dailyDoneToday,
  dailyKeyUTC,
  defaultProfile,
  haptics,
  icarusScore,
  loadSharedProfile,
  recordDailyCompletion,
  recordPlay,
  saveSharedProfile,
  setHapticsEnabled,
  siblingForDay,
  type IcarusProfile,
} from '@icarus/platform';
import { AudioFx } from './audio';
import { Confetti } from './confetti';
import { dailyLevelIndex } from './daily';
import {
  Layer,
  PaperState,
  canFold,
  createPaper,
  fold,
  silhouetteMismatch,
  splitLayers,
} from './engine/engine';
import { Line, distToSegment, lineSide, pt } from './engine/geom';
import { LEVELS, Level, SolutionStep } from './levels';
import {
  FoldAnim,
  View,
  creaseArrows,
  creaseScreenSeg,
  paintDesk,
  renderScene,
  springEase,
  toPaper,
} from './renderer';
import {
  HINTS_PER_LEVEL,
  SaveData,
  continueTarget,
  currentTier,
  defaultSave,
  flawlessStreak,
  masteryFor,
  matchPercent,
  normalizeSave,
  shouldSuggestUndo,
  starsFor,
  totalStars,
} from './scoring';
import { UI } from './ui';

/** Spring flip duration; the reduced-motion path uses the shorter flat ease. */
const FOLD_ANIM_MS = 260;
const FOLD_ANIM_MS_REDUCED = 200;
/** Calm paper slide/fade-in when a level loads (skipped for reduced motion). */
const INTRO_MS = 320;

type Screen = 'title' | 'levels' | 'puzzle' | 'gallery';

interface ActiveAnim {
  line: Line;
  side: 1 | -1;
  creaseId: string;
  kept: Layer[];
  moving: Layer[];
  start: number;
}

export class Game {
  private readonly audio: AudioFx;
  private readonly ui: UI;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly confetti = new Confetti();

  private save: SaveData = defaultSave(LEVELS.length);
  private screen: Screen = 'title';
  private levelIndex = 0;
  private level: Level = LEVELS[0];
  /** True while the active puzzle is today's Daily Fold. */
  private dailyMode = false;
  private state: PaperState = createPaper(LEVELS[0].paper);
  private history: PaperState[] = [];
  private moves: SolutionStep[] = [];
  private hintsLeft = HINTS_PER_LEVEL;
  private hintsUsed = 0;
  private selectedId: string | null = null;
  private hintId: string | null = null;
  private hintSide: 1 | -1 | null = null;
  /** Ghost-panel match % (0–100) from the last silhouette evaluation. */
  private proximity: number | null = null;
  private flash: { id: string; until: number } | null = null;
  private anim: ActiveAnim | null = null;
  private paused = false;
  private pauseStarted = 0;
  private undoToastAt = -1;
  private completed = false;
  private view: View | null = null;
  private hudH = 72;
  private cssW = 1;
  private cssH = 1;
  private introStart = 0;
  /** Reduced-motion gate: OS preference until the user toggles it in settings. */
  private reducedMotion: boolean;
  private foldAnimMs: number;
  /** Cross-game profile (shared localStorage key on same-origin web). */
  private profile: IcarusProfile = defaultProfile();

  constructor(private readonly platform: Platform) {
    const canvas = document.getElementById('scene');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #scene canvas');
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.foldAnimMs = this.reducedMotion ? FOLD_ANIM_MS_REDUCED : FOLD_ANIM_MS;
    this.audio = new AudioFx(platform);
    this.ui = new UI({
      onPlay: () => this.showLevels(),
      onContinue: () => {
        const target = continueTarget(this.save);
        if (target === null) return;
        this.setPaused(false);
        this.startLevel(target);
      },
      onDaily: () => {
        this.setPaused(false);
        this.startLevel(dailyLevelIndex(), true);
      },
      onSelectLevel: (i) => {
        this.setPaused(false);
        this.startLevel(i);
      },
      onLevelsBack: () => {
        this.setPaused(false);
        this.showTitle();
      },
      onGallery: () => {
        this.setPaused(false);
        this.showGallery();
      },
      onGalleryBack: () => {
        this.setPaused(false);
        this.showTitle();
      },
      onMenu: () => {
        this.setPaused(false);
        this.showLevels();
      },
      onUndo: () => this.undo(),
      onHint: () => this.hint(),
      onReset: () => this.reset(),
      onNext: () => this.nextLevel(),
      onRetry: () => this.startLevel(this.levelIndex, this.dailyMode),
      onResume: () => this.setPaused(false),
    });
  }

  async init(): Promise<void> {
    const loaded = await this.platform.load<SaveData>(defaultSave(LEVELS.length));
    // Pass today's UTC key so a stale dailyBestStars resets on day change.
    this.save = normalizeSave(loaded, LEVELS.length, dailyKeyUTC());
    // Cross-game profile: settings fall back to the shared profile, then to
    // defaults; this session is recorded with today's mastery.
    this.profile = loadSharedProfile();
    if (this.save.sfx === undefined) this.save.sfx = this.profile.settings.sfx;
    if (this.save.haptics === undefined) this.save.haptics = this.profile.settings.haptics;
    if (this.save.reducedMotion === undefined) {
      this.save.reducedMotion = this.profile.settings.reducedMotion || this.reducedMotion;
    }
    this.audio.setSfx(this.save.sfx !== false);
    setHapticsEnabled(this.save.haptics !== false);
    this.applyReducedMotion(this.save.reducedMotion === true);
    recordPlay(this.profile, 'fold', masteryFor(this.save));
    saveSharedProfile(this.profile);
    this.bindSettings();
    this.showTitle();
    this.bindInput();
    this.bindResize();
    this.resize();
    requestAnimationFrame((t) => this.tick(t));
  }

  /** Recompute the reduced-motion gate + fold animation duration. */
  private applyReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.foldAnimMs = on ? FOLD_ANIM_MS_REDUCED : FOLD_ANIM_MS;
    document.body.classList.toggle('reduced-motion', on);
  }

  /** Mirror the current mastery into the shared profile (never lowers it). */
  private mirrorMastery(): void {
    const entry = this.profile.games.fold;
    if (!entry) return;
    entry.mastery = Math.max(entry.mastery, masteryFor(this.save));
    saveSharedProfile(this.profile);
  }

  /** Settings overlay: three toggles mirrored into the save and the profile. */
  private bindSettings(): void {
    const overlay = document.getElementById('screen-settings')!;
    const sfxBox = document.getElementById('set-sfx') as HTMLInputElement;
    const hapticsBox = document.getElementById('set-haptics') as HTMLInputElement;
    const motionBox = document.getElementById('set-motion') as HTMLInputElement;
    sfxBox.checked = this.save.sfx !== false;
    hapticsBox.checked = this.save.haptics !== false;
    motionBox.checked = this.save.reducedMotion === true;
    document.getElementById('btn-settings')!.addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      overlay.hidden = false;
    });
    document.getElementById('btn-settings-close')!.addEventListener('click', () => {
      this.audio.click();
      overlay.hidden = true;
    });
    sfxBox.addEventListener('change', () => {
      this.save.sfx = sfxBox.checked;
      this.audio.setSfx(sfxBox.checked);
      this.profile.settings.sfx = sfxBox.checked;
      saveSharedProfile(this.profile);
      void this.platform.save(this.save);
    });
    hapticsBox.addEventListener('change', () => {
      this.save.haptics = hapticsBox.checked;
      setHapticsEnabled(hapticsBox.checked);
      if (hapticsBox.checked) haptics(20);
      this.profile.settings.haptics = hapticsBox.checked;
      saveSharedProfile(this.profile);
      void this.platform.save(this.save);
    });
    motionBox.addEventListener('change', () => {
      this.save.reducedMotion = motionBox.checked;
      this.applyReducedMotion(motionBox.checked);
      this.profile.settings.reducedMotion = motionBox.checked;
      saveSharedProfile(this.profile);
      void this.platform.save(this.save);
    });
  }

  // ------------------------------------------------------------------ screens

  private showTitle(): void {
    this.screen = 'title';
    this.anim = null; // cancel any in-flight fold when leaving the puzzle
    this.confetti.clear();
    this.ui.setTotalStars(totalStars(this.save));
    const target = continueTarget(this.save);
    this.ui.setContinue(target === null ? null : `Continue — Level ${LEVELS[target].id}`);
    this.ui.setDaily(this.save.dailyStreak, dailyDoneToday(this.save, dailyKeyUTC()));
    this.ui.setScoreLine(icarusScore(this.profile));
    this.ui.showScreen('title');
  }

  private showLevels(): void {
    this.screen = 'levels';
    this.anim = null; // cancel any in-flight fold when leaving the puzzle
    this.ui.renderLevelGrid(this.save);
    this.ui.setTotalStars(totalStars(this.save));
    this.ui.showScreen('levels');
  }

  private showGallery(): void {
    this.screen = 'gallery';
    this.anim = null; // cancel any in-flight fold when leaving the puzzle
    this.ui.renderGallery(this.save);
    this.ui.showScreen('gallery');
  }

  private startLevel(index: number, daily = false): void {
    this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, index));
    this.level = LEVELS[this.levelIndex];
    this.dailyMode = daily;
    this.state = createPaper(this.level.paper);
    this.history = [];
    this.moves = [];
    this.hintsLeft = HINTS_PER_LEVEL;
    this.hintsUsed = 0;
    this.selectedId = null;
    this.hintId = null;
    this.hintSide = null;
    // Baseline proximity so the ghost panel reads truthfully from frame one.
    this.proximity = matchPercent(silhouetteMismatch(this.state, this.level.target));
    this.flash = null;
    this.anim = null;
    this.completed = false;
    this.undoToastAt = -1;
    this.introStart = performance.now(); // calm slide/fade-in on level load
    this.confetti.clear();
    this.screen = 'puzzle';
    this.ui.showScreen('puzzle');
    this.ui.showResults(false);
    this.updateHud();
  }

  private nextLevel(): void {
    if (this.levelIndex + 1 < LEVELS.length) this.startLevel(this.levelIndex + 1);
    else this.showLevels();
  }

  private updateHud(): void {
    this.ui.setHud(
      this.dailyMode ? `Daily · ${this.level.name}` : `${this.level.id} · ${this.level.name}`,
      this.hintsLeft,
      this.history.length > 0 && !this.anim,
      {
        folds: this.moves.length,
        par: this.level.solution.length,
        tier: currentTier(this.moves.length, this.level.solution.length, this.hintsUsed),
      },
    );
  }

  // ------------------------------------------------------------------- input

  private bindInput(): void {
    document.addEventListener(
      'pointerdown',
      () => {
        this.audio.unlock();
      },
      { capture: true },
    );
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.screen !== 'puzzle' || this.paused || this.anim || this.completed) return;
    // Swallow taps during the level-intro slide: the paper is drawn offset
    // while it arrives, so hit-testing would be unreliable for ~300ms.
    if (!this.reducedMotion && performance.now() - this.introStart < INTRO_MS) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const view = this.view;
    if (!view) return;

    // 1) Fold arrows of the selected crease.
    if (this.selectedId) {
      const crease = this.level.creases.find((c) => c.id === this.selectedId);
      if (crease) {
        const arrows = creaseArrows(view, { a: crease.a, b: crease.b });
        if (arrows) {
          for (const arrow of arrows) {
            if (Math.hypot(x - arrow.cx, y - arrow.cy) <= arrow.r) {
              this.tryFold(crease.id, { a: crease.a, b: crease.b }, arrow.side);
              return;
            }
          }
        }
      }
    }

    // 2) Select the nearest crease within touch range. Hit-test the same
    // screen-space segment that is drawn (clipped to the play area), so the
    // visible dashed line is exactly what is tappable.
    let best: { id: string; d: number } | null = null;
    for (const crease of this.level.creases) {
      const seg = creaseScreenSeg(view, { a: crease.a, b: crease.b });
      if (!seg) continue;
      const d = distToSegment(pt(x, y), seg[0], seg[1]);
      if (d < 22 && (!best || d < best.d)) best = { id: crease.id, d };
    }
    if (best) {
      if (this.selectedId !== best.id) {
        this.selectedId = best.id;
        this.audio.click();
      }
      return;
    }

    // 3) Tap on one side of the selected crease folds that side.
    if (this.selectedId) {
      const crease = this.level.creases.find((c) => c.id === this.selectedId);
      if (crease) {
        const p = toPaper(view, x, y);
        const side = lineSide({ a: crease.a, b: crease.b }, p);
        const len = Math.hypot(crease.b.x - crease.a.x, crease.b.y - crease.a.y);
        if (Math.abs(side) / Math.max(len, 1e-9) > 2) {
          this.tryFold(crease.id, { a: crease.a, b: crease.b }, side > 0 ? 1 : -1);
          return;
        }
      }
      this.selectedId = null;
    }
  }

  // ------------------------------------------------------------------ actions

  private tryFold(creaseId: string, line: Line, side: 1 | -1): void {
    if (this.anim || this.completed) return;
    if (!canFold(this.state, line, side)) {
      this.flash = { id: creaseId, until: performance.now() + 500 };
      this.audio.thud();
      return;
    }
    const { kept, moved } = splitLayers(this.state, line, side);
    this.anim = {
      line,
      side,
      creaseId,
      kept,
      moving: moved,
      start: performance.now(),
    };
    this.selectedId = null;
    this.hintId = null;
    this.hintSide = null;
    this.audio.swish();
    this.updateHud(); // disable Undo while the fold animation runs
  }

  private commitFold(): void {
    const anim = this.anim;
    if (!anim) return;
    this.anim = null;
    this.history.push(this.state);
    this.state = fold(this.state, anim.line, anim.side);
    this.moves.push({ creaseId: anim.creaseId, side: anim.side });
    haptics(8); // tactile tick for a committed fold
    this.updateHud();

    // Compute the precise 0–1 silhouette distance once (same cost as the old
    // boolean wrapper) and feed it to the ghost-panel proximity readout.
    const mismatch = silhouetteMismatch(this.state, this.level.target);
    this.proximity = matchPercent(mismatch);
    if (mismatch <= 0.02) {
      this.completeLevel();
      return;
    }
    if (
      shouldSuggestUndo(this.moves.length, this.level.solution.length, false) &&
      this.undoToastAt !== this.moves.length
    ) {
      this.undoToastAt = this.moves.length;
      this.ui.toast('Not matching — try Undo to step back');
      this.ui.pulseUndo();
    }
  }

  private undo(): void {
    if (this.anim || this.screen !== 'puzzle') return;
    const prev = this.history.pop();
    if (!prev) return;
    this.state = prev;
    this.moves.pop();
    this.hintId = null;
    this.hintSide = null;
    this.selectedId = null;
    this.completed = false;
    this.proximity = matchPercent(silhouetteMismatch(this.state, this.level.target));
    this.ui.showResults(false);
    this.audio.click();
    this.updateHud();
  }

  private reset(): void {
    if (this.anim || this.screen !== 'puzzle') return;
    this.state = createPaper(this.level.paper);
    this.history = [];
    this.moves = [];
    this.hintId = null;
    this.hintSide = null;
    this.selectedId = null;
    this.completed = false;
    this.proximity = matchPercent(silhouetteMismatch(this.state, this.level.target));
    this.ui.showResults(false);
    this.audio.click();
    this.updateHud();
  }

  /** True when the moves so far are a prefix of the authored solution. */
  private movesMatchPrefix(): boolean {
    const sol = this.level.solution;
    return (
      this.moves.length <= sol.length &&
      this.moves.every((m, i) => m.creaseId === sol[i].creaseId && m.side === sol[i].side)
    );
  }

  /** True when on the authored path with at least one step still ahead. */
  private onSolutionPath(): boolean {
    return this.moves.length < this.level.solution.length && this.movesMatchPrefix();
  }

  /** Auto-undo back to the last state that lies on the authored path. */
  private rewindToPath(): void {
    if (this.anim || this.screen !== 'puzzle' || this.completed) return;
    let steps = 0;
    while (!this.movesMatchPrefix() && this.history.length > 0) {
      this.state = this.history.pop() as PaperState;
      this.moves.pop();
      steps++;
    }
    if (steps === 0) return;
    this.hintId = null;
    this.hintSide = null;
    this.selectedId = null;
    this.proximity = matchPercent(silhouetteMismatch(this.state, this.level.target));
    this.audio.click();
    this.updateHud();
  }

  private hint(): void {
    if (this.anim || this.screen !== 'puzzle' || this.completed) return;
    if (this.hintsLeft <= 0) {
      this.ui.toast('No hints left for this level');
      return;
    }
    if (!this.onSolutionPath()) {
      // Off the authored path: offer a one-tap rewind to the last good state
      // instead of leaving the player at a dead end.
      this.ui.toast('Off the solution path — rewind to the last good fold?', 5200, {
        label: 'Rewind',
        onTap: () => this.rewindToPath(),
      });
      this.ui.pulseUndo();
      return;
    }
    const step = this.level.solution[this.moves.length];
    this.hintsLeft--;
    this.hintsUsed++;
    this.hintId = step.creaseId;
    this.hintSide = step.side; // the hint also shows WHICH side to fold
    this.audio.click();
    this.updateHud();
  }

  private completeLevel(): void {
    this.completed = true;
    const stars = starsFor(this.moves.length, this.level.solution.length, this.hintsUsed);
    // Capture the previous best before persisting so the results panel can
    // celebrate a genuine improvement ("New best!").
    const isNewBest = stars > (this.save.stars[this.levelIndex] ?? 0);
    this.save.stars[this.levelIndex] = Math.max(this.save.stars[this.levelIndex] ?? 0, stars);
    // Daily Fold bookkeeping: a replay keeps the streak, a new day extends it.
    // Captured BEFORE recording so the card can tell a first completion from
    // a same-day replay (which shows the "Daily best" line).
    const todayKey = dailyKeyUTC();
    const dailyReplay = this.dailyMode && dailyDoneToday(this.save, todayKey);
    if (this.dailyMode) {
      const progress = recordDailyCompletion(this.save, todayKey);
      this.save.dailyLast = progress.dailyLast;
      this.save.dailyStreak = progress.dailyStreak;
      this.save.dailyBestStars = Math.max(this.save.dailyBestStars, stars);
    }
    // A daily beyond the unlocked frontier still banks its stars above, but
    // must not skip-unlock the whole path up to it.
    if (!this.dailyMode || this.levelIndex < this.save.unlocked) {
      this.save.unlocked = Math.max(
        this.save.unlocked,
        Math.min(LEVELS.length, this.levelIndex + 2),
      );
    }
    void this.platform.save(this.save);
    this.platform.sendScore(totalStars(this.save));
    this.mirrorMastery();
    this.audio.chime(stars);
    haptics([20, 40, 20]); // gentle double-tap celebration pulse
    if (stars === 3 && !this.reducedMotion) this.confetti.burst(performance.now(), this.cssW);
    const streak = flawlessStreak(this.save.stars, this.levelIndex);
    // In daily mode only offer Next when the following level is actually
    // unlocked (the daily itself may be far ahead of the player's progress).
    const hasNext =
      this.levelIndex + 1 < LEVELS.length &&
      (!this.dailyMode || this.levelIndex + 1 < this.save.unlocked);
    const dailyStreak = this.save.dailyStreak;
    const dailyBestStars = this.save.dailyBestStars;
    const sib = siblingForDay('fold');
    window.setTimeout(() => {
      // Bail if the completion was undone/reset or another level started
      // during the 450ms delay (all of those clear `completed`).
      if (this.screen !== 'puzzle' || !this.completed) return;
      this.ui.showResults(true, {
        stars,
        folds: this.moves.length,
        par: this.level.solution.length,
        hints: this.hintsUsed,
        hasNext,
        name: this.level.name,
        isNewBest,
        nextName: hasNext ? LEVELS[this.levelIndex + 1].name : undefined,
        streak,
        dailyStreak: this.dailyMode ? dailyStreak : undefined,
        dailyBest: this.dailyMode && dailyReplay ? dailyBestStars : undefined,
        promoText: `More from Icarus: ${sib.name} — ${sib.pitch}`,
      });
    }, 450);
  }

  // -------------------------------------------------------------- pause/loop

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.audio.setPaused(paused);
    if (paused) {
      this.pauseStarted = performance.now();
      if (this.screen !== 'title') this.ui.showPause(true);
    } else {
      if (this.anim) this.anim.start += performance.now() - this.pauseStarted;
      this.ui.showPause(false);
    }
  }

  private bindResize(): void {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => this.resize());
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = window.innerWidth;
    this.cssH = window.innerHeight;
    const pxW = Math.round(this.cssW * dpr);
    const pxH = Math.round(this.cssH * dpr);
    // Skip the backing-store realloc (which also resets all canvas state)
    // when nothing actually changed — resize and orientationchange both
    // fire on rotation.
    if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
      this.canvas.width = pxW;
      this.canvas.height = pxH;
      this.canvas.style.width = `${this.cssW}px`;
      this.canvas.style.height = `${this.cssH}px`;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const hud = document.getElementById('hud');
    this.hudH = hud && !hud.hidden ? hud.getBoundingClientRect().height : 72;
  }

  private tick(now: number): void {
    requestAnimationFrame((t) => this.tick(t));
    if (this.flash && now > this.flash.until) this.flash = null;

    if (!this.paused && this.anim && this.screen === 'puzzle') {
      const raw = (now - this.anim.start) / this.foldAnimMs;
      if (raw >= 1) {
        this.commitFold();
      }
    }

    if (this.screen !== 'puzzle') {
      // Calm static backdrop behind the menus — the same desk + vignette the
      // puzzle scene sits on, so the light never jumps between screens.
      paintDesk(this.ctx, this.cssW, this.cssH);
      return;
    }

    const hud = document.getElementById('hud');
    this.hudH = hud ? hud.getBoundingClientRect().height : 72;

    let animView: FoldAnim | null = null;
    if (this.anim) {
      // While paused, freeze the animation clock at the pause instant so the
      // fold does not visually complete behind the pause overlay (resume
      // shifts `start` by the pause duration, continuing seamlessly).
      const animNow = this.paused ? this.pauseStarted : now;
      const raw = Math.min(1, (animNow - this.anim.start) / this.foldAnimMs);
      // Spring flip: anticipation + gentle overshoot/settle + paper flex.
      // Reduced motion keeps the old flat ease with no overshoot or bow.
      const eased = this.reducedMotion
        ? raw < 0.5
          ? 2 * raw * raw
          : 1 - Math.pow(-2 * raw + 2, 2) / 2
        : springEase(raw);
      animView = {
        line: this.anim.line,
        side: this.anim.side,
        kept: this.anim.kept,
        moving: this.anim.moving,
        t: eased,
        flex: !this.reducedMotion,
      };
    }

    // Level-intro slide/fade-in; instant under reduced motion.
    const intro = this.reducedMotion ? 1 : Math.min(1, (now - this.introStart) / INTRO_MS);

    this.view = renderScene(this.ctx, this.cssW, this.cssH, this.hudH, {
      state: this.state,
      level: this.level,
      selectedId: this.selectedId,
      hintId: this.hintId,
      hintSide: this.hintSide,
      proximity: this.proximity,
      intro,
      anim: animView,
      flash: this.flash,
      time: now,
    });

    // 3-star paper confetti drifts down over the scene (behind the DOM
    // results overlay). Frozen while paused, same as the fold animation.
    this.confetti.draw(this.ctx, this.paused ? this.pauseStarted : now);
  }
}
