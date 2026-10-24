/**
 * S'more recipe collection. Cosmetic (menu dots + serve-plate garnish);
 * unlocks are earned through play, first unlock reachable in session one.
 */
import { MEDAL_GOLD } from './constants';
import type { SaveData } from './save';

export interface Treat {
  name: string;
  /** Garnish colors for the menu dots / serve plate. */
  cracker: string;
  filling: string;
  chocolate: string;
}

export const TREATS: Treat[] = [
  { name: "Classic S'more", cracker: '#d9a860', filling: '#fdf6e8', chocolate: '#5a3620' },
  { name: 'Peanut Butter Cup', cracker: '#c89858', filling: '#e8c078', chocolate: '#4a2c18' },
  { name: 'Mint Chocolate', cracker: '#d9a860', filling: '#b8e8c8', chocolate: '#3a2418' },
];

export function treatUnlocked(index: number, save: SaveData): boolean {
  if (index === 0) return true;
  if (index === 1) return save.stats.serves >= 10;
  if (index === 2) return save.bestRush >= MEDAL_GOLD;
  return false;
}

export function treatUnlockHint(index: number): string {
  if (index === 1) return 'roast 10 mallows';
  if (index === 2) return `score ${MEDAL_GOLD}+ in a rush`;
  return '';
}

/** Stored selection if unlocked, else the highest unlocked slot. */
export function resolveTreat(save: SaveData): number {
  if (treatUnlocked(save.treat, save)) return save.treat;
  for (let i = TREATS.length - 1; i >= 0; i -= 1) {
    if (treatUnlocked(i, save)) return i;
  }
  return 0;
}
