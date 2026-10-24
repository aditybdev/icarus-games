/**
 * Box-skin data + unlock rules (node-testable, no DOM). Skins are pure
 * palette/label structs consumed by the renderer's drawBox; unlocks derive
 * from save progress (medals earned, lifetime tissues pulled).
 */
import type { RoundSize } from './constants';
import { MEDAL_ORDER, bestMedalFor, type Medal } from './medals';
import type { SaveData } from './save';

export interface BoxSkin {
  readonly name: string;
  /** Brand text on the box front. */
  readonly label: string;
  readonly sublabel: string;
  /** Body vertical gradient. */
  readonly bodyTop: string;
  readonly bodyBottom: string;
  /** Slot + label contrast color. */
  readonly slot: string;
  /** Polka-dot pattern color. */
  readonly dot: string;
}

export const BOX_SKINS: readonly BoxSkin[] = [
  {
    name: 'Classic',
    label: 'SOFTIES',
    sublabel: 'cloud-soft tissues',
    bodyTop: '#a5e3ff',
    bodyBottom: '#5fb8ef',
    slot: '#2e6b96',
    dot: 'rgba(255,255,255,0.16)',
  },
  {
    name: 'Breezy',
    label: 'BREEZY',
    sublabel: 'mint-fresh tissues',
    bodyTop: '#a8f0cd',
    bodyBottom: '#4ecb92',
    slot: '#1f7a54',
    dot: 'rgba(255,255,255,0.2)',
  },
  {
    name: 'Puffy',
    label: 'PUFFY',
    sublabel: 'powder-pink tissues',
    bodyTop: '#ffd3e6',
    bodyBottom: '#ff8fbe',
    slot: '#b04a7d',
    dot: 'rgba(255,255,255,0.22)',
  },
  {
    name: 'Luxe',
    label: 'LUXE',
    sublabel: 'golden-touch tissues',
    bodyTop: '#ffe9a8',
    bodyBottom: '#f0b13d',
    slot: '#8a5a12',
    dot: 'rgba(255,255,255,0.28)',
  },
];

/** Total lifetime pulls needed to unlock the Breezy skin. */
export const SKIN_PULLS_UNLOCK = 100;

/** True when any size's best time earns at least the given medal. */
export function hasMedalAtLeast(save: SaveData, medal: Medal): boolean {
  const need = MEDAL_ORDER.indexOf(medal);
  for (const size of [25, 50, 100] as RoundSize[]) {
    const earned = bestMedalFor(size, save.bestMs[size]);
    if (earned !== null && MEDAL_ORDER.indexOf(earned) >= need) return true;
  }
  return false;
}

/**
 * Human-readable unlock condition for a locked skin ("" when the skin is
 * free by default or the index is unknown). Surfaced on the locked picker
 * dots so the chase is communicated, not just the lock.
 */
export function skinUnlockHint(index: number): string {
  switch (index) {
    case 1:
      return `pull ${SKIN_PULLS_UNLOCK} tissues total`;
    case 2:
      return 'earn any silver medal';
    case 3:
      return 'earn any gold medal';
    default:
      return '';
  }
}

/** Unlock predicate per skin index: medals for Puffy/Luxe, pulls for Breezy. */
export function skinUnlocked(index: number, save: SaveData): boolean {
  switch (index) {
    case 0:
      return true;
    case 1:
      return save.stats.totalPulled >= SKIN_PULLS_UNLOCK;
    case 2:
      return hasMedalAtLeast(save, 'silver');
    case 3:
      return hasMedalAtLeast(save, 'gold');
    default:
      return false;
  }
}

/** Clamp a persisted skin index to one that exists and is unlocked. */
export function resolveSkin(save: SaveData): number {
  const i = Math.floor(save.skin);
  return i >= 0 && i < BOX_SKINS.length && skinUnlocked(i, save) ? i : 0;
}
