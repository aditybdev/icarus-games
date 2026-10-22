/**
 * Daily Fold — deterministic daily level picker. Pure module, no DOM.
 *
 * The same UTC calendar date always yields the same level index worldwide:
 * the date is hashed into a uint32 seed (dateSeedUTC) and one draw from
 * mulberry32 picks the level.
 */

import { dateSeedUTC, mulberry32 } from '@icarus/platform';
import { LEVELS } from './levels';

export const DAILY_LEVEL_COUNT = LEVELS.length;

/** Index into LEVELS for the given UTC date (today by default). */
export function dailyLevelIndex(
  date: Date = new Date(),
  levelCount: number = DAILY_LEVEL_COUNT,
): number {
  return Math.floor(mulberry32(dateSeedUTC(date))() * levelCount);
}
