/**
 * DOM overlay: screens, HUD chips, toast, results badges, treat picker.
 * Writers cache last values — zero redundant DOM churn (T4).
 */
import type { Medal } from '../core/constants';
import type { SaveData } from '../core/save';
import { TREATS, treatUnlocked, treatUnlockHint } from '../core/treats';

export interface MallowBadge {
  score: number;
  grade: string;
  tag: 'Golden!' | 'Toasty' | 'Raw' | 'Dark' | 'Burnt' | 'On fire';
}

export interface ResultsData {
  total: number;
  medal: Medal | null;
  badges: MallowBadge[];
  isNewBest: boolean;
  bestRush: number;
  nearText: string;
  statsText: string;
  dailyText: string;
  promoText: string;
}

export interface UICallbacks {
  onPlay: () => void;
  onDaily: () => void;
  onReplay: () => void;
  onMenu: () => void;
  onResume: () => void;
  onPauseRestart: () => void;
  onPause: () => void;
  onSettings: (open: boolean) => void;
  onHowto: () => void;
  onTutorialDone: () => void;
  onTreat: (index: number) => void;
  onToggleSfx: (on: boolean) => void;
  onToggleHaptics: (on: boolean) => void;
  onToggleMotion: (on: boolean) => void;
}

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e;
}

export class UI {
  private lastOrder = '';
  private lastScore = -1;
  private toastTimer = 0;
  private readonly cb: UICallbacks;

  constructor(cb: UICallbacks) {
    this.cb = cb;
    el('btn-play').addEventListener('click', cb.onPlay);
    el('btn-daily').addEventListener('click', cb.onDaily);
    el('btn-howto').addEventListener('click', cb.onHowto);
    el('btn-replay').addEventListener('click', cb.onReplay);
    el('btn-menu').addEventListener('click', cb.onMenu);
    el('btn-resume').addEventListener('click', cb.onResume);
    el('btn-pause-restart').addEventListener('click', cb.onPauseRestart);
    el('btn-pause-menu').addEventListener('click', cb.onMenu);
    el('btn-pause').addEventListener('click', cb.onPause);
    el('btn-settings').addEventListener('click', () => cb.onSettings(true));
    el('btn-pause-settings').addEventListener('click', () => cb.onSettings(true));
    el('btn-settings-close').addEventListener('click', () => cb.onSettings(false));
    el('btn-tutorial-got').addEventListener('click', cb.onTutorialDone);

    this.bindCheck('set-sfx', cb.onToggleSfx);
    this.bindCheck('set-haptics', cb.onToggleHaptics);
    this.bindCheck('set-motion', cb.onToggleMotion);
  }

  private bindCheck(id: string, cb: (on: boolean) => void): void {
    el(id).addEventListener('change', () => cb((el(id) as HTMLInputElement).checked));
  }

  syncSettings(sfx: boolean, haptics: boolean, motion: boolean): void {
    (el('set-sfx') as HTMLInputElement).checked = sfx;
    (el('set-haptics') as HTMLInputElement).checked = haptics;
    (el('set-motion') as HTMLInputElement).checked = motion;
  }

  showScreen(name: 'title' | 'results' | 'pause' | 'settings' | 'tutorial' | null): void {
    for (const id of ['screen-title', 'screen-results', 'screen-pause', 'screen-settings', 'screen-tutorial']) {
      el(id).hidden = id !== `screen-${name}`;
    }
  }

  setHudVisible(on: boolean): void {
    el('hud').hidden = !on;
    if (!on) this.setHint('');
  }

  setOrderChip(text: string): void {
    if (text === this.lastOrder) return;
    this.lastOrder = text;
    el('order-chip').textContent = text;
  }

  setScore(total: number): void {
    if (total === this.lastScore) return;
    this.lastScore = total;
    el('score-chip').textContent = String(total);
  }

  setHint(text: string): void {
    const h = el('hint');
    h.textContent = text;
    h.hidden = text === '';
  }

  toast(text: string): void {
    const t = el('toast');
    t.textContent = text;
    t.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      t.hidden = true;
    }, 1700);
  }

  showMenu(save: SaveData, icarusScore: number, dailyText: string, promoText: string): void {
    el('best-line').textContent =
      save.bestRush > 0
        ? `Best night ${save.bestRush}${save.medal ? ` · ${save.medal}` : ''}`
        : 'No roasts yet — the fire is crackling';
    el('daily-line').textContent = dailyText;
    const { serves, golden } = save.stats;
    const statsEl = el('menu-stats');
    statsEl.hidden = serves === 0;
    statsEl.textContent = serves > 0 ? `${serves} mallows roasted · ${golden} golden` : '';
    const scoreEl = el('score-line');
    scoreEl.hidden = icarusScore <= 0;
    scoreEl.textContent = icarusScore > 0 ? `Icarus score ${icarusScore}` : '';
    el('promo-line').textContent = promoText;
    this.renderTreats(save);
  }

  private renderTreats(save: SaveData): void {
    const row = el('treat-row');
    row.replaceChildren();
    TREATS.forEach((t, i) => {
      const unlocked = treatUnlocked(i, save);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `treat-dot${save.treat === i ? ' sel' : ''}${unlocked ? '' : ' locked'}`;
      b.setAttribute('aria-pressed', String(save.treat === i));
      b.setAttribute('aria-label', unlocked ? t.name : `${t.name} (locked: ${treatUnlockHint(i)})`);
      for (const c of [t.cracker, t.chocolate, t.filling]) {
        const layer = document.createElement('span');
        layer.className = 'layer';
        layer.style.background = c;
        b.appendChild(layer);
      }
      if (unlocked) b.addEventListener('click', () => this.cb.onTreat(i));
      row.appendChild(b);
    });
  }

  showResults(d: ResultsData): void {
    const anyFail = d.badges.some((b) => b.tag === 'Burnt' || b.tag === 'On fire');
    el('results-title').textContent = anyFail ? 'Night done — one got away' : 'Night complete!';
    el('results-score').textContent = String(d.total);
    const medalEl = el('results-medal');
    medalEl.textContent = d.medal ? `${d.medal[0].toUpperCase()}${d.medal.slice(1)} medal` : '';
    medalEl.className = d.medal ?? '';
    el('results-near').textContent = d.nearText;
    el('results-best').textContent = d.isNewBest ? 'New best!' : d.bestRush > 0 ? `Best night ${d.bestRush}` : '';
    const orders = el('results-orders');
    orders.replaceChildren();
    for (const b of d.badges) {
      const badge = document.createElement('div');
      const cls = b.tag === 'Golden!' ? 'golden' : b.tag === 'Burnt' || b.tag === 'On fire' || b.tag === 'Raw' ? 'fail' : '';
      badge.className = `order-badge${cls ? ` ${cls}` : ''}`;
      badge.textContent = `${b.score} ${b.grade} · ${b.tag}`;
      orders.appendChild(badge);
    }
    el('results-stats').textContent = d.statsText;
    el('results-daily').textContent = d.dailyText;
    el('results-promo').textContent = d.promoText;
    this.showScreen('results');
  }
}
