/**
 * Four-Leg Frenzy — game controller: screens, HUD, fixed-timestep loop,
 * camera, save data, and host-platform integration.
 */
import type { Platform } from '@icarus/platform';
import {
  dailyDoneToday,
  dailyKeyUTC,
  dateSeedUTC,
  defaultProfile,
  haptics,
  icarusScore,
  loadSharedProfile,
  osPrefersReducedMotion,
  recordPlay,
  saveSharedProfile,
  setHapticsEnabled,
  siblingForDay,
  type IcarusProfile,
} from '@icarus/platform';
import { AudioFx } from './audio';
import { LegInput } from './input';
import { Renderer } from './render/renderer';
import {
  DEFAULT_SAVE,
  normalizeSave,
  withDailyCompletion,
  type SaveData,
} from './save';
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
  masteryFor,
  paceBarPct,
  pbPaceX,
  projectedRank,
  rankBeats,
  rankFor,
  scoreFor,
  type Rank,
} from './sim/rules';

type UiState = 'title' | 'countdown' | 'playing' | 'paused' | 'results';

/** Countdown beat length (s); full = 3·2·1·GO, quick restart = GO only. */
const COUNT_STEP_S = 0.7;
const COUNT_FULL_S = COUNT_STEP_S * 4;

/** "FINAL STRETCH!" toast fires once per race past this distance (m). */
const FINAL_STRETCH_M = 40;

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
  /** True when the user opened the pause overlay (vs. a host/visibility pause). */
  private manualPaused = false;
  /** True while the current run is the Icarus Daily Race (date-seeded). */
  private daily = false;
  /** Cross-game profile (shared localStorage key on same-origin web). */
  private profile: IcarusProfile = defaultProfile();
  // HUD write caches — updateHud runs every frame; only touch the DOM when the
  // rendered string actually changes.
  private lastDistFill = '';
  private lastDistText = '';
  private lastTimer = '';
  private lastSpeed = '';
  private lastFalls = '';
  private lastPace = '';
  private lastCaretPct: Record<string, string> = {};

  constructor(private platform: Platform) {
    const canvas = $('scene') as HTMLCanvasElement;
    this.renderer = new Renderer(canvas);
    this.audio = new AudioFx(platform);
    this.input.onFirstGesture = () => this.audio.unlock();
    this.input.onMetaKey = (key) => this.onMetaKey(key);
  }

  async init(): Promise<void> {
    // Passing today's key drops a stale dailyBestMs when the day rolled over.
    this.save = normalizeSave(
      await this.platform.load<SaveData>({ ...DEFAULT_SAVE }),
      dailyKeyUTC(),
    );
    // Cross-game profile: settings fall back to the shared profile, then to
    // defaults; this session is recorded with today's mastery.
    this.profile = loadSharedProfile();
    if (this.save.sfx === undefined) this.save.sfx = this.profile.settings.sfx;
    if (this.save.haptics === undefined) this.save.haptics = this.profile.settings.haptics;
    // Reduced motion defaults to the OS preference until the user overrides
    // it in settings (undefined = never touched the toggle).
    if (this.save.reducedMotion === undefined) {
      this.save.reducedMotion =
        this.profile.settings.reducedMotion || osPrefersReducedMotion();
    }
    setHapticsEnabled(this.save.haptics !== false);
    recordPlay(this.profile, 'frenzy', masteryFor(this.save.bestTimeMs));
    saveSharedProfile(this.profile);

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
    click('btn-daily', () => this.startDaily());
    click('btn-retry', () => this.restart(true));
    click('btn-results-menu', () => this.showTitle());
    click('btn-pause', () => {
      this.manualPaused = true;
      this.setPaused(true);
    });
    click('btn-resume', () => {
      this.manualPaused = false;
      this.setPaused(false);
    });
    click('btn-pause-restart', () => this.restart(true));
    click('btn-pause-menu', () => this.showTitle());
    click('btn-settings', () => this.openSettings());
    click('btn-pause-settings', () => this.openSettings());
    click('btn-settings-close', () => this.closeSettings());

    $('set-motion').addEventListener('change', (e) => {
      this.save.reducedMotion = (e.target as HTMLInputElement).checked;
      document.body.classList.toggle('reduced-motion', this.save.reducedMotion === true);
      this.profile.settings.reducedMotion = this.save.reducedMotion;
      saveSharedProfile(this.profile);
      void this.platform.save(this.save);
    });
    $('set-sfx').addEventListener('change', (e) => {
      this.save.sfx = (e.target as HTMLInputElement).checked;
      this.audio.setSfx(this.save.sfx !== false);
      this.profile.settings.sfx = this.save.sfx;
      saveSharedProfile(this.profile);
      void this.platform.save(this.save);
    });
    $('set-haptics').addEventListener('change', (e) => {
      this.save.haptics = (e.target as HTMLInputElement).checked;
      setHapticsEnabled(this.save.haptics);
      if (this.save.haptics) haptics(20);
      this.profile.settings.haptics = this.save.haptics;
      saveSharedProfile(this.profile);
      void this.platform.save(this.save);
    });
  }

  private applySettingsToUi(): void {
    ($('set-motion') as HTMLInputElement).checked = this.save.reducedMotion === true;
    ($('set-sfx') as HTMLInputElement).checked = this.save.sfx !== false;
    ($('set-haptics') as HTMLInputElement).checked = this.save.haptics !== false;
    this.audio.setSfx(this.save.sfx !== false);
    document.body.classList.toggle('reduced-motion', this.save.reducedMotion === true);
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

  private updateDailyLine(): void {
    const done = dailyDoneToday(this.save, dailyKeyUTC());
    $('btn-daily').textContent = done ? 'Daily Race ✓' : 'Daily Race';
    const line = $('daily-line');
    if (this.save.dailyStreak > 0) {
      const best =
        done && this.save.dailyBestMs != null
          ? ` · today ${formatSeconds(this.save.dailyBestMs)}`
          : '';
      line.textContent = `🔥 ${this.save.dailyStreak}-day streak${best}`;
    } else {
      line.textContent = 'One seeded race per day — same course worldwide!';
    }
  }

  private updateScoreLine(): void {
    const score = icarusScore(this.profile);
    $('score-line').textContent =
      score > 0 ? `Icarus Score ${score.toLocaleString()}` : '';
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
    $('daily-chip').classList.toggle(
      'hidden',
      !this.daily || name === 'title' || name === 'results',
    );
    if (name !== 'paused') this.closeSettings();
  }

  private showTitle(): void {
    // idle attract-mode creature standing near the start
    this.sim = createSim('training', 3);
    this.sim.body.x = 1.6;
    for (let i = 0; i < 4; i++) this.sim.legs[i].plantX = this.sim.body.x + [0.34, 0.3, -0.3, -0.34][i];
    this.manualPaused = false;
    this.daily = false;
    this.camX = 0;
    this.input.releaseAll();
    this.audio.setPaused(false);
    this.updateBestLine();
    this.updateDailyLine();
    this.updateScoreLine();
    this.setScreen('title');
  }

  private startRun(mode: GameMode, quick = false): void {
    this.daily = false;
    this.seedCounter = (this.seedCounter * 1103515245 + 12345) & 0x7fffffff;
    this.beginRun(createSim(mode, this.seedCounter || 1), quick);
  }

  /**
   * Daily Race: the same date-seeded course for everyone, worldwide — the
   * wobble forcing is driven by the sim rng, so dateSeedUTC fixes it per day.
   */
  private startDaily(quick = false): void {
    this.daily = true;
    this.beginRun(createSim('race', dateSeedUTC() || 1), quick);
  }

  /** Instant-restart that preserves whether the run was the daily. */
  private restart(quick: boolean): void {
    if (this.daily) {
      this.startDaily(quick);
    } else {
      this.startRun(this.sim.mode, quick);
    }
  }

  private beginRun(sim: SimState, quick: boolean): void {
    this.sim = sim;
    this.manualPaused = false;
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
        this.restart(true);
      }
    } else if (this.ui === 'results') {
      this.audio.click();
      this.restart(true);
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

  /** True while the pause overlay came from the user, not the host. */
  get isManualPause(): boolean {
    return this.manualPaused && this.ui === 'paused';
  }

  // --------------------------------------------------------------- loop

  /**
   * Frozen-while-paused visual clock. Everything time-based in the renderer
   * (sky drift, crowd, pollen, puffs, confetti) reads this, so a host or
   * manual pause stops ALL animation — the Playables pause contract — while
   * the raw rAF timestamp keeps dt math honest.
   */
  private visualNowMs = 0;

  private frame(t: number): void {
    const frameDt = Math.min(0.25, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;
    if (this.ui !== 'paused') this.visualNowMs += frameDt * 1000;

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
        this.drainEvents(this.visualNowMs);
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
    // In the Daily Race the pace flag chases today's best daily time instead.
    const pb = this.daily ? this.save.dailyBestMs : this.save.bestTimeMs;
    this.renderer.draw(this.sim, {
      camX: this.camX,
      nowMs: this.visualNowMs,
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
    haptics(pattern);
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
    const distFill = `${Math.min(100, (dist / TRACK_LENGTH) * 100).toFixed(1)}%`;
    if (distFill !== this.lastDistFill) {
      this.lastDistFill = distFill;
      ($('dist-fill') as HTMLElement).style.width = distFill;
    }
    const distText = race ? `${formatMetres(dist)} / ${TRACK_LENGTH} m` : formatMetres(s.distance);
    if (distText !== this.lastDistText) {
      this.lastDistText = distText;
      $('dist-text').textContent = distText;
    }
    const timer = race
      ? Math.max(0, (RACE_LIMIT_MS - eff) / 1000).toFixed(1)
      : formatSeconds(s.timeMs);
    if (timer !== this.lastTimer) {
      this.lastTimer = timer;
      $('hud-timer').textContent = timer;
    }
    const speed = `${s.body.v.toFixed(1)} m/s`;
    if (speed !== this.lastSpeed) {
      this.lastSpeed = speed;
      $('hud-speed').textContent = speed;
    }
    const falls = `Stumbles ${s.stumbles} · Wipeouts ${s.wipeouts}`;
    if (falls !== this.lastFalls) {
      this.lastFalls = falls;
      $('hud-falls').textContent = falls;
    }

    // Pace ladder: sliding rank carets + projected-rank chip (race only).
    for (const t of RANK_THRESHOLDS_MS) {
      const el = $(`caret-${t.rank.toLowerCase()}`);
      el.classList.toggle('hidden', !race);
      if (race) {
        const pct = `${paceBarPct(eff, t.maxMs).toFixed(2)}%`;
        if (pct !== this.lastCaretPct[t.rank]) {
          this.lastCaretPct[t.rank] = pct;
          el.style.left = pct;
        }
      }
    }
    const paceChip = $('hud-pace');
    paceChip.classList.toggle('hidden', !race);
    if (race) {
      const pace = `pace: ${projectedRank(eff, dist) ?? '—'}`;
      if (pace !== this.lastPace) {
        this.lastPace = pace;
        paceChip.textContent = pace;
      }
    }

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
      }
    }
    // Daily Race: stamp today, bump the streak and keep today's best time.
    let dailyImproved = false;
    let dailyStreak = 0;
    if (this.daily && s.finished) {
      const result = withDailyCompletion(this.save, dailyKeyUTC(), eff);
      this.save = result.save;
      dailyImproved = result.improved;
      dailyStreak = result.streak;
    }
    // A daily completion or a new best must be persisted immediately.
    if ((this.daily && s.finished) || newBest) void this.platform.save(this.save);
    // Mastery may have grown — mirror it into the shared profile.
    const entry = this.profile.games.frenzy;
    if (entry) {
      entry.mastery = Math.max(entry.mastery, masteryFor(this.save.bestTimeMs));
      saveSharedProfile(this.profile);
    }
    this.platform.sendScore(score);

    $('results-title').textContent = s.finished
      ? this.daily
        ? 'Daily Race done!'
        : 'Finished!'
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
    if (this.daily && s.finished) {
      lines.push(
        dailyImproved
          ? `New daily best: ${formatSeconds(this.save.dailyBestMs ?? eff)}!`
          : `Daily best today: ${formatSeconds(this.save.dailyBestMs ?? eff)}`,
      );
      lines.push(dailyStreak === 1 ? '🔥 1-day streak' : `🔥 ${dailyStreak}-day streak`);
    }
    const stats = $('results-stats');
    stats.textContent = '';
    for (const line of lines) {
      const div = document.createElement('div');
      div.textContent = line;
      stats.appendChild(div);
    }

    // "More from Icarus" — a day-rotated sibling pitch (no link: outbound
    // navigation is policy-gated on Playables).
    const sib = siblingForDay('frenzy');
    $('promo-line').textContent = `More from Icarus: ${sib.name} — ${sib.pitch}`;

    this.input.releaseAll();
    this.setScreen('results');
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
  }
}
