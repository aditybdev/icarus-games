import { describe, expect, it } from 'vitest';
import {
  Line,
  Pt,
  clipHalfPlane,
  pointInPolygon,
  polygonArea,
  pt,
  reflectPoint,
  triangulate,
} from './geom';
import {
  PaperState,
  canFold,
  createPaper,
  fold,
  silhouetteMatch,
  silhouetteMismatch,
  splitLayers,
  statesEqual,
  totalArea,
} from './engine';

const SQ: Pt[] = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)];

function polyAreaSum(polys: Pt[][]): number {
  return polys.reduce((a, p) => a + polygonArea(p), 0);
}

describe('reflection math', () => {
  it('reflects known points across the x-axis', () => {
    const line: Line = { a: pt(0, 0), b: pt(1, 0) };
    expect(reflectPoint(line, pt(3, 4))).toEqual(pt(3, -4));
    expect(reflectPoint(line, pt(-2, -7))).toEqual(pt(-2, 7));
    expect(reflectPoint(line, pt(5, 0))).toEqual(pt(5, 0));
  });

  it('reflects across y = x by swapping coordinates', () => {
    const line: Line = { a: pt(0, 0), b: pt(10, 10) };
    const r = reflectPoint(line, pt(3, 8));
    expect(r.x).toBeCloseTo(8, 9);
    expect(r.y).toBeCloseTo(3, 9);
  });

  it('reflects across a vertical line x = 2', () => {
    const line: Line = { a: pt(2, 0), b: pt(2, 5) };
    const r = reflectPoint(line, pt(9, 4));
    expect(r.x).toBeCloseTo(-5, 9);
    expect(r.y).toBeCloseTo(4, 9);
  });

  it('is an involution', () => {
    const line: Line = { a: pt(1, 2), b: pt(7, -3) };
    const p = pt(-4, 9);
    const rr = reflectPoint(line, reflectPoint(line, p));
    expect(rr.x).toBeCloseTo(p.x, 9);
    expect(rr.y).toBeCloseTo(p.y, 9);
  });
});

describe('splitting', () => {
  it('clipping a square along its diagonal yields two triangles', () => {
    const diag: Line = { a: pt(0, 0), b: pt(100, 100) };
    const pos = clipHalfPlane(SQ, diag, 1);
    const neg = clipHalfPlane(SQ, diag, -1);
    expect(pos.length).toBe(3);
    expect(neg.length).toBe(3);
    expect(polygonArea(pos)).toBeCloseTo(5000, 6);
    expect(polygonArea(neg)).toBeCloseTo(5000, 6);
    // The two triangles cover the square.
    expect(pointInPolygon(pt(10, 90), pos)).toBe(true);
    expect(pointInPolygon(pt(90, 10), neg)).toBe(true);
  });

  it('splitLayers on a square diagonal gives equal halves', () => {
    const state = createPaper(SQ);
    const diag: Line = { a: pt(0, 0), b: pt(100, 100) };
    const { kept, moved, movedArea } = splitLayers(state, diag, 1);
    expect(polyAreaSum(kept.map((l) => l.poly))).toBeCloseTo(5000, 6);
    expect(polyAreaSum(moved.map((l) => l.poly))).toBeCloseTo(5000, 6);
    expect(movedArea).toBeCloseTo(5000, 6);
  });

  it('triangulates a concave polygon with correct total area', () => {
    const lShape = [pt(0, 0), pt(100, 0), pt(100, 50), pt(50, 50), pt(50, 100), pt(0, 100)];
    const tris = triangulate(lShape);
    expect(tris.length).toBeGreaterThanOrEqual(4);
    expect(polyAreaSum(tris)).toBeCloseTo(7500, 6);
  });
});

describe('folding', () => {
  it('folding a square along its diagonal yields a triangle silhouette', () => {
    const state = createPaper(SQ);
    const diag: Line = { a: pt(0, 0), b: pt(100, 100) };
    const folded = fold(state, diag, 1);
    expect(folded).not.toBe(state);
    expect(silhouetteMatch(folded, [pt(0, 0), pt(100, 0), pt(100, 100)])).toBe(true);
    // ...and it no longer matches the original square.
    expect(silhouetteMatch(folded, SQ)).toBe(false);
  });

  it('preserves total paper area (with overlap counted)', () => {
    let state = createPaper(SQ);
    const initial = totalArea(state);
    state = fold(state, { a: pt(50, 0), b: pt(50, 100) }, 1);
    state = fold(state, { a: pt(50, 50), b: pt(100, 50) }, -1);
    state = fold(state, { a: pt(50, 50), b: pt(100, 100) }, 1);
    expect(totalArea(state)).toBeCloseTo(initial, 6);
  });

  it('re-stacks moved pieces on top (origami convention)', () => {
    const state = createPaper(SQ);
    const mid: Line = { a: pt(50, 0), b: pt(50, 100) };
    const { kept, moved } = splitLayers(state, mid, 1);
    expect(kept.length).toBeGreaterThan(0);
    expect(moved.length).toBeGreaterThan(0);
    const maxKeptZ = Math.max(...kept.map((l) => l.z));
    const minMovedZ = Math.min(...moved.map((l) => l.z));
    expect(minMovedZ).toBeGreaterThan(maxKeptZ);
    const folded = fold(state, mid, 1);
    const sorted = folded.layers.slice().sort((a, b) => a.z - b.z);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].z).toBeGreaterThan(sorted[i - 1].z);
    }
  });

  it('flips the layer side flag on moved pieces', () => {
    const state = createPaper(SQ);
    const folded = fold(state, { a: pt(50, 0), b: pt(50, 100) }, 1);
    const flips = folded.layers.map((l) => l.flip);
    expect(flips).toContain(true);
    expect(flips).toContain(false);
  });

  it('handles concave paper correctly (L-shape folds into a rectangle)', () => {
    const lShape = [pt(0, 0), pt(100, 0), pt(100, 50), pt(50, 50), pt(50, 100), pt(0, 100)];
    const state = createPaper(lShape);
    const crease: Line = { a: pt(0, 50), b: pt(50, 50) };
    expect(canFold(state, crease, 1)).toBe(true);
    const folded = fold(state, crease, 1);
    expect(
      silhouetteMatch(folded, [pt(0, 0), pt(100, 0), pt(100, 50), pt(0, 50)]),
    ).toBe(true);
  });

  it('invalid fold (no paper on moving side) is a no-op', () => {
    const state = createPaper(SQ);
    // All paper sits on the + side of this remote line, so folding -1 moves nothing.
    const farAway: Line = { a: pt(500, 0), b: pt(500, 100) };
    expect(canFold(state, farAway, -1)).toBe(false);
    const result = fold(state, farAway, -1);
    expect(result).toBe(state); // same reference: exact no-op
    // Folding the whole sheet over a boundary line is legal (paper flips over)...
    const edge: Line = { a: pt(100, 0), b: pt(100, 100) };
    expect(canFold(state, edge, 1)).toBe(true);
    // ...but folding the empty side is a no-op.
    expect(canFold(state, edge, -1)).toBe(false);
    expect(fold(state, edge, -1)).toBe(state);
  });

  it('degenerate crease (zero-length line) is a safe no-op, never NaN', () => {
    const state = createPaper(SQ);
    const dot: Line = { a: pt(50, 50), b: pt(50, 50) };
    expect(canFold(state, dot, 1)).toBe(false);
    expect(canFold(state, dot, -1)).toBe(false);
    expect(fold(state, dot, 1)).toBe(state); // same reference: exact no-op
    // State stays fully valid (no NaN leaked into coordinates).
    for (const layer of state.layers) {
      for (const p of layer.poly) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it('is deterministic across repeated runs', () => {
    const seq: [Line, 1 | -1][] = [
      [{ a: pt(0, 0), b: pt(100, 100) }, 1],
      [{ a: pt(0, 100), b: pt(100, 0) }, 1],
      [{ a: pt(50, 0), b: pt(50, 50) }, 1],
    ];
    const run = (): PaperState => {
      let s = createPaper(SQ);
      for (const [line, side] of seq) s = fold(s, line, side);
      return s;
    };
    expect(statesEqual(run(), run())).toBe(true);
  });
});

describe('undo via snapshot stack', () => {
  it('restores the exact previous state', () => {
    const history: PaperState[] = [];
    let state = createPaper(SQ);
    const moves: [Line, 1 | -1][] = [
      [{ a: pt(50, 0), b: pt(50, 100) }, 1],
      [{ a: pt(50, 50), b: pt(100, 50) }, -1],
      [{ a: pt(50, 50), b: pt(100, 100) }, 1],
    ];
    const snapshots: PaperState[] = [state];
    for (const [line, side] of moves) {
      history.push(state);
      state = fold(state, line, side);
      snapshots.push(state);
    }
    for (let i = moves.length - 1; i >= 0; i--) {
      const restored = history.pop();
      expect(restored).toBeDefined();
      state = restored as PaperState;
      expect(statesEqual(state, snapshots[i])).toBe(true);
    }
  });
});

describe('silhouette matching', () => {
  it('matches independently of translation and scale', () => {
    const state = createPaper(SQ);
    const scaled = [pt(500, 500), pt(700, 500), pt(700, 700), pt(500, 700)];
    expect(silhouetteMatch(state, scaled)).toBe(true);
  });

  it('rejects wrong aspect ratios', () => {
    const state = createPaper(SQ);
    const wide = [pt(0, 0), pt(200, 0), pt(200, 100), pt(0, 100)];
    expect(silhouetteMatch(state, wide)).toBe(false);
  });

  it('mismatch grows monotonically for near misses', () => {
    const state = createPaper(SQ);
    const exact = [pt(50, 0), pt(100, 0), pt(100, 100), pt(50, 100)];
    const folded = fold(state, { a: pt(50, 0), b: pt(50, 100) }, 1);
    const good = silhouetteMismatch(folded, exact);
    const off = silhouetteMismatch(folded, [
      pt(40, 0),
      pt(100, 0),
      pt(100, 100),
      pt(40, 100),
    ]);
    expect(good).toBeLessThan(0.02);
    expect(off).toBeGreaterThan(good);
  });
});
