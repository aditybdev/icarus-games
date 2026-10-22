/**
 * DOM UI layer: menu, countdown, HUD, pause and results screens.
 * All gameplay drawing happens on the canvas; this only manages overlays.
 */
import { ROUND_SIZES, type RoundSize } from '../core/constants';
import { bestMedalFor, type Medal } from '../core/medals';
import { formatMs } from '../core/round';
import type { SaveData } from '../core/save';
import { BOX_SKINS, skinUnlocked } from '../core/skins';

export interface ResultsData {
  timeText: string;
  avgText: string;
  /** Near-miss line vs the previous best ("" when there was no best). */
  deltaText: string;
  /** True when the player finished ahead of the previous best. */
  deltaAhead: boolean;
  size: RoundSize;
  /** Overrides the "Round of N" line (e.g. blitz results). */
  sizeText?: string;
  bestText: string;
  newBest: boolean;
  /** Medal earned this round (null: no medal line). */
  medal: Medal | null;
  /** "next medal in 1.3 s" chase line ("" hides it). */
  nextMedalText: string;
}

export interface UICallbacks {
  onPlay(size: RoundSize): void;
  onBlitz(): void;
  onReplay(): void;
  onMenu(): void;
  onResume(): void;
  onPause(): void;
  onRestart(): void;
  onSkin(index: number): void;
}

const MEDAL_TEXT: Record<Medal, string> = {
  bronze: 'Bronze medal!',
  silver: 'Silver medal!',
  gold: 'GOLD MEDAL!',
};

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

export class UI {
  private readonly hud = el('hud');
  private readonly remainingEl = el('remaining');
  private readonly remainingSub: HTMLElement;
  private readonly timerEl = el('timer');
  private readonly streakEl = el('streak-pop');
  private readonly streakChip = el('streak-chip');
  private readonly paceChip = el('pace-chip');
  private paceBehind: boolean | null = null;
  private readonly screenMenu = el('screen-menu');
  private readonly screenCountdown = el('screen-countdown');
  private readonly screenPause = el('screen-pause');
  private readonly screenResults = el('screen-results');
  private readonly countSize = el('count-size');
  private readonly countNum = el('count-num');
  private readonly resultsTime = el('results-time');
  private readonly resultsAvg = el('results-avg');
  private readonly resultsDelta = el('results-delta');
  private readonly resultsMedal = el('results-medal');
  private readonly resultsNextMedal = el('results-next-medal');
  private readonly resultsSize = el('results-size');
  private readonly resultsBest = el('results-best');
  private readonly menuStats = el('menu-stats');
  private readonly skinRow = el('skin-row');
  private readonly skinDots: HTMLButtonElement[] = [];

  constructor(cb: UICallbacks) {
    for (const size of ROUND_SIZES) {
      const btn = document.querySelector<HTMLButtonElement>(`.size-btn[data-size="${size}"]`);
      btn?.addEventListener('click', () => cb.onPlay(size));
    }
    const sub = this.remainingEl.parentElement?.querySelector<HTMLElement>('.chip-sub');
    if (!sub) throw new Error('missing .chip-sub');
    this.remainingSub = sub;
    el<HTMLButtonElement>('btn-blitz').addEventListener('click', () => cb.onBlitz());
    el<HTMLButtonElement>('pause-btn').addEventListener('click', () => cb.onPause());
    el<HTMLButtonElement>('btn-resume').addEventListener('click', () => cb.onResume());
    el<HTMLButtonElement>('btn-pause-restart').addEventListener('click', () => cb.onRestart());
    el<HTMLButtonElement>('btn-pause-menu').addEventListener('click', () => cb.onMenu());
    el<HTMLButtonElement>('btn-replay').addEventListener('click', () => cb.onReplay());
    el<HTMLButtonElement>('btn-results-menu').addEventListener('click', () => cb.onMenu());

    // Build the skin-picker dots once from the skin data.
    BOX_SKINS.forEach((skin, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'skin-dot';
      dot.style.background = `linear-gradient(${skin.bodyTop}, ${skin.bodyBottom})`;
      dot.addEventListener('click', () => cb.onSkin(index));
      this.skinRow.appendChild(dot);
      this.skinDots.push(dot);
    });
  }

  private hideScreens(): void {
    this.screenMenu.hidden = true;
    this.screenCountdown.hidden = true;
    this.screenPause.hidden = true;
    this.screenResults.hidden = true;
  }

  showMenu(save: SaveData): void {
    this.hideScreens();
    this.hud.hidden = true;
    for (const size of ROUND_SIZES) {
      const best = save.bestMs[size];
      el(`best-${size}`).textContent = best === null ? 'no time yet' : `best ${formatMs(best)}`;
      // Medal dot: the best medal ever earned on this size.
      const dot = el(`medal-${size}`);
      dot.classList.remove('bronze', 'silver', 'gold');
      const medal = bestMedalFor(size, best);
      if (medal) dot.classList.add(medal);
    }
    // Lifetime stats line ("312 rounds · best streak 18").
    const { roundsPlayed, totalPulled, bestStreak } = save.stats;
    if (roundsPlayed > 0) {
      this.menuStats.textContent =
        `${roundsPlayed} rounds · ${totalPulled} pulled · best streak ${bestStreak}`;
      this.menuStats.hidden = false;
    } else {
      this.menuStats.hidden = true;
    }
    // Skin picker: unlocked dots are tappable, locked ones greyed out.
    BOX_SKINS.forEach((skin, index) => {
      const dot = this.skinDots[index];
      const unlocked = skinUnlocked(index, save);
      dot.classList.toggle('locked', !unlocked);
      dot.classList.toggle('selected', index === save.skin);
      dot.setAttribute(
        'aria-label',
        unlocked ? `${skin.name} box skin` : `${skin.name} box skin (locked)`,
      );
    });
    this.screenMenu.hidden = false;
  }

  showCountdown(label: string): void {
    this.hideScreens();
    this.countSize.textContent = label;
    this.countNum.textContent = '3';
    this.screenCountdown.hidden = false;
  }

  setCountdown(label: string): void {
    if (this.countNum.textContent !== label) this.countNum.textContent = label;
  }

  hideCountdown(): void {
    this.screenCountdown.hidden = true;
  }

  /** mode 'time': counts remaining tissues; 'blitz': shows the live score. */
  showHUD(size: number, mode: 'time' | 'blitz' = 'time'): void {
    this.hud.hidden = false;
    this.remainingSub.textContent = mode === 'blitz' ? 'pts' : 'left';
    this.setRemaining(size);
    this.setTimer(mode === 'blitz' ? '00:30.0' : '00:00.0');
    // Fresh round: clear the previous round's streak/pace indicators.
    this.streakChip.hidden = true;
    this.paceChip.hidden = true;
    this.paceBehind = null;
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

  /** Update the live streak chip ("xN"); hot turns it Blazing pink. */
  setStreak(count: number, hot: boolean): void {
    const text = `×${count}`;
    if (this.streakChip.hidden) this.streakChip.hidden = false;
    if (this.streakChip.textContent !== text) this.streakChip.textContent = text;
    this.streakChip.classList.toggle('hot', hot);
    // A lingering flash class would mask the bump animation (later rule
    // wins), so clear it whenever the chain ticks up again.
    this.streakChip.classList.remove('bump', 'flash');
    // Restart the bump animation.
    void this.streakChip.offsetWidth;
    this.streakChip.classList.add('bump');
  }

  /** Flash the streak chip red — a mercy was spent or the chain broke. */
  flashStreak(): void {
    if (this.streakChip.hidden) this.streakChip.hidden = false;
    this.streakChip.classList.remove('flash', 'bump');
    // Restart the flash animation.
    void this.streakChip.offsetWidth;
    this.streakChip.classList.add('flash');
  }

  hideStreak(): void {
    if (!this.streakChip.hidden) this.streakChip.hidden = true;
  }

  /**
   * Update the live pace chip ("-0.4 s" ahead / "+1.2 s" behind vs best
   * pace), or hide it when there is nothing to compare against.
   */
  setPace(text: string | null, behind: boolean): void {
    if (text === null) {
      if (!this.paceChip.hidden) this.paceChip.hidden = true;
      this.paceBehind = null;
      return;
    }
    if (this.paceChip.hidden) this.paceChip.hidden = false;
    if (this.paceChip.textContent !== text) this.paceChip.textContent = text;
    if (this.paceBehind !== behind) {
      this.paceBehind = behind;
      this.paceChip.classList.toggle('behind', behind);
    }
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
    this.resultsDelta.textContent = data.deltaText;
    this.resultsDelta.hidden = data.deltaText === '';
    this.resultsDelta.classList.toggle('ahead', data.deltaAhead);
    this.resultsDelta.classList.toggle('behind', !data.deltaAhead);
    // Medal reveal: pops in with the earned medal's color, hidden when none.
    this.resultsMedal.classList.remove('bronze', 'silver', 'gold', 'show');
    if (data.medal) {
      this.resultsMedal.textContent = MEDAL_TEXT[data.medal];
      this.resultsMedal.classList.add(data.medal);
      this.resultsMedal.hidden = false;
      // Restart the pop animation.
      void this.resultsMedal.offsetWidth;
      this.resultsMedal.classList.add('show');
    } else {
      this.resultsMedal.hidden = true;
    }
    this.resultsNextMedal.textContent = data.nextMedalText;
    this.resultsNextMedal.hidden = data.nextMedalText === '';
    this.resultsSize.textContent = data.sizeText ?? `Round of ${data.size}`;
    this.resultsBest.textContent = data.bestText;
    this.resultsBest.classList.toggle('new-best', data.newBest);
    this.screenResults.hidden = false;
  }
}
