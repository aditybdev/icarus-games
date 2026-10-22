/**
 * DOM controller for HUD + screens. All markup lives in index.html; this
 * module only toggles visibility and fills in values.
 */
import { FLAVOR_COLORS, FLAVOR_LABELS, FLAVORS, type Flavor, type Order } from '../core/orders';
import { heightToCm } from '../core/scoring';

export type Mode = 'free' | 'rush';

export interface UICallbacks {
  onMode(mode: Mode): void;
  /** Done (Free Swirl) / Serve (Order Rush) button. */
  onDone(): void;
  onReplay(): void;
  onMenu(): void;
  onResume(): void;
  onPause(): void;
  onFlavor(flavor: Flavor): void;
}

export interface ResultsView {
  title: string;
  scoreText: string;
  stars: { earned: number; max: number } | null;
  bestText: string;
  newBest: boolean;
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export class UI {
  private readonly hud = must('hud');
  private readonly titleScreen = must('screen-title');
  private readonly pauseScreen = must('screen-pause');
  private readonly resultsScreen = must('screen-results');
  private readonly orderCard = must('order-card');
  private readonly toastEl = must('toast');

  private readonly meterFill = must('meter-fill');
  private readonly meterBand = must('meter-band');
  private readonly meterLabel = must('meter-label');
  private readonly wobbleDot = must('wobble-dot');
  private readonly wobbleBox = must('wobble');
  private readonly flavorChip = must('flavor-chip');
  private readonly flavorDot = must('flavor-dot');
  private readonly flavorName = must('flavor-name');
  private readonly flavorBar = must('flavor-bar');
  private readonly orderLabel = must('order-label');
  private readonly doneBtn = must<HTMLButtonElement>('done-btn');

  private readonly titleBest = must('title-best');
  private readonly resultsTitle = must('results-title');
  private readonly resultsStars = must('results-stars');
  private readonly resultsScore = must('results-score');
  private readonly resultsBest = must('results-best');
  private readonly orderCardTitle = must('order-card-title');
  private readonly orderCardFlavor = must('order-card-flavor');
  private readonly orderCardTarget = must('order-card-target');

  private toastTimer = 0;

  constructor(cb: UICallbacks) {
    must<HTMLButtonElement>('btn-free').addEventListener('click', () => cb.onMode('free'));
    must<HTMLButtonElement>('btn-rush').addEventListener('click', () => cb.onMode('rush'));
    this.doneBtn.addEventListener('click', () => cb.onDone());
    must<HTMLButtonElement>('btn-replay').addEventListener('click', () => cb.onReplay());
    must<HTMLButtonElement>('btn-results-menu').addEventListener('click', () => cb.onMenu());
    must<HTMLButtonElement>('btn-resume').addEventListener('click', () => cb.onResume());
    must<HTMLButtonElement>('btn-pause-menu').addEventListener('click', () => cb.onMenu());
    must<HTMLButtonElement>('pause-btn').addEventListener('click', () => cb.onPause());

    for (const flavor of FLAVORS) {
      const btn = document.createElement('button');
      btn.className = 'flavor-btn';
      btn.type = 'button';
      btn.dataset.flavor = flavor;
      btn.style.setProperty('--flavor', css(FLAVOR_COLORS[flavor]));
      btn.setAttribute('aria-label', FLAVOR_LABELS[flavor]);
      const label = document.createElement('span');
      label.className = 'flavor-btn-label';
      label.textContent = FLAVOR_LABELS[flavor];
      btn.appendChild(label);
      btn.addEventListener('click', () => cb.onFlavor(flavor));
      this.flavorBar.appendChild(btn);
    }
  }

  private show(el: HTMLElement, visible: boolean): void {
    el.hidden = !visible;
  }

  showTitle(best: number, bestStars: number): void {
    this.show(this.hud, false);
    this.show(this.resultsScreen, false);
    this.show(this.orderCard, false);
    this.titleBest.textContent =
      best > 0 || bestStars > 0
        ? `Best swirl: ${best} pts · Best rush: ${bestStars}/9 stars`
        : 'No scores yet — make your first swirl!';
    this.show(this.titleScreen, true);
  }

  showHUD(mode: Mode): void {
    this.show(this.titleScreen, false);
    this.show(this.resultsScreen, false);
    this.show(this.hud, true);
    this.show(this.flavorBar, mode === 'rush');
    this.show(this.flavorChip, mode === 'rush');
    this.show(this.orderLabel, mode === 'rush');
    this.show(this.meterBand, mode === 'rush');
    this.doneBtn.textContent = mode === 'rush' ? 'Serve!' : 'Done';
  }

  setHeight(heightUnits: number): void {
    this.meterLabel.textContent = `${heightToCm(heightUnits)} cm`;
  }

  setHeightFill(frac: number): void {
    const f = Math.min(1, Math.max(0, frac));
    this.meterFill.style.height = `${(f * 100).toFixed(1)}%`;
  }

  /** Position the target band on the meter (fractions of max height). */
  setBand(centerFrac: number, halfFrac: number): void {
    const bottom = Math.max(0, (centerFrac - halfFrac) * 100);
    const height = Math.min(100 - bottom, halfFrac * 2 * 100);
    this.meterBand.style.bottom = `${bottom.toFixed(1)}%`;
    this.meterBand.style.height = `${height.toFixed(1)}%`;
  }

  /** 0 = steady, 1 = at the topple threshold. */
  setWobble(frac: number): void {
    const f = Math.min(1, Math.max(0, frac));
    this.wobbleDot.style.left = `${(f * 100).toFixed(1)}%`;
    this.wobbleBox.classList.toggle('danger', f > 0.75);
  }

  setFlavor(flavor: Flavor): void {
    this.flavorDot.style.background = css(FLAVOR_COLORS[flavor]);
    this.flavorName.textContent = FLAVOR_LABELS[flavor];
    for (const child of Array.from(this.flavorBar.children)) {
      const btn = child as HTMLButtonElement;
      btn.classList.toggle('active', btn.dataset.flavor === flavor);
    }
  }

  setOrderLabel(text: string): void {
    this.orderLabel.textContent = text;
  }

  showOrderCard(order: Order, total: number): void {
    this.orderCardTitle.textContent = `Order ${order.index + 1} of ${total}`;
    this.orderCardFlavor.textContent = FLAVOR_LABELS[order.flavor];
    this.orderCardFlavor.style.color = css(FLAVOR_COLORS[order.flavor]);
    if (order.flavor === 'vanilla') this.orderCardFlavor.style.color = '#c8932f';
    const lo = heightToCm(order.targetHeight - order.band);
    const hi = heightToCm(order.targetHeight + order.band);
    this.orderCardTarget.textContent = `Target height: ${lo}–${hi} cm`;
    this.show(this.orderCard, true);
  }

  hideOrderCard(): void {
    this.show(this.orderCard, false);
  }

  showResults(view: ResultsView): void {
    this.show(this.hud, false);
    this.show(this.orderCard, false);
    this.resultsTitle.textContent = view.title;
    this.resultsScore.textContent = view.scoreText;
    this.resultsBest.textContent = view.bestText;
    this.resultsBest.classList.toggle('new-best', view.newBest);
    this.resultsStars.replaceChildren();
    if (view.stars) {
      for (let i = 0; i < view.stars.max; i += 1) {
        const star = document.createElement('span');
        star.className = i < view.stars.earned ? 'star earned' : 'star';
        star.textContent = '★';
        this.resultsStars.appendChild(star);
      }
      this.show(this.resultsStars, true);
    } else {
      this.show(this.resultsStars, false);
    }
    this.show(this.resultsScreen, true);
  }

  setPaused(paused: boolean): void {
    this.show(this.pauseScreen, paused);
  }

  get isPauseShown(): boolean {
    return !this.pauseScreen.hidden;
  }

  toast(text: string, ms = 1500): void {
    window.clearTimeout(this.toastTimer);
    this.toastEl.textContent = text;
    this.show(this.toastEl, true);
    this.toastTimer = window.setTimeout(() => this.show(this.toastEl, false), ms);
  }
}
