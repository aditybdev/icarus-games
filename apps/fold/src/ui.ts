/**
 * DOM overlay UI for Fold: title screen, level select, HUD, results,
 * pause overlay and toasts. The puzzle scene itself is canvas-rendered.
 */

import { LEVELS } from './levels';
import { SaveData } from './scoring';

export interface UICallbacks {
  onPlay(): void;
  onSelectLevel(index: number): void;
  onLevelsBack(): void;
  onMenu(): void;
  onUndo(): void;
  onHint(): void;
  onReset(): void;
  onNext(): void;
  onRetry(): void;
  onResume(): void;
}

const LOCK_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing element #${id}`);
  return e as T;
}

export class UI {
  private toastTimer = 0;

  constructor(private callbacks: UICallbacks) {
    const cb = callbacks;
    el<HTMLButtonElement>('btn-play').addEventListener('click', cb.onPlay);
    el<HTMLButtonElement>('btn-levels-back').addEventListener('click', cb.onLevelsBack);
    el<HTMLButtonElement>('btn-menu').addEventListener('click', cb.onMenu);
    el<HTMLButtonElement>('btn-undo').addEventListener('click', cb.onUndo);
    el<HTMLButtonElement>('btn-hint').addEventListener('click', cb.onHint);
    el<HTMLButtonElement>('btn-reset').addEventListener('click', cb.onReset);
    el<HTMLButtonElement>('btn-next').addEventListener('click', cb.onNext);
    el<HTMLButtonElement>('btn-retry').addEventListener('click', cb.onRetry);
    el<HTMLButtonElement>('btn-results-menu').addEventListener('click', cb.onMenu);
    el<HTMLButtonElement>('btn-resume').addEventListener('click', cb.onResume);
    el<HTMLButtonElement>('btn-pause-menu').addEventListener('click', cb.onMenu);
  }

  showScreen(which: 'title' | 'levels' | 'puzzle'): void {
    el('screen-title').hidden = which !== 'title';
    el('screen-levels').hidden = which !== 'levels';
    el('hud').hidden = which !== 'puzzle';
    if (which !== 'puzzle') {
      this.showResults(false);
      this.showPause(false);
    }
  }

  setTotalStars(n: number): void {
    el('total-stars').textContent = n > 0 ? `${n} ★ earned` : '';
  }

  renderLevelGrid(save: SaveData): void {
    const grid = el('level-grid');
    grid.textContent = '';
    LEVELS.forEach((level, i) => {
      const btn = document.createElement('button');
      btn.className = 'level-cell';
      const unlocked = i < save.unlocked;
      const num = document.createElement('span');
      num.className = 'cell-num';
      num.textContent = String(level.id);
      btn.appendChild(num);
      if (unlocked) {
        const stars = save.stars[i] ?? 0;
        const starSpan = document.createElement('span');
        starSpan.className = 'cell-stars';
        starSpan.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
        btn.appendChild(starSpan);
        btn.addEventListener('click', () => this.callbacks.onSelectLevel(i));
      } else {
        btn.classList.add('locked');
        const lock = document.createElement('span');
        lock.className = 'cell-lock';
        lock.innerHTML = LOCK_SVG; // static, developer-controlled markup
        btn.appendChild(lock);
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
      }
      grid.appendChild(btn);
    });
  }

  setHud(levelLabel: string, hintsLeft: number, undoEnabled: boolean): void {
    el('hud-title').textContent = levelLabel;
    el<HTMLButtonElement>('btn-hint').textContent = `Hint ${hintsLeft}`;
    el<HTMLButtonElement>('btn-hint').disabled = hintsLeft <= 0;
    el<HTMLButtonElement>('btn-undo').disabled = !undoEnabled;
  }

  pulseUndo(): void {
    const btn = el<HTMLButtonElement>('btn-undo');
    btn.classList.remove('pulse');
    // Force reflow so the animation restarts.
    void btn.offsetWidth;
    btn.classList.add('pulse');
  }

  showResults(
    show: boolean,
    opts?: { stars: number; folds: number; par: number; hints: number; hasNext: boolean; name: string },
  ): void {
    el('screen-results').hidden = !show;
    if (!show || !opts) return;
    el('results-title').textContent = `${opts.name} — complete`;
    el('results-stars').textContent = '★'.repeat(opts.stars) + '☆'.repeat(3 - opts.stars);
    el('results-stats').textContent = `Folds ${opts.folds} · Par ${opts.par} · Hints ${opts.hints}`;
    el<HTMLButtonElement>('btn-next').hidden = !opts.hasNext;
  }

  showPause(show: boolean): void {
    el('screen-pause').hidden = !show;
  }

  toast(msg: string, ms = 2600): void {
    const t = el('toast');
    t.textContent = msg;
    t.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      t.hidden = true;
    }, ms);
  }
}
