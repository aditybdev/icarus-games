/**
 * Skim — stone collection. Unlockables give the chase beyond the medal
 * ladder (endowed progress: the first unlock lands inside session 1).
 * Pure data + predicates; unit-tested.
 */
import { MEDAL_GOLD_M, MEDAL_SILVER_M } from './constants';
import type { SaveData } from './save';

export interface StoneSkin {
  name: string;
  /** Stone body + band colors for the renderer. */
  body: string;
  band: string;
  dark: string;
}

export const STONE_SKINS: readonly StoneSkin[] = [
  { name: 'Granite', body: '#8d9299', band: '#6e747b', dark: '#565b61' },
  { name: 'River Slate', body: '#5b7a8c', band: '#476474', dark: '#354d5a' },
  { name: 'Meteorite', body: '#4a3f5c', band: '#d9813a', dark: '#322b40' },
];

export const THROWS_UNLOCK = 10;

/** Unlock predicate per stone index. */
export function stoneUnlocked(index: number, save: SaveData): boolean {
  switch (index) {
    case 0:
      return true;
    case 1:
      return save.stats.throws >= THROWS_UNLOCK;
    case 2:
      return save.bestM >= MEDAL_GOLD_M;
    default:
      return false;
  }
}

/** Human-readable unlock condition for a locked stone ("" when free/unknown). */
export function stoneUnlockHint(index: number): string {
  switch (index) {
    case 1:
      return `throw ${THROWS_UNLOCK} stones`;
    case 2:
      return `skim past ${MEDAL_GOLD_M} m (gold)`;
    default:
      return '';
  }
}

/** Valid unlocked selection, else fall back to Granite. */
export function resolveStone(save: SaveData): number {
  return stoneUnlocked(save.stone, save) ? save.stone : 0;
}

export { MEDAL_SILVER_M };
