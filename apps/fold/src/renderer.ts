/**
 * Canvas 2D renderer for Fold (DOM side). All gameplay math lives in the
 * pure engine; this module only draws.
 */

import { Layer, PaperState } from './engine/engine';
import { Line, Pt, bboxOf, distToSegment, footOf } from './engine/geom';
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
  /** Eased progress; may briefly dip below 0 (anticipation) and overshoot
   *  past 1 (settle) — the cos-projection turns that into a slight re-open. */
  t: number;
  /** True to bow the flipping layer a few px mid-flight (paper flex). */
  flex: boolean;
}

/**
 * Spring-like ease for the fold flip: a brief anticipation dip below 0, then
 * a damped spring that gently overshoots the flat landing (~7%) and settles.
 * f(0) = 0 and f(1) = 1 exactly, so the flip's end state is identical to the
 * old interpolation — the geometry stays honest.
 */
export function springEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const ANT = 0.12; // anticipation window (fraction of the animation)
  if (t < ANT) {
    const u = t / ANT;
    return -0.055 * u * u; // paper lifts a touch before flipping
  }
  const u = (t - ANT) / (1 - ANT);
  const k = 5.2; // damping rate
  const w = 6.8; // oscillation frequency (≈ one visible settle wobble)
  const endN = 1 - Math.exp(-k) * Math.cos(w); // normalize so f(1) = 1 exactly
  const v = (1 - Math.exp(-k * u) * Math.cos(w * u)) / endN;
  // Blend the anticipation dip into the spring with a fast-decaying term.
  return v - (v + 0.055) * Math.pow(1 - u, 6);
}

export interface Scene {
  state: PaperState;
  level: Level;
  selectedId: string | null;
  hintId: string | null;
  /** Which side of the hinted crease to fold (drives the single hint arrow). */
  hintSide: 1 | -1 | null;
  /** Ghost-panel match readout 0–100, or null to hide the chip. */
  proximity: number | null;
  /** Level-intro transition progress 0..1 (1 = fully arrived). */
  intro: number;
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

  // Bbox over all layer points and crease endpoints, computed inline so the
  // per-frame call allocates nothing.
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const layer of state.layers) {
    for (const p of layer.poly) {
      if (p.x < minx) minx = p.x;
      if (p.y < miny) miny = p.y;
      if (p.x > maxx) maxx = p.x;
      if (p.y > maxy) maxy = p.y;
    }
  }
  for (const c of level.creases) {
    if (c.a.x < minx) minx = c.a.x;
    if (c.a.y < miny) miny = c.a.y;
    if (c.a.x > maxx) maxx = c.a.x;
    if (c.a.y > maxy) maxy = c.a.y;
    if (c.b.x < minx) minx = c.b.x;
    if (c.b.y < miny) miny = c.b.y;
    if (c.b.x > maxx) maxx = c.b.x;
    if (c.b.y > maxy) maxy = c.b.y;
  }
  const bbw = Math.max(maxx - minx, 1e-6);
  const bbh = Math.max(maxy - miny, 1e-6);
  const scale = Math.min(play.w / bbw, play.h / bbh) * 0.92;
  const ox = play.x + (play.w - bbw * scale) / 2 - minx * scale;
  const oy = play.y + (play.h - bbh * scale) / 2 - miny * scale;
  return { scale, ox, oy, play, ghost };
}

// ---------------------------------------------------------------------------
// Procedural paper textures — generated once into module-level caches, never
// per frame: the fiber grain tile, the shared key-light paper gradients, and
// the desk vignette.
// ---------------------------------------------------------------------------

let grainPattern: CanvasPattern | null = null;

function getGrain(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (grainPattern) return grainPattern;
  const SIZE = 256;
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const g = c.getContext('2d');
  if (!g) return null;
  // Deterministic LCG (same family as the original grain) so the sheet looks
  // identical on every device and every run.
  let seed = 1234567;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  // Low-frequency mottling: broad soft blotches of shade and light, like the
  // uneven density of real cotton paper.
  for (let i = 0; i < 30; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const r = 18 + rand() * 42;
    const dark = rand() > 0.5;
    const blotch = g.createRadialGradient(x, y, 0, x, y, r);
    blotch.addColorStop(0, dark ? 'rgba(122, 96, 62, 0.045)' : 'rgba(255, 253, 246, 0.05)');
    blotch.addColorStop(1, 'rgba(255, 253, 246, 0)');
    g.fillStyle = blotch;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Directional fibers: short faint streaks with a slight wobble, echoing the
  // laid lines of formed paper.
  for (let i = 0; i < 240; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const len = 4 + rand() * 13;
    const tilt = (rand() - 0.5) * 0.35;
    const dark = rand() > 0.45;
    g.strokeStyle = dark
      ? `rgba(118, 90, 56, ${(0.03 + rand() * 0.035).toFixed(3)})`
      : `rgba(255, 255, 255, ${(0.04 + rand() * 0.04).toFixed(3)})`;
    g.lineWidth = 0.6 + rand() * 0.7;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + len * 0.5, y + tilt * len * 0.5, x + len, y + tilt * len);
    g.stroke();
  }
  // Fine speckle (kept from the original grain) for tooth.
  for (let i = 0; i < 900; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const r = rand() * 1.1 + 0.3;
    g.fillStyle = rand() > 0.5 ? 'rgba(120, 92, 58, 0.05)' : 'rgba(255, 255, 255, 0.06)';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  grainPattern = ctx.createPattern(c, 'repeat');
  // A slight rotation breaks up any residual tiling rhythm on large sheets.
  if (grainPattern && typeof DOMMatrix !== 'undefined') {
    grainPattern.setTransform(new DOMMatrix().rotate(-28));
  }
  return grainPattern;
}

/** Shared key-light (top-left) paper gradients, one per sheet side. */
let gradFront: CanvasGradient | null = null;
let gradBack: CanvasGradient | null = null;

function getPaperGradient(ctx: CanvasRenderingContext2D, flip: boolean): CanvasGradient | null {
  const cached = flip ? gradBack : gradFront;
  if (cached) return cached;
  // Lit pooling toward the top-left, gentle shading toward the bottom-right.
  // Anchored off-origin so the lit pool sits near the play area for typical
  // viewports; the gradient is shared by the scene layers and gallery cards.
  const g = ctx.createRadialGradient(-170, -190, 60, -140, -160, 760);
  if (flip) {
    g.addColorStop(0, 'rgba(255, 250, 238, 0.34)');
    g.addColorStop(0.55, 'rgba(255, 250, 238, 0)');
    g.addColorStop(1, 'rgba(104, 76, 44, 0.13)');
  } else {
    g.addColorStop(0, 'rgba(255, 255, 250, 0.42)');
    g.addColorStop(0.55, 'rgba(255, 255, 250, 0)');
    g.addColorStop(1, 'rgba(104, 76, 44, 0.10)');
  }
  if (flip) gradBack = g;
  else gradFront = g;
  return g;
}

let deskW = -1;
let deskH = -1;
let deskGrad: CanvasGradient | null = null;

let vigW = -1;
let vigH = -1;
let vigGrad: CanvasGradient | null = null;

function getVignette(ctx: CanvasRenderingContext2D, w: number, h: number): CanvasGradient {
  if (!vigGrad || vigW !== w || vigH !== h) {
    vigW = w;
    vigH = h;
    const g = ctx.createRadialGradient(
      w / 2,
      h * 0.42,
      Math.min(w, h) * 0.45,
      w / 2,
      h * 0.55,
      Math.hypot(w, h) * 0.62,
    );
    g.addColorStop(0, 'rgba(96, 68, 36, 0)');
    g.addColorStop(1, 'rgba(96, 68, 36, 0.10)');
    vigGrad = g;
  }
  return vigGrad;
}

/**
 * The warm desk backdrop: a gentle vertical falloff plus a soft vignette.
 * Shared by the puzzle scene and the menu backdrop so the whole app sits in
 * one continuous light.
 */
export function paintDesk(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // The falloff gradient depends only on the viewport size — cache it like the
  // vignette instead of allocating a new CanvasGradient every frame.
  if (!deskGrad || deskW !== w || deskH !== h) {
    deskW = w;
    deskH = h;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#f6f0e2');
    bg.addColorStop(1, '#eadfc9');
    deskGrad = bg;
  }
  ctx.fillStyle = deskGrad;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = getVignette(ctx, w, h);
  ctx.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function tracePoly(ctx: CanvasRenderingContext2D, v: View, poly: Pt[]): void {
  // Inline the view transform so tracing a path allocates no Pt objects.
  const s = v.scale;
  const ox = v.ox;
  const oy = v.oy;
  ctx.moveTo(poly[0].x * s + ox, poly[0].y * s + oy);
  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i].x * s + ox, poly[i].y * s + oy);
  }
  ctx.closePath();
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  v: View,
  layer: Layer,
  grain: CanvasPattern | null,
  grad: CanvasGradient | null,
  bowPx = 0,
  bowNx = 0,
  bowNy = 0,
): void {
  // Screen-space bbox for the lighting gradient and the curl band, computed
  // inline (no allocation).
  const vs = v.scale;
  const vox = v.ox;
  const voy = v.oy;
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const p of layer.poly) {
    const sx = p.x * vs + vox;
    const sy = p.y * vs + voy;
    if (sx < bx0) bx0 = sx;
    if (sy < by0) by0 = sy;
    if (sx > bx1) bx1 = sx;
    if (sy > by1) by1 = sy;
  }
  const bw = bx1 - bx0;
  const bh = by1 - by0;

  ctx.beginPath();
  tracePoly(ctx, v, layer.poly);
  ctx.fillStyle = layer.flip ? PAPER_BACK : PAPER_FRONT;
  ctx.fill();

  // Soft key-light gradient over the flat base — paper is never one flat tone.
  // The gradient is shared, so it is painted through a rect clip aligned with
  // this layer instead of being recentered per layer (no discontinuities
  // between adjacent pieces of one continuous sheet).
  if (grad && bw > 0.5 && bh > 0.5) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx0, by0, bw, bh);
    ctx.clip();
    ctx.fillStyle = grad;
    ctx.fillRect(bx0, by0, bw, bh);
    ctx.restore();
  }

  if (grain) {
    ctx.beginPath();
    tracePoly(ctx, v, layer.poly);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = grain;
    ctx.fill();
    ctx.restore();
  }

  // Paper-curl shading for a bowing (mid-flip) layer: a soft dark band toward
  // the hinge and a light band toward the free edge, scaled by the live bow
  // magnitude so the flex reads as curled paper, not a flat quad.
  if (bowPx > 0.05 && bw > 0.5 && bh > 0.5) {
    const k = Math.min(1, bowPx / 4);
    const reach = (bw + bh) / 4 + bowPx;
    const cx = (bx0 + bx1) / 2;
    const cy = (by0 + by1) / 2;
    const curl = ctx.createLinearGradient(
      cx - bowNx * reach,
      cy - bowNy * reach,
      cx + bowNx * reach * 0.7,
      cy + bowNy * reach * 0.7,
    );
    curl.addColorStop(0, 'rgba(90, 64, 34, 0)');
    curl.addColorStop(0.38, `rgba(90, 64, 34, ${(0.1 * k).toFixed(3)})`);
    curl.addColorStop(0.62, `rgba(255, 253, 244, ${(0.12 * k).toFixed(3)})`);
    curl.addColorStop(1, 'rgba(255, 253, 244, 0)');
    ctx.beginPath();
    tracePoly(ctx, v, layer.poly);
    ctx.save();
    ctx.fillStyle = curl;
    ctx.fill();
    ctx.restore();
  }

  // Self-stroke hides anti-aliasing seams between adjacent pieces.
  ctx.beginPath();
  tracePoly(ctx, v, layer.poly);
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

/**
 * Screen-space crease segment as actually drawn: the infinite crease line
 * clipped to the play rect (plus margin). Used for BOTH drawing and
 * hit-testing so the visible dashed line is exactly what is tappable.
 */
export function creaseScreenSeg(v: View, line: Line): [Pt, Pt] | null {
  const margin = 40;
  const clipRect: Rect = {
    x: v.play.x - margin,
    y: v.play.y - margin,
    w: v.play.w + margin * 2,
    h: v.play.h + margin * 2,
  };
  return clipSegToRect(toScreen(v, line.a), toScreen(v, line.b), clipRect);
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

/** Draw one pulsing fold arrow per requested side, in the given color. */
function drawArrowSet(
  ctx: CanvasRenderingContext2D,
  v: View,
  line: Line,
  sides: readonly (1 | -1)[],
  color: string,
  time: number,
): void {
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
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const s of sides) {
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

function drawArrows(ctx: CanvasRenderingContext2D, v: View, line: Line, time: number): void {
  drawArrowSet(ctx, v, line, [1, -1], CREASE_SELECTED, time);
}

/** Hint affordance: only the correct-side arrow, in hint green. */
function drawHintArrow(
  ctx: CanvasRenderingContext2D,
  v: View,
  line: Line,
  side: 1 | -1,
  time: number,
): void {
  drawArrowSet(ctx, v, line, [side], CREASE_HINT, time);
}

// ---------------------------------------------------------------------------
// Main scene render
// ---------------------------------------------------------------------------

// Paper states are treated as immutable (fold/undo/reset always swap in a
// different state object), so the z-sorted stationary layer list can be
// memoized by reference instead of being re-allocated and re-sorted on every
// frame between fold commits.
let stationaryFor: PaperState | null = null;
let stationaryCache: Layer[] = [];

function zSortedLayers(state: PaperState): Layer[] {
  if (stationaryFor !== state) {
    stationaryFor = state;
    stationaryCache = state.layers.slice().sort((a, b) => a.z - b.z);
  }
  return stationaryCache;
}

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
  const gradF = getPaperGradient(ctx, false);
  const gradB = getPaperGradient(ctx, true);

  // Background: warm desk with a gentle falloff + soft vignette.
  paintDesk(ctx, w, h);

  // Level-intro transition: the paper (and ghost panel) slides up slightly
  // and fades in with an easeOut curve. intro === 1 is the steady state.
  const intro = scene.intro;
  const eased = 1 - Math.pow(1 - intro, 3);
  ctx.save();
  if (eased < 1) {
    ctx.globalAlpha = eased;
    ctx.translate(0, (1 - eased) * 16);
  }

  drawGhostPanel(ctx, view, level, scene.proximity);

  // Which layers are stationary right now (during an animation the moving
  // ones are drawn separately with interpolation).
  const stationary = scene.anim ? scene.anim.kept : zSortedLayers(state);

  // Soft shadow under the whole sheet, falling down-right away from the
  // top-left key light.
  ctx.save();
  ctx.shadowColor = 'rgba(96, 68, 36, 0.26)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 10;
  ctx.beginPath();
  for (const layer of stationary) tracePoly(ctx, view, layer.poly);
  ctx.fillStyle = PAPER_FRONT;
  ctx.fill();
  ctx.restore();

  for (const layer of stationary) {
    drawLayer(ctx, view, layer, grain, layer.flip ? gradB : gradF);
  }

  // Folded layers rest on one another: a soft ambient-occlusion band along
  // every stack boundary sells the depth between the sheets.
  drawStackAO(ctx, view, stationary);

  if (scene.anim) drawAnimLayers(ctx, view, scene.anim, grain);

  drawCreases(ctx, view, scene);

  const selected = level.creases.find((c) => c.id === scene.selectedId);
  if (selected && !scene.anim) {
    drawArrows(ctx, view, { a: selected.a, b: selected.b }, scene.time);
  }
  const hinted = level.creases.find((c) => c.id === scene.hintId);
  if (hinted && scene.hintSide && !scene.anim) {
    drawHintArrow(ctx, view, { a: hinted.a, b: hinted.b }, scene.hintSide, scene.time);
  }
  ctx.restore(); // end intro transform
  return view;
}

/**
 * Soft ambient occlusion between stacked layers. Each upper piece casts a
 * gradient band along its boundary onto every genuinely overlapped lower
 * piece (alpha grows with stack height, so deeper folds sit darker). Pairs
 * are gated by a paper-space bbox-overlap test and the band is clipped to the
 * receiving polygon, so coplanar triangulation seams (zero-area neighbours)
 * never shade — only true stack boundaries, including the crease hinge, do.
 */
function drawStackAO(ctx: CanvasRenderingContext2D, v: View, layers: Layer[]): void {
  if (layers.length < 2) return;
  for (let i = 1; i < layers.length; i++) {
    const over = layers[i].poly;
    let ox0 = Infinity;
    let oy0 = Infinity;
    let ox1 = -Infinity;
    let oy1 = -Infinity;
    for (const p of over) {
      if (p.x < ox0) ox0 = p.x;
      if (p.y < oy0) oy0 = p.y;
      if (p.x > ox1) ox1 = p.x;
      if (p.y > oy1) oy1 = p.y;
    }
    const band = 11 + Math.min(5, i); // 12–16 px, deeper stacks get wider bands
    const castA = Math.min(0.12, 0.045 + 0.015 * i);
    const color = `rgba(74, 52, 28, ${castA.toFixed(3)})`;
    for (let j = 0; j < i; j++) {
      const under = layers[j].poly;
      let ux0 = Infinity;
      let uy0 = Infinity;
      let ux1 = -Infinity;
      let uy1 = -Infinity;
      for (const p of under) {
        if (p.x < ux0) ux0 = p.x;
        if (p.y < uy0) uy0 = p.y;
        if (p.x > ux1) ux1 = p.x;
        if (p.y > uy1) uy1 = p.y;
      }
      if (ux0 >= ox1 || ox0 >= ux1 || uy0 >= oy1 || oy0 >= uy1) continue;
      aoBand(ctx, v, under, over, band, color);
    }
  }
}

/**
 * Clip to `receiving` and stroke a soft band along each of `boundary`'s
 * edges. The band uses a symmetric tent gradient (opaque at the edge, fading
 * both ways), so whichever side the receiving paper lies on gets a proper
 * fade-away contact shadow.
 */
function aoBand(
  ctx: CanvasRenderingContext2D,
  v: View,
  receiving: Pt[],
  boundary: Pt[],
  band: number,
  color: string,
): void {
  ctx.save();
  ctx.beginPath();
  tracePoly(ctx, v, receiving);
  ctx.clip();
  ctx.lineWidth = band;
  const fade = 'rgba(74, 52, 28, 0)';
  const vs = v.scale;
  const vox = v.ox;
  const voy = v.oy;
  for (let j = 0; j < boundary.length; j++) {
    const pa = boundary[j];
    const pb = boundary[(j + 1) % boundary.length];
    const ax = pa.x * vs + vox;
    const ay = pa.y * vs + voy;
    const bx = pb.x * vs + vox;
    const by = pb.y * vs + voy;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 2) continue;
    const enx = (-dy / len) * band;
    const eny = (dx / len) * band;
    const g = ctx.createLinearGradient(ax - enx, ay - eny, ax + enx, ay + eny);
    g.addColorStop(0, fade);
    g.addColorStop(0.5, color);
    g.addColorStop(1, fade);
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAnimLayers(
  ctx: CanvasRenderingContext2D,
  v: View,
  anim: FoldAnim,
  grain: CanvasPattern | null,
): void {
  const { line, moving, t, flex } = anim;
  // t may overshoot 1 (spring settle); the cos-projection turns that into a
  // slight re-open of the flip, which reads as the paper settling down.
  const cos = Math.cos(Math.PI * t);
  const lift = Math.abs(Math.sin(Math.PI * t));
  // Paper flex: mid-flip the moving layer bows a few px toward its original
  // side instead of staying perfectly flat. Zero at both ends (sin = 0), so
  // the start and end states stay geometrically exact.
  const bow = flex ? Math.sin(Math.PI * Math.min(t, 1)) : 0;
  const dx = line.b.x - line.a.x;
  const dy = line.b.y - line.a.y;
  const len = Math.hypot(dx, dy) || 1;
  // Unit normal pointing toward the moving side's original half-plane.
  const nx = (-dy / len) * anim.side;
  const ny = (dx / len) * anim.side;
  // Crease in screen space, for the free-boundary thickness test.
  const aS = toScreen(v, line.a);
  const bS = toScreen(v, line.b);
  // Paper-thickness edge styles, hoisted out of the per-layer loop (alpha
  // follows the lift: the edge reads clearest at mid-flip).
  const thA = 0.2 + 0.35 * lift;
  const lightEdge = `rgba(255, 252, 242, ${thA.toFixed(3)})`;
  const darkEdge = `rgba(84, 58, 30, ${(thA * 0.85).toFixed(3)})`;
  const showEdge = lift > 0.02;
  for (const layer of moving) {
    // Rotate the perpendicular offset around the crease: cos goes 1 -> -1,
    // landing exactly on the reflected position at t = 1.
    let maxD = 0;
    if (bow !== 0) {
      for (const p of layer.poly) {
        const f = footOf(line, p);
        maxD = Math.max(maxD, Math.hypot(p.x - f.x, p.y - f.y));
      }
    }
    // Bow amplitude: the farthest point arcs at most ~4 CSS px (and never
    // more than 30% of the piece size, so tiny pieces don't over-bend).
    const ampPx = bow !== 0 && maxD > 1e-6 ? Math.min(4, maxD * v.scale * 0.3) : 0;
    const amp = maxD > 1e-6 ? ampPx / (maxD * v.scale) : 0;
    const poly = layer.poly.map((p) => {
      const f = footOf(line, p);
      const ox = p.x - f.x;
      const oy = p.y - f.y;
      let x = f.x + ox * cos;
      let y = f.y + oy * cos;
      if (amp !== 0) {
        const d = Math.hypot(ox, oy);
        x += nx * d * amp * bow;
        y += ny * d * amp * bow;
      }
      return { x, y };
    });
    // Contact shadow grows with the "height" of the flip; soft blur plus a
    // down-right offset matching the top-left key light.
    ctx.save();
    ctx.globalAlpha = 0.14 * lift;
    ctx.filter = 'blur(5px)';
    ctx.beginPath();
    tracePoly(ctx, v, poly.map((p) => ({ x: p.x + 3 / v.scale, y: p.y + 7 / v.scale })));
    ctx.fillStyle = '#5d4326';
    ctx.fill();
    ctx.restore();
    const flipNow = cos < 0 ? !layer.flip : layer.flip;
    drawLayer(
      ctx,
      v,
      { poly, z: layer.z, flip: flipNow },
      grain,
      getPaperGradient(ctx, flipNow),
      ampPx * bow,
      nx,
      ny,
    );
    // A whisper of paper thickness along the free boundary (every edge off
    // the hinge): a lit rim toward the key light and a shaded rim away from
    // it, so the flipping sheet reads as a 1–2 px thick cut edge.
    if (showEdge) {
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 0; i < poly.length; i++) {
        const p = toScreen(v, poly[i]);
        const q = toScreen(v, poly[(i + 1) % poly.length]);
        if (distToSegment(p, aS, bS) <= 1.5 || distToSegment(q, aS, bS) <= 1.5) continue;
        ctx.beginPath();
        ctx.moveTo(p.x - 0.8, p.y - 0.8);
        ctx.lineTo(q.x - 0.8, q.y - 0.8);
        ctx.strokeStyle = lightEdge;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x + 0.9, p.y + 0.9);
        ctx.lineTo(q.x + 0.9, q.y + 0.9);
        ctx.strokeStyle = darkEdge;
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

function drawCreases(ctx: CanvasRenderingContext2D, v: View, scene: Scene): void {
  for (const crease of scene.level.creases) {
    const seg = creaseScreenSeg(v, { a: crease.a, b: crease.b });
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
      // Embossed ridge: a lit lip toward the key light and a shaded groove
      // away from it, with the dashed crease line on top — creases read as
      // scored paper, not flat overlay lines.
      ctx.setLineDash([7, 6]);
      ctx.save();
      ctx.translate(-0.7, -0.7);
      ctx.strokeStyle = 'rgba(255, 250, 238, 0.5)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.translate(0.9, 0.9);
      ctx.strokeStyle = 'rgba(110, 80, 50, 0.22)';
      ctx.lineWidth = 2.6;
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = CREASE_COLOR;
      ctx.lineWidth = 2;
    }
    ctx.stroke();
    ctx.restore();
  }
}

function drawGhostPanel(
  ctx: CanvasRenderingContext2D,
  v: View,
  level: Level,
  proximity: number | null,
): void {
  const r = v.ghost;
  ctx.save();
  roundRect(ctx, r.x, r.y, r.w, r.h, 14);
  // Soft drop shadow falling down-right, matching the sheet's shadow.
  ctx.shadowColor = 'rgba(96, 68, 36, 0.18)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = 'rgba(255, 252, 245, 0.88)';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(160, 130, 95, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Key-light rims: a lit hairline along the top/left, a shaded one along
  // the bottom/right, so the panel sits in the same light as the paper.
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 253, 246, 0.8)';
  ctx.beginPath();
  ctx.moveTo(r.x + 13, r.y + 1.4);
  ctx.lineTo(r.x + r.w - 13, r.y + 1.4);
  ctx.moveTo(r.x + 1.4, r.y + 13);
  ctx.lineTo(r.x + 1.4, r.y + r.h - 26);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(96, 68, 36, 0.16)';
  ctx.beginPath();
  ctx.moveTo(r.x + 13, r.y + r.h - 1.4);
  ctx.lineTo(r.x + r.w - 13, r.y + r.h - 1.4);
  ctx.moveTo(r.x + r.w - 1.4, r.y + 13);
  ctx.lineTo(r.x + r.w - 1.4, r.y + r.h - 26);
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
  // The green fill gently saturates as the paper nears the target.
  const closeness = (proximity ?? 0) / 100;
  ctx.fillStyle = `rgba(125, 155, 118, ${(0.16 + 0.28 * closeness).toFixed(3)})`;
  ctx.fill();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#c96f4a';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

  // Matches the stylesheet's --muted (#7d6a4c): deep enough for 4.5:1 on the
  // panel background at 14px.
  ctx.fillStyle = '#7d6a4c';
  ctx.font = '600 14px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TARGET', r.x + r.w / 2, r.y + r.h - labelH / 2 - 1);

  // Proximity chip in the top corner: "92%" after each committed fold.
  if (proximity !== null) {
    const label = `${proximity}%`;
    ctx.font = '700 11px system-ui, -apple-system, sans-serif';
    const cw = ctx.measureText(label).width + 12;
    const ch = 16;
    const cx = r.x + r.w - 6 - cw;
    const cy = r.y + 6;
    roundRect(ctx, cx, cy, cw, ch, 8);
    ctx.fillStyle = 'rgba(255, 252, 245, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(125, 155, 118, 0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#5f7a59';
    ctx.fillText(label, cx + cw / 2, cy + ch / 2 + 0.5);
  }
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

// ---------------------------------------------------------------------------
// Origami gallery figure cards
// ---------------------------------------------------------------------------

/**
 * Render one gallery figure card into a small canvas: the level's target
 * silhouette drawn large with paper grain (unlocked), or a folded-paper
 * placeholder (locked). Pure procedural — reuses the shared grain pattern.
 */
export function renderFigure(
  canvas: HTMLCanvasElement,
  target: Pt[],
  locked: boolean,
): void {
  const W = 180;
  const H = 135; // 4:3, matched by the stylesheet's aspect-ratio
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const grain = getGrain(ctx);

  // Card interior: a soft vertical wash so the card sits in the key light
  // instead of reading as a flat rectangle.
  const wash = ctx.createLinearGradient(0, 0, 0, H);
  wash.addColorStop(0, '#fbf6ea');
  wash.addColorStop(1, '#f0e6d2');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  // Folded-paper placeholder geometry (sheet with a dog-eared corner).
  const sx = W * 0.3;
  const sy = H * 0.17;
  const sw = W * 0.4;
  const sh = H * 0.66;
  const ear = W * 0.09;

  // Figure bbox in card space, for the shared key-light gradient clip.
  let bx0 = sx;
  let by0 = sy;
  let bx1 = sx + sw;
  let by1 = sy + sh;

  const trace = (): void => {
    ctx.beginPath();
    if (locked) {
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + sw - ear, sy);
      ctx.lineTo(sx + sw, sy + ear);
      ctx.lineTo(sx + sw, sy + sh);
      ctx.lineTo(sx, sy + sh);
      ctx.closePath();
    } else {
      const bb = bboxOf(target);
      const bw = Math.max(bb.maxx - bb.minx, 1e-6);
      const bh = Math.max(bb.maxy - bb.miny, 1e-6);
      const m = 16;
      const s = Math.min((W - m * 2) / bw, (H - m * 2) / bh);
      const ox = (W - bw * s) / 2 - bb.minx * s;
      const oy = (H - bh * s) / 2 - bb.miny * s;
      bx0 = bb.minx * s + ox;
      by0 = bb.miny * s + oy;
      bx1 = bb.maxx * s + ox;
      by1 = bb.maxy * s + oy;
      target.forEach((p, i) => {
        const x = p.x * s + ox;
        const y = p.y * s + oy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
  };

  // Base fill with a soft lift shadow falling down-right, matching the desk.
  trace();
  ctx.save();
  ctx.shadowColor = 'rgba(96, 68, 36, 0.22)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = locked ? PAPER_BACK : PAPER_FRONT;
  ctx.fill();
  ctx.restore();

  // Shared key-light paper gradient (same light as the puzzle sheet).
  const grad = getPaperGradient(ctx, locked);
  if (grad && bx1 - bx0 > 0.5 && by1 - by0 > 0.5) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx0, by0, bx1 - bx0, by1 - by0);
    ctx.clip();
    ctx.fillStyle = grad;
    ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
    ctx.restore();
  }

  // Paper grain pass.
  if (grain) {
    trace();
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = grain;
    ctx.fill();
    ctx.restore();
  }

  // Edge definition, with a lit rim toward the key light and a shaded rim
  // away from it under the main stroke.
  ctx.save();
  ctx.translate(-0.7, -0.7);
  trace();
  ctx.strokeStyle = 'rgba(255, 252, 242, 0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.translate(0.8, 0.8);
  trace();
  ctx.strokeStyle = 'rgba(96, 68, 36, 0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  trace();
  ctx.strokeStyle = locked ? 'rgba(160, 130, 95, 0.5)' : 'rgba(146, 113, 76, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (locked) {
    // Dog-ear flap on the placeholder sheet.
    ctx.beginPath();
    ctx.moveTo(sx + sw - ear, sy);
    ctx.lineTo(sx + sw - ear, sy + ear);
    ctx.lineTo(sx + sw, sy + ear);
    ctx.closePath();
    ctx.fillStyle = PAPER_FRONT;
    ctx.fill();
    ctx.strokeStyle = 'rgba(160, 130, 95, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
