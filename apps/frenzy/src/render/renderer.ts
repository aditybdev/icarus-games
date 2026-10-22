/**
 * Four-Leg Frenzy — canvas renderer. All drawing is procedural (no assets).
 * Purely visual: reads SimState but never mutates it.
 *
 * Studio-grade presentation layer:
 *  - 5-plane parallax (sky/sun, clouds, hills, tree+crowd silhouette, track,
 *    plus a near-field pollen plane) with per-plane shake falloff.
 *  - Pre-rendered sprites & gradients (built at init/resize) so the per-frame
 *    path performs zero allocations and never touches shadowBlur.
 *  - Juice: squash & stretch, compressing soft shadow, footfall dust sprites,
 *    speed lines, finish-line bloom, cheering crowd, drifting cloud shadows.
 */
import {
  LEG_OFFSET_X,
  LEG_SIGN,
  TRACK_LENGTH,
  V_MAX,
  type SimState,
} from '../sim/types';

export interface ViewState {
  /** Camera world-x (follows the creature). */
  camX: number;
  /** Wall-clock ms for idle animation (blinks, clouds, puff aging). */
  nowMs: number;
  /** 0..1 camera-shake trauma. */
  shake: number;
  reducedMotion: boolean;
  /** World-x of the PB pace-flag, or null when no PB exists / not racing. */
  pbFlagX: number | null;
}

interface Puff {
  x: number;
  birth: number;
  big: boolean;
}

interface Confetti {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  color: number;
  birth: number;
}

const BODY = '#e0a96d';
const BODY_DARK = '#c68f52';
const BELLY = '#f2d3a7';
const OUTLINE = '#5a3d26';
const LEG_NEAR = '#d1985c';
const LEG_FAR = '#a9743f';
const HOOF = '#6b4a2f';
const MANE = '#b57e46';

const THIGH = 0.3;
const SHIN = 0.36;

const CONFETTI_COLORS = ['#ffd94a', '#ff8fb3', '#58a83c', '#7ec8ff', '#fff7e6'];
const CONFETTI_LIFE_MS = 1400;
/** Finish-line glow after a confetti burst. */
const BLOOM_MS = 1100;

/** Far -> near draw order for the legs (far side first). Module const so the
 * per-frame loop never allocates an array literal. */
const LEG_ORDER = [1, 3, 0, 2] as const;

/** Hill layers: [parallax, color, amplitude, frequency]. */
const HILL_LAYERS: ReadonlyArray<readonly [number, string, number, number]> = [
  [0.35, '#a5d977', 0.55, 0.9],
  [0.55, '#8ccb66', 0.35, 1.4],
];

const POLLEN_COUNT = 20;
const CROWD_SPACING = 34;
/** Crowd goes wild once the leader passes 40 m (mirrors FINAL_STRETCH_M). */
const EXCITE_FROM_M = TRACK_LENGTH - 10;

/** Distance-marker labels, interned so drawGround never builds strings. */
const markerLabels = new Map<number, string>();
function markerLabel(m: number): string {
  let s = markerLabels.get(m);
  if (s === undefined) {
    s = `${m} m`;
    markerLabels.set(m, s);
  }
  return s;
}

/** Deterministic hash -> [0,1) for scenery placement. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  return [c, ctx];
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private puffs: Puff[] = [];
  private confetti: Confetti[] = [];

  // ---- pre-rendered (rebuilt in resize) ----
  private skyGrad: CanvasGradient | null = null;
  private groundGrad: CanvasGradient | null = null;
  private gradeGrad: CanvasGradient | null = null;
  private groundPattern: CanvasPattern | null = null;
  private vignette: HTMLCanvasElement | null = null;

  // ---- pre-rendered sprites (built once) ----
  private cloudSprite: HTMLCanvasElement;
  private puffSprite: HTMLCanvasElement;
  private shadowSprite: HTMLCanvasElement;
  private glowSprite: HTMLCanvasElement;
  private sunSprite: HTMLCanvasElement;
  private silTile: HTMLCanvasElement;
  private personSprites: HTMLCanvasElement[] = [];
  private speckleTile: HTMLCanvasElement;

  // ---- fixed-size ambient state (no per-frame allocation) ----
  private pollenSeeds = new Float32Array(POLLEN_COUNT);
  private crowdEnergy = 0.12;
  private crowdLastMs = -1;
  private lastConfettiAt = -1e9;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    for (let i = 0; i < POLLEN_COUNT; i++) this.pollenSeeds[i] = hash(i * 3.7 + 1);

    this.cloudSprite = this.buildCloudSprite();
    this.puffSprite = this.buildPuffSprite();
    this.shadowSprite = this.buildShadowSprite();
    this.glowSprite = this.buildGlowSprite();
    this.sunSprite = this.buildSunSprite();
    this.silTile = this.buildSilhouetteTile();
    this.speckleTile = this.buildSpeckleTile();
    const crowdPalette = ['#ffd94a', '#ff8fb3', '#7ec8ff', '#fff7e6', '#ff6b5e'];
    for (const c of crowdPalette) this.personSprites.push(this.buildPersonSprite(c));

    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    // Size-dependent gradients/patterns rebuild lazily or right here.
    this.skyGrad = null;
    this.groundGrad = null;
    this.gradeGrad = null;
    this.groundPattern = null;
    this.vignette = this.buildVignette();
  }

  /** Dust puff at a hoof plant (world x). */
  addPuff(x: number, big: boolean, nowMs: number): void {
    this.puffs.push({ x, birth: nowMs, big });
    if (this.puffs.length > 40) this.puffs.splice(0, this.puffs.length - 40);
  }

  /** Confetti burst at the finish line (world x). Particle ages are derived
   * from `birth`, so no per-frame mutation is needed (same pattern as puffs). */
  addConfetti(x: number, nowMs: number): void {
    this.lastConfettiAt = nowMs;
    for (let i = 0; i < 26; i++) {
      this.confetti.push({
        x,
        y: 0.4 + Math.random() * 0.5,
        vx: (Math.random() - 0.5) * 6,
        vy: 3 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 12,
        color: i % CONFETTI_COLORS.length,
        birth: nowMs,
      });
    }
    if (this.confetti.length > 60) this.confetti.splice(0, this.confetti.length - 60);
  }

  private get ppm(): number {
    return Math.min(this.w, this.h) * 0.28;
  }

  private get groundY(): number {
    if (this.h > this.w) return this.h * 0.55;
    // Short landscape (phones): the leg pad occupies ~40% of the height, so
    // keep the creature above it instead of at 0.72·h behind the buttons.
    return this.h < 520 ? this.h * 0.55 : this.h * 0.72;
  }

  private sx(wx: number, camX: number): number {
    return (wx - camX) * this.ppm + this.w * 0.3;
  }

  private sy(wy: number): number {
    return this.groundY - wy * this.ppm;
  }

  draw(sim: SimState, view: ViewState): void {
    const { ctx, w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    let camX = view.camX;
    let camY = 0;
    if (view.shake > 0.001 && !view.reducedMotion) {
      const t = view.nowMs;
      camX += (Math.sin(t * 0.11) + Math.sin(t * 0.047)) * 0.02 * view.shake;
      camY = Math.sin(t * 0.13) * 5 * view.shake;
    }

    // Crowd excitement: ramps toward 1 in the final stretch, decays after.
    const exciteTarget =
      sim.mode === 'race' && !sim.finished && !sim.timedOut && sim.distance >= EXCITE_FROM_M
        ? 1
        : 0.12;
    if (this.crowdLastMs < 0) this.crowdLastMs = view.nowMs;
    const cdt = clamp((view.nowMs - this.crowdLastMs) / 1000, 0, 0.1);
    this.crowdLastMs = view.nowMs;
    this.crowdEnergy += (exciteTarget - this.crowdEnergy) * Math.min(1, cdt * 3);

    // Every plane takes a proportional share of the camera shake, so the whole
    // scene (parallax included) rattles together.
    this.drawSky(camX, camY * 0.25, view.nowMs);
    this.drawHills(camX, camY * 0.5);
    this.drawSilhouette(camX, camY * 0.7);
    this.drawCrowd(camX, camY * 0.7, view.nowMs, view.reducedMotion);

    ctx.save();
    ctx.translate(0, camY);
    this.drawGround(camX, sim.mode === 'race', view.pbFlagX);
    this.drawCreature(sim, camX, view.nowMs, view.reducedMotion);
    this.drawPuffs(camX, view.nowMs);
    this.drawConfetti(camX, view.nowMs);
    this.drawCloudShadows(view.nowMs, view.reducedMotion);
    ctx.restore();

    this.drawPollen(view.nowMs, view.reducedMotion);
    this.drawGrade();
  }

  // ------------------------------------------------------------ pre-render

  private buildCloudSprite(): HTMLCanvasElement {
    const [c, x] = makeCanvas(240, 140);
    const blobs: Array<[number, number, number]> = [
      [80, 85, 52],
      [135, 92, 44],
      [45, 96, 38],
      [175, 100, 30],
    ];
    for (const [bx, by, r] of blobs) {
      const g = x.createRadialGradient(bx, by, r * 0.15, bx, by, r);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.75, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(bx - r, by - r, r * 2, r * 2);
    }
    // cool underside
    const u = x.createLinearGradient(0, 70, 0, 140);
    u.addColorStop(0, 'rgba(170,205,235,0)');
    u.addColorStop(1, 'rgba(170,205,235,0.25)');
    x.fillStyle = u;
    x.fillRect(0, 70, 240, 70);
    return c;
  }

  private buildPuffSprite(): HTMLCanvasElement {
    const [c, x] = makeCanvas(96, 64);
    const blobs: Array<[number, number, number]> = [
      [36, 38, 26],
      [60, 40, 21],
      [22, 44, 16],
    ];
    for (const [bx, by, r] of blobs) {
      const g = x.createRadialGradient(bx, by, 1, bx, by, r);
      g.addColorStop(0, 'rgba(216,188,142,0.85)');
      g.addColorStop(1, 'rgba(216,188,142,0)');
      x.fillStyle = g;
      x.fillRect(bx - r, by - r, r * 2, r * 2);
    }
    return c;
  }

  private buildShadowSprite(): HTMLCanvasElement {
    const [c, x] = makeCanvas(128, 36);
    const g = x.createRadialGradient(64, 18, 2, 64, 18, 62);
    g.addColorStop(0, 'rgba(30,50,15,0.55)');
    g.addColorStop(0.7, 'rgba(30,50,15,0.28)');
    g.addColorStop(1, 'rgba(30,50,15,0)');
    x.save();
    x.translate(64, 18);
    x.scale(1, 18 / 62);
    x.translate(-64, -18);
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 62);
    x.restore();
    return c;
  }

  private buildGlowSprite(): HTMLCanvasElement {
    const [c, x] = makeCanvas(256, 256);
    const g = x.createRadialGradient(128, 128, 4, 128, 128, 126);
    g.addColorStop(0, 'rgba(255,244,190,0.9)');
    g.addColorStop(0.4, 'rgba(255,224,140,0.35)');
    g.addColorStop(1, 'rgba(255,224,140,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
    return c;
  }

  private buildSunSprite(): HTMLCanvasElement {
    const [c, x] = makeCanvas(256, 256);
    const g = x.createRadialGradient(128, 128, 8, 128, 128, 126);
    g.addColorStop(0, 'rgba(255,236,150,0.95)');
    g.addColorStop(0.18, 'rgba(255,217,74,0.85)');
    g.addColorStop(0.45, 'rgba(255,217,74,0.22)');
    g.addColorStop(1, 'rgba(255,217,74,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
    return c;
  }

  /** Distant tree-line / stand silhouette tile (parallax 0.55 plane). */
  private buildSilhouetteTile(): HTMLCanvasElement {
    const TW = 512;
    const TH = 180;
    const [c, x] = makeCanvas(TW, TH);
    // hedge band along the base
    x.fillStyle = '#7ba96f';
    x.fillRect(0, TH - 34, TW, 34);
    x.fillStyle = 'rgba(255,255,255,0.12)';
    x.fillRect(0, TH - 34, TW, 5);
    // trees with rounded canopies; colours hold the two-tile wrap seamless
    // because placement is hashed per slot, not per edge.
    for (let i = 0; i < 9; i++) {
      const tx = i * 57 + hash(i * 11) * 22;
      const tall = 62 + hash(i * 23) * 58;
      const wide = 30 + hash(i * 37) * 22;
      const base = TH - 30;
      x.fillStyle = '#6d8f5f';
      x.fillRect(tx - 3, base - tall * 0.45, 6, tall * 0.45);
      x.fillStyle = i % 2 === 0 ? '#7fae78' : '#74a26c';
      x.beginPath();
      x.arc(tx, base - tall * 0.62, wide * 0.62, 0, Math.PI * 2);
      x.arc(tx - wide * 0.34, base - tall * 0.44, wide * 0.44, 0, Math.PI * 2);
      x.arc(tx + wide * 0.34, base - tall * 0.46, wide * 0.46, 0, Math.PI * 2);
      x.fill();
      // canopy highlight on the sun side
      x.fillStyle = 'rgba(255,244,200,0.14)';
      x.beginPath();
      x.arc(tx + wide * 0.18, base - tall * 0.72, wide * 0.3, 0, Math.PI * 2);
      x.fill();
    }
    return c;
  }

  private buildPersonSprite(shirt: string): HTMLCanvasElement {
    const [c, x] = makeCanvas(14, 22);
    // head
    x.fillStyle = '#f2d3a7';
    x.beginPath();
    x.arc(7, 5, 3.4, 0, Math.PI * 2);
    x.fill();
    // body (shirt)
    x.fillStyle = shirt;
    x.beginPath();
    x.roundRect(2.5, 9, 9, 11, 3);
    x.fill();
    return c;
  }

  /** Transparent speckle/streak tile, pattern-filled over the track. */
  private buildSpeckleTile(): HTMLCanvasElement {
    const T = 160;
    const [c, x] = makeCanvas(T, T);
    for (let i = 0; i < 110; i++) {
      const px = hash(i * 1.3) * T;
      const py = hash(i * 2.9 + 5) * T;
      const r = 0.6 + hash(i * 4.1) * 1.4;
      x.fillStyle = hash(i * 7.7) < 0.5 ? 'rgba(60,90,30,0.20)' : 'rgba(255,255,230,0.16)';
      x.beginPath();
      x.arc(px, py, r, 0, Math.PI * 2);
      x.fill();
    }
    // worn horizontal streaks
    x.strokeStyle = 'rgba(90,70,35,0.10)';
    x.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      const py = hash(i * 9.1 + 2) * T;
      const px = hash(i * 3.3 + 8) * T;
      const len = 22 + hash(i * 5.5) * 40;
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(px + len, py + (hash(i * 6.6) - 0.5) * 4);
      x.stroke();
    }
    return c;
  }

  private buildVignette(): HTMLCanvasElement {
    const w = Math.max(2, this.w);
    const h = Math.max(2, this.h);
    const [c, x] = makeCanvas(w, h);
    const r0 = Math.min(w, h) * 0.42;
    const r1 = Math.max(w, h) * 0.72;
    const g = x.createRadialGradient(w / 2, h * 0.45, r0, w / 2, h * 0.5, r1);
    g.addColorStop(0, 'rgba(24,16,40,0)');
    g.addColorStop(1, 'rgba(24,16,40,0.30)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    return c;
  }

  // ---------------------------------------------------------------- scenery

  private drawSky(camX: number, yOff: number, nowMs: number): void {
    const { ctx, w, h } = this;
    if (!this.skyGrad) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#79c2f4');
      g.addColorStop(0.62, '#c9ecff');
      g.addColorStop(1, '#fdeec9');
      this.skyGrad = g;
    }
    ctx.fillStyle = this.skyGrad;
    ctx.fillRect(0, 0, w, h);

    // sun: pre-rendered glow disc + hot core
    const sunX = w * 0.82;
    const sunY = h * 0.16 + yOff * 0.5;
    const sunR = Math.min(w, h);
    ctx.drawImage(this.sunSprite, sunX - sunR * 0.32, sunY - sunR * 0.32, sunR * 0.64, sunR * 0.64);
    ctx.fillStyle = '#ffe382';
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 0.06, 0, Math.PI * 2);
    ctx.fill();

    // drifting clouds (parallax 0.2)
    const ppm = this.ppm;
    const spanPx = w + 260;
    for (let i = 0; i < 8; i++) {
      const base = hash(i) * 40 + i * 7;
      const rel = (((base - camX * 0.2) * ppm + w * 0.3) % spanPx + spanPx) % spanPx;
      const drift = Math.sin(nowMs * 0.0001 + i) * 6 + nowMs * 0.004 * (0.4 + hash(i + 60) * 0.6);
      const px = ((rel + drift) % spanPx + spanPx) % spanPx - 130;
      const cy = h * (0.07 + hash(i + 20) * 0.22) + yOff;
      const s = ppm * (0.9 + hash(i + 40) * 0.9);
      ctx.globalAlpha = 0.75 + hash(i + 80) * 0.2;
      ctx.drawImage(this.cloudSprite, px - s * 0.5, cy - s * 0.29, s, s * 0.58);
    }
    ctx.globalAlpha = 1;
  }

  private drawHills(camX: number, yOff: number): void {
    const { ctx, w, h } = this;
    for (const [par, color, amp, freq] of HILL_LAYERS) {
      const base = camX * par;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let px = 0; px <= w; px += 16) {
        const wx = base + px / this.ppm;
        const y =
          this.groundY + yOff -
          (Math.sin(wx * 0.35 * freq) * amp + Math.sin(wx * 0.13 * freq + 2) * amp * 0.7 + amp * 1.9) *
            this.ppm *
            0.5;
        ctx.lineTo(px, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** Far tree-line / stand silhouette, tiled (parallax 0.55). */
  private drawSilhouette(camX: number, yOff: number): void {
    const { ctx, w } = this;
    const sh = clamp(this.h * 0.2, 80, 170);
    const tw = sh * (512 / 180);
    let off = -((camX * 0.55 * this.ppm) % tw);
    if (off > 0) off -= tw;
    const top = this.groundY + yOff + 8 - sh;
    for (let px = off; px < w; px += tw) {
      ctx.drawImage(this.silTile, px, top, tw, sh);
    }
  }

  /** Cheering crowd on the far plane; bounce scales with race excitement. */
  private drawCrowd(camX: number, yOff: number, nowMs: number, reducedMotion: boolean): void {
    const { ctx, w } = this;
    const energy = this.crowdEnergy;
    const off0 = -((camX * 0.55 * this.ppm) % CROWD_SPACING);
    const count = Math.ceil(w / CROWD_SPACING) + 2;
    const base1 = this.groundY + yOff - 10;
    const base2 = this.groundY + yOff - 26;
    const t = nowMs * 0.006;
    const nSprites = this.personSprites.length;
    for (let i = -1; i < count; i++) {
      // sparse clusters: skip ~35% of slots deterministically by world slot
      const slot = Math.round((camX * 0.55 * this.ppm + i * CROWD_SPACING) / CROWD_SPACING);
      if (hash(slot * 3.1) < 0.35) continue;
      const px = off0 + i * CROWD_SPACING + hash(slot * 7.7) * 8;
      const phase = hash(slot * 5.3) * Math.PI * 2;
      const speed = 1 + energy * 1.6 + hash(slot * 9.9) * 0.4;
      const amp = reducedMotion ? 0 : (0.8 + energy * 5) * (0.6 + hash(slot * 4.7) * 0.8);
      const bounce = Math.abs(Math.sin(t * speed + phase)) * amp;
      const sprite = this.personSprites[((slot % nSprites) + nSprites) % nSprites];
      ctx.drawImage(sprite, px, base1 - bounce, 14, 22);
      // back row, sparser + slightly transparent for depth
      if (hash(slot * 6.1) > 0.5) {
        const bounce2 = Math.abs(Math.sin(t * speed * 0.9 + phase + 1.3)) * amp * 0.7;
        ctx.globalAlpha = 0.75;
        ctx.drawImage(sprite, px + 12, base2 - bounce2, 12, 19);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Large soft cloud shadows sliding slowly across the track. */
  private drawCloudShadows(nowMs: number, reducedMotion: boolean): void {
    const { ctx, w, h } = this;
    const gy = this.groundY;
    const span = w + 700;
    const t = reducedMotion ? 0 : nowMs;
    for (let i = 0; i < 3; i++) {
      const speed = 0.011 + i * 0.004;
      const px = (((i * 0.37 * span + t * speed) % span) + span) % span - 350;
      const py = gy + (h - gy) * (0.18 + i * 0.3);
      const sw = w * (0.5 + i * 0.14);
      ctx.globalAlpha = 0.1;
      ctx.drawImage(this.shadowSprite, px - sw / 2, py - sw * 0.07, sw, sw * 0.14);
    }
    ctx.globalAlpha = 1;
  }

  /** Near-field pollen / dust motes drifting in the light. */
  private drawPollen(nowMs: number, reducedMotion: boolean): void {
    const { ctx, w, h } = this;
    const t = reducedMotion ? 0 : nowMs;
    ctx.fillStyle = 'rgba(255,250,220,0.5)';
    for (let i = 0; i < POLLEN_COUNT; i++) {
      const s = this.pollenSeeds[i];
      const dir = s > 0.5 ? 1 : -1;
      const px = (((s * w * 1.7 + t * 0.014 * (0.4 + s) * dir) % (w + 40)) + w + 40) % (w + 40) - 20;
      const py = h * 0.12 + s * h * 0.68 + Math.sin(t * 0.0006 + s * 40) * 26;
      const r = 1 + s * 1.6;
      ctx.globalAlpha = 0.16 + s * 0.22;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Warm grade + vignette, screen-space, two cheap fullscreen draws. */
  private drawGrade(): void {
    const { ctx, w, h } = this;
    if (!this.gradeGrad) {
      const g = ctx.createLinearGradient(0, 0, w * 0.35, h);
      g.addColorStop(0, 'rgba(255,196,110,0.13)');
      g.addColorStop(0.45, 'rgba(255,196,110,0.02)');
      g.addColorStop(1, 'rgba(18,52,74,0.10)');
      this.gradeGrad = g;
    }
    ctx.fillStyle = this.gradeGrad;
    ctx.fillRect(0, 0, w, h);
    if (this.vignette) ctx.drawImage(this.vignette, 0, 0, w, h);
  }

  private drawGround(camX: number, race: boolean, pbFlagX: number | null): void {
    const { ctx, w, h } = this;
    const gy = this.groundY;
    const ppm = this.ppm;

    // shaded turf: soft vertical gradient + scrolling speckle texture
    if (!this.groundGrad) {
      const g = ctx.createLinearGradient(0, gy, 0, h);
      g.addColorStop(0, '#8fd45e');
      g.addColorStop(0.25, '#7ec850');
      g.addColorStop(1, '#5ea53c');
      this.groundGrad = g;
    }
    ctx.fillStyle = this.groundGrad;
    ctx.fillRect(0, gy, w, h - gy);

    if (!this.groundPattern) this.groundPattern = ctx.createPattern(this.speckleTile, 'repeat');
    if (this.groundPattern) {
      ctx.save();
      ctx.translate(-(((camX * ppm) % 160) + 160) % 160, gy);
      ctx.fillStyle = this.groundPattern;
      ctx.fillRect(-160, 0, w + 320, h - gy);
      ctx.restore();
    }

    // sun-lit top edge
    ctx.fillStyle = 'rgba(255,246,200,0.28)';
    ctx.fillRect(0, gy, w, 3);
    ctx.fillStyle = '#6ab843';
    ctx.fillRect(0, gy + 3, w, ppm * 0.1);

    const x0 = camX - w * 0.3 / ppm - 1;
    const x1 = x0 + w / ppm + 2;

    // worn centre line along the running lane + lane dashes
    ctx.fillStyle = 'rgba(122,92,48,0.16)';
    ctx.fillRect(0, gy + ppm * 0.16, w, ppm * 0.05);
    ctx.fillStyle = 'rgba(255,247,230,0.4)';
    for (let dx = Math.floor(x0 / 2) * 2; dx < x1; dx += 2) {
      const px = this.sx(dx, camX);
      ctx.fillRect(px, gy + ppm * 0.165, ppm * 0.8, 3);
    }

    // grass tufts + flowers
    for (let gx = Math.floor(x0 / 0.7) * 0.7; gx < x1; gx += 0.7) {
      const r = hash(Math.round(gx * 10));
      const px = this.sx(gx + r * 0.5, camX);
      const py = gy + 6 + r * (h - gy - 14);
      if (r < 0.14) {
        ctx.fillStyle = r < 0.07 ? '#ff8fb3' : '#fff3b0';
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = '#5da53a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - 3, py - 7);
        ctx.moveTo(px + 2, py);
        ctx.lineTo(px + 4, py - 8);
        ctx.stroke();
      }
    }

    // fence every 5 m
    ctx.strokeStyle = '#b98a5a';
    ctx.fillStyle = '#b98a5a';
    const first = Math.ceil(x0 / 5) * 5;
    for (let fx = first; fx < x1; fx += 5) {
      if (race && fx >= TRACK_LENGTH) continue;
      const px = this.sx(fx, camX);
      ctx.fillRect(px - 2.5, gy - ppm * 0.34, 5, ppm * 0.34);
      // post cap highlight
      ctx.fillStyle = '#d9ad77';
      ctx.fillRect(px - 2.5, gy - ppm * 0.34, 5, 2.5);
      ctx.fillStyle = '#b98a5a';
    }
    ctx.lineWidth = 4;
    for (let fx = first; fx < x1; fx += 5) {
      const a = this.sx(fx, camX);
      const b = this.sx(Math.min(fx + 5, race ? TRACK_LENGTH : fx + 5), camX);
      if (b <= a) continue;
      ctx.beginPath();
      ctx.moveTo(a, gy - ppm * 0.14);
      ctx.lineTo(b, gy - ppm * 0.14);
      ctx.moveTo(a, gy - ppm * 0.26);
      ctx.lineTo(b, gy - ppm * 0.26);
      ctx.stroke();
    }

    // distance markers every 10 m
    for (let mx = Math.ceil(x0 / 10) * 10; mx < x1; mx += 10) {
      if (mx <= 0 || (race && mx >= TRACK_LENGTH)) continue;
      const px = this.sx(mx, camX);
      ctx.fillStyle = '#8a6f4d';
      ctx.fillRect(px - 2, gy - ppm * 0.5, 4, ppm * 0.16);
      ctx.fillStyle = '#fff7e6';
      ctx.strokeStyle = '#5a3d26';
      ctx.lineWidth = 2;
      const bw = 34;
      const bh = 18;
      const by = gy - ppm * 0.52;
      ctx.beginPath();
      ctx.roundRect(px - bw / 2, by - bh, bw, bh, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#3a2a18';
      ctx.font = '900 11px "Trebuchet MS", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(markerLabel(mx), px, by - bh / 2);
    }

    if (race) this.drawStart(camX);
    if (race && pbFlagX != null) this.drawPaceFlag(camX, pbFlagX);
    if (race) this.drawFinish(camX);
  }

  /** Start gate at x=0 (race mode). */
  private drawStart(camX: number): void {
    const { ctx } = this;
    const gy = this.groundY;
    const ppm = this.ppm;
    const px = this.sx(0, camX);
    if (px < -80 || px > this.w + 80) return;

    ctx.fillStyle = '#8a6f4d';
    ctx.fillRect(px - 4, gy - ppm * 0.95, 8, ppm * 0.95);
    ctx.fillRect(px + 56, gy - ppm * 0.95, 8, ppm * 0.95);
    const bw = 64;
    const bh = ppm * 0.2;
    const bx = px - 4;
    const by = gy - ppm * 0.95;
    ctx.fillStyle = '#58a83c';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = 'rgba(255,247,230,0.9)';
    for (let c = 0; c < bw / 16; c++) {
      ctx.fillRect(bx + c * 16 + 4, by + 3, 8, bh - 6);
    }
    ctx.strokeStyle = '#5a3d26';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(px - 2, gy, 4, ppm * 0.06);
  }

  /** PB pace-flag: beat the flag, beat the PB. */
  private drawPaceFlag(camX: number, flagX: number): void {
    const { ctx } = this;
    const gy = this.groundY;
    const ppm = this.ppm;
    const px = this.sx(flagX, camX);
    if (px < -40 || px > this.w + 40) return;

    const poleH = ppm * 0.62;
    // pole
    ctx.fillStyle = '#fff7e6';
    ctx.strokeStyle = '#5a3d26';
    ctx.lineWidth = 1.5;
    ctx.fillRect(px - 1.5, gy - poleH, 3, poleH);
    ctx.strokeRect(px - 1.5, gy - poleH, 3, poleH);
    // pennant (points back toward the runner)
    ctx.fillStyle = '#b3541e';
    ctx.beginPath();
    ctx.moveTo(px + 1.5, gy - poleH);
    ctx.lineTo(px + 1.5 - ppm * 0.28, gy - poleH + ppm * 0.07);
    ctx.lineTo(px + 1.5, gy - poleH + ppm * 0.14);
    ctx.closePath();
    ctx.fill();
    // label
    ctx.fillStyle = '#b3541e';
    ctx.font = '900 11px "Trebuchet MS", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('PB', px, gy - poleH - 3);
  }

  private drawFinish(camX: number): void {
    const { ctx } = this;
    const gy = this.groundY;
    const ppm = this.ppm;
    const px = this.sx(TRACK_LENGTH, camX);
    if (px < -80 || px > this.w + 80) return;

    // posts
    ctx.fillStyle = '#8a6f4d';
    ctx.fillRect(px - 4, gy - ppm * 1.1, 8, ppm * 1.1);
    ctx.fillRect(px + 56, gy - ppm * 1.1, 8, ppm * 1.1);
    // checkered banner
    const bw = 64;
    const bh = ppm * 0.22;
    const bx = px - 4;
    const by = gy - ppm * 1.1;
    const cell = 8;
    for (let c = 0; c < bw / cell; c++) {
      for (let r = 0; r < Math.ceil(bh / cell); r++) {
        ctx.fillStyle = (c + r) % 2 === 0 ? '#222' : '#fff';
        ctx.fillRect(bx + c * cell, by + r * cell, cell, cell);
      }
    }
    ctx.strokeStyle = '#5a3d26';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);
    // ground line
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(px - 2, gy, 4, ppm * 0.06);
  }

  // --------------------------------------------------------------- creature

  private drawPuffs(camX: number, nowMs: number): void {
    const { ctx } = this;
    const ppm = this.ppm;
    // Compact expired puffs in place (no per-frame array allocation).
    let keep = 0;
    for (let read = 0; read < this.puffs.length; read++) {
      if (nowMs - this.puffs[read].birth < 450) this.puffs[keep++] = this.puffs[read];
    }
    this.puffs.length = keep;
    for (const p of this.puffs) {
      const age = (nowMs - p.birth) / 450;
      const r = ppm * (p.big ? 0.5 : 0.3) * (0.45 + age);
      const px = this.sx(p.x, camX);
      const py = this.groundY - r * 0.2 - age * ppm * 0.15;
      ctx.globalAlpha = (1 - age) * 0.75;
      ctx.drawImage(this.puffSprite, px - r, py - r * 0.62, r * 2, r * 1.24);
    }
    ctx.globalAlpha = 1;
  }

  private drawConfetti(camX: number, nowMs: number): void {
    const { ctx } = this;
    const ppm = this.ppm;
    let keep = 0;
    for (let read = 0; read < this.confetti.length; read++) {
      if (nowMs - this.confetti[read].birth < CONFETTI_LIFE_MS) this.confetti[keep++] = this.confetti[read];
    }
    this.confetti.length = keep;

    // bloom moment: soft warm flash at the finish line, pre-rendered glow
    const bAge = nowMs - this.lastConfettiAt;
    if (bAge >= 0 && bAge < BLOOM_MS) {
      const k = bAge / BLOOM_MS;
      const px = this.sx(TRACK_LENGTH, camX);
      const py = this.sy(0.8);
      const r = ppm * (1.6 + k * 2.2);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (1 - k) * 0.55;
      ctx.drawImage(this.glowSprite, px - r, py - r, r * 2, r * 2);
      ctx.restore();
    }

    for (const c of this.confetti) {
      const ageS = (nowMs - c.birth) / 1000;
      const wx = c.x + c.vx * ageS;
      const wy = Math.max(0.02, c.y + c.vy * ageS - 4.9 * ageS * ageS);
      const fade = Math.min(1, (CONFETTI_LIFE_MS - (nowMs - c.birth)) / 400);
      ctx.save();
      ctx.translate(this.sx(wx, camX), this.sy(wy));
      ctx.rotate(c.rot + c.spin * ageS);
      ctx.globalAlpha = fade;
      ctx.fillStyle = CONFETTI_COLORS[c.color];
      ctx.fillRect(-ppm * 0.03, -ppm * 0.05, ppm * 0.06, ppm * 0.1);
      ctx.restore();
    }
  }

  private drawCreature(sim: SimState, camX: number, nowMs: number, reducedMotion: boolean): void {
    const { ctx } = this;
    const ppm = this.ppm;
    const b = sim.body;
    const bx = this.sx(b.x, camX);
    const by = this.sy(b.h);

    // soft ground shadow: compresses + fades as the body rises
    const shScale = Math.max(0.4, 1 - (b.h - 0.3) * 0.8);
    const shW = ppm * 1.15 * shScale;
    ctx.globalAlpha = 0.5 + shScale * 0.5;
    ctx.drawImage(this.shadowSprite, bx - shW / 2, this.groundY - ppm * 0.045, shW, ppm * 0.16);
    ctx.globalAlpha = 1;

    // speed lines at high velocity
    if (!reducedMotion && b.v > 3) {
      const k = clamp((b.v - 3) / (V_MAX - 3), 0, 1);
      ctx.strokeStyle = '#ffffff';
      ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const ly = by + (i - 2) * ppm * 0.15 + hash(i * 3.1) * 4;
        const len = ppm * (0.25 + k * 0.5) * (1 - i * 0.12);
        const lx0 = bx - ppm * (0.62 + i * 0.2 + hash(i * 7.7) * 0.15);
        ctx.globalAlpha = k * 0.4 * (1 - i * 0.14);
        ctx.lineWidth = 1.5 + (1 - i * 0.15);
        ctx.beginPath();
        ctx.moveTo(lx0, ly);
        ctx.lineTo(lx0 - len, ly);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // legs: far side (FR=1, BR=3) first, then near side (FL=0, BL=2)
    for (const i of LEG_ORDER) {
      this.drawLeg(sim, i, camX, i === 1 || i === 3);
    }

    // run-cycle squash & stretch from vertical velocity (stretch on the hop,
    // squash on landing); legs stay world-anchored.
    const stretch = reducedMotion ? 0 : clamp(b.hv * 0.035, -0.16, 0.2);
    const idle = 1 + Math.sin(nowMs * 0.0022) * 0.008;

    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(-b.pitch);
    ctx.scale((1 - stretch * 0.6) * idle, (1 + stretch) * idle);

    // tail
    const wag = Math.sin(nowMs * 0.012 + b.v) * 0.18;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = ppm * 0.05;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-ppm * 0.4, -ppm * 0.05);
    ctx.quadraticCurveTo(-ppm * 0.55, -ppm * (0.12 + wag * 0.3), -ppm * 0.6, -ppm * (0.22 + wag));
    ctx.stroke();
    ctx.fillStyle = MANE;
    ctx.beginPath();
    ctx.arc(-ppm * 0.6, -ppm * (0.22 + wag), ppm * 0.07, 0, Math.PI * 2);
    ctx.fill();

    // barrel body
    ctx.fillStyle = BODY;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, ppm * 0.42, ppm * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = BELLY;
    ctx.beginPath();
    ctx.ellipse(0, ppm * 0.1, ppm * 0.33, ppm * 0.19, 0, 0, Math.PI * 2);
    ctx.fill();

    // key-light: warm top-left sheen on the barrel
    ctx.fillStyle = 'rgba(255,240,200,0.22)';
    ctx.beginPath();
    ctx.ellipse(-ppm * 0.06, -ppm * 0.12, ppm * 0.3, ppm * 0.13, -0.35, 0, Math.PI * 2);
    ctx.fill();

    // mane tufts
    ctx.fillStyle = MANE;
    for (let k = 0; k < 3; k++) {
      const mx = ppm * (0.08 + k * 0.11);
      ctx.beginPath();
      ctx.moveTo(mx - ppm * 0.06, -ppm * 0.26);
      ctx.lineTo(mx, -ppm * (0.38 - k * 0.02));
      ctx.lineTo(mx + ppm * 0.06, -ppm * 0.26);
      ctx.closePath();
      ctx.fill();
    }

    // head
    const hx = ppm * 0.46;
    const hy = -ppm * 0.24;
    ctx.fillStyle = BODY;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(hx, hy, ppm * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // ears
    ctx.fillStyle = BODY_DARK;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(hx + s * ppm * 0.08 - ppm * 0.05, hy - ppm * 0.14);
      ctx.lineTo(hx + s * ppm * 0.1, hy - ppm * 0.3);
      ctx.lineTo(hx + s * ppm * 0.08 + ppm * 0.06, hy - ppm * 0.15);
      ctx.closePath();
      ctx.fill();
    }
    // snout
    ctx.fillStyle = BELLY;
    ctx.beginPath();
    ctx.ellipse(hx + ppm * 0.14, hy + ppm * 0.06, ppm * 0.11, ppm * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.arc(hx + ppm * 0.2, hy + ppm * 0.05, ppm * 0.018, 0, Math.PI * 2);
    ctx.fill();
    // big eye (blinks every ~3.2 s)
    const blinkPhase = (nowMs % 3200) / 3200;
    const blink = blinkPhase > 0.95 ? 0.15 : 1;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(hx + ppm * 0.05, hy - ppm * 0.03, ppm * 0.055, ppm * 0.055 * blink, 0, 0, Math.PI * 2);
    ctx.fill();
    if (blink > 0.5) {
      ctx.fillStyle = '#2b1c10';
      ctx.beginPath();
      ctx.arc(hx + ppm * 0.065, hy - ppm * 0.03, ppm * 0.026, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(hx + ppm * 0.055, hy - ppm * 0.042, ppm * 0.011, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // stumble stars
    if (sim.stumbleT > 0) {
      // head centre in screen space (rotate local (0.46,-0.24) by -pitch)
      const lx = 0.46;
      const ly = -0.24;
      const hxs = bx + (lx * Math.cos(-b.pitch) - ly * Math.sin(-b.pitch)) * ppm;
      const hys = by + (lx * Math.sin(-b.pitch) + ly * Math.cos(-b.pitch)) * ppm;
      for (let k = 0; k < 3; k++) {
        const a = nowMs * 0.012 + (k * Math.PI * 2) / 3;
        const sx2 = hxs + Math.cos(a) * ppm * 0.3;
        const sy2 = hys - ppm * 0.18 + Math.sin(a) * ppm * 0.1;
        this.drawStar(sx2, sy2, ppm * 0.06);
      }
    }
  }

  private drawStar(x: number, y: number, r: number): void {
    const { ctx } = this;
    ctx.fillStyle = '#ffd94a';
    ctx.strokeStyle = '#b3541e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 - Math.PI / 2;
      const rr = k % 2 === 0 ? r : r * 0.45;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private drawLeg(sim: SimState, i: number, camX: number, far: boolean): void {
    const { ctx } = this;
    const ppm = this.ppm;
    const b = sim.body;
    const leg = sim.legs[i];

    // hip in world coords (rotate local offset by pitch around COM)
    const lx = LEG_OFFSET_X[i];
    const ly = -0.12;
    const c = Math.cos(b.pitch);
    const s = Math.sin(b.pitch);
    const hipWx = b.x + lx * c - ly * s;
    const hipWy = b.h + lx * s + ly * c;

    let footWx: number;
    let footWy: number;
    let kneeWx: number;
    let kneeWy: number;

    if (leg.phase === 'planted' || leg.phase === 'recover') {
      footWx = leg.plantX;
      footWy = 0;
      // 2-bone IK, world coords (y up)
      const dx = footWx - hipWx;
      const dy = footWy - hipWy;
      const d = Math.min(THIGH + SHIN - 0.02, Math.max(0.08, Math.hypot(dx, dy)));
      const base = Math.atan2(dy, dx);
      const cosA = Math.max(-1, Math.min(1, (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d)));
      const a = Math.acos(cosA);
      // front legs knee forward (+x), back legs knee backward
      const kneeSign = LEG_SIGN[i] > 0 ? -1 : 1;
      const ka = base + kneeSign * a;
      kneeWx = hipWx + Math.cos(ka) * THIGH;
      kneeWy = hipWy + Math.sin(ka) * THIGH;
    } else {
      // FK while swinging: hip angle from straight down, positive forward
      const a = leg.phase === 'swing' ? leg.angle : Math.max(leg.angle, 0.05);
      const bend = 0.8;
      const a2 = a - bend * (LEG_SIGN[i] > 0 ? 1 : -1) * -1;
      kneeWx = hipWx + Math.sin(a) * THIGH;
      kneeWy = hipWy - Math.cos(a) * THIGH;
      footWx = kneeWx + Math.sin(a2) * SHIN;
      footWy = kneeWy - Math.cos(a2) * SHIN;
    }

    const depth = far ? ppm * 0.045 : 0;
    const hx = this.sx(hipWx, camX) + depth;
    const hy = this.sy(hipWy) - depth * 0.4;
    const kx = this.sx(kneeWx, camX) + depth;
    const ky = this.sy(kneeWy) - depth * 0.4;
    const fx = this.sx(footWx, camX) + depth;
    const fy = this.sy(footWy) - depth * 0.4;

    const col = far ? LEG_FAR : LEG_NEAR;
    ctx.lineCap = 'round';
    ctx.strokeStyle = col;
    ctx.lineWidth = ppm * 0.075;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(kx, ky);
    ctx.stroke();
    ctx.lineWidth = ppm * 0.06;
    ctx.beginPath();
    ctx.moveTo(kx, ky);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    // hoof
    ctx.fillStyle = HOOF;
    ctx.beginPath();
    ctx.ellipse(fx, fy, ppm * 0.055, ppm * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
