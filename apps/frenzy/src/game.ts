/**
 * Four-Leg Frenzy — game controller: screens, HUD, fixed-timestep loop,
 * camera, save data, and host-platform integration.
 */
import type { Platform } from '@icarus/platform';
import { AudioFx } from './audio';
import { LegInput } from './input';
import { Renderer } from './render/renderer';
import { stepSim } from './sim/sim';
import {
  DT,
  FALL_PENALTY_MS,
  RACE_LIMIT_MS,
  TRACK_LENGTH,
  createSim,
  type GameMode,
  type SimInput,
  type SimState,
} from './sim/types';
import {
  RANK_THRESHOLDS_MS,
  effectiveTimeMs,
  formatMetres,
  formatSeconds,
  paceBarPct,
  pbPaceX,
  projectedRank,
  rankBeats,
  rankFor,
  scoreFor,
  type Rank,
} from './sim/rules';

interface SaveData {
  v: 1;
  bestTimeMs: number | null;
  bestRank: string | null;
  reducedMotion?: boolean;
  sfx?: boolean;
}

type UiState = 'title' | 'countdown' | 'playing' | 'paused' | 'results';

/** Countdown beat length (s); full = 3·2·1·GO, quick restart = GO only. */
const COUNT_STEP_S = 0.7;
const COUNT_FULL_S = COUNT_STEP_S * 4;

/** "FINAL STRETCH!" toast fires once per race past this distance (m). */
const FINAL_STRETCH_M = 40;

const DEFAULT_SAVE: SaveData = { v: 1, bestTimeMs: null, bestRank: null };

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

export class Game {
  private renderer: Renderer;
  private input = new LegInput();
  private audio: AudioFx;
  private sim: SimState = createSim('training', 3);
  private ui: UiState = 'title';
  private save: SaveData = { ...DEFAULT_SAVE };
  private camX = 0;
  private shake = 0;
  private acc = 0;
  private lastT = 0;
  private rafId = 0;
  private seedCounter = 7;
  private countdownT = 0;
  private countdownTotal = 0;
  private countdownIdx = -1;
  private finalStretchShown = false;
  private penaltyChipT = 0;
  private toastT = 0;

  constructor(private platform: Platform) {
    const canvas = $('scene') as HTMLCanvasElement;
    this.renderer = new Renderer(canvas);
    this.audio = new AudioFx(platform);
    this.input.onFirstGesture = () => this.audio.unlock();
    this.input.onMetaKey = (key) => this.onMetaKey(key);
  }

  async init(): Promise<void> {
    this.save = await this.platform.load<SaveData>({ ...DEFAULT_SAVE });
    if (this.save.v !== 1) this.save = { ...DEFAULT_SAVE };
    // Sanitize persisted fields: a corrupt bestTimeMs (wrong type / non-finite)
    // would make `eff < bestTimeMs` permanently false and block all future
    // best-time saves.
    if (typeof this.save.bestTimeMs !== 'number' || !Number.isFinite(this.save.bestTimeMs) || this.save.bestTimeMs <= 0) {
      this.save.bestTimeMs = null;
    }
    if (this.save.bestRank !== null && typeof this.save.bestRank !== 'string') {
      this.save.bestRank = null;
    }

    this.input.attach();
    window.addEventListener('resize', () => this.renderer.resize());
    this.bindButtons();
    this.applySettingsToUi();
    this.updateBestLine();
    this.showTitle();

    this.lastT = performance.now();
    const loop = (t: number): void => {
      this.rafId = requestAnimationFrame(loop);
      this.frame(t);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------ ui wiring

  private bindButtons(): void {
    const click = (id: string, fn: () => void): void => {
      $(id).addEventListener('click', () => {
        this.audio.unlock();
        this.audio.click();
        fn();
      });
    };
    click('btn-race', () => this.startRun('race'));
    click('btn-train', () => this.startRun('training'));
    click('btn-retry', () => this.startRun(this.sim.mode, true));
    click('btn-results-menu', () => this.showTitle());
    click('btn-pause', () => this.setPaused(true));
    click('btn-resume', () => this.setPaused(false));
    click('btn-pause-restart', () => this.startRun(this.sim.mode, true));
    click('btn-pause-menu', () => this.showTitle());
    click('btn-settings', () => this.openSettings());
    click('btn-pause-settings', () => this.openSettings());
    click('btn-settings-close', () => this.closeSettings());

    $('set-motion').addEventListener('change', (e) => {
      this.save.reducedMotion = (e.target as HTMLInputElement).checked;
      void this.platform.save(this.save);
    });
    $('set-sfx').addEventListener('change', (e) => {
      this.save.sfx = (e.target as HTMLInputElement).checked;
      this.audio.setSfx(this.save.sfx !== false);
      void this.platform.save(this.save);
    });
  }

  private applySettingsToUi(): void {
    ($('set-motion') as HTMLInputElement).checked = this.save.reducedMotion === true;
    ($('set-sfx') as HTMLInputElement).checked = this.save.sfx !== false;
    this.audio.setSfx(this.save.sfx !== false);
  }

  private openSettings(): void {
    $('screen-settings').classList.remove('hidden');
    // The gear sits at z-index 40, above the settings overlay (35) — hide it
    // while the overlay is open.
    $('btn-settings').classList.add('hidden');
  }

  private closeSettings(): void {
    $('screen-settings').classList.add('hidden');
    $('btn-settings').classList.toggle('hidden', this.ui !== 'title');
  }

  private updateBestLine(): void {
    const el = $('best-line');
    if (this.save.bestTimeMs != null) {
      el.textContent = `Best: ${formatSeconds(this.save.bestTimeMs)} — Rank ${this.save.bestRank ?? '-'}`;
    } else {
      el.textContent = 'No races yet — the pasture awaits!';
    }
  }

  // ------------------------------------------------------------- screens

  private setScreen(name: UiState): void {
    this.ui = name;
    $('screen-title').classList.toggle('hidden', name !== 'title');
    $('btn-settings').classList.toggle('hidden', name !== 'title');
    $('screen-results').classList.toggle('hidden', name !== 'results');
    $('screen-pause').classList.toggle('hidden', name !== 'paused');
    $('countdown').classList.toggle('hidden', name !== 'countdown');
    $('hud').classList.toggle('hidden', name === 'title' || name === 'results');
    $('legpad').classList.toggle('hidden', name === 'title' || name === 'results');
    if (name !== 'paused') this.closeSettings();
  }

  private showTitle(): void {
    // idle attract-mode creature standing near the start
    this.sim = createSim('training', 3);
    this.sim.body.x = 1.6;
    for (let i = 0; i < 4; i++) this.sim.legs[i].plantX = this.sim.body.x + [0.34, 0.3, -0.3, -0.34][i];
    this.camX = 0;
    this.input.releaseAll();
    this.audio.setPaused(false);
    this.updateBestLine();
    this.setScreen('title');
  }

  private startRun(mode: GameMode, quick = false): void {
    this.seedCounter = (this.seedCounter * 1103515245 + 12345) & 0x7fffffff;
    this.sim = createSim(mode, this.seedCounter || 1);
    this.camX = 0;
    this.shake = 0;
    this.acc = 0;
    this.finalStretchShown = false;
    this.hideChips();
    this.input.releaseAll();
    this.audio.setPaused(false);
    this.updateHud();
    this.beginCountdown(quick);
  }

  /**
   * UI-side countdown before sim stepping begins — the sim only ever steps in
   * `playing`, so determinism is untouched. Fresh runs from the title get the
   * full 3-2-1-GO; instant restarts get a short "GO!" flash so the retry loop
   * stays friction-free.
   */
  private beginCountdown(quick: boolean): void {
    this.countdownTotal = quick ? COUNT_STEP_S : COUNT_FULL_S;
    this.countdownT = this.countdownTotal;
    this.countdownIdx = -1;
    this.setScreen('countdown');
  }

  private onMetaKey(key: 'r' | 'enter'): void {
    if (key === 'r') {
      if (this.ui === 'playing' || this.ui === 'paused' || this.ui === 'results') {
        this.audio.click();
        this.startRun(this.sim.mode, true);
      }
    } else if (this.ui === 'results') {
      this.audio.click();
      this.startRun(this.sim.mode, true);
    }
  }

  setPaused(paused: boolean): void {
    if (paused && this.ui !== 'playing') return;
    if (!paused && this.ui !== 'paused') return;
    this.audio.setPaused(paused);
    this.input.releaseAll();
    this.setScreen(paused ? 'paused' : 'playing');
    this.lastT = performance.now();
    this.acc = 0;
  }

  resume(): void {
    this.setPaused(false);
  }

  pause(): void {
    this.setPaused(true);
  }

  // --------------------------------------------------------------- loop

  private frame(t: number): void {
    const frameDt = Math.min(0.25, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;

    if (this.ui === 'countdown') {
      this.countdownT -= frameDt;
      const idx =
        this.countdownTotal <= COUNT_STEP_S
          ? 3
          : Math.min(3, Math.floor((this.countdownTotal - this.countdownT) / COUNT_STEP_S));
      if (idx !== this.countdownIdx) {
        this.countdownIdx = idx;
        $('countdown').textContent = idx >= 3 ? 'GO!' : String(3 - idx);
        this.audio.countBlip(idx >= 3, idx);
      }
      if (this.countdownT <= 0) {
        this.setScreen('playing');
        this.acc = 0;
      }
    }

    const active = this.ui === 'playing';
    if (active) {
      this.acc += frameDt;
      const input: SimInput = { held: [...this.input.held] as [boolean, boolean, boolean, boolean] };
      while (this.acc >= DT) {
        stepSim(this.sim, input, DT);
        this.acc -= DT;
        this.drainEvents(t);
        if (this.sim.finished || this.sim.timedOut) {
          this.showResults();
          break;
        }
      }
    }

    // camera follows with a lookahead by speed
    const target = this.sim.body.x + this.sim.body.v * 0.25;
    if (this.save.reducedMotion === true) {
      this.camX = target;
    } else {
      const k = Math.min(1, frameDt * 6);
      this.camX += (target - this.camX) * k;
    }
    this.shake = Math.max(0, this.shake - frameDt * 2.2);

    if (active) this.updateHud();
    const pb = this.save.bestTimeMs;
    this.renderer.draw(this.sim, {
      camX: this.camX,
      nowMs: t,
      shake: this.shake,
      reducedMotion: this.save.reducedMotion === true,
      pbFlagX:
        this.sim.mode === 'race' && pb != null
          ? pbPaceX(effectiveTimeMs(this.sim.timeMs, this.sim.penaltyMs), pb)
          : null,
    });
  }

  /** Haptics: touch devices only (body.touch is set by input.ts). */
  private vibrate(pattern: number | number[]): void {
    if (!document.body.classList.contains('touch')) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* vibration unsupported / blocked */
    }
  }

  /**
   * Fade a chip in, hold, then fade out (opacity transitions only — safe for
   * reduced motion; no flashing). Retriggering restarts the hold.
   */
  private flashChip(el: HTMLElement, text: string, holdMs: number, timerKey: 'penaltyChipT' | 'toastT'): void {
    window.clearTimeout(this[timerKey]);
    el.textContent = text;
    el.classList.remove('hidden', 'show');
    void el.offsetWidth; // restart the fade even on rapid retrigger
    el.classList.add('show');
    this[timerKey] = window.setTimeout(() => {
      el.classList.remove('show');
      this[timerKey] = window.setTimeout(() => el.classList.add('hidden'), 260);
    }, holdMs);
  }

  private hideChips(): void {
    window.clearTimeout(this.penaltyChipT);
    window.clearTimeout(this.toastT);
    $('penalty-chip').classList.remove('show');
    $('penalty-chip').classList.add('hidden');
    $('toast').classList.remove('show');
    $('toast').classList.add('hidden');
  }

  private drainEvents(nowMs: number): void {
    for (const ev of this.sim.events) {
      switch (ev.type) {
        case 'plant':
          this.audio.thud(ev.leg, ev.strength);
          this.renderer.addPuff(this.sim.legs[ev.leg].plantX, ev.strength > 0.35, nowMs);
          if (ev.strength > 0.35) this.vibrate(15);
          break;
        case 'stumble':
          this.audio.whistle();
          this.shake = Math.min(1, this.shake + 0.5);
          break;
        case 'fall':
          this.audio.bonk();
          this.shake = 1;
          this.vibrate([40, 30, 80]);
          this.flashChip($('penalty-chip'), `+${FALL_PENALTY_MS / 1000} s`, 900, 'penaltyChipT');
          break;
        case 'finish':
          this.audio.fanfare();
          if (this.save.reducedMotion !== true) this.renderer.addConfetti(TRACK_LENGTH, nowMs);
          break;
        case 'timeout':
          this.audio.trombone();
          break;
        case 'lift':
          break;
      }
    }
  }

  // ----------------------------------------------------------------- hud

  private updateHud(): void {
    const s = this.sim;
    const eff = effectiveTimeMs(s.timeMs, s.penaltyMs);
    const dist = Math.min(TRACK_LENGTH, s.distance);
    const race = s.mode === 'race';
    ($('dist-fill') as HTMLElement).style.width = `${Math.min(100, (dist / TRACK_LENGTH) * 100)}%`;
    $('dist-text').textContent =
      race ? `${formatMetres(dist)} / ${TRACK_LENGTH} m` : formatMetres(s.distance);
    $('hud-timer').textContent =
      race
        ? Math.max(0, (RACE_LIMIT_MS - eff) / 1000).toFixed(1)
        : formatSeconds(s.timeMs);
    $('hud-speed').textContent = `${s.body.v.toFixed(1)} m/s`;
    $('hud-falls').textContent = `Stumbles ${s.stumbles} · Wipeouts ${s.wipeouts}`;

    // Pace ladder: sliding rank carets + projected-rank chip (race only).
    for (const t of RANK_THRESHOLDS_MS) {
      const el = $(`caret-${t.rank.toLowerCase()}`);
      el.classList.toggle('hidden', !race);
      if (race) el.style.left = `${paceBarPct(eff, t.maxMs)}%`;
    }
    const paceChip = $('hud-pace');
    paceChip.classList.toggle('hidden', !race);
    if (race) paceChip.textContent = `pace: ${projectedRank(eff, dist) ?? '—'}`;

    if (race && !this.finalStretchShown && s.distance >= FINAL_STRETCH_M) {
      this.finalStretchShown = true;
      this.flashChip($('toast'), 'FINAL STRETCH!', 1400, 'toastT');
    }
  }

  // ------------------------------------------------------------- results

  private showResults(): void {
    const s = this.sim;
    const eff = effectiveTimeMs(s.timeMs, s.penaltyMs);
    const rank = rankFor(eff);
    const score = scoreFor(s.finished, eff, s.distance);

    let newBest = false;
    // Rank-up is checked against the pre-run best rank (before we overwrite it).
    const rankUp =
      s.mode === 'race' &&
      s.finished &&
      this.save.bestRank != null &&
      rankBeats(rank, this.save.bestRank as Rank);
    if (s.mode === 'race' && s.finished) {
      if (this.save.bestTimeMs == null || eff < this.save.bestTimeMs) {
        this.save.bestTimeMs = eff;
        this.save.bestRank = rank;
        newBest = true;
        void this.platform.save(this.save);
      }
    }
    this.platform.sendScore(score);

    $('results-title').textContent = s.finished
      ? 'Finished!'
      : s.timedOut
        ? s.distance > 45
          ? `SO CLOSE — ${formatMetres(s.distance)}!`
          : "Time's up!"
        : 'Run over';
    $('results-rank').textContent = s.finished ? rank : '-';
    const ladder = $('results-ladder');
    ladder.classList.toggle('hidden', !s.finished);
    if (s.finished) {
      ladder.textContent = RANK_THRESHOLDS_MS.map((t) => `${t.rank} ≤ ${t.maxMs / 1000} s`).join(' · ');
    }
    $('results-best').classList.toggle('hidden', !newBest);
    $('results-rankup').classList.toggle('hidden', !rankUp);

    const lines: string[] = [];
    if (s.finished) {
      lines.push(`Time: ${formatSeconds(eff)}${s.penaltyMs > 0 ? ` (incl. +${(s.penaltyMs / 1000).toFixed(0)}s penalties)` : ''}`);
    } else {
      lines.push(`Distance: ${formatMetres(s.distance)}`);
    }
    lines.push(`Stumbles: ${s.stumbles} · Wipeouts: ${s.wipeouts}`);
    if (s.mode === 'race' && this.save.bestTimeMs != null) {
      lines.push(`Best: ${formatSeconds(this.save.bestTimeMs)}`);
    }
    const stats = $('results-stats');
    stats.textContent = '';
    for (const line of lines) {
      const div = document.createElement('div');
      div.textContent = line;
      stats.appendChild(div);
    }

    this.input.releaseAll();
    this.setScreen('results');
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
  }
}
