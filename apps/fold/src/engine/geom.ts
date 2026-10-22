/**
 * Pure 2D geometry primitives for the Fold engine.
 * No DOM access — safe to run in Node (unit tests).
 *
 * Conventions:
 *  - Points are plain {x, y} objects, y-down (screen-like) but math is
 *    orientation-agnostic.
 *  - A crease line is a segment {a, b}; the *line* through a and b is what
 *    matters for folding.
 *  - "side" of a line for a point p is the sign of the cross product
 *    (b - a) x (p - a). Positive side => side = +1.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Line {
  a: Pt;
  b: Pt;
}

export const EPS = 1e-9;
/** Minimum area (in square paper units) for a clipped piece to be kept. */
export const AREA_EPS = 1e-6;

export function pt(x: number, y: number): Pt {
  return { x, y };
}

/** Cross product (b - a) x (c - a). */
export function cross3(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Signed side of point p relative to the directed line a -> b. */
export function lineSide(l: Line, p: Pt): number {
  return cross3(l.a, l.b, p);
}

export function lineLength(l: Line): number {
  return Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
}

/** Foot of the perpendicular from p onto the line. */
export function footOf(l: Line, p: Pt): Pt {
  const dx = l.b.x - l.a.x;
  const dy = l.b.y - l.a.y;
  const len2 = dx * dx + dy * dy;
  const t = ((p.x - l.a.x) * dx + (p.y - l.a.y) * dy) / len2;
  return { x: l.a.x + t * dx, y: l.a.y + t * dy };
}

/** Signed perpendicular distance from p to the line (positive on + side). */
export function signedDist(l: Line, p: Pt): number {
  return lineSide(l, p) / lineLength(l);
}

/** Reflect point p across the line. Reflection is an involution. */
export function reflectPoint(l: Line, p: Pt): Pt {
  const f = footOf(l, p);
  return { x: 2 * f.x - p.x, y: 2 * f.y - p.y };
}

/** Signed area of a polygon (positive for CCW winding). */
export function signedArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function polygonArea(poly: Pt[]): number {
  return Math.abs(signedArea(poly));
}

/** Remove consecutive (and closing) duplicate points within EPS. */
export function dedupe(poly: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.abs(p.x - last.x) > EPS || Math.abs(p.y - last.y) > EPS) {
      out.push(p);
    }
  }
  if (out.length > 1) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.abs(f.x - l.x) <= EPS && Math.abs(f.y - l.y) <= EPS) out.pop();
  }
  return out;
}

/**
 * Sutherland–Hodgman half-plane clip: keeps the part of `poly` on the
 * `keep` side of the line (keep = +1 keeps points with lineSide >= 0).
 * Robust for convex input (we always feed it convex pieces).
 */
export function clipHalfPlane(poly: Pt[], l: Line, keep: 1 | -1): Pt[] {
  const out: Pt[] = [];
  const n = poly.length;
  if (n < 3) return out;
  for (let i = 0; i < n; i++) {
    const cur = poly[i];
    const nxt = poly[(i + 1) % n];
    const dc = lineSide(l, cur) * keep;
    const dn = lineSide(l, nxt) * keep;
    const curIn = dc >= -EPS;
    const nxtIn = dn >= -EPS;
    if (curIn) out.push(cur);
    if (curIn !== nxtIn) {
      const t = dc / (dc - dn);
      out.push({
        x: cur.x + (nxt.x - cur.x) * t,
        y: cur.y + (nxt.y - cur.y) * t,
      });
    }
  }
  return dedupe(out);
}

/** Strict point-in-triangle test (edges excluded) for CCW triangles. */
export function pointInTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  return (
    cross3(a, b, p) > EPS && cross3(b, c, p) > EPS && cross3(c, a, p) > EPS
  );
}

/** Inclusive point-in-triangle test (boundary counts as inside). */
function pointInOrOnTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  return (
    cross3(a, b, p) >= -EPS && cross3(b, c, p) >= -EPS && cross3(c, a, p) >= -EPS
  );
}

/**
 * Remove consecutive vertices that lie exactly on the segment between their
 * neighbors (collinear chains left over from clipping). Keeps the polygon's
 * covered region unchanged and prevents ear-clipping deadlocks.
 */
function removeCollinear(pts: Pt[]): Pt[] {
  let changed = true;
  let out = pts;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const prev = out[(i + out.length - 1) % out.length];
      const cur = out[i];
      const next = out[(i + 1) % out.length];
      if (Math.abs(cross3(prev, cur, next)) <= EPS) {
        const dot = (cur.x - prev.x) * (next.x - cur.x) + (cur.y - prev.y) * (next.y - cur.y);
        if (dot >= -EPS) {
          out = out.filter((_, j) => j !== i);
          changed = true;
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Ear-clipping triangulation of a simple polygon (convex or concave).
 * Deterministic: always clips the first ear found scanning from index 0.
 * A candidate ear is rejected when any other vertex lies inside OR on its
 * boundary — this keeps diagonals that graze reflex vertices from producing
 * overlapping triangles. Falls back to fan triangulation if numerically
 * stuck (should not happen for simple polygons).
 */
export function triangulate(poly: Pt[]): Pt[][] {
  let pts = removeCollinear(dedupe(poly));
  if (pts.length < 3) return [];
  if (signedArea(pts) < 0) pts = pts.slice().reverse();
  const idx: number[] = pts.map((_, i) => i);
  const tris: Pt[][] = [];
  let guard = 0;
  while (idx.length > 3) {
    if (guard++ > 4096) {
      for (let i = 1; i < idx.length - 1; i++) {
        tris.push([pts[idx[0]], pts[idx[i]], pts[idx[i + 1]]]);
      }
      return tris;
    }
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const a = pts[ia];
      const b = pts[ib];
      const c = pts[ic];
      if (cross3(a, b, c) <= EPS) continue; // reflex or collinear: not an ear
      let blocked = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (pointInOrOnTriangle(pts[j], a, b, c)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Numeric fallback: fan triangulation keeps us total.
      for (let i = 1; i < idx.length - 1; i++) {
        tris.push([pts[idx[0]], pts[idx[i]], pts[idx[i + 1]]]);
      }
      return tris;
    }
  }
  tris.push([pts[idx[0]], pts[idx[1]], pts[idx[2]]]);
  return tris;
}

/** Even-odd point-in-polygon test (works for concave polygons). */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export interface BBox {
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
}

export function bboxOf(pts: Pt[]): BBox {
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const p of pts) {
    if (p.x < minx) minx = p.x;
    if (p.y < miny) miny = p.y;
    if (p.x > maxx) maxx = p.x;
    if (p.y > maxy) maxy = p.y;
  }
  return { minx, miny, maxx, maxy };
}

/** Distance from p to segment ab. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
