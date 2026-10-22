/**
 * Fold engine — pure TypeScript, no DOM.
 *
 * Paper state is an ordered list of polygon layers. Each layer is a simple
 * polygon (convex pieces after the first fold) with a z index; higher z is
 * drawn on top. A fold:
 *   1. Splits every layer by the crease line. Concave layers are handled by
 *      ear-clip triangulation followed by per-triangle Sutherland–Hodgman
 *      half-plane clipping, so arbitrary simple polygons split correctly.
 *   2. Reflects every piece on the moving side across the crease line.
 *   3. Re-stacks the moved pieces on top of everything (origami convention),
 *      preserving their relative order.
 *
 * The engine never mutates its inputs, so undo is just keeping previous
 * states on a stack. Everything is deterministic: identical inputs produce
 * identical outputs.
 */

import {
  AREA_EPS,
  BBox,
  EPS,
  Line,
  Pt,
  bboxOf,
  clipHalfPlane,
  lineLength,
  pointInPolygon,
  polygonArea,
  reflectPoint,
  triangulate,
} from './geom';

export interface Layer {
  poly: Pt[];
  z: number;
  /** True when the layer has been flipped an odd number of times (back side up). */
  flip: boolean;
}

export interface PaperState {
  layers: Layer[];
}

export function createPaper(poly: Pt[]): PaperState {
  return {
    layers: [{ poly: poly.map((p) => ({ x: p.x, y: p.y })), z: 0, flip: false }],
  };
}

export interface SplitResult {
  /** Pieces remaining on the stationary side, z-ordered bottom to top. */
  kept: Layer[];
  /** Pieces on the moving side (NOT yet reflected), z-ordered as they will stack. */
  moved: Layer[];
  /** Total paper area on the moving side. */
  movedArea: number;
}

/**
 * Split every layer of the state along the crease line into stationary and
 * moving pieces. `side` selects which half-plane moves (+1 or -1).
 */
export function splitLayers(state: PaperState, line: Line, side: 1 | -1): SplitResult {
  const sorted = state.layers.slice().sort((a, b) => a.z - b.z);
  const kept: Layer[] = [];
  const moved: Layer[] = [];
  let movedArea = 0;
  let z = 0;
  const keepSide: 1 | -1 = side === 1 ? -1 : 1;
  for (const layer of sorted) {
    for (const tri of triangulate(layer.poly)) {
      const k = clipHalfPlane(tri, line, keepSide);
      if (k.length >= 3 && polygonArea(k) > AREA_EPS) {
        kept.push({ poly: k, z: z++, flip: layer.flip });
      }
      const m = clipHalfPlane(tri, line, side);
      const ma = polygonArea(m);
      if (m.length >= 3 && ma > AREA_EPS) {
        moved.push({ poly: m, z: 0, flip: layer.flip });
        movedArea += ma;
      }
    }
  }
  moved.forEach((l, i) => {
    l.z = kept.length + i;
  });
  return { kept, moved, movedArea };
}

/** A fold is only meaningful when there is paper on the moving side. */
export function canFold(state: PaperState, line: Line, side: 1 | -1): boolean {
  if (lineLength(line) <= EPS) return false; // degenerate crease: no fold line
  return splitLayers(state, line, side).movedArea > 1e-6;
}

/**
 * Fold the paper. Returns a brand-new state; if there is nothing on the
 * moving side the input state is returned unchanged (invalid fold = no-op).
 */
export function fold(state: PaperState, line: Line, side: 1 | -1): PaperState {
  if (lineLength(line) <= EPS) return state; // degenerate crease: safe no-op
  const { kept, moved, movedArea } = splitLayers(state, line, side);
  if (movedArea <= 1e-6) return state;
  const flipped: Layer[] = moved.map((l) => ({
    poly: l.poly.map((p) => reflectPoint(line, p)),
    z: l.z,
    flip: !l.flip,
  }));
  return { layers: kept.concat(flipped) };
}

/** Sum of all layer areas (counts overlaps; invariant under folding). */
export function totalArea(state: PaperState): number {
  let s = 0;
  for (const l of state.layers) s += polygonArea(l.poly);
  return s;
}

/** Exact structural equality (used by undo-exactness tests). */
export function statesEqual(a: PaperState, b: PaperState): boolean {
  if (a.layers.length !== b.layers.length) return false;
  for (let i = 0; i < a.layers.length; i++) {
    const la = a.layers[i];
    const lb = b.layers[i];
    if (la.z !== lb.z || la.flip !== lb.flip || la.poly.length !== lb.poly.length) {
      return false;
    }
    for (let j = 0; j < la.poly.length; j++) {
      if (la.poly[j].x !== lb.poly[j].x || la.poly[j].y !== lb.poly[j].y) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Silhouette matching (pure, deterministic grid sampling — no canvas needed)
// ---------------------------------------------------------------------------

interface NormFit {
  minx: number;
  miny: number;
  s: number;
  ox: number;
  oy: number;
}

function fitToUnit(pts: Pt[]): NormFit {
  const bb: BBox = bboxOf(pts);
  const w = Math.max(bb.maxx - bb.minx, 1e-9);
  const h = Math.max(bb.maxy - bb.miny, 1e-9);
  const s = 1 / Math.max(w, h);
  return {
    minx: bb.minx,
    miny: bb.miny,
    s,
    ox: (1 - w * s) / 2,
    oy: (1 - h * s) / 2,
  };
}

function mapPt(fit: NormFit, p: Pt): Pt {
  return { x: (p.x - fit.minx) * fit.s + fit.ox, y: (p.y - fit.miny) * fit.s + fit.oy };
}

/**
 * Rasterize-free silhouette comparison: both the paper union and the target
 * polygon are normalized independently into the unit square, then sampled on
 * a deterministic n x n grid. Returns the fraction of mismatching cells
 * relative to the larger shape (0 = identical silhouettes).
 */
export function silhouetteMismatch(
  state: PaperState,
  target: Pt[],
  n = 128,
): number {
  if (state.layers.length === 0 || target.length < 3) return 1;
  const paperPolys = state.layers.map((l) => l.poly);
  const allPts: Pt[] = [];
  for (const poly of paperPolys) for (const p of poly) allPts.push(p);
  if (allPts.length === 0) return 1;

  const paperFit = fitToUnit(allPts);
  const targetFit = fitToUnit(target);
  const mappedPaper = paperPolys.map((poly) => poly.map((p) => mapPt(paperFit, p)));
  const mappedTarget = target.map((p) => mapPt(targetFit, p));

  let paperCount = 0;
  let targetCount = 0;
  let diff = 0;
  for (let j = 0; j < n; j++) {
    const y = (j + 0.5) / n;
    for (let i = 0; i < n; i++) {
      const q: Pt = { x: (i + 0.5) / n, y };
      let inPaper = false;
      for (const poly of mappedPaper) {
        if (pointInPolygon(q, poly)) {
          inPaper = true;
          break;
        }
      }
      const inTarget = pointInPolygon(q, mappedTarget);
      if (inPaper) paperCount++;
      if (inTarget) targetCount++;
      if (inPaper !== inTarget) diff++;
    }
  }
  if (paperCount === 0 || targetCount === 0) return 1;
  return diff / Math.max(paperCount, targetCount);
}

/** Solved when silhouettes differ by at most ~2% of the shape area. */
export function silhouetteMatch(state: PaperState, target: Pt[], tol = 0.02): boolean {
  return silhouetteMismatch(state, target) <= tol;
}
