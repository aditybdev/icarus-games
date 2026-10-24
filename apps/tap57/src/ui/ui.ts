/**
 * Tap the 57 — DOM overlay UI. Screens, HUD chips, menu/results population,
 * condiment collection row, settings. Canvas owns the scene; the DOM owns
 * chrome. Writers cache their last value to skip no-op DOM churn (T4).
 */
import type { Medal } from '../core/constants';
import { BOTTLE_SKINS, bottleUnlockHint, bottleUnlocked } from '../core/bottles';
import type { SaveData } from '../core/save';

export interface UICallbacks {
  onPlay(): void;
  onDaily(): void;
  onReplay(): void;
  onMenu(): void;
  onResume(): void;
  onPauseRestart(): void;
  onPause(): void;
  onSettings(open: boolean): void;
  onHowto(): void;
  onTutorialDone(): void;
  onBottle(index: number): void;
  onToggleSfx(on: boolean): void;
  onToggleHaptics(on: boolean): void;
  onToggleMotion(on: boolean): void;
}

export interface OrderBadges {
  label: string;
  score: number;
  plated: boolean;
  splat: boolean;
}

export interface ResultsData {
  total: number;
  medal: Medal | null;
  nearText: string;
  isNewBest: boolean;
  bestRush: number;
  badges: OrderBadges[];
  statsText: string;
  dailyText: string;
  promoText: string;
  replayLabel: string;
}

const el = (id: string): HTMLElement => document.getElementById(id)!;

export class UI {
  private readonly cb: UICallbacks;
  private readonly orderChip = el('order-chip');
  private readonly scoreChip = el('score-chip');
  private readonly hintEl = el('hint');
  private readonly toastEl = el('toast');
  private readonly bottleDots: HTMLElement[] = [];
  private toastTimer = 0;
  private lastOrder = '';
  private lastScore = -1;

  constructor(cb: UICallbacks) {
    this.cb = cb;
    el('btn-play').addEventListener('click', () => cb.onPlay());
    el('btn-daily').addEventListener('click', () => cb.onDaily());
    el('btn-replay').addEventListener('click', () => cb.onReplay());
    el('btn-menu').addEventListener('click', () => cb.onMenu());
    el('btn-resume').addEventListener('click', () => cb.onResume());
    el('btn-pause-restart').addEventListener('click', () => cb.onPauseRestart());
    el('btn-pause-menu').addEventListener('click', () => cb.onMenu());
    el('btn-pause').addEventListener('click', () => cb.onPause());
    el('btn-howto').addEventListener('click', () => cb.onHowto());
    el('btn-tutorial-got').addEventListener('click', () => cb.onTutorialDone());
    el('btn-settings').addEventListener('click', () => cb.onSettings(true));
    el('btn-pause-settings').addEventListener('click', () => cb.onSettings(true));
    el('btn-settings-close').addEventListener('click', () => cb.onSettings(false));
    el('set-sfx').addEventListener('change', (e) => cb.onToggleSfx((e.target as HTMLInputElement).checked));
    el('set-haptics').addEventListener('change', (e) => cb.onToggleHaptics((e.target as HTMLInputElement).checked));
    el('set-motion').addEventListener('change', (e) => cb.onToggleMotion((e.target as HTMLInputElement).checked));

    const row = el('bottle-row');
    BOTTLE_SKINS.forEach((skin, index) => {
      const dot = document.createElement('button');
      dot.className = 'bottle-dot';
      dot.type = 'button';
      const swatch = document.createElement('div');
      swatch.className = 'swatch';
      swatch.style.background = skin.blob;
      dot.appendChild(swatch);
      dot.addEventListener('click', () => cb.onBottle(index));
      row.appendChild(dot);
      this.bottleDots.push(dot);
    });
  }

  showScreen(name: 'title' | 'results' | 'pause' | 'settings' | 'tutorial' | null): void {
    for (const s of ['title', 'results', 'pause', 'settings', 'tutorial'] as const) {
      el(`screen-${s}`).hidden = s !== name;
    }
  }

  setHudVisible(visible: boolean): void {
    el('hud').hidden = !visible;
    if (!visible) {
      this.lastOrder = '';
      this.lastScore = -1;
      this.setHint('');
    }
  }

  setOrderChip(text: string): void {
    if (text === this.lastOrder) return;
    this.lastOrder = text;
    this.orderChip.textContent = text;
  }

  setScore(total: number): void {
    if (total === this.lastScore) return;
    this.lastScore = total;
    this.scoreChip.textContent = String(total);
  }

  /** In-play gesture hint ("" hides). One hint at a time, teach inside play. */
  setHint(text: string): void {
    this.hintEl.hidden = text === '';
    if (text && this.hintEl.textContent !== text) this.hintEl.textContent = text;
  }

  toast(text: string, ms = 1800): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.hidden = true;
    }, ms);
  }

  showMenu(save: SaveData, icarusScore: number, dailyText: string, promoText: string): void {
    el('best-line').textContent =
      save.bestRush > 0
        ? `Best rush ${save.bestRush}${save.medal ? ` · ${save.medal}` : ''}`
        : 'No rushes yet — the fries are waiting';
    el('daily-line').textContent = dailyText;
    const { serves, plated } = save.stats;
    const stats = el('menu-stats');
    stats.hidden = serves === 0;
    if (serves > 0) stats.textContent = `${serves} orders served · ${plated} plated`;
    const scoreLine = el('score-line');
    scoreLine.textContent = icarusScore > 0 ? `Icarus Score ${icarusScore.toLocaleString()}` : '';
    scoreLine.hidden = icarusScore <= 0;
    el('promo-line').textContent = promoText;
    this.renderBottles(save);
  }

  private renderBottles(save: SaveData): void {
    BOTTLE_SKINS.forEach((skin, index) => {
      const dot = this.bottleDots[index];
      const unlocked = bottleUnlocked(index, save);
      const hint = bottleUnlockHint(index);
      dot.classList.toggle('locked', !unlocked);
      dot.classList.toggle('sel', save.bottle === index && unlocked);
      dot.setAttribute(
        'aria-label',
        unlocked ? `${skin.name} bottle` : `${skin.name} bottle (locked${hint ? ` — ${hint}` : ''})`,
      );
      (dot as HTMLButtonElement).disabled = !unlocked;
      dot.title = unlocked ? skin.name : hint ? `Locked — ${hint}` : 'Locked';
    });
  }

  showResults(d: ResultsData): void {
    el('results-title').textContent = d.badges.some((b) => b.splat) ? 'Rush done — one got away' : 'Rush complete!';
    el('results-score').textContent = String(d.total);
    const medalEl = el('results-medal');
    medalEl.textContent = d.medal ? `${d.medal[0].toUpperCase()}${d.medal.slice(1)} medal` : '';
    medalEl.className = d.medal ?? '';
    el('results-near').textContent = d.nearText;
    el('results-best').textContent = d.isNewBest ? 'New best!' : `Best rush ${d.bestRush}`;
    const orders = el('results-orders');
    orders.replaceChildren();
    for (const b of d.badges) {
      const badge = document.createElement('span');
      badge.className = `order-badge${b.plated ? ' plated' : ''}${b.splat ? ' splat' : ''}`;
      badge.textContent = b.splat ? `${b.label} SPLAT` : `${b.label} ${b.score}`;
      orders.appendChild(badge);
    }
    el('results-stats').textContent = d.statsText;
    el('results-daily').textContent = d.dailyText;
    el('results-promo').textContent = d.promoText;
    el('btn-replay').textContent = d.replayLabel;
    this.showScreen('results');
  }

  syncSettings(sfx: boolean, haptics: boolean, reducedMotion: boolean): void {
    (el('set-sfx') as HTMLInputElement).checked = sfx;
    (el('set-haptics') as HTMLInputElement).checked = haptics;
    (el('set-motion') as HTMLInputElement).checked = reducedMotion;
  }
}
