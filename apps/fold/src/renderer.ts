/**
 * Canvas 2D renderer for Fold (DOM side). All gameplay math lives in the
 * pure engine; this module only draws.
 */

import { Layer, PaperState } from './engine/engine';
import { Line, Pt, bboxOf, footOf } from './engine/geom';
import { Level } from './levels';

export const PAPER_FRONT = '#f8f2e6';
export const PAPER_BACK = '#eee1c9';
const CREASE_COLOR = 'rgba(146, 113, 76, 0.8)';
const CREASE_SELECTED = '#c96f4a';
const CREASE_HINT = '#7d9b76';
const CREASE_FLASH = '#c0392b';

export interface FoldAnim {
  line: Line;
  side: 1 | -1;
  /** Stationary pieces (z-ordered), drawn normally during the flip. */
  kept: Layer[];
  /** Moving pieces in their pre-fold positions, interpolated during the flip. */
  moving: Layer[];
  /** Eased progress 0..1. */
  t: number;
}

export interface Scene {
  state: PaperState;
  level: Level;
  selectedId: string | null;
  hintId: string | null;
  anim: FoldAnim | null;
  flash: { id: string; until: number } | null;
  time: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface View {
  scale: number;
  ox: number;
  oy: number;
  play: Rect;
  ghost: Rect;
}

export function toScreen(v: View, p: Pt): Pt {
  return { x: p.x * v.scale + v.ox, y: p.y * v.scale + v.oy };
}

export function toPaper(v: View, x: number, y: number): Pt {
  return { x: (x - v.ox) / v.scale, y: (y - v.oy) / v.scale };
}

/**
 * Compute the paper viewport: a reserved corner panel shows the target
 * silhouette (top strip in portrait, right column in landscape).
 */
export function computeView(
  w: number,
  h: number,
  hudH: number,
  state: PaperState,
  level: Level,
): View {
  const g = Math.max(96, Math.min(160, Math.min(w, h) * 0.22));
  const ghost: Rect = { x: w - g - 14, y: hudH + 12, w: g, h: g + 26 };
  let play: Rect;
  if (h >= w) {
    const top = ghost.y + ghost.h + 10;
    play = { x: 14, y: top, w: w - 28, h: h - top - 16 };
  } else {
    play = { x: 14, y: hudH + 12, w: w - 28 - g - 14, h: h - hudH - 26 };
  }

  const pts: Pt[] = [];
  for (const layer of state.layers) for (const p of layer.poly) pts.push(p);
  for (const c of level.creases) {
    pts.push(c.a, c.b);
  }
  const bb = bboxOf(pts);
  const bbw = Math.max(bb.maxx - bb.minx, 1e-6);
  const bbh = Math.max(bb.maxy - bb.miny, 1e-6);
  const scale = Math.min(play.w / bbw, play.h / bbh) * 0.92;
  const ox = play.x + (play.w - bbw * scale) / 2 - bb.minx * scale;
  const oy = play.y + (play.h - bbh * scale) / 2 - bb.miny * scale;
  return { scale, ox, oy, play, ghost };
}

// ---------------------------------------------------------------------------
// Grain pattern (procedural, created once)
// ---------------------------------------------------------------------------

let grainPattern: CanvasPattern | null = null;

function getGrain(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (grainPattern) return grainPattern;
  const c = document.createElement('canvas');
  c.width = 140;
  c.height = 140;
  const g = c.getContext('2d');
  if (!g) return null;
  // Simple deterministic-ish speckle; visual only.
  let seed = 1234567;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 520; i++) {
    const x = rand() * 140;
    const y = rand() * 140;
    const r = rand() * 1.1 + 0.3;
    g.fillStyle = rand() > 0.5 ? 'rgba(120, 92, 58, 0.05)' : 'rgba(255, 255, 255, 0.06)';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  grainPattern = ctx.createPattern(c, 'repeat');
  return grainPattern;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function tracePoly(ctx: CanvasRenderingContext2D, v: View, poly: Pt[]): void {
  const p0 = toScreen(v, poly[0]);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < poly.length; i++) {
    const p = toScreen(v, poly[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  v: View,
  layer: Layer,
  grain: CanvasPattern | null,
): void {
  ctx.beginPath();
  tracePoly(ctx, v, layer.poly);
  ctx.fillStyle = layer.flip ? PAPER_BACK : PAPER_FRONT;
  ctx.fill();
  if (grain) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = grain;
    ctx.fill();
    ctx.restore();
  }
  // Self-stroke hides anti-aliasing seams between adjacent pieces.
  ctx.strokeStyle = layer.flip ? PAPER_BACK : PAPER_FRONT;
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function clipSegToRect(a: Pt, b: Pt, r: Rect): [Pt, Pt] | null {
  // Liang–Barsky clip of segment ab against rect r.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const checks: [number, number][] = [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return null;
    }
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

// ---------------------------------------------------------------------------
// Crease arrows (selection UI) — computed in screen space for stable 48px+
// touch targets.
// ---------------------------------------------------------------------------

export interface ArrowHit {
  cx: number;
  cy: number;
  r: number;
  side: 1 | -1;
}

export function creaseArrows(v: View, line: Line): ArrowHit[] | null {
  const A = toScreen(v, line.a);
  const B = toScreen(v, line.b);
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  if (len < 1e-6) return null;
  const dx = (B.x - A.x) / len;
  const dy = (B.y - A.y) / len;
  const nx = -dy;
  const ny = dx;
  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2;
  return [
    { cx: mx + nx * 30, cy: my + ny * 30, r: 30, side: 1 },
    { cx: mx - nx * 30, cy: my - ny * 30, r: 30, side: -1 },
  ];
}

function drawArrows(ctx: CanvasRenderingContext2D, v: View, line: Line, time: number): void {
  const A = toScreen(v, line.a);
  const B = toScreen(v, line.b);
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  if (len < 1e-6) return;
  const dx = (B.x - A.x) / len;
  const dy = (B.y - A.y) / len;
  const nx = -dy;
  const ny = dx;
  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2;
  const pulse = 1 + 0.06 * Math.sin(time / 240);
  ctx.save();
  ctx.strokeStyle = CREASE_SELECTED;
  ctx.fillStyle = CREASE_SELECTED;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const s of [1, -1] as const) {
    const tailX = mx + nx * s * 40 * pulse;
    const tailY = my + ny * s * 40 * pulse;
    const tipX = mx + nx * s * 12;
    const tipY = my + ny * s * 12;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    // Arrowhead pointing toward/across the crease.
    const bx = mx + nx * s * 20;
    const by = my + ny * s * 20;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(bx + dx * 7, by + dy * 7);
    ctx.lineTo(bx - dx * 7, by - dy * 7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Main scene render
// ---------------------------------------------------------------------------

export function renderScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  hudH: number,
  scene: Scene,
): View {
  const { state, level } = scene;
  const view = computeView(w, h, hudH, state, level);
  const grain = getGrain(ctx);

  // Background: warm cream gradient.
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#f3ecdc');
  bg.addColorStop(1, '#eadfc9');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  drawGhostPanel(ctx, view, level);

  // Which layers are stationary right now (during an animation the moving
  // ones are drawn separately with interpolation).
  const stationary = scene.anim
    ? scene.anim.kept
    : state.layers.slice().sort((a, b) => a.z - b.z);

  // Soft shadow under the whole sheet.
  ctx.save();
  ctx.shadowColor = 'rgba(96, 68, 36, 0.28)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 9;
  ctx.beginPath();
  for (const layer of stationary) tracePoly(ctx, view, layer.poly);
  ctx.fillStyle = PAPER_FRONT;
  ctx.fill();
  ctx.restore();

  for (const layer of stationary) drawLayer(ctx, view, layer, grain);

  if (scene.anim) drawAnimLayers(ctx, view, scene.anim, grain);

  drawCreases(ctx, view, scene);

  const selected = level.creases.find((c) => c.id === scene.selectedId);
  if (selected && !scene.anim) {
    drawArrows(ctx, view, { a: selected.a, b: selected.b }, scene.time);
  }
  return view;
}

function drawAnimLayers(
  ctx: CanvasRenderingContext2D,
  v: View,
  anim: FoldAnim,
  grain: CanvasPattern | null,
): void {
  const { line, moving, t } = anim;
  const cos = Math.cos(Math.PI * t);
  const lift = Math.sin(Math.PI * t);
  for (const layer of moving) {
    // Rotate the perpendicular offset around the crease: cos goes 1 -> -1,
    // landing exactly on the reflected position at t = 1.
    const poly = layer.poly.map((p) => {
      const f = footOf(line, p);
      return { x: f.x + (p.x - f.x) * cos, y: f.y + (p.y - f.y) * cos };
    });
    // Contact shadow grows with the "height" of the flip.
    ctx.save();
    ctx.globalAlpha = 0.14 * lift;
    ctx.beginPath();
    tracePoly(ctx, v, poly.map((p) => ({ x: p.x + 3 / v.scale, y: p.y + 6 / v.scale })));
    ctx.fillStyle = '#5d4326';
    ctx.fill();
    ctx.restore();
    drawLayer(ctx, v, { poly, z: layer.z, flip: cos < 0 ? !layer.flip : layer.flip }, grain);
  }
}

function drawCreases(ctx: CanvasRenderingContext2D, v: View, scene: Scene): void {
  const margin = 40;
  const clipRect: Rect = {
    x: v.play.x - margin,
    y: v.play.y - margin,
    w: v.play.w + margin * 2,
    h: v.play.h + margin * 2,
  };
  for (const crease of scene.level.creases) {
    const A = toScreen(v, crease.a);
    const B = toScreen(v, crease.b);
    const seg = clipSegToRect(A, B, clipRect);
    if (!seg) continue;
    const isSelected = crease.id === scene.selectedId;
    const isHint = crease.id === scene.hintId;
    const isFlash = scene.flash !== null && scene.flash.id === crease.id;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(seg[0].x, seg[0].y);
    ctx.lineTo(seg[1].x, seg[1].y);
    if (isFlash) {
      ctx.strokeStyle = CREASE_FLASH;
      ctx.lineWidth = 3;
      ctx.setLineDash([]);
    } else if (isSelected) {
      ctx.strokeStyle = CREASE_SELECTED;
      ctx.lineWidth = 3;
      ctx.setLineDash([9, 6]);
      ctx.shadowColor = 'rgba(201, 111, 74, 0.5)';
      ctx.shadowBlur = 8;
    } else if (isHint) {
      const pulse = 0.6 + 0.4 * Math.sin(scene.time / 170);
      ctx.strokeStyle = CREASE_HINT;
      ctx.globalAlpha = pulse;
      ctx.lineWidth = 4;
      ctx.setLineDash([9, 6]);
      ctx.shadowColor = 'rgba(125, 155, 118, 0.8)';
      ctx.shadowBlur = 12;
    } else {
      ctx.strokeStyle = CREASE_COLOR;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 6]);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function drawGhostPanel(ctx: CanvasRenderingContext2D, v: View, level: Level): void {
  const r = v.ghost;
  ctx.save();
  roundRect(ctx, r.x, r.y, r.w, r.h, 14);
  ctx.fillStyle = 'rgba(255, 252, 245, 0.88)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(160, 130, 95, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const labelH = 22;
  const inner: Rect = { x: r.x + 10, y: r.y + 8, w: r.w - 20, h: r.h - labelH - 14 };
  const bb = bboxOf(level.target);
  const bbw = Math.max(bb.maxx - bb.minx, 1e-6);
  const bbh = Math.max(bb.maxy - bb.miny, 1e-6);
  const s = Math.min(inner.w / bbw, inner.h / bbh);
  const ox = inner.x + (inner.w - bbw * s) / 2 - bb.minx * s;
  const oy = inner.y + (inner.h - bbh * s) / 2 - bb.miny * s;
  ctx.beginPath();
  level.target.forEach((p, i) => {
    const x = p.x * s + ox;
    const y = p.y * s + oy;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = 'rgba(125, 155, 118, 0.16)';
  ctx.fill();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#c96f4a';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#8a7358';
  ctx.font = '600 14px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TARGET', r.x + r.w / 2, r.y + r.h - labelH / 2 - 1);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
