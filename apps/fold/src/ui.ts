/**
 * DOM overlay UI for Fold: title screen, level select, HUD, results,
 * pause overlay and toasts. The puzzle scene itself is canvas-rendered.
 */

import { LEVELS } from './levels';
import { renderFigure } from './renderer';
import { SaveData, galleryCards, totalStars } from './scoring';

export interface UICallbacks {
  onPlay(): void;
  onContinue(): void;
  onSelectLevel(index: number): void;
  onLevelsBack(): void;
  onGallery(): void;
  onGalleryBack(): void;
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
    el<HTMLButtonElement>('btn-continue').addEventListener('click', cb.onContinue);
    el<HTMLButtonElement>('btn-levels-back').addEventListener('click', cb.onLevelsBack);
    el<HTMLButtonElement>('btn-gallery').addEventListener('click', cb.onGallery);
    el<HTMLButtonElement>('btn-gallery-back').addEventListener('click', cb.onGalleryBack);
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

  showScreen(which: 'title' | 'levels' | 'puzzle' | 'gallery'): void {
    el('screen-title').hidden = which !== 'title';
    el('screen-levels').hidden = which !== 'levels';
    el('screen-gallery').hidden = which !== 'gallery';
    el('hud').hidden = which !== 'puzzle';
    if (which !== 'puzzle') {
      this.showResults(false);
      this.showPause(false);
    }
  }

  setTotalStars(n: number): void {
    el('total-stars').textContent = n > 0 ? `${n} ★ earned` : '';
  }

  /** Show/hide the title-screen Continue shortcut (`null` hides it). */
  setContinue(label: string | null): void {
    const btn = el<HTMLButtonElement>('btn-continue');
    btn.hidden = label === null;
    if (label !== null) btn.textContent = label;
  }

  renderLevelGrid(save: SaveData): void {
    el('levels-progress').textContent = `${totalStars(save)} / ${LEVELS.length * 3} ★`;
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
        if (stars === 3) btn.classList.add('perfect'); // gold perfect-run border
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

  setHud(
    levelLabel: string,
    hintsLeft: number,
    undoEnabled: boolean,
    progress: { folds: number; par: number; tier: number },
  ): void {
    el('hud-title').textContent = levelLabel;
    el<HTMLButtonElement>('btn-hint').textContent = `Hint ${hintsLeft}`;
    el<HTMLButtonElement>('btn-hint').disabled = hintsLeft <= 0;
    el<HTMLButtonElement>('btn-undo').disabled = !undoEnabled;
    el('hud-folds').textContent = `Folds ${progress.folds} · Par ${progress.par}`;
    // Star-tier preview: earned stars bright, the rest dimmed.
    const starsEl = el('hud-stars');
    starsEl.textContent = '';
    for (let i = 1; i <= 3; i++) {
      const s = document.createElement('span');
      s.className = i <= progress.tier ? 'star-on' : 'star-off';
      s.textContent = '★';
      starsEl.appendChild(s);
    }
  }

  pulseUndo(): void {
    const btn = el<HTMLButtonElement>('btn-undo');
    btn.classList.remove('pulse');
    // Force reflow so the animation restarts.
    void btn.offsetWidth;
    btn.classList.add('pulse');
  }

  /** Origami gallery: one figure card per level, unlocked on completion. */
  renderGallery(save: SaveData): void {
    const cards = galleryCards(save);
    const unlockedCount = cards.filter((c) => c.unlocked).length;
    el('gallery-progress').textContent = `${unlockedCount} / ${LEVELS.length} figures`;
    const grid = el('gallery-grid');
    grid.textContent = '';
    LEVELS.forEach((level, i) => {
      const info = cards[i] ?? { unlocked: false, stars: 0 };
      const card = document.createElement('div');
      card.className = 'gallery-card';
      if (!info.unlocked) card.classList.add('locked');
      if (info.stars === 3) card.classList.add('perfect');
      const cv = document.createElement('canvas');
      renderFigure(cv, level.target, !info.unlocked);
      card.appendChild(cv);
      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = info.unlocked ? `${level.id} · ${level.name}` : 'Not yet folded';
      card.appendChild(name);
      const stars = document.createElement('div');
      stars.className = 'card-stars';
      stars.textContent = info.unlocked ? '★'.repeat(info.stars) + '☆'.repeat(3 - info.stars) : '';
      card.appendChild(stars);
      grid.appendChild(card);
    });
  }

  showResults(
    show: boolean,
    opts?: {
      stars: number;
      folds: number;
      par: number;
      hints: number;
      hasNext: boolean;
      name: string;
      /** True when the earned stars beat the saved best for this level. */
      isNewBest: boolean;
      /** Name of the next level, teased on the Next button. */
      nextName?: string;
      /** Consecutive 3★ completions ending at this level. */
      streak?: number;
    },
  ): void {
    el('screen-results').hidden = !show;
    if (!show || !opts) return;
    el('results-title').textContent = `${opts.name} — complete`;
    // Earned stars pop in one by one; unearned ones fade in dimmed after.
    const wrap = el('results-stars');
    wrap.textContent = '';
    for (let i = 0; i < 3; i++) {
      const earned = i < opts.stars;
      const s = document.createElement('span');
      s.className = earned ? 'star earned' : 'star empty';
      s.style.animationDelay = `${earned ? 120 + i * 170 : 700 + i * 90}ms`;
      s.textContent = '★';
      wrap.appendChild(s);
    }
    el('results-best').hidden = !opts.isNewBest;
    // Flawless streak is only worth mentioning from 2 onward.
    const showStreak = opts.stars === 3 && (opts.streak ?? 0) >= 2;
    el('results-streak').hidden = !showStreak;
    if (showStreak) el('results-streak').textContent = `Flawless streak ×${opts.streak}`;
    el('results-stats').textContent = `Folds ${opts.folds} · Par ${opts.par} · Hints ${opts.hints}`;
    const nextBtn = el<HTMLButtonElement>('btn-next');
    nextBtn.hidden = !opts.hasNext;
    nextBtn.textContent = opts.nextName ? `Next: ${opts.nextName}` : 'Next';
  }

  showPause(show: boolean): void {
    el('screen-pause').hidden = !show;
  }

  /**
   * Show a toast. With `action`, the toast gains a tappable button (and
   * pointer events) that runs the callback and dismisses itself.
   */
  toast(msg: string, ms = 2600, action?: { label: string; onTap(): void }): void {
    const t = el('toast');
    t.textContent = '';
    t.appendChild(document.createTextNode(msg));
    if (action) {
      const btn = document.createElement('button');
      btn.className = 'toast-action';
      btn.type = 'button';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        t.hidden = true;
        action.onTap();
      });
      t.appendChild(btn);
      t.classList.add('has-action');
    } else {
      t.classList.remove('has-action');
    }
    t.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      t.hidden = true;
    }, ms);
  }
}
