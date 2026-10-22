/**
 * DOM controller for HUD + screens. All markup lives in index.html; this
 * module only toggles visibility and fills in values.
 */
import { FLAVOR_COLORS, FLAVOR_LABELS, FLAVORS, type Flavor, type Order } from '../core/orders';
import { heightToCm } from '../core/scoring';

export type Mode = 'free' | 'rush' | 'daily';

export interface UICallbacks {
  onMode(mode: Mode): void;
  /** Done (Free Swirl) / Serve (Order Rush) button. */
  onDone(): void;
  onReplay(): void;
  onMenu(): void;
  onResume(): void;
  onPause(): void;
  onFlavor(flavor: Flavor): void;
  /** Fired once per star as it pops in on the results screen (sound/haptics). */
  onStarReveal(index: number): void;
  /** "Keep rushing" on the results screen (endless Order Rush). */
  onContinueRush(): void;
}

export interface ResultsView {
  title: string;
  scoreText: string;
  /** When set (and motion allowed), the score counts up from 0 to `to`. */
  countUp?: { to: number; suffix: string };
  stars: { earned: number; max: number } | null;
  bestText: string;
  newBest: boolean;
  /** Show the "Keep rushing" button (endless mode checkpoint). */
  continueRush?: boolean;
}

const REDUCED_MOTION =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

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
  private readonly meterBest = must('meter-best');
  private readonly meterLabel = must('meter-label');
  private readonly scoreChip = must('score-chip');
  private readonly comboChip = must('combo-chip');
  private readonly continueRushBtn = must<HTMLButtonElement>('btn-continue-rush');
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
  private lastScore = -1;
  private lastCombo = 1;
  private starTimers: number[] = [];
  private countRaf = 0;
  private readonly starReveal: (index: number) => void;

  constructor(cb: UICallbacks) {
    this.starReveal = (index) => cb.onStarReveal(index);
    must<HTMLButtonElement>('btn-free').addEventListener('click', () => cb.onMode('free'));
    must<HTMLButtonElement>('btn-rush').addEventListener('click', () => cb.onMode('rush'));
    must<HTMLButtonElement>('btn-daily').addEventListener('click', () => cb.onMode('daily'));
    this.doneBtn.addEventListener('click', () => cb.onDone());
    must<HTMLButtonElement>('btn-replay').addEventListener('click', () => cb.onReplay());
    this.continueRushBtn.addEventListener('click', () => cb.onContinueRush());
    must<HTMLButtonElement>('btn-results-menu').addEventListener('click', () => cb.onMenu());
    must<HTMLButtonElement>('btn-resume').addEventListener('click', () => cb.onResume());
    must<HTMLButtonElement>('btn-pause-menu').addEventListener('click', () => cb.onMenu());
    must<HTMLButtonElement>('pause-btn').addEventListener('click', () => cb.onPause());

    // Tap-anywhere-to-replay on the results screen; real buttons (Replay /
    // Menu) keep their own behavior and are excluded so they don't double-fire.
    this.resultsScreen.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      cb.onReplay();
    });

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

  /** Cancel any in-flight results animations (star reveal, score count-up). */
  private clearResultsAnims(): void {
    for (const t of this.starTimers) window.clearTimeout(t);
    this.starTimers = [];
    if (this.countRaf) {
      cancelAnimationFrame(this.countRaf);
      this.countRaf = 0;
    }
  }

  showTitle(
    best: number,
    bestRushStars: number,
    daily?: { streak: number; doneToday: boolean },
  ): void {
    this.clearResultsAnims();
    this.show(this.hud, false);
    this.show(this.resultsScreen, false);
    this.show(this.orderCard, false);
    this.titleBest.textContent =
      best > 0 || bestRushStars > 0
        ? `Best swirl: ${best} pts · Best rush: ${bestRushStars} stars`
        : 'No scores yet — make your first swirl!';
    if (daily) {
      const btn = must<HTMLButtonElement>('btn-daily');
      btn.textContent = daily.doneToday ? 'Daily Rush ✓' : 'Daily Rush';
      must('daily-line').textContent =
        daily.streak > 0 ? `Daily streak: ${daily.streak} day${daily.streak === 1 ? '' : 's'}` : '';
    }
    this.show(this.titleScreen, true);
  }

  showHUD(mode: Mode): void {
    const rush = mode !== 'free';
    this.clearResultsAnims();
    this.show(this.titleScreen, false);
    this.show(this.resultsScreen, false);
    this.show(this.hud, true);
    this.show(this.flavorBar, rush);
    this.show(this.flavorChip, rush);
    this.show(this.orderLabel, rush);
    this.show(this.meterBand, rush);
    this.show(this.scoreChip, mode === 'free');
    this.show(this.comboChip, false);
    this.lastScore = -1;
    this.lastCombo = 1;
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

  /** Show a saved-best tick on the meter (fraction of max height), or hide it. */
  setBestMarker(frac: number | null): void {
    if (frac === null) {
      this.show(this.meterBest, false);
      return;
    }
    const f = Math.min(1, Math.max(0, frac));
    this.meterBest.style.bottom = `${(f * 100).toFixed(1)}%`;
    this.show(this.meterBest, true);
  }

  /** Live Free Swirl score chip; skips the DOM write when unchanged. */
  setScore(score: number): void {
    if (score === this.lastScore) return;
    this.lastScore = score;
    this.scoreChip.textContent = `${score} pts`;
  }

  /** Combo multiplier chip; hidden at ×1, pops when the multiplier steps up. */
  setCombo(mult: number): void {
    if (mult <= 1) {
      this.lastCombo = 1;
      this.show(this.comboChip, false);
      return;
    }
    if (mult !== this.lastCombo) {
      this.lastCombo = mult;
      this.comboChip.textContent = `×${mult}!`;
      this.comboChip.classList.remove('hot');
      void this.comboChip.offsetWidth; // restart the pop animation
      this.comboChip.classList.add('hot');
    }
    this.show(this.comboChip, true);
  }

  /** Toggle the overdrive styling on the height-meter fill. */
  setTurboMeter(on: boolean): void {
    this.meterFill.classList.toggle('turbo', on);
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

  showOrderCard(order: Order, total: number | null): void {
    this.orderCardTitle.textContent =
      total === null ? `Order ${order.index + 1}` : `Order ${order.index + 1} of ${total}`;
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
    this.clearResultsAnims();
    this.show(this.hud, false);
    this.show(this.orderCard, false);
    this.resultsTitle.textContent = view.title;
    this.resultsBest.textContent = view.bestText;
    this.resultsBest.classList.toggle('new-best', view.newBest);
    this.resultsStars.replaceChildren();

    // Score: count up from 0 when motion is allowed, else print final text.
    if (view.countUp && !REDUCED_MOTION) {
      const { to, suffix } = view.countUp;
      const DURATION = 600;
      const t0 = performance.now();
      const tick = (now: number): void => {
        const t = Math.min(1, (now - t0) / DURATION);
        const eased = 1 - Math.pow(1 - t, 3);
        this.resultsScore.textContent = `${Math.round(eased * to)}${suffix}`;
        if (t < 1) this.countRaf = requestAnimationFrame(tick);
        else this.countRaf = 0;
      };
      this.countRaf = requestAnimationFrame(tick);
    } else {
      this.resultsScore.textContent = view.scoreText;
    }

    if (view.stars) {
      const stagger = view.stars.earned > 0 && !REDUCED_MOTION;
      const spans: HTMLSpanElement[] = [];
      for (let i = 0; i < view.stars.max; i += 1) {
        const star = document.createElement('span');
        const earned = i < view.stars.earned;
        star.className = earned ? `star earned${stagger ? ' pending' : ''}` : 'star';
        star.textContent = '★';
        this.resultsStars.appendChild(star);
        spans.push(star);
      }
      if (stagger) {
        for (let i = 0; i < view.stars.earned; i += 1) {
          const star = spans[i];
          this.starTimers.push(
            window.setTimeout(() => {
              star.classList.remove('pending');
              star.classList.add('pop');
              this.starReveal(i);
            }, 200 + i * 220),
          );
        }
      }
      this.show(this.resultsStars, true);
    } else {
      this.show(this.resultsStars, false);
    }
    this.show(this.continueRushBtn, view.continueRush === true);
    this.show(this.resultsScreen, true);
  }

  /** One-shot flash on the Order Rush target band (re-entrant). */
  flashBand(): void {
    this.meterBand.classList.remove('flash');
    void this.meterBand.offsetWidth; // restart the CSS animation
    this.meterBand.classList.add('flash');
  }

  /**
   * Flavor-mismatch fairness: tint the chip red and pulse the button the
   * order actually needs. `null` clears all hint state.
   */
  setFlavorHint(target: Flavor | null): void {
    this.flavorChip.classList.toggle('mismatch', target !== null);
    for (const child of Array.from(this.flavorBar.children)) {
      const btn = child as HTMLButtonElement;
      btn.classList.toggle('hint-pulse', target !== null && btn.dataset.flavor === target);
    }
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
