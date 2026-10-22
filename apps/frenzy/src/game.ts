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
  RACE_LIMIT_MS,
  TRACK_LENGTH,
  createSim,
  type GameMode,
  type SimInput,
  type SimState,
} from './sim/types';
import { effectiveTimeMs, formatMetres, formatSeconds, rankFor, scoreFor } from './sim/rules';

interface SaveData {
  v: 1;
  bestTimeMs: number | null;
  bestRank: string | null;
  reducedMotion?: boolean;
  sfx?: boolean;
}

type UiState = 'title' | 'playing' | 'paused' | 'results';

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

  constructor(private platform: Platform) {
    const canvas = $('scene') as HTMLCanvasElement;
    this.renderer = new Renderer(canvas);
    this.audio = new AudioFx(platform);
    this.input.onFirstGesture = () => this.audio.unlock();
  }

  async init(): Promise<void> {
    this.save = await this.platform.load<SaveData>({ ...DEFAULT_SAVE });
    if (this.save.v !== 1) this.save = { ...DEFAULT_SAVE };

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
    click('btn-retry', () => this.startRun(this.sim.mode));
    click('btn-results-menu', () => this.showTitle());
    click('btn-pause', () => this.setPaused(true));
    click('btn-resume', () => this.setPaused(false));
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
  }

  private closeSettings(): void {
    $('screen-settings').classList.add('hidden');
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

  private startRun(mode: GameMode): void {
    this.seedCounter = (this.seedCounter * 1103515245 + 12345) & 0x7fffffff;
    this.sim = createSim(mode, this.seedCounter || 1);
    this.camX = 0;
    this.shake = 0;
    this.acc = 0;
    this.input.releaseAll();
    this.audio.setPaused(false);
    this.setScreen('playing');
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
    this.renderer.draw(this.sim, {
      camX: this.camX,
      nowMs: t,
      shake: this.shake,
      reducedMotion: this.save.reducedMotion === true,
    });
  }

  private drainEvents(nowMs: number): void {
    for (const ev of this.sim.events) {
      switch (ev.type) {
        case 'plant':
          this.audio.thud(ev.leg, ev.strength);
          this.renderer.addPuff(this.sim.legs[ev.leg].plantX, ev.strength > 0.35, nowMs);
          break;
        case 'stumble':
          this.audio.whistle();
          this.shake = Math.min(1, this.shake + 0.5);
          break;
        case 'fall':
          this.audio.bonk();
          this.shake = 1;
          break;
        case 'finish':
          this.audio.fanfare();
          break;
        case 'timeout':
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
    ($('dist-fill') as HTMLElement).style.width = `${Math.min(100, (dist / TRACK_LENGTH) * 100)}%`;
    $('dist-text').textContent =
      s.mode === 'race' ? `${formatMetres(dist)} / ${TRACK_LENGTH} m` : formatMetres(s.distance);
    $('hud-timer').textContent =
      s.mode === 'race'
        ? Math.max(0, (RACE_LIMIT_MS - eff) / 1000).toFixed(1)
        : formatSeconds(s.timeMs);
    $('hud-speed').textContent = `${s.body.v.toFixed(1)} m/s`;
    $('hud-falls').textContent = `Falls ${s.falls}`;
  }

  // ------------------------------------------------------------- results

  private showResults(): void {
    const s = this.sim;
    const eff = effectiveTimeMs(s.timeMs, s.penaltyMs);
    const rank = rankFor(eff);
    const score = scoreFor(s.finished, eff, s.distance);

    let newBest = false;
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
        ? "Time's up!"
        : 'Run over';
    $('results-rank').textContent = s.finished ? rank : '-';
    $('results-best').classList.toggle('hidden', !newBest);

    const lines: string[] = [];
    if (s.finished) {
      lines.push(`Time: ${formatSeconds(eff)}${s.penaltyMs > 0 ? ` (incl. +${(s.penaltyMs / 1000).toFixed(0)}s penalties)` : ''}`);
    } else {
      lines.push(`Distance: ${formatMetres(s.distance)}`);
    }
    lines.push(`Falls: ${s.falls}`);
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
