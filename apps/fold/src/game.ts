/**
 * Game controller for Fold: wires the pure engine, renderer, audio, DOM UI
 * and platform adapter together.
 */

import type { Platform } from '@icarus/platform';
import { AudioFx } from './audio';
import {
  Layer,
  PaperState,
  canFold,
  createPaper,
  fold,
  silhouetteMatch,
  splitLayers,
} from './engine/engine';
import { Line, distToSegment, lineSide, pt } from './engine/geom';
import { LEVELS, Level, SolutionStep } from './levels';
import {
  FoldAnim,
  View,
  creaseArrows,
  creaseScreenSeg,
  renderScene,
  toPaper,
} from './renderer';
import {
  HINTS_PER_LEVEL,
  SaveData,
  defaultSave,
  normalizeSave,
  shouldSuggestUndo,
  starsFor,
  totalStars,
} from './scoring';
import { UI } from './ui';

const FOLD_ANIM_MS = 200;

type Screen = 'title' | 'levels' | 'puzzle';

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

  private save: SaveData = defaultSave(LEVELS.length);
  private screen: Screen = 'title';
  private levelIndex = 0;
  private level: Level = LEVELS[0];
  private state: PaperState = createPaper(LEVELS[0].paper);
  private history: PaperState[] = [];
  private moves: SolutionStep[] = [];
  private hintsLeft = HINTS_PER_LEVEL;
  private hintsUsed = 0;
  private selectedId: string | null = null;
  private hintId: string | null = null;
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

  constructor(private readonly platform: Platform) {
    const canvas = document.getElementById('scene');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #scene canvas');
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.audio = new AudioFx(platform);
    this.ui = new UI({
      onPlay: () => this.showLevels(),
      onSelectLevel: (i) => {
        this.setPaused(false);
        this.startLevel(i);
      },
      onLevelsBack: () => {
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
      onRetry: () => this.startLevel(this.levelIndex),
      onResume: () => this.setPaused(false),
    });
  }

  async init(): Promise<void> {
    const loaded = await this.platform.load<SaveData>(defaultSave(LEVELS.length));
    this.save = normalizeSave(loaded, LEVELS.length);
    this.ui.setTotalStars(totalStars(this.save));
    this.ui.showScreen('title');
    this.bindInput();
    this.bindResize();
    this.resize();
    requestAnimationFrame((t) => this.tick(t));
  }

  // ------------------------------------------------------------------ screens

  private showTitle(): void {
    this.screen = 'title';
    this.anim = null; // cancel any in-flight fold when leaving the puzzle
    this.ui.setTotalStars(totalStars(this.save));
    this.ui.showScreen('title');
  }

  private showLevels(): void {
    this.screen = 'levels';
    this.anim = null; // cancel any in-flight fold when leaving the puzzle
    this.ui.renderLevelGrid(this.save);
    this.ui.setTotalStars(totalStars(this.save));
    this.ui.showScreen('levels');
  }

  private startLevel(index: number): void {
    this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, index));
    this.level = LEVELS[this.levelIndex];
    this.state = createPaper(this.level.paper);
    this.history = [];
    this.moves = [];
    this.hintsLeft = HINTS_PER_LEVEL;
    this.hintsUsed = 0;
    this.selectedId = null;
    this.hintId = null;
    this.flash = null;
    this.anim = null;
    this.completed = false;
    this.undoToastAt = -1;
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
      `${this.level.id} · ${this.level.name}`,
      this.hintsLeft,
      this.history.length > 0 && !this.anim,
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
    this.updateHud();

    if (silhouetteMatch(this.state, this.level.target)) {
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
    this.selectedId = null;
    this.completed = false;
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
    this.selectedId = null;
    this.completed = false;
    this.ui.showResults(false);
    this.audio.click();
    this.updateHud();
  }

  private hint(): void {
    if (this.anim || this.screen !== 'puzzle' || this.completed) return;
    if (this.hintsLeft <= 0) {
      this.ui.toast('No hints left for this level');
      return;
    }
    const sol = this.level.solution;
    const onTrack =
      this.moves.length < sol.length &&
      this.moves.every((m, i) => m.creaseId === sol[i].creaseId && m.side === sol[i].side);
    if (!onTrack) {
      this.ui.toast('Off the solution path — Undo to get back on track');
      this.ui.pulseUndo();
      return;
    }
    this.hintsLeft--;
    this.hintsUsed++;
    this.hintId = sol[this.moves.length].creaseId;
    this.audio.click();
    this.updateHud();
  }

  private completeLevel(): void {
    this.completed = true;
    const stars = starsFor(this.moves.length, this.level.solution.length, this.hintsUsed);
    this.save.stars[this.levelIndex] = Math.max(this.save.stars[this.levelIndex] ?? 0, stars);
    this.save.unlocked = Math.max(
      this.save.unlocked,
      Math.min(LEVELS.length, this.levelIndex + 2),
    );
    void this.platform.save(this.save);
    this.platform.sendScore(totalStars(this.save));
    this.audio.chime();
    window.setTimeout(() => {
      // Bail if the completion was undone/reset or another level started
      // during the 450ms delay (all of those clear `completed`).
      if (this.screen !== 'puzzle' || !this.completed) return;
      this.ui.showResults(true, {
        stars,
        folds: this.moves.length,
        par: this.level.solution.length,
        hints: this.hintsUsed,
        hasNext: this.levelIndex + 1 < LEVELS.length,
        name: this.level.name,
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
      const raw = (now - this.anim.start) / FOLD_ANIM_MS;
      if (raw >= 1) {
        this.commitFold();
      }
    }

    if (this.screen !== 'puzzle') {
      // Calm static backdrop behind the menus.
      this.ctx.clearRect(0, 0, this.cssW, this.cssH);
      const bg = this.ctx.createLinearGradient(0, 0, 0, this.cssH);
      bg.addColorStop(0, '#f3ecdc');
      bg.addColorStop(1, '#eadfc9');
      this.ctx.fillStyle = bg;
      this.ctx.fillRect(0, 0, this.cssW, this.cssH);
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
      const raw = Math.min(1, (animNow - this.anim.start) / FOLD_ANIM_MS);
      const eased = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
      animView = {
        line: this.anim.line,
        side: this.anim.side,
        kept: this.anim.kept,
        moving: this.anim.moving,
        t: eased,
      };
    }

    this.view = renderScene(this.ctx, this.cssW, this.cssH, this.hudH, {
      state: this.state,
      level: this.level,
      selectedId: this.selectedId,
      hintId: this.hintId,
      anim: animView,
      flash: this.flash,
      time: now,
    });
  }
}
