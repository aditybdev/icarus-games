import { describe, expect, it } from 'vitest';
import { LEVELS, Level } from './levels';
import {
  PaperState,
  canFold,
  createPaper,
  fold,
  silhouetteMatch,
  silhouetteMismatch,
  totalArea,
} from './engine/engine';
import { Line } from './engine/geom';

function creaseLine(level: Level, id: string): Line {
  const c = level.creases.find((k) => k.id === id);
  if (!c) throw new Error(`Level ${level.id}: unknown crease '${id}'`);
  return { a: c.a, b: c.b };
}

describe('level data sanity', () => {
  it('has 30 levels with unique ids 1..30', () => {
    expect(LEVELS.length).toBe(30);
    LEVELS.forEach((l, i) => expect(l.id).toBe(i + 1));
  });

  it('every solution step references an existing crease and valid side', () => {
    for (const level of LEVELS) {
      expect(level.solution.length).toBeGreaterThan(0);
      expect(level.solution.length).toBeLessThanOrEqual(4);
      for (const step of level.solution) {
        expect(level.creases.some((c) => c.id === step.creaseId)).toBe(true);
        expect(step.side === 1 || step.side === -1).toBe(true);
      }
      expect(level.paper.length).toBeGreaterThanOrEqual(3);
      expect(level.target.length).toBeGreaterThanOrEqual(3);
    }
  });
});

/**
 * The repo gate: replay every level's authored solution through the real
 * geometry engine and assert the resulting silhouette matches the
 * independently authored target. This proves every puzzle is solvable.
 */
describe('every level is solvable with its authored solution', () => {
  for (const level of LEVELS) {
    it(`level ${level.id} "${level.name}" (${level.solution.length} fold${level.solution.length > 1 ? 's' : ''})`, () => {
      let state: PaperState = createPaper(level.paper);
      const initialArea = totalArea(state);
      for (const step of level.solution) {
        const line = creaseLine(level, step.creaseId);
        expect(
          canFold(state, line, step.side),
          `level ${level.id}: crease ${step.creaseId} side ${step.side} must move paper`,
        ).toBe(true);
        state = fold(state, line, step.side);
        // Folding never creates or destroys paper.
        expect(totalArea(state)).toBeCloseTo(initialArea, 6);
      }
      const mismatch = silhouetteMismatch(state, level.target);
      expect(
        silhouetteMatch(state, level.target),
        `level ${level.id} "${level.name}": silhouette mismatch ${(mismatch * 100).toFixed(2)}% exceeds 2%`,
      ).toBe(true);
    });
  }
});

describe('level progression shape', () => {
  it('starts with single-fold puzzles and grows to multi-fold puzzles', () => {
    expect(LEVELS[0].solution.length).toBe(1);
    expect(LEVELS[1].solution.length).toBe(1);
    expect(LEVELS[2].solution.length).toBe(1);
    const maxFolds = Math.max(...LEVELS.map((l) => l.solution.length));
    expect(maxFolds).toBeGreaterThanOrEqual(4);
    const multiFold = LEVELS.filter((l) => l.solution.length >= 3).length;
    expect(multiFold).toBeGreaterThanOrEqual(8);
  });
});
