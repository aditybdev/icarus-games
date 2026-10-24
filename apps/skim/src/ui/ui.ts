/**
 * Skim — DOM layer. Menus, HUD chips, results card, settings, toast and the
 * in-play gesture hints. Every per-frame writer is value-cached (BENCHMARK
 * T4: no DOM churn for unchanged values).
 */
import { formatM, type Medal } from '../core/scoring';
import type { SaveData } from '../core/save';
import { STONE_SKINS, stoneUnlocked, stoneUnlockHint } from '../core/stones';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

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
  onStone(index: number): void;
  onToggleSfx(on: boolean): void;
  onToggleHaptics(on: boolean): void;
  onToggleMotion(on: boolean): void;
}

export interface ResultsData {
  distanceM: number;
  skips: number;
  perfects: number;
  medal: Medal | null;
  /** Near-miss line ("4.2 m from silver") or "" at gold. */
  nearText: string;
  isNewBest: boolean;
  bestM: number;
  /** Daily mode: running total text ("" in free play). */
  dailyText: string;
  promoText: string;
}

export class UI {
  private readonly cb: UICallbacks;
  private readonly distChip = el('dist-chip');
  private readonly chainChip = el('chain-chip');
  private readonly dailyChip = el('daily-progress-chip');
  private readonly hintEl = el('hint');
  private readonly toastEl = el('toast');
  private toastTimer = 0;
  private lastDist = '';
  private lastChain = -1;
  private readonly stoneDots: HTMLButtonElement[] = [];

  constructor(cb: UICallbacks) {
    this.cb = cb;
    el('btn-play').addEventListener('click', () => cb.onPlay());
    el('btn-daily').addEventListener('click', () => cb.onDaily());
    el('btn-replay').addEventListener('click', () => cb.onReplay());
    el('btn-results-menu').addEventListener('click', () => cb.onMenu());
    el('btn-resume').addEventListener('click', () => cb.onResume());
    el('btn-pause-restart').addEventListener('click', () => cb.onPauseRestart());
    el('btn-pause-settings').addEventListener('click', () => cb.onSettings(true));
    el('btn-pause-menu').addEventListener('click', () => cb.onMenu());
    el('btn-pause').addEventListener('click', () => cb.onPause());
    el('btn-settings').addEventListener('click', () => cb.onSettings(true));
    el('btn-settings-close').addEventListener('click', () => cb.onSettings(false));
    el('btn-howto').addEventListener('click', () => cb.onHowto());
    el('btn-tutorial-got').addEventListener('click', () => cb.onTutorialDone());
    el<HTMLInputElement>('set-sfx').addEventListener('change', (e) =>
      cb.onToggleSfx((e.target as HTMLInputElement).checked),
    );
    el<HTMLInputElement>('set-haptics').addEventListener('change', (e) =>
      cb.onToggleHaptics((e.target as HTMLInputElement).checked),
    );
    el<HTMLInputElement>('set-motion').addEventListener('change', (e) =>
      cb.onToggleMotion((e.target as HTMLInputElement).checked),
    );

    // Stone picker dots.
    const row = el('stone-row');
    STONE_SKINS.forEach((skin, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'stone-dot';
      const pebble = document.createElement('span');
      pebble.className = 'pebble';
      pebble.style.background = skin.body;
      pebble.style.boxShadow = `inset -3px -3px 0 ${skin.band}`;
      dot.appendChild(pebble);
      dot.addEventListener('click', () => this.cb.onStone(index));
      row.appendChild(dot);
      this.stoneDots.push(dot);
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
      this.lastDist = '';
      this.lastChain = -1;
      this.setHint('');
    }
  }

  setDailyChip(text: string): void {
    this.dailyChip.hidden = text === '';
    if (text) this.dailyChip.textContent = text;
  }

  setDist(m: number): void {
    const text = formatM(m);
    if (text === this.lastDist) return;
    this.lastDist = text;
    this.distChip.textContent = text;
  }

  setChain(perfects: number): void {
    if (perfects === this.lastChain) return;
    const was = this.lastChain;
    this.lastChain = perfects;
    this.chainChip.hidden = perfects < 2;
    if (perfects >= 2) {
      this.chainChip.textContent = `${perfects} perfect in a row`;
      if (perfects > was) {
        this.chainChip.classList.remove('bump');
        void this.chainChip.offsetWidth; // restart the bump animation
        this.chainChip.classList.add('bump');
      }
    }
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
    const bestLine = el('best-line');
    bestLine.textContent =
      save.bestM > 0
        ? `Best skim ${formatM(save.bestM)}${save.medal ? ` · ${save.medal}` : ''}`
        : 'No throws yet — the lake is waiting';
    el('daily-line').textContent = dailyText;
    const { throws, perfects } = save.stats;
    const stats = el('menu-stats');
    stats.hidden = throws === 0;
    if (throws > 0) stats.textContent = `${throws} throws · ${perfects} perfect taps`;
    const scoreLine = el('score-line');
    scoreLine.textContent = icarusScore > 0 ? `Icarus Score ${icarusScore.toLocaleString()}` : '';
    scoreLine.hidden = icarusScore <= 0;
    el('promo-line').textContent = promoText;
    this.renderStones(save);
  }

  private renderStones(save: SaveData): void {
    STONE_SKINS.forEach((skin, index) => {
      const dot = this.stoneDots[index];
      const unlocked = stoneUnlocked(index, save);
      dot.classList.toggle('locked', !unlocked);
      dot.classList.toggle('selected', index === save.stone);
      const hint = unlocked ? '' : stoneUnlockHint(index);
      dot.setAttribute(
        'aria-label',
        unlocked ? `${skin.name} stone` : `${skin.name} stone (locked${hint ? ` — ${hint}` : ''})`,
      );
      dot.setAttribute('aria-disabled', String(!unlocked));
      dot.title = unlocked ? skin.name : hint ? `Locked — ${hint}` : 'Locked';
    });
  }

  showResults(data: ResultsData): void {
    el('results-dist').textContent = formatM(data.distanceM);
    const medalEl = el('results-medal');
    medalEl.hidden = !data.medal;
    if (data.medal) {
      medalEl.textContent = `${data.medal} medal`;
      medalEl.className = data.medal;
      medalEl.id = 'results-medal';
    }
    el('results-near').textContent = data.nearText;
    const best = el('results-best');
    best.textContent = data.isNewBest ? 'New best!' : `Best ${formatM(data.bestM)}`;
    best.classList.toggle('new-best', data.isNewBest);
    el('results-stats').textContent = `${data.skips} skips · ${data.perfects} perfect`;
    const daily = el('results-daily');
    daily.hidden = data.dailyText === '';
    if (data.dailyText) daily.textContent = data.dailyText;
    el('results-promo').textContent = data.promoText;
    this.showScreen('results');
  }

  syncSettings(sfx: boolean, haptics: boolean, motion: boolean): void {
    el<HTMLInputElement>('set-sfx').checked = sfx;
    el<HTMLInputElement>('set-haptics').checked = haptics;
    el<HTMLInputElement>('set-motion').checked = motion;
  }
}
