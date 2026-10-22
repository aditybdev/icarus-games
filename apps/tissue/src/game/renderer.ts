/**
 * Canvas 2D renderer for Tissue Rush (DOM side — no gameplay rules here).
 * Visual-realism pass: one consistent key light from the top-left across the
 * whole scene, a 3/4-perspective cardboard box with an elliptical slot and a
 * crinkly clear-film collar, embossed translucent tissue paper shaded per
 * ribbon segment by its angle to the light, soft pre-rendered sprite
 * shadows, a vignetted atmosphere with depth-tiered bubbles, and motion
 * realism (pop overshoot + settle, tumbling flyers with soft trails, render-
 * only micro-flutter on the cloth).
 *
 * Texture budget: the paper-fiber noise tile, quilted-diamond emboss tile,
 * radial shadow blob, vignette and all box/sheet gradients are generated
 * once at boot or resize; the per-frame path allocates nothing (fixed
 * Float32Array edge buffers, precomputed shade/style palettes).
 */
import { type RoundState } from '../core/round';
import { BOX_SKINS, type BoxSkin } from '../core/skins';
import { Ribbon } from './cloth';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layout {
  boxCX: number;
  boxTop: number;
  boxW: number;
  boxH: number;
  boxR: number;
  slotW: number;
  slotY: number;
  sheetW: number;
  sheetH: number;
}

/** Derived 3/4-perspective box geometry (recomputed on resize). */
interface BoxGeo {
  x: number;
  y: number;
  bottom: number;
  frontTop: number;
  frontH: number;
  /** Horizontal extrusion of the top/side faces toward the back-right. */
  ex: number;
  /** Vertical radius of the elliptical slot on the top face. */
  slotRy: number;
}

interface Flyer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  ribbon: Ribbon;
  age: number;
  gold: boolean;
  /** Fake-3D tumble phase + speed (render-only perspective flip). */
  tumble: number;
  tumbleV: number;
  /** Fixed ring buffer of past positions for the soft motion trail. */
  trail: Float32Array;
  trailCursor: number;
  trailCount: number;
}

/** Pooled fever-trail sparkle (ring buffer — zero per-frame allocation). */
interface TrailSparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  r: number;
}

interface ConfettiPiece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  color: string;
  dot: boolean;
  life: number;
  seed: number;
}

interface Bubble {
  x: number;
  y: number;
  r: number;
  speed: number;
  drift: number;
  /** Precomputed fill styles (alpha fixed per bubble — no per-frame strings). */
  style: string;
  hiStyle: string;
  seed: number;
}

interface Sparkle {
  x: number;
  y: number;
  r: number;
  speed: number;
  seed: number;
}

const TAU = Math.PI * 2;
const CONFETTI_COLORS = ['#ff8fb2', '#7ec8ff', '#8fe3bd', '#ffd166', '#c3a6ff', '#ffffff'];
const GOLD_COLORS = ['#ffd166', '#ffdf8e', '#f4b942', '#fff3c4'];
/** Fever sparkle-trail pool size (fixed ring buffer, no per-frame allocs). */
const TRAIL_MAX = 48;
/** Flyer motion-trail length (fixed ring buffer per flyer). */
const FLYER_TRAIL = 8;
/** Max ribbon points (pull ribbon 11, flyer tail 9) — edge buffer size. */
const RIBBON_MAX = 16;
/** Key light direction (unit vector toward the light): top-left. */
const LIGHT_X = -0.4472;
const LIGHT_Y = -0.8944;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function easeOutBack(t: number): number {
  const c = 1.70158;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

function easeOutElastic(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Darken a #rrggbb color by factor f (0..1). */
function shadeRgb(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

/** Lighten a #rrggbb color toward white by t (0..1). */
function tintRgb(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.round(r + (255 - r) * t)},${Math.round(g + (255 - g) * t)},${Math.round(
    b + (255 - b) * t,
  )})`;
}

/** Precomputed lit->shadow ramp so per-segment shading allocates nothing. */
function shadePalette(
  shadow: [number, number, number],
  lit: [number, number, number],
  k: number,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < k; i += 1) {
    const t = i / (k - 1);
    out.push(
      `rgb(${Math.round(shadow[0] + (lit[0] - shadow[0]) * t)},${Math.round(
        shadow[1] + (lit[1] - shadow[1]) * t,
      )},${Math.round(shadow[2] + (lit[2] - shadow[2]) * t)})`,
    );
  }
  return out;
}

/** Tissue-paper segment shades, shadow side -> lit edge (key light top-left). */
const PAPER_SHADES = shadePalette([188, 201, 219], [255, 255, 255], 12);
const GOLD_SHADES = shadePalette([186, 134, 30], [255, 246, 205], 12);

/** Precomputed tension-meter hues (avoids per-frame hsl string building). */
const METER_HUES: string[] = [];
for (let i = 0; i <= 24; i += 1) {
  METER_HUES.push(`hsl(${Math.round(160 - (i / 24) * 150)}, 72%, 60%)`);
}

/** Precomputed flyer-trail fill styles, newest -> oldest. */
const TRAIL_STYLES_WHITE: string[] = [];
const TRAIL_STYLES_GOLD: string[] = [];
for (let k = 0; k < FLYER_TRAIL; k += 1) {
  const a = (0.09 * (1 - k / FLYER_TRAIL)).toFixed(3);
  TRAIL_STYLES_WHITE.push(`rgba(255,255,255,${a})`);
  TRAIL_STYLES_GOLD.push(`rgba(255,224,140,${a})`);
}

/** Precomputed ambient-sparkle stroke styles (soft twinkle range). */
const SPARKLE_STYLES: string[] = [];
for (let i = 0; i < 16; i += 1) {
  SPARKLE_STYLES.push(`rgba(255,255,255,${(0.16 + (i / 15) * 0.4).toFixed(3)})`);
}

/** Precomputed fever-trail stroke styles, dim -> bright. */
const TRAILSPARK_STYLES: string[] = [];
for (let i = 0; i < 16; i += 1) {
  TRAILSPARK_STYLES.push(`rgba(255,214,120,${(0.75 * (i / 15)).toFixed(3)})`);
}

/** Deterministic crinkle strokes around the slot's clear-film collar. */
interface CollarCrinkle {
  ang: number;
  r0: number;
  len: number;
  alpha: number;
}
const COLLAR_CRINKLES: CollarCrinkle[] = [];
{
  const rand = mulberry32(777001);
  for (let i = 0; i < 10; i += 1) {
    COLLAR_CRINKLES.push({
      ang: rand() * TAU,
      r0: 1.5 + rand() * 3,
      len: 4 + rand() * 7,
      alpha: 0.16 + rand() * 0.3,
    });
  }
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private safeBottom = 0;
  private layout: Layout = {
    boxCX: 0,
    boxTop: 0,
    boxW: 0,
    boxH: 0,
    boxR: 0,
    slotW: 0,
    slotY: 0,
    sheetW: 0,
    sheetH: 0,
  };
  private boxGeo: BoxGeo = { x: 0, y: 0, bottom: 0, frontTop: 0, frontH: 0, ex: 0, slotRy: 8 };
  private bgGradient: CanvasGradient | null = null;
  private bubbles: Bubble[] = [];
  private sparkles: Sparkle[] = [];
  private readonly safeProbe: HTMLElement;

  private ribbon: Ribbon | null = null;
  private grabX = 0;
  private grabY = 0;
  private flyers: Flyer[] = [];
  private confetti: ConfettiPiece[] = [];
  /** Snap-back squash animation (1 -> 0) after a short pull. */
  private snapT: number | null = null;
  /** Pop-up bounce of the next tissue (0 -> 1). */
  private popT = 1;
  /** Time since the pop finished — drives the decaying settle wobble. */
  private settleT = 99;
  private evtExited = false;
  private evtPopped = false;
  /** Active box skin (palette + brand label). */
  private skin: BoxSkin = BOX_SKINS[0];
  /** True while the exposed sheet is the golden bonus tissue. */
  private goldNext = false;
  /** Fever visuals: box glow + sparkle pull trails. */
  private fever = false;
  /** prefers-reduced-motion: kills sparkle trails, flutter and glow pulsing. */
  private reducedMotion = false;
  private readonly trail: TrailSparkle[] = [];
  private trailCursor = 0;

  /* ---- boot-time procedural textures (generated once, tiled forever) ---- */
  private noisePattern: CanvasPattern | null = null;
  private embossPattern: CanvasPattern | null = null;
  private shadowBlob!: HTMLCanvasElement;
  private vignette: HTMLCanvasElement | null = null;

  /* ---- cached paints (rebuilt on resize / skin change) ---- */
  private boxFrontGrad: CanvasGradient | null = null;
  private boxTopGrad: CanvasGradient | null = null;
  private boxSideGrad: CanvasGradient | null = null;
  private boxSheenGrad: CanvasGradient | null = null;
  private slotGrad: CanvasGradient | null = null;
  private sheetGrad: CanvasGradient | null = null;
  private sheetGradGold: CanvasGradient | null = null;

  /* ---- preallocated ribbon edge buffers (zero per-frame allocation) ---- */
  private readonly bufLx = new Float32Array(RIBBON_MAX);
  private readonly bufLy = new Float32Array(RIBBON_MAX);
  private readonly bufRx = new Float32Array(RIBBON_MAX);
  private readonly bufRy = new Float32Array(RIBBON_MAX);
  private readonly bufFace = new Float32Array(RIBBON_MAX);

  constructor(stage: HTMLElement) {
    this.canvas = document.createElement('canvas');
    stage.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;

    // Hidden probe to read env(safe-area-inset-bottom) as pixels.
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;' +
      'padding-bottom:env(safe-area-inset-bottom,0px)';
    document.body.appendChild(probe);
    this.safeProbe = probe;
    this.safeBottom = parseFloat(getComputedStyle(probe).paddingBottom) || 0;

    this.buildTextures();

    // Ambient bubbles with a depth tier: smaller, dimmer and slower when far.
    const rand = mulberry32(20240521);
    for (let i = 0; i < 14; i += 1) {
      const z = 0.45 + rand() * 0.55;
      const alpha = 0.045 + 0.15 * z * z;
      this.bubbles.push({
        x: rand(),
        y: rand(),
        r: (7 + rand() * 26) * z,
        speed: (8 + rand() * 20) * (0.5 + z * 0.7),
        drift: (6 + rand() * 18) * z,
        style: `rgba(255,255,255,${alpha.toFixed(3)})`,
        hiStyle: `rgba(255,255,255,${(alpha * 0.75).toFixed(3)})`,
        seed: rand() * TAU,
      });
    }
    for (let i = 0; i < 9; i += 1) {
      this.sparkles.push({
        x: rand(),
        y: rand(),
        r: 1.6 + rand() * 2.6,
        speed: 0.6 + rand() * 1.4,
        seed: rand() * TAU,
      });
    }
    // Pre-allocate the fever sparkle-trail ring buffer once.
    for (let i = 0; i < TRAIL_MAX; i += 1) {
      this.trail.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, r: 2 });
    }
    this.resize();
  }

  get domElement(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * Generate every reusable texture exactly once: the paper-fiber noise tile
   * (doubling as cardboard print grain), the quilted-diamond emboss tile and
   * the soft radial shadow blob sprite. Nothing here runs per frame.
   */
  private buildTextures(): void {
    // Paper fiber noise: soft gray grain + short fiber streaks.
    const n = document.createElement('canvas');
    n.width = 128;
    n.height = 128;
    const nctx = n.getContext('2d');
    if (nctx) {
      const rand = mulberry32(910209);
      const img = nctx.createImageData(128, 128);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 118 + Math.floor(rand() * 84);
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      nctx.putImageData(img, 0, 0);
      for (let i = 0; i < 420; i += 1) {
        const x = rand() * 128;
        const y = rand() * 128;
        const len = 2 + rand() * 5;
        nctx.strokeStyle =
          rand() < 0.5 ? 'rgba(90,100,115,0.20)' : 'rgba(255,255,255,0.28)';
        nctx.lineWidth = 1;
        nctx.beginPath();
        nctx.moveTo(x, y);
        nctx.lineTo(x + len, y + (rand() - 0.5) * 1.5);
        nctx.stroke();
      }
      this.noisePattern = this.ctx.createPattern(n, 'repeat');
    }

    // Quilted diamond emboss: two diagonal line families, each drawn as a
    // lit top-left edge + a shaded bottom-right edge (real embossed tissue).
    const e = document.createElement('canvas');
    e.width = 36;
    e.height = 36;
    const ectx = e.getContext('2d');
    if (ectx) {
      ectx.lineWidth = 1;
      for (const [off, style] of [
        [-0.8, 'rgba(255,255,255,0.55)'],
        [0.8, 'rgba(110,130,155,0.45)'],
      ] as const) {
        ectx.strokeStyle = style;
        ectx.beginPath();
        for (let k = -1; k <= 1; k += 1) {
          const b = k * 18;
          ectx.moveTo(-12 + off, b - 12 + off);
          ectx.lineTo(48 + off, b + 48 + off);
          const b2 = 36 + k * 18;
          ectx.moveTo(-12 + off, b2 + 12 + off);
          ectx.lineTo(b2 + 12 + off, -12 + off);
        }
        ectx.stroke();
      }
      this.embossPattern = this.ctx.createPattern(e, 'repeat');
    }

    // Soft radial shadow blob sprite (drop/contact/finger shadows).
    const s = document.createElement('canvas');
    s.width = 200;
    s.height = 200;
    const sctx = s.getContext('2d');
    if (sctx) {
      const g = sctx.createRadialGradient(100, 100, 8, 100, 100, 98);
      g.addColorStop(0, 'rgba(12,22,38,0.85)');
      g.addColorStop(0.55, 'rgba(12,22,38,0.38)');
      g.addColorStop(1, 'rgba(12,22,38,0)');
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, 200, 200);
    }
    this.shadowBlob = s;
  }

  /** Vignette + top-left light bloom, regenerated only on resize. */
  private buildVignette(): void {
    const v = document.createElement('canvas');
    v.width = Math.max(2, this.w);
    v.height = Math.max(2, this.h);
    const vctx = v.getContext('2d');
    if (vctx) {
      const r = Math.hypot(this.w, this.h) * 0.62;
      const g = vctx.createRadialGradient(
        this.w / 2,
        this.h * 0.44,
        r * 0.42,
        this.w / 2,
        this.h * 0.44,
        r,
      );
      g.addColorStop(0, 'rgba(18,48,84,0)');
      g.addColorStop(1, 'rgba(18,48,84,0.20)');
      vctx.fillStyle = g;
      vctx.fillRect(0, 0, v.width, v.height);
      const b = vctx.createRadialGradient(
        this.w * 0.16,
        this.h * 0.08,
        10,
        this.w * 0.16,
        this.h * 0.08,
        this.w * 0.75,
      );
      b.addColorStop(0, 'rgba(255,255,255,0.14)');
      b.addColorStop(1, 'rgba(255,255,255,0)');
      vctx.fillStyle = b;
      vctx.fillRect(0, 0, v.width, v.height);
    }
    this.vignette = v;
  }

  /**
   * Rebuild every layout- and skin-dependent paint. Face shading follows the
   * key light: top face lightest, front face mid (raw skin palette), right
   * side face darkest. Runs on resize and on skin swap only — never per frame.
   */
  private rebuildBoxPaint(): void {
    const L = this.layout;
    const skin = this.skin;
    const { ctx } = this;
    const x = L.boxCX - L.boxW / 2;
    const y = L.boxTop;
    const bottom = L.boxTop + L.boxH;
    const slotRy = Math.min(9, Math.max(6, L.boxH * 0.055));
    const frontTop = L.slotY + slotRy + 2;
    const ex = L.boxW * 0.055;
    this.boxGeo = { x, y, bottom, frontTop, frontH: bottom - frontTop, ex, slotRy };

    // Front face: mid shading straight from the skin palette.
    const f = ctx.createLinearGradient(0, frontTop, 0, bottom);
    f.addColorStop(0, skin.bodyTop);
    f.addColorStop(1, skin.bodyBottom);
    this.boxFrontGrad = f;

    // Top face: lightest — it faces the key light.
    const t = ctx.createLinearGradient(x + ex, y, x + L.boxW * 0.9, frontTop);
    t.addColorStop(0, tintRgb(skin.bodyTop, 0.55));
    t.addColorStop(1, tintRgb(skin.bodyTop, 0.22));
    this.boxTopGrad = t;

    // Right side face: darkest — turned away from the key light.
    const s = ctx.createLinearGradient(0, y, 0, bottom);
    s.addColorStop(0, shadeRgb(skin.bodyTop, 0.62));
    s.addColorStop(1, shadeRgb(skin.bodyBottom, 0.5));
    this.boxSideGrad = s;

    // Soft directional sheen across the front print.
    const sheen = ctx.createLinearGradient(x, frontTop, x + L.boxW * 0.55, frontTop + (bottom - frontTop) * 0.75);
    sheen.addColorStop(0, 'rgba(255,255,255,0.16)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    this.boxSheenGrad = sheen;

    // Slot well: deep center, rim catching a little light.
    const scx = L.boxCX + ex * 0.4;
    const sg = ctx.createRadialGradient(scx, L.slotY - 2, 2, scx, L.slotY, L.slotW * 0.55);
    sg.addColorStop(0, shadeRgb(skin.slot, 0.3));
    sg.addColorStop(0.75, shadeRgb(skin.slot, 0.55));
    sg.addColorStop(1, shadeRgb(skin.slot, 0.8));
    this.slotGrad = sg;

    // Idle-sheet gradients (full height, bottom-anchored so partial pops
    // reuse the same cached paint): lit crown, softly shaded base.
    const top = L.slotY + 9 - L.sheetH;
    const pw = ctx.createLinearGradient(0, top, 0, L.slotY + 9);
    pw.addColorStop(0, '#ffffff');
    pw.addColorStop(0.75, '#f4f7fb');
    pw.addColorStop(1, '#dce4ef');
    this.sheetGrad = pw;
    const pg = ctx.createLinearGradient(0, top, 0, L.slotY + 9);
    pg.addColorStop(0, '#fff9e0');
    pg.addColorStop(0.75, '#ffe9a8');
    pg.addColorStop(1, '#f0bd4a');
    this.sheetGradGold = pg;
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Safe-area insets can change with orientation, so re-read on resize.
    this.safeBottom = parseFloat(getComputedStyle(this.safeProbe).paddingBottom) || 0;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { w, h } = this;
    const boxW = clamp(Math.min(Math.min(w, h) * 0.6, h * 0.46), 200, 330);
    const boxH = boxW * 0.56;
    const bottom = Math.max(18, h * 0.045) + this.safeBottom;
    const boxTop = h - bottom - boxH;
    this.layout = {
      boxCX: w / 2,
      boxTop,
      boxW,
      boxH,
      boxR: Math.min(26, boxW * 0.12),
      slotW: boxW * 0.52,
      slotY: boxTop + boxH * 0.17,
      sheetW: boxW * 0.42,
      sheetH: boxW * 0.52,
    };

    const g = this.ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#6fc1f2');
    g.addColorStop(0.55, '#b9e6ff');
    g.addColorStop(1, '#dcf8ea');
    this.bgGradient = g;

    this.buildVignette();
    this.rebuildBoxPaint();
  }

  /* ----------------------------- interaction ----------------------------- */

  /**
   * True once the pop-up bounce is far enough along that the sheet is
   * grabbable. Matches the gate in exposedTissueRect so a tap that lands on
   * the visible sheet always connects.
   */
  get popReady(): boolean {
    return this.popT >= 0.7;
  }

  /** Grabbable region of the currently exposed sheet (CSS px), or null. */
  exposedTissueRect(): Rect | null {
    if (!this.popReady || this.ribbon) return null;
    const L = this.layout;
    const scale = easeOutBack(clamp(this.popT, 0, 1));
    const h = L.sheetH * Math.max(0, scale);
    return {
      x: L.boxCX - L.sheetW / 2 - 14,
      y: L.slotY - h - 14,
      w: L.sheetW + 28,
      h: h + 22,
    };
  }

  startGrab(x: number, y: number): void {
    const L = this.layout;
    this.ribbon = new Ribbon(11);
    this.ribbon.reset(L.boxCX, L.slotY, x, y);
    this.grabX = x;
    this.grabY = y;
    this.snapT = null;
  }

  moveGrab(x: number, y: number): void {
    this.grabX = x;
    this.grabY = y;
  }

  /**
   * Short pull: discard the ribbon and squash the sheet back into place.
   * The pop of the next sheet started at grab time, so restoring popT keeps
   * the current sheet fully exposed and instantly re-grabbable.
   */
  snapBack(): void {
    this.ribbon = null;
    this.snapT = 1;
    this.popT = 1;
  }

  /** Successful rip: fling the sheet off with the release velocity. */
  launchFlyer(x: number, y: number, vx: number, vy: number, gold = false): void {
    this.ribbon = null;
    const L = this.layout;
    const ribbon = new Ribbon(9);
    ribbon.reset(x, y, x + 10, y + 24);
    this.flyers.push({
      x,
      y,
      vx: clamp(vx, -2400, 2400),
      vy: Math.min(clamp(vy, -2600, 2600), -520),
      rot: (Math.random() - 0.5) * 0.6,
      vr: (Math.random() - 0.5) * 14,
      w: L.sheetW * 0.62,
      h: L.sheetH * 0.42,
      ribbon,
      age: 0,
      gold,
      tumble: Math.random() * TAU,
      tumbleV: (5 + Math.random() * 5) * (Math.random() < 0.5 ? -1 : 1),
      trail: new Float32Array(FLYER_TRAIL * 2),
      trailCursor: 0,
      trailCount: 0,
    });
  }

  /** Begin the pop-up bounce for the next tissue. */
  startPop(): void {
    this.popT = 0;
  }

  /** Reset all per-round visuals. */
  resetForRound(): void {
    this.ribbon = null;
    this.flyers = [];
    this.confetti = [];
    this.snapT = null;
    this.popT = 0;
    this.settleT = 99;
    this.goldNext = false;
    for (const s of this.trail) s.life = 0;
  }

  /** Swap the box skin (palette + brand label). */
  setSkin(skin: BoxSkin): void {
    this.skin = skin;
    this.rebuildBoxPaint();
  }

  /** Mark the currently exposed sheet as the golden bonus tissue. */
  setGoldNext(on: boolean): void {
    this.goldNext = on;
  }

  /** Fever visuals: glowing box + sparkle pull trails (set by streak heat). */
  setFeverVisual(on: boolean): void {
    this.fever = on;
  }

  /** Cache prefers-reduced-motion at boot; kills trails + glow pulsing. */
  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
  }

  /** Gold sparkle burst where the golden tissue ripped free. */
  goldBurst(x: number, y: number): void {
    const rand = mulberry32((Math.random() * 1e9) >>> 0);
    for (let i = 0; i < 26; i += 1) {
      const angle = rand() * TAU;
      const speed = 140 + rand() * 420;
      this.confetti.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 180,
        rot: rand() * TAU,
        vr: (rand() - 0.5) * 12,
        w: 4 + rand() * 5,
        h: 3 + rand() * 4,
        color: GOLD_COLORS[Math.floor(rand() * GOLD_COLORS.length)],
        dot: rand() < 0.5,
        life: 0.9 + rand() * 0.7,
        seed: rand() * TAU,
      });
    }
  }

  confettiBurst(): void {
    const rand = mulberry32((Math.random() * 1e9) >>> 0);
    const cx = this.w / 2;
    const cy = this.h * 0.3;
    for (let i = 0; i < 130; i += 1) {
      const angle = -Math.PI / 2 + (rand() - 0.5) * 1.9;
      const speed = 420 + rand() * 720;
      this.confetti.push({
        x: cx + (rand() - 0.5) * 60,
        y: cy + (rand() - 0.5) * 30,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: rand() * TAU,
        vr: (rand() - 0.5) * 12,
        w: 6 + rand() * 7,
        h: 4 + rand() * 6,
        color: CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)],
        dot: rand() < 0.35,
        life: 2.2 + rand() * 1.1,
        seed: rand() * TAU,
      });
    }
  }

  /* ------------------------------- update -------------------------------- */

  update(dt: number, pullTension: number): void {
    const L = this.layout;

    if (this.snapT !== null) {
      this.snapT -= dt / 0.34;
      if (this.snapT <= 0) this.snapT = null;
    }
    if (this.popT < 1) {
      this.popT = Math.min(1, this.popT + dt / 0.3);
      if (this.popT >= 1) {
        this.evtPopped = true;
        this.settleT = 0; // begin the decaying settle wobble
      }
    }
    this.settleT += dt;

    if (this.ribbon) {
      const stretch = clamp((pullTension - 0.75) * 0.7, 0, 0.28);
      this.ribbon.step(dt, L.boxCX, L.slotY, this.grabX, this.grabY, {
        gravity: 650,
        damping: 0.97,
        iterations: 3,
        stretch,
      });
    }

    // Fever sparkle trail: while a hot-streak pull is held, seed sparkles at
    // the fingertip from the fixed pool (skips entirely under reduced motion).
    if (this.fever && this.ribbon && !this.reducedMotion) {
      for (let i = 0; i < 2; i += 1) {
        const s = this.trail[this.trailCursor];
        this.trailCursor = (this.trailCursor + 1) % TRAIL_MAX;
        s.x = this.grabX + (Math.random() - 0.5) * 26;
        s.y = this.grabY + (Math.random() - 0.5) * 18;
        s.vx = (Math.random() - 0.5) * 60;
        s.vy = 30 + Math.random() * 90;
        s.maxLife = 0.4 + Math.random() * 0.35;
        s.life = s.maxLife;
        s.r = 1.6 + Math.random() * 2.4;
      }
    }
    for (const s of this.trail) {
      if (s.life <= 0) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
    }

    for (let i = this.flyers.length - 1; i >= 0; i -= 1) {
      const f = this.flyers[i];
      f.vy += 1500 * dt;
      f.vx *= 1 - 0.4 * dt;
      f.vy *= 1 - 0.15 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.vr * dt;
      f.vr *= 1 - 0.9 * dt;
      f.age += dt;
      f.tumble += f.tumbleV * dt;
      f.tumbleV *= 1 - 0.45 * dt;
      // Record the soft motion trail into the fixed ring buffer.
      f.trail[f.trailCursor * 2] = f.x;
      f.trail[f.trailCursor * 2 + 1] = f.y;
      f.trailCursor = (f.trailCursor + 1) % FLYER_TRAIL;
      if (f.trailCount < FLYER_TRAIL) f.trailCount += 1;
      f.ribbon.step(dt, f.x, f.y, 0, 0, {
        gravity: 500,
        damping: 0.96,
        iterations: 2,
        pinEnd: false,
        restLength: 15,
      });
      if (f.x < -360 || f.x > this.w + 360 || f.y < -320 || f.y > this.h + 320) {
        this.flyers.splice(i, 1);
        this.evtExited = true;
      }
    }

    for (let i = this.confetti.length - 1; i >= 0; i -= 1) {
      const c = this.confetti[i];
      c.vy += 880 * dt;
      c.x += (c.vx + Math.sin(c.life * 7 + c.seed) * 42) * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
      c.life -= dt;
      if (c.life <= 0 || c.y > this.h + 40) this.confetti.splice(i, 1);
    }
  }

  pollEvents(): { exited: boolean; popped: boolean } {
    const ev = { exited: this.evtExited, popped: this.evtPopped };
    this.evtExited = false;
    this.evtPopped = false;
    return ev;
  }

  /* -------------------------------- draw --------------------------------- */

  draw(round: RoundState | null, time: number, pullTension: number, showHint: boolean): void {
    const { ctx, w, h } = this;
    ctx.fillStyle = this.bgGradient ?? '#bfe8ff';
    ctx.fillRect(0, 0, w, h);

    this.drawBubbles(time);
    if (this.vignette) ctx.drawImage(this.vignette, 0, 0, w, h);

    const phase = round?.phase ?? 'idle';
    const boxEmpty = phase === 'finished' || phase === 'flying';

    if (this.fever) this.drawFeverGlow(time);
    this.drawBoxShadow();
    this.drawBoxBack(round);

    // Sheet tucked into the slot: drawn after the top face so the slot's
    // front lip (drawn in drawBoxFront) can overlap its base. While a pull
    // is held, this is the NEXT sheet rising to replace the ribbon.
    const sheetUp = !boxEmpty && this.popT > 0.01;
    if (sheetUp) this.drawIdleSheet(time);
    if (sheetUp || this.ribbon) this.drawContactShadow();
    this.drawBoxFront();

    if (this.ribbon) {
      const flutter = this.reducedMotion ? 0 : 1.0 + 2.6 * pullTension;
      this.drawRibbon(
        this.ribbon,
        this.layout.sheetW * (1 - 0.38 * pullTension),
        this.goldNext,
        flutter,
        time,
        pullTension,
      );
      this.drawTensionMeter(pullTension, time);
    }

    for (const f of this.flyers) this.drawFlyer(f);
    this.drawTrail();

    if (showHint && phase === 'idle' && round && round.pulled === 0) {
      this.drawHint(time);
    }

    this.drawConfetti();
  }

  /** Fever pull-trail sparkles (pooled; alpha fades with life). */
  private drawTrail(): void {
    const { ctx } = this;
    for (const s of this.trail) {
      if (s.life <= 0) continue;
      const a = clamp(s.life / s.maxLife, 0, 1);
      ctx.strokeStyle = TRAILSPARK_STYLES[Math.min(15, Math.floor(a * 16))];
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(s.x - s.r, s.y);
      ctx.lineTo(s.x + s.r, s.y);
      ctx.moveTo(s.x, s.y - s.r);
      ctx.lineTo(s.x, s.y + s.r);
      ctx.stroke();
    }
  }

  private drawBubbles(time: number): void {
    const { ctx, w, h } = this;
    for (const b of this.bubbles) {
      const y = (((b.y * h - time * b.speed) % (h + 80)) + h + 80) % (h + 80) - 40;
      const x = b.x * w + Math.sin(time * 0.4 + b.seed) * b.drift;
      ctx.fillStyle = b.style;
      ctx.beginPath();
      ctx.arc(x, y, b.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = b.hiStyle;
      ctx.beginPath();
      ctx.arc(x - b.r * 0.3, y - b.r * 0.35, b.r * 0.3, 0, TAU);
      ctx.fill();
    }
    for (const s of this.sparkles) {
      const tw = 0.5 + 0.5 * Math.sin(time * s.speed * 2 + s.seed);
      const x = s.x * w;
      const y = s.y * h * 0.6;
      ctx.strokeStyle = SPARKLE_STYLES[Math.min(15, Math.floor(tw * 16))];
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x - s.r, y);
      ctx.lineTo(x + s.r, y);
      ctx.moveTo(x, y - s.r);
      ctx.lineTo(x, y + s.r);
      ctx.stroke();
    }
  }

  private roundedRectPath(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    roundTop = true,
    roundBottom = true,
  ): void {
    const ctx = this.ctx;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + (roundTop ? rr : 0), y);
    ctx.lineTo(x + w - (roundTop ? rr : 0), y);
    if (roundTop) ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - (roundBottom ? rr : 0));
    if (roundBottom) ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + (roundBottom ? rr : 0), y + h);
    if (roundBottom) ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + (roundTop ? rr : 0));
    if (roundTop) ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  /** Fever glow: warm halo around the box (static under reduced motion). */
  private drawFeverGlow(time: number): void {
    const { ctx } = this;
    const L = this.layout;
    const g = this.boxGeo;
    const pulse = this.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 4.2);
    for (let i = 3; i >= 1; i -= 1) {
      const grow = i * 7;
      ctx.fillStyle = `rgba(255,190,80,${0.05 + 0.05 * pulse * (4 - i)})`;
      this.roundedRectPath(
        g.x - grow,
        g.y - grow,
        L.boxW + g.ex + grow * 2,
        L.boxH + grow * 2,
        L.boxR + grow,
      );
      ctx.fill();
    }
  }

  /** Soft blurred drop shadow grounding the box (pre-rendered blob sprite). */
  private drawBoxShadow(): void {
    const { ctx } = this;
    const L = this.layout;
    const g = this.boxGeo;
    // Cast down-right, away from the top-left key light.
    ctx.globalAlpha = 0.34;
    ctx.drawImage(
      this.shadowBlob,
      g.x - L.boxW * 0.1 + g.ex * 0.7,
      g.bottom - L.boxH * 0.2 + 6,
      L.boxW * 1.24,
      L.boxH * 0.5,
    );
    ctx.globalAlpha = 1;
  }

  /**
   * Back half of the 3/4 box: darkest right side face, lightest top face
   * with cardboard grain, the elliptical slot well and the back half of the
   * crinkly clear-film collar with its key-light specular arc.
   */
  private drawBoxBack(round: RoundState | null): void {
    const { ctx } = this;
    const L = this.layout;
    const g = this.boxGeo;
    const skin = this.skin;
    const x = g.x;
    const y = g.y;
    const w = L.boxW;
    const ft = g.frontTop;
    const ex = g.ex;
    const bottom = g.bottom;
    const scx = L.boxCX + ex * 0.4;
    const scy = L.slotY;
    const rx = L.slotW / 2;

    // Right side face (darkest — turned away from the key light).
    ctx.fillStyle = this.boxSideGrad ?? shadeRgb(skin.bodyBottom, 0.55);
    ctx.beginPath();
    ctx.moveTo(x + w, ft);
    ctx.lineTo(x + w + ex, y);
    ctx.lineTo(x + w + ex, bottom - (ft - y));
    ctx.lineTo(x + w, bottom);
    ctx.closePath();
    ctx.fill();

    // Top face (lightest — faces the key light).
    ctx.fillStyle = this.boxTopGrad ?? tintRgb(skin.bodyTop, 0.4);
    ctx.beginPath();
    ctx.moveTo(x, ft);
    ctx.lineTo(x + w, ft);
    ctx.lineTo(x + w + ex, y);
    ctx.lineTo(x + ex, y);
    ctx.closePath();
    ctx.fill();
    // Cardboard print grain on the top face.
    if (this.noisePattern) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, ft);
      ctx.lineTo(x + w, ft);
      ctx.lineTo(x + w + ex, y);
      ctx.lineTo(x + ex, y);
      ctx.closePath();
      ctx.clip();
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = this.noisePattern;
      ctx.fillRect(x - 1, y - 1, w + ex + 2, ft - y + 2);
      ctx.restore();
    }
    // Top-face edge shading: lit back + left rims (facing the key light).
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + ex, y + 0.8);
    ctx.lineTo(x + w + ex, y + 0.8);
    ctx.moveTo(x + 0.8, ft);
    ctx.lineTo(x + ex + 0.8, y + 1);
    ctx.stroke();
    // Ambient occlusion where the top face meets the front.
    ctx.strokeStyle = 'rgba(40,70,100,0.16)';
    ctx.beginPath();
    ctx.moveTo(x + 1, ft - 0.8);
    ctx.lineTo(x + w - 1, ft - 0.8);
    ctx.stroke();
    // Seam highlight where the side face meets the top.
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.moveTo(x + w, ft - 0.8);
    ctx.lineTo(x + w + ex, y + 0.8);
    ctx.stroke();

    // Slot well (ellipse on the top plane).
    ctx.fillStyle = this.slotGrad ?? '#223a4d';
    ctx.beginPath();
    ctx.ellipse(scx, scy, rx, g.slotRy, 0, 0, TAU);
    ctx.fill();
    // Deep shadow along the far wall of the slot.
    ctx.strokeStyle = 'rgba(8,18,30,0.5)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(scx, scy, rx - 1.5, g.slotRy - 1.2, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();

    // Remaining-stack hint inside the well (layered sheet edges).
    if (!round || round.remaining > 0) {
      ctx.strokeStyle = 'rgba(250,252,255,0.85)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i += 1) {
        const yy = scy - 3 + i * 2.6;
        ctx.beginPath();
        ctx.moveTo(scx - rx + 9, yy);
        ctx.quadraticCurveTo(scx, yy - 2.2, scx + rx - 9, yy);
        ctx.stroke();
      }
    }

    // Crinkly clear-film collar, back half: translucent white ring with a
    // bright specular arc on the upper-left (the key-light side).
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(scx, scy, rx + 5, g.slotRy + 3.5, 0, Math.PI, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(scx, scy, rx + 5, g.slotRy + 3.5, 0, Math.PI * 1.06, Math.PI * 1.5);
    ctx.stroke();
    // Film crinkles radiating outward (deterministic, seeded once).
    ctx.lineWidth = 1.1;
    for (const c of COLLAR_CRINKLES) {
      const ca = Math.cos(c.ang);
      const sa = Math.sin(c.ang);
      ctx.strokeStyle = `rgba(255,255,255,${c.alpha})`;
      ctx.beginPath();
      ctx.moveTo(scx + ca * (rx + c.r0), scy + sa * (g.slotRy + c.r0 * 0.7));
      ctx.lineTo(scx + ca * (rx + c.r0 + c.len), scy + sa * (g.slotRy + (c.r0 + c.len) * 0.7));
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  /**
   * Front half of the box: the palette-driven front face with dot print,
   * cardboard grain, sheen and edge shading, plus the front lip of the film
   * collar so the sheet reads as tucked through the slot.
   */
  private drawBoxFront(): void {
    const { ctx } = this;
    const L = this.layout;
    const g = this.boxGeo;
    const skin = this.skin;
    const x = g.x;
    const w = L.boxW;
    const ft = g.frontTop;
    const bottom = g.bottom;
    const frontH = g.frontH;

    // Body (mid shading — the raw skin palette).
    ctx.fillStyle = this.boxFrontGrad ?? skin.bodyBottom;
    this.roundedRectPath(x, ft, w, frontH, L.boxR, false, true);
    ctx.fill();

    ctx.save();
    this.roundedRectPath(x, ft, w, frontH, L.boxR, false, true);
    ctx.clip();

    // Polka-dot print.
    ctx.fillStyle = skin.dot;
    const step = 34;
    for (let row = 0; row < frontH / step + 1; row += 1) {
      for (let col = 0; col < w / step + 1; col += 1) {
        const px = x + col * step + (row % 2 === 0 ? 0 : step / 2);
        const py = ft + row * step + 8;
        ctx.beginPath();
        ctx.arc(px, py, 5.5, 0, TAU);
        ctx.fill();
      }
    }

    // Cardboard print grain.
    if (this.noisePattern) {
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = this.noisePattern;
      ctx.fillRect(x, ft, w, frontH);
      ctx.globalAlpha = 1;
    }

    // Directional sheen from the key light.
    if (this.boxSheenGrad) {
      ctx.fillStyle = this.boxSheenGrad;
      ctx.fillRect(x, ft, w, frontH);
    }
    ctx.restore();

    // Edge shading: lit left rim, ambient occlusion at the bottom, darker
    // seam where the front turns into the shadow side face.
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 1.2, bottom - L.boxR * 0.7);
    ctx.lineTo(x + 1.2, ft + 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(30,60,95,0.22)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x + L.boxR * 0.5, bottom - 1.5);
    ctx.lineTo(x + w - L.boxR * 0.5, bottom - 1.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(30,60,95,0.26)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + w - 1.2, ft + 2);
    ctx.lineTo(x + w - 1.2, bottom - L.boxR * 0.7);
    ctx.stroke();

    // Brand label.
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `800 ${Math.round(L.boxW * 0.105)}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(skin.label, L.boxCX, ft + frontH * 0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = `700 ${Math.round(L.boxW * 0.055)}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    ctx.fillText(skin.sublabel, L.boxCX, ft + frontH * 0.71);

    // Front lip of the film collar + the slot's near rim, drawn over the
    // sheet base so the tissue reads as tucked through the opening.
    const scx = L.boxCX + g.ex * 0.4;
    const scy = L.slotY;
    const rx = L.slotW / 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.26)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(scx, scy, rx + 5, g.slotRy + 3.5, 0, 0, Math.PI);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(scx, scy, rx + 5, g.slotRy + 3.5, 0, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(10,20,30,0.35)';
    ctx.beginPath();
    ctx.ellipse(scx, scy, rx - 1, g.slotRy - 1, 0, 0, Math.PI);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  /** Soft contact shadow where the sheet/ribbon exits the slot. */
  private drawContactShadow(): void {
    const { ctx } = this;
    const L = this.layout;
    ctx.globalAlpha = 0.2;
    ctx.drawImage(
      this.shadowBlob,
      L.boxCX + this.boxGeo.ex * 0.2 - L.slotW * 0.28,
      L.slotY - 5,
      L.slotW * 0.56,
      12,
    );
    ctx.globalAlpha = 1;
  }

  /** Wavy soft sheet path, shared by the idle sheet and flyers. */
  private sheetPath(
    cx: number,
    bottomY: number,
    w: number,
    h: number,
    sway: number,
    time: number,
  ): void {
    const ctx = this.ctx;
    const top = bottomY - h;
    const half = w / 2;
    const swayTop = sway * 7;
    ctx.beginPath();
    ctx.moveTo(cx - half + sway * 1.5, bottomY);
    ctx.quadraticCurveTo(
      cx - half - 3 + sway * 3,
      (top + bottomY) / 2,
      cx - half + swayTop,
      top + 4,
    );
    const steps = 8;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const px = cx - half + swayTop + w * t;
      const py = top + 4 + Math.sin(t * Math.PI * 2.2 + time * 2.2) * 2.6 - Math.sin(t * Math.PI) * 3;
      ctx.lineTo(px, py);
    }
    ctx.quadraticCurveTo(
      cx + half + 3 + sway * 3,
      (top + bottomY) / 2,
      cx + half + sway * 1.5,
      bottomY,
    );
    ctx.closePath();
  }

  private drawIdleSheet(time: number): void {
    const { ctx } = this;
    const L = this.layout;
    let scale = easeOutBack(clamp(this.popT, 0, 1));
    if (this.snapT !== null) {
      scale *= 0.55 + 0.45 * easeOutElastic(1 - this.snapT);
    }
    const h = L.sheetH * Math.max(0.02, scale);
    const sway = Math.sin(time * 1.7) * 0.6 + Math.sin(time * 0.9 + 1.3) * 0.4;
    // Base sits deep enough in the slot that the collar lip overlaps it.
    const bottom = L.slotY + 9;
    const gold = this.goldNext;

    // Decaying settle wobble after the pop overshoot (render-only; the
    // grabbable rect in exposedTissueRect is unaffected).
    const settle = this.reducedMotion ? 0 : Math.exp(-this.settleT * 3.0) * Math.sin(this.settleT * 14);

    ctx.save();
    ctx.translate(L.boxCX, bottom);
    ctx.rotate(settle * 0.05);
    ctx.translate(-L.boxCX, -bottom);

    // Soft shadow the standing sheet casts on the box top (down-right).
    ctx.globalAlpha = 0.13;
    ctx.drawImage(
      this.shadowBlob,
      L.boxCX - L.sheetW * 0.3 + 6,
      bottom - 8,
      L.sheetW * 0.64,
      16,
    );
    ctx.globalAlpha = 1;

    // Paper body: cached lit gradient, slightly translucent against the box.
    ctx.globalAlpha = 0.96;
    ctx.fillStyle = (gold ? this.sheetGradGold : this.sheetGrad) ?? (gold ? '#ffe9a8' : '#f7fafd');
    this.sheetPath(L.boxCX, bottom, L.sheetW, h, sway, time);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Paper texture: quilted diamond emboss + fiber grain, clipped to the sheet.
    ctx.save();
    this.sheetPath(L.boxCX, bottom, L.sheetW, h, sway, time);
    ctx.clip();
    if (this.embossPattern) {
      ctx.globalAlpha = gold ? 0.08 : 0.11;
      ctx.fillStyle = this.embossPattern;
      ctx.fillRect(L.boxCX - L.sheetW, bottom - h - 8, L.sheetW * 2, h + 16);
    }
    if (this.noisePattern) {
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = this.noisePattern;
      ctx.fillRect(L.boxCX - L.sheetW, bottom - h - 8, L.sheetW * 2, h + 16);
    }
    ctx.restore();

    // Alpha-feathered edges: a soft halo stroke around the silhouette.
    ctx.strokeStyle = gold ? 'rgba(255,240,190,0.28)' : 'rgba(255,255,255,0.26)';
    ctx.lineWidth = 3;
    this.sheetPath(L.boxCX, bottom, L.sheetW, h, sway, time);
    ctx.stroke();

    // Key-light edge shading: lit left rim, shaded right rim.
    const top = bottom - h;
    const half = L.sheetW / 2;
    const swayTop = sway * 7;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(L.boxCX - half + sway * 1.5, bottom);
    ctx.quadraticCurveTo(
      L.boxCX - half - 3 + sway * 3,
      (top + bottom) / 2,
      L.boxCX - half + swayTop,
      top + 4,
    );
    ctx.stroke();
    ctx.strokeStyle = gold ? 'rgba(190,140,40,0.32)' : 'rgba(130,150,180,0.3)';
    ctx.beginPath();
    ctx.moveTo(L.boxCX + half + sway * 1.5, bottom);
    ctx.quadraticCurveTo(
      L.boxCX + half + 3 + sway * 3,
      (top + bottom) / 2,
      L.boxCX + half + swayTop,
      top + 6,
    );
    ctx.stroke();

    // Fold shading lines (soft shadow + offset highlight pair).
    for (const f of [0.34, 0.66]) {
      const fx = L.boxCX - half + L.sheetW * f;
      ctx.strokeStyle = gold ? 'rgba(214,158,46,0.4)' : 'rgba(150,170,200,0.26)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(fx + sway * 1.5, bottom - 2);
      ctx.quadraticCurveTo(fx + sway * 4, bottom - h * 0.55, fx + sway * 6, bottom - h + 7);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fx - 1.5 + sway * 1.5, bottom - 2);
      ctx.quadraticCurveTo(fx - 1.5 + sway * 4, bottom - h * 0.55, fx - 1.5 + sway * 6, bottom - h + 7);
      ctx.stroke();
    }

    // Crumple lines at the base where the sheet is pinched through the slot.
    ctx.strokeStyle = gold ? 'rgba(180,130,36,0.3)' : 'rgba(140,160,190,0.24)';
    ctx.lineWidth = 1.4;
    for (const f of [0.3, 0.5, 0.7]) {
      const fx = L.boxCX - half + L.sheetW * f;
      ctx.beginPath();
      ctx.moveTo(fx - 5, bottom - 1);
      ctx.quadraticCurveTo(fx, bottom - 7, fx + 5, bottom - 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Draw a verlet ribbon as real tissue paper: per-segment flat shading from
   * the segment's angle to the key light (precomputed palettes — zero
   * allocation), lit/shadow edge strokes, clipped emboss + fiber overlays,
   * crumple wrinkles near the fingers and a render-only micro-flutter that
   * grows toward the free end. The sim state is never touched.
   */
  private drawRibbon(
    ribbon: Ribbon,
    baseW: number,
    gold: boolean,
    flutter: number,
    phase: number,
    tension: number,
  ): void {
    const { ctx } = this;
    const pts = ribbon.points;
    const n = Math.min(pts.length, RIBBON_MAX);
    if (n < 2) return;
    const lx = this.bufLx;
    const ly = this.bufLy;
    const rx = this.bufRx;
    const ry = this.bufRy;
    const face = this.bufFace;

    // Edge points via per-point normals; width tapers toward the fingers.
    for (let i = 0; i < n; i += 1) {
      const p = pts[i];
      const q = pts[Math.min(n - 1, i + 1)];
      const o = pts[Math.max(0, i - 1)];
      let dx = q.x - o.x;
      let dy = q.y - o.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const t = i / (n - 1);
      const halfW = (baseW / 2) * (1 - 0.5 * t) + 1;
      // Micro-flutter on render positions only — the sim is untouched.
      const fl = flutter * t * t;
      const px = p.x + Math.sin(phase * 21 + i * 1.93) * fl;
      const py = p.y + Math.cos(phase * 17 + i * 2.31) * fl * 0.8;
      lx[i] = px - dy * halfW;
      ly[i] = py + dx * halfW;
      rx[i] = px + dy * halfW;
      ry[i] = py - dx * halfW;
    }

    // Per-segment fill, shaded by the segment normal vs the key light.
    const shades = gold ? GOLD_SHADES : PAPER_SHADES;
    for (let i = 0; i < n - 1; i += 1) {
      const mlx = (lx[i] + lx[i + 1]) * 0.5;
      const mly = (ly[i] + ly[i + 1]) * 0.5;
      const mrx = (rx[i] + rx[i + 1]) * 0.5;
      const mry = (ry[i] + ry[i + 1]) * 0.5;
      let nx = mlx - mrx;
      let ny = mly - mry;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const facing = nx * LIGHT_X + ny * LIGHT_Y;
      face[i] = facing;
      const ti = (i + 0.5) / (n - 1);
      // Root sits in the slot's shadow; the pinched end darkens slightly.
      const bright =
        clamp(0.5 + 0.55 * facing, 0, 1) *
        (1 - 0.16 * ti * ti) *
        (0.86 + 0.14 * Math.min(1, ti / 0.18));
      ctx.fillStyle = shades[clamp(Math.round(bright * 11), 0, 11)];
      ctx.beginPath();
      ctx.moveTo(lx[i], ly[i]);
      ctx.lineTo(lx[i + 1], ly[i + 1]);
      ctx.lineTo(rx[i + 1], ry[i + 1]);
      ctx.lineTo(rx[i], ry[i]);
      ctx.closePath();
      ctx.fill();
    }

    // Paper texture overlays clipped to the ribbon silhouette.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(lx[0], ly[0]);
    for (let i = 1; i < n; i += 1) ctx.lineTo(lx[i], ly[i]);
    for (let i = n - 1; i >= 0; i -= 1) ctx.lineTo(rx[i], ry[i]);
    ctx.closePath();
    ctx.clip();
    let minX = lx[0];
    let minY = ly[0];
    let maxX = lx[0];
    let maxY = ly[0];
    for (let i = 0; i < n; i += 1) {
      minX = Math.min(minX, lx[i], rx[i]);
      minY = Math.min(minY, ly[i], ry[i]);
      maxX = Math.max(maxX, lx[i], rx[i]);
      maxY = Math.max(maxY, ly[i], ry[i]);
    }
    if (this.embossPattern) {
      ctx.globalAlpha = gold ? 0.07 : 0.09;
      ctx.fillStyle = this.embossPattern;
      ctx.fillRect(minX - 2, minY - 2, maxX - minX + 4, maxY - minY + 4);
    }
    if (this.noisePattern) {
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = this.noisePattern;
      ctx.fillRect(minX - 2, minY - 2, maxX - minX + 4, maxY - minY + 4);
    }
    ctx.restore();

    // Soft alpha-feathered silhouette.
    ctx.strokeStyle = gold ? 'rgba(255,240,190,0.2)' : 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(lx[0], ly[0]);
    for (let i = 1; i < n; i += 1) ctx.lineTo(lx[i], ly[i]);
    for (let i = n - 1; i >= 0; i -= 1) ctx.lineTo(rx[i], ry[i]);
    ctx.closePath();
    ctx.stroke();

    // Lit vs shadow edge strokes per segment (follows the key light side).
    const litEdge = gold ? 'rgba(255,244,205,0.55)' : 'rgba(255,255,255,0.5)';
    const darkEdge = gold ? 'rgba(150,104,20,0.35)' : 'rgba(120,140,170,0.32)';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < n - 1; i += 1) {
      const leftLit = face[i] > 0;
      ctx.strokeStyle = leftLit ? litEdge : darkEdge;
      ctx.beginPath();
      ctx.moveTo(lx[i], ly[i]);
      ctx.lineTo(lx[i + 1], ly[i + 1]);
      ctx.stroke();
      ctx.strokeStyle = leftLit ? darkEdge : litEdge;
      ctx.beginPath();
      ctx.moveTo(rx[i], ry[i]);
      ctx.lineTo(rx[i + 1], ry[i + 1]);
      ctx.stroke();
    }

    // Crumple/wrinkle shading where the sheet is pinched by the fingers.
    if (tension > 0.12) {
      const a = 0.26 * clamp(tension, 0, 1);
      ctx.globalAlpha = a;
      ctx.strokeStyle = gold ? 'rgb(150,104,20)' : 'rgb(118,138,168)';
      ctx.lineWidth = 1.3;
      for (let k = 1; k <= 3; k += 1) {
        const idx = n - 1 - k;
        if (idx < 1) break;
        ctx.beginPath();
        ctx.moveTo(lx[idx] + (rx[idx] - lx[idx]) * 0.22, ly[idx] + (ry[idx] - ly[idx]) * 0.22);
        ctx.quadraticCurveTo(
          (lx[idx] + rx[idx]) * 0.5 + 2,
          (ly[idx] + ry[idx]) * 0.5 - 2,
          lx[idx] + (rx[idx] - lx[idx]) * 0.78,
          ly[idx] + (ry[idx] - ly[idx]) * 0.78,
        );
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Soft finger occlusion at the pinch point.
      ctx.globalAlpha = 0.12 * clamp(tension, 0, 1);
      ctx.drawImage(this.shadowBlob, pts[n - 1].x - 15, pts[n - 1].y - 9, 30, 18);
      ctx.globalAlpha = 1;
    }
  }

  private drawTensionMeter(t: number, time: number): void {
    const { ctx } = this;
    const L = this.layout;
    const mw = 13;
    const mh = L.sheetH + 46;
    const mx = L.boxCX + L.boxW / 2 + 16;
    const my = L.slotY + 14 - mh;

    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    this.roundedRectPath(mx, my, mw, mh, mw / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(46,110,160,0.22)';
    ctx.lineWidth = 1;
    this.roundedRectPath(mx + 0.5, my + 0.5, mw - 1, mh - 1, mw / 2);
    ctx.stroke();

    const fillH = mh * clamp(t, 0, 1);
    if (fillH > 2) {
      ctx.fillStyle = METER_HUES[clamp(Math.round(t * 24), 0, 24)];
      this.roundedRectPath(mx + 2, my + mh - fillH + 2, mw - 4, Math.max(4, fillH - 4), (mw - 4) / 2);
      ctx.fill();
    }

    // Threshold tick at the top of the track.
    ctx.fillStyle = 'rgba(46,110,160,0.5)';
    ctx.fillRect(mx - 3, my - 1.5, mw + 6, 3);

    // Rip flash when at full tension.
    if (t >= 1) {
      const a = 0.35 + 0.25 * Math.sin(time * 26);
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(L.boxCX, L.slotY, L.slotW * 0.55, 0, TAU);
      ctx.stroke();
    }
  }

  private drawFlyer(f: Flyer): void {
    const { ctx } = this;

    // Soft fading motion trail (fixed ring buffer, precomputed styles).
    if (!this.reducedMotion && f.trailCount > 1) {
      const styles = f.gold ? TRAIL_STYLES_GOLD : TRAIL_STYLES_WHITE;
      for (let k = 0; k < f.trailCount; k += 1) {
        const idx = (f.trailCursor - 1 - k + FLYER_TRAIL * 2) % FLYER_TRAIL;
        const t = k / FLYER_TRAIL;
        ctx.fillStyle = styles[k];
        ctx.beginPath();
        ctx.ellipse(
          f.trail[idx * 2],
          f.trail[idx * 2 + 1],
          f.w * (0.24 + 0.3 * t),
          f.h * (0.3 + 0.38 * t),
          0,
          0,
          TAU,
        );
        ctx.fill();
      }
    }

    // Trailing cloth tail first, body over it.
    const tailFlutter = this.reducedMotion ? 0 : 2.2 * Math.exp(-f.age * 1.1) + 0.3;
    this.drawRibbon(f.ribbon, f.w * 0.8, f.gold, tailFlutter, f.age, 0);

    // Body tumbling with fake perspective: oscillating scale + skew, shaded
    // as it turns away from the key light.
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rot);
    const flip = Math.cos(f.tumble);
    const sx = 0.22 + 0.78 * Math.abs(flip);
    ctx.transform(sx, 0, Math.sin(f.tumble) * 0.18, 1, 0, 0);

    ctx.fillStyle = f.gold ? GOLD_SHADES[10] : PAPER_SHADES[10];
    ctx.beginPath();
    ctx.moveTo(-f.w / 2, -f.h / 2 + 3);
    const steps = 6;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      ctx.lineTo(
        -f.w / 2 + f.w * t,
        -f.h / 2 + Math.sin(t * Math.PI * 2.4 + f.age * 16) * 3,
      );
    }
    ctx.lineTo(f.w / 2, f.h / 2);
    ctx.lineTo(-f.w / 2, f.h / 2);
    ctx.closePath();
    ctx.fill();

    // Tumble shading: edge-on and back-facing poses fall into shadow.
    const darkness = (1 - Math.abs(flip)) * 0.32 + (flip < 0 ? 0.1 : 0);
    if (darkness > 0.02) {
      ctx.globalAlpha = darkness;
      ctx.fillStyle = f.gold ? 'rgb(150,104,20)' : 'rgb(110,130,160)';
      ctx.beginPath();
      ctx.moveTo(-f.w / 2, -f.h / 2 + 3);
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        ctx.lineTo(
          -f.w / 2 + f.w * t,
          -f.h / 2 + Math.sin(t * Math.PI * 2.4 + f.age * 16) * 3,
        );
      }
      ctx.lineTo(f.w / 2, f.h / 2);
      ctx.lineTo(-f.w / 2, f.h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Fold lines + a lit top edge from the key light.
    const wobble = Math.sin(f.age * 14) * 0.15;
    ctx.strokeStyle = f.gold
      ? `rgba(214,158,46,${0.4 + wobble})`
      : `rgba(150,170,200,${0.34 + wobble})`;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-f.w * 0.18, -f.h / 2 + 4);
    ctx.lineTo(-f.w * 0.18, f.h / 2 - 2);
    ctx.moveTo(f.w * 0.16, -f.h / 2 + 3);
    ctx.lineTo(f.w * 0.16, f.h / 2 - 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-f.w / 2 + 2, -f.h / 2 + 3);
    ctx.lineTo(f.w / 2 - 2, -f.h / 2 + 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawHint(time: number): void {
    const { ctx } = this;
    const L = this.layout;
    const baseY = L.slotY - L.sheetH - 22;
    for (let i = 0; i < 2; i += 1) {
      const phase = (time * 1.4 + i * 0.5) % 1;
      const y = baseY - phase * 34;
      const a = 0.55 * (1 - phase);
      ctx.strokeStyle = `rgba(46,110,160,${a})`;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(L.boxCX - 14, y + 8);
      ctx.lineTo(L.boxCX, y - 6);
      ctx.lineTo(L.boxCX + 14, y + 8);
      ctx.stroke();
    }
  }

  private drawConfetti(): void {
    const { ctx } = this;
    for (const c of this.confetti) {
      const a = clamp(c.life / 0.7, 0, 1);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.globalAlpha = a;
      ctx.fillStyle = c.color;
      if (c.dot) {
        ctx.beginPath();
        ctx.arc(0, 0, c.w / 2, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
