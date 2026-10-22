/**
 * DOM UI layer: menu, countdown, HUD, pause and results screens.
 * All gameplay drawing happens on the canvas; this only manages overlays.
 */
import { ROUND_SIZES, type RoundSize } from '../core/constants';
import { formatMs } from '../core/round';

export interface ResultsData {
  timeText: string;
  avgText: string;
  size: RoundSize;
  bestText: string;
  newBest: boolean;
}

export interface UICallbacks {
  onPlay(size: RoundSize): void;
  onReplay(): void;
  onMenu(): void;
  onResume(): void;
  onPause(): void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

export class UI {
  private readonly hud = el('hud');
  private readonly remainingEl = el('remaining');
  private readonly timerEl = el('timer');
  private readonly streakEl = el('streak-pop');
  private readonly screenMenu = el('screen-menu');
  private readonly screenCountdown = el('screen-countdown');
  private readonly screenPause = el('screen-pause');
  private readonly screenResults = el('screen-results');
  private readonly countSize = el('count-size');
  private readonly countNum = el('count-num');
  private readonly resultsTime = el('results-time');
  private readonly resultsAvg = el('results-avg');
  private readonly resultsSize = el('results-size');
  private readonly resultsBest = el('results-best');

  constructor(cb: UICallbacks) {
    for (const size of ROUND_SIZES) {
      const btn = document.querySelector<HTMLButtonElement>(`.size-btn[data-size="${size}"]`);
      btn?.addEventListener('click', () => cb.onPlay(size));
    }
    el<HTMLButtonElement>('pause-btn').addEventListener('click', () => cb.onPause());
    el<HTMLButtonElement>('btn-resume').addEventListener('click', () => cb.onResume());
    el<HTMLButtonElement>('btn-pause-menu').addEventListener('click', () => cb.onMenu());
    el<HTMLButtonElement>('btn-replay').addEventListener('click', () => cb.onReplay());
    el<HTMLButtonElement>('btn-results-menu').addEventListener('click', () => cb.onMenu());
  }

  private hideScreens(): void {
    this.screenMenu.hidden = true;
    this.screenCountdown.hidden = true;
    this.screenPause.hidden = true;
    this.screenResults.hidden = true;
  }

  showMenu(bestMs: Record<RoundSize, number | null>): void {
    this.hideScreens();
    this.hud.hidden = true;
    for (const size of ROUND_SIZES) {
      const best = bestMs[size];
      el(`best-${size}`).textContent = best === null ? 'no time yet' : `best ${formatMs(best)}`;
    }
    this.screenMenu.hidden = false;
  }

  showCountdown(size: RoundSize): void {
    this.hideScreens();
    this.countSize.textContent = `Round of ${size}`;
    this.countNum.textContent = '3';
    this.screenCountdown.hidden = false;
  }

  setCountdown(label: string): void {
    if (this.countNum.textContent !== label) this.countNum.textContent = label;
  }

  hideCountdown(): void {
    this.screenCountdown.hidden = true;
  }

  showHUD(size: RoundSize): void {
    this.hud.hidden = false;
    this.setRemaining(size);
    this.setTimer('00:00.0');
  }

  hideHUD(): void {
    this.hud.hidden = true;
  }

  setRemaining(n: number): void {
    const text = String(n);
    if (this.remainingEl.textContent !== text) this.remainingEl.textContent = text;
  }

  setTimer(text: string): void {
    if (this.timerEl.textContent !== text) this.timerEl.textContent = text;
  }

  /** Pop a streak label ("Speedy!" / "Blazing!") mid-screen. */
  streak(label: string, hot: boolean): void {
    this.streakEl.textContent = label;
    this.streakEl.classList.toggle('hot', hot);
    this.streakEl.hidden = false;
    this.streakEl.classList.remove('show');
    // Restart the CSS animation.
    void this.streakEl.offsetWidth;
    this.streakEl.classList.add('show');
  }

  setPaused(on: boolean): void {
    // The pause screen overlays whatever is currently shown (e.g. the
    // countdown) instead of replacing it, so resume restores it untouched.
    this.screenPause.hidden = !on;
  }

  showResults(data: ResultsData): void {
    this.hideScreens();
    this.hud.hidden = true;
    this.resultsTime.textContent = data.timeText;
    this.resultsAvg.textContent = data.avgText;
    this.resultsSize.textContent = `Round of ${data.size}`;
    this.resultsBest.textContent = data.bestText;
    this.resultsBest.classList.toggle('new-best', data.newBest);
    this.screenResults.hidden = false;
  }
}
