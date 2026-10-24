/**
 * Condiment collection. Cosmetic skins (bottle tint + blob color + label);
 * unlocks are earned through play, first unlock reachable in session one.
 */
import { MEDAL_GOLD } from './constants';
import type { SaveData } from './save';

export interface BottleSkin {
  name: string;
  /** Bottle glass tint, blob color, label accent. */
  glass: string;
  blob: string;
  label: string;
  cap: string;
}

export const BOTTLE_SKINS: BottleSkin[] = [
  { name: 'Classic Ketchup', glass: '#e8b48c', blob: '#d9381e', label: '#f4f0e6', cap: '#d9381e' },
  { name: 'Yellow Mustard', glass: '#f0d9a0', blob: '#f2c018', label: '#fdf6e0', cap: '#e0a800' },
  { name: 'Sriracha', glass: '#f0a898', blob: '#c2272f', label: '#f8f0d8', cap: '#2e8b57' },
];

export function bottleUnlocked(index: number, save: SaveData): boolean {
  if (index === 0) return true;
  if (index === 1) return save.stats.serves >= 10;
  if (index === 2) return save.bestRush >= MEDAL_GOLD;
  return false;
}

export function bottleUnlockHint(index: number): string {
  if (index === 1) return 'serve 10 orders';
  if (index === 2) return `score ${MEDAL_GOLD}+ in a rush`;
  return '';
}

/** Stored selection if unlocked, else the highest unlocked slot. */
export function resolveBottle(save: SaveData): number {
  if (bottleUnlocked(save.bottle, save)) return save.bottle;
  for (let i = BOTTLE_SKINS.length - 1; i >= 0; i -= 1) {
    if (bottleUnlocked(i, save)) return i;
  }
  return 0;
}
