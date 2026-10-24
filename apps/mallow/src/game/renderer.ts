/**
 * Golden Mallow — Canvas 2D campfire renderer. Night scene: stars, fire pit
 * with pooled flame particles + ember glow, skewered mallow with per-face
 * doneness shading (the color ramp IS the doneness meter). Hot-loop rules
 * (BENCHMARK T4): no per-frame allocations — flames, stars and float texts
 * live in fixed pools; gradients cached by size.
 */
import { FACES } from '../core/constants';
import { gustAt, type Fire, type Mallow } from '../core/mallow';
import type { OrderSpec } from '../core/orders';
import type { Treat } from '../core/treats';

const MAX_FLAMES = 80;
const MAX_STARS = 70;
const MAX_FLOATS = 4;

interface Flame { x: number; y: number; vy: number; t0: number; life: number; r: number; hue: number; }
interface FloatText { x: number; y: number; text: string; t0: number; kind: 'score' | 'fail'; }

export interface DrawState {
  mallow: Mallow | null;
  fire: Fire;
  order: OrderSpec | null;
  /** Mallow-local sim seconds. */
  t: number;
  phase: 'card' | 'roast' | 'judge' | 'menu';
  avg: number;
  orderLabel: string;
  orderIndex: number;
  orderCount: number;
  treat: Treat;
  gustNow: number;
}

/** Doneness → color ramp: cream → gold → brown → charcoal. */
function mallowColor(h: number): string {
  if (h >= 1.05) return '#241610';
  if (h >= 0.9) return '#5a3418';
  if (h >= 0.78) return '#8a5a28';
  if (h >= 0.6) return '#c8882e';
  if (h >= 0.4) return '#e8b060';
  if (h >= 0.2) return '#f4d8a0';
  return '#fdf6e8';
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private skyGrad: CanvasGradient | null = null;
  private glowGrad: CanvasGradient | null = null;
  private shake = 0;
  private shakeX = 0;
  private shakeY = 0;
  private reducedMotion = false;
  private readonly flames: Flame[] = [];
  private readonly stars: { x: number; y: number; r: number; tw: number }[] = [];
  private readonly floats: FloatText[] = [];
  private flameCursor = 0;
  private spawnAcc = 0;
  private now = 0;

  constructor(stage: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'scene';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'A campfire at night — your marshmallow roasts over the flames');
    stage.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    for (let i = 0; i < MAX_FLAMES; i += 1) {
      this.flames.push({ x: 0, y: 0, vy: 0, t0: -9, life: 1, r: 1, hue: 40 });
    }
    for (let i = 0; i < MAX_STARS; i += 1) {
      this.stars.push({ x: (i * 0.618) % 1, y: ((i * 0.3819) % 1) * 0.55, r: 0.6 + ((i * 7) % 10) / 8, tw: (i * 1.3) % 6 });
    }
    for (let i = 0; i < MAX_FLOATS; i += 1) this.floats.push({ x: 0, y: 0, text: '', t0: -9, kind: 'score' });
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get el(): HTMLCanvasElement {
    return this.canvas;
  }

  resize(): void {
    // Cert trap: hosts can construct at 0×0 — never divide by it.
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth || 1);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight || 1);
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.w = w;
    this.h = h;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.skyGrad = null;
    this.glowGrad = null;
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
  }

  addShake(amount: number): void {
    if (this.reducedMotion) return;
    this.shake = Math.min(1, this.shake + amount);
  }

  /** fx/fy are screen fractions so callers never touch canvas pixels. */
  floatText(fx: number, fy: number, text: string, kind: 'score' | 'fail'): void {
    const f = this.floats.reduce((a, b) => (a.t0 < b.t0 ? a : b));
    f.x = fx * this.w;
    f.y = fy * this.h;
    f.text = text;
    f.t0 = this.now;
    f.kind = kind;
  }

  draw(s: DrawState): void {
    const { ctx, w, h } = this;
    this.now = s.t;

    // Shake decay (translation + slight rotation reads as force).
    let shakeRot = 0;
    if (this.shake > 0.001) {
      const m = this.shake * 7;
      this.shakeX = (Math.random() - 0.5) * m;
      this.shakeY = (Math.random() - 0.5) * m;
      shakeRot = (Math.random() - 0.5) * 0.02 * this.shake;
      this.shake *= 0.88;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
    ctx.save();
    if (shakeRot !== 0) {
      ctx.translate(w / 2, h / 2);
      ctx.rotate(shakeRot);
      ctx.translate(-w / 2, -h / 2);
    }

    // ---- night sky + stars ----
    if (!this.skyGrad) {
      this.skyGrad = ctx.createLinearGradient(0, 0, 0, h);
      this.skyGrad.addColorStop(0, '#0d1226');
      this.skyGrad.addColorStop(0.6, '#141a2e');
      this.skyGrad.addColorStop(1, '#1e2238');
    }
    ctx.fillStyle = this.skyGrad;
    ctx.fillRect(0, 0, w, h);
    for (const st of this.stars) {
      const tw = this.reducedMotion ? 0.7 : 0.5 + 0.5 * Math.sin(s.t * 1.4 + st.tw);
      ctx.globalAlpha = 0.25 + 0.55 * tw;
      ctx.fillStyle = '#f0e6d2';
      ctx.beginPath();
      ctx.arc(st.x * w, st.y * h, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ---- ground ----
    ctx.fillStyle = '#10141f';
    ctx.fillRect(0, h * 0.78, w, h * 0.22);

    // ---- fire pit: glow, logs, flames, embers ----
    const fireX = w / 2 + this.shakeX;
    const fireY = h * 0.78 + this.shakeY;
    const gust = s.gustNow;
    if (!this.glowGrad) {
      this.glowGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, w * 0.45);
      this.glowGrad.addColorStop(0, 'rgba(232, 130, 58, 0.5)');
      this.glowGrad.addColorStop(1, 'rgba(232, 130, 58, 0)');
    }
    ctx.save();
    ctx.translate(fireX, fireY);
    const glowScale = 0.7 + 0.45 * gust;
    ctx.scale(glowScale, glowScale * 0.7);
    ctx.fillStyle = this.glowGrad;
    ctx.fillRect(-w * 0.5, -w * 0.5, w, w);
    ctx.restore();

    // spawn flames (pooled; rate ∝ gust)
    if (s.phase !== 'menu') {
      this.spawnAcc += (this.reducedMotion ? 8 : 26) * gust * (1 / 60);
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        const f = this.flames[this.flameCursor];
        this.flameCursor = (this.flameCursor + 1) % MAX_FLAMES;
        f.x = (Math.random() - 0.5) * w * 0.14;
        f.y = 0;
        f.vy = 60 + Math.random() * 70;
        f.t0 = s.t;
        f.life = 0.7 + Math.random() * 0.6;
        f.r = 5 + Math.random() * 9;
        f.hue = 32 + Math.random() * 16;
      }
    }

    // logs
    ctx.strokeStyle = '#4a2e18';
    ctx.lineCap = 'round';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(fireX - w * 0.09, fireY - 4);
    ctx.lineTo(fireX + w * 0.09, fireY - 12);
    ctx.moveTo(fireX - w * 0.09, fireY - 12);
    ctx.lineTo(fireX + w * 0.09, fireY - 4);
    ctx.stroke();

    // flames
    for (const f of this.flames) {
      const age = s.t - f.t0;
      if (age < 0 || age > f.life) continue;
      const k = age / f.life;
      const fx = fireX + f.x + (this.reducedMotion ? 0 : Math.sin(age * 9 + f.x) * 4);
      const fy = fireY - 8 - f.vy * age;
      const r = f.r * (1 - k) * (0.8 + 0.4 * gust);
      if (r <= 0.5) continue;
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.fillStyle = `hsl(${f.hue + k * 18}, 95%, ${58 + k * 12}%)`;
      ctx.beginPath();
      ctx.ellipse(fx, fy, r * 0.7, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ---- skewer + mallow ----
    if (s.mallow && s.phase !== 'menu') this.drawMallow(s, fireX, fireY);

    // ---- doneness gauge (playfield-is-UI) ----
    if (s.mallow && s.order && s.phase === 'roast') this.drawGauge(s);

    // ---- serve plate with the treat garnish ----
    if (s.phase === 'judge') this.drawPlate(s);

    // ---- float texts ----
    for (const f of this.floats) {
      const age = s.t - f.t0;
      if (age < 0 || age > 1.3 || !f.text) continue;
      ctx.globalAlpha = 1 - age / 1.3;
      ctx.fillStyle = f.kind === 'fail' ? '#f0a898' : '#e8a832';
      ctx.font = `800 ${Math.round(this.h * 0.032)}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y - age * 30);
      ctx.globalAlpha = 1;
    }

    // ---- order card ----
    if (s.phase === 'card' && s.order) this.drawOrderCard(s);

    ctx.restore(); // shake rotation
  }

  /* ------------------------------- pieces ------------------------------- */

  private drawMallow(s: DrawState, fireX: number, fireY: number): void {
    const { ctx, w } = this;
    const m = s.mallow!;
    const mw = Math.min(w * 0.3, 150);
    const mh = mw * 0.52;
    const mx = fireX;
    const my = fireY - this.h * (0.16 + 0.05 * Math.max(0, 1.2 - s.gustNow)); // gusts lick higher

    // skewer stick through the mallow
    ctx.strokeStyle = '#a8743a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(mx - w * 0.34, my + mh * 0.15);
    ctx.lineTo(mx + w * 0.34, my - mh * 0.15);
    ctx.stroke();

    // mallow body: per-face vertical strips, rotated by wrapping face order
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(mx - mw / 2, my - mh / 2, mw, mh, mh * 0.35);
    ctx.clip();
    const stripW = mw / FACES;
    // angle → which face faces the viewer center; strips shift with rotation
    const shift = ((m.angle / (2 * Math.PI)) * FACES) % FACES;
    for (let i = -1; i <= FACES; i += 1) {
      const faceIdx = ((i - Math.round(shift)) % FACES + FACES) % FACES;
      ctx.fillStyle = mallowColor(m.faces[faceIdx]);
      ctx.fillRect(mx - mw / 2 + i * stripW - (shift - Math.round(shift)) * stripW, my - mh / 2, stripW + 1, mh);
    }
    // rounded end shading
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(mx - mw / 2, my - mh / 2, stripW * 0.5, mh);
    ctx.fillRect(mx + mw / 2 - stripW * 0.5, my - mh / 2, stripW * 0.5, mh);
    ctx.restore();

    // flaming face: bright flame licks on top
    if (m.flamingFace >= 0) {
      const a = m.angle + (m.flamingFace * 2 * Math.PI) / FACES;
      const fx = mx + Math.sin(a) * mw * 0.28;
      const fy = my - Math.cos(a) * mh * 0.32;
      ctx.fillStyle = 'rgba(240, 120, 40, 0.9)';
      const fr = 10 + (this.reducedMotion ? 0 : Math.sin(this.now * 22) * 3);
      ctx.beginPath();
      ctx.ellipse(fx, fy - 8, fr * 0.6, fr, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 210, 90, 0.9)';
      ctx.beginPath();
      ctx.ellipse(fx, fy - 6, fr * 0.3, fr * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // charcoal faces: smoke wisps
    if (m.charcoal.some(Boolean) && !this.reducedMotion) {
      ctx.strokeStyle = 'rgba(160,160,160,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 6; i += 1) {
        const yy = my - mh / 2 - i * 7;
        const xx = mx + Math.sin(this.now * 2 + i) * 6;
        if (i === 0) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
  }

  private drawGauge(s: DrawState): void {
    const { ctx, w, h } = this;
    const o = s.order!;
    const gx = w * 0.5 - w * 0.3;
    const gy = h * 0.13;
    const gw = w * 0.6;
    const gh = 12;
    // track
    ctx.fillStyle = 'rgba(240, 230, 210, 0.15)';
    ctx.beginPath();
    ctx.roundRect(gx, gy, gw, gh, gh / 2);
    ctx.fill();
    // order window
    ctx.fillStyle = 'rgba(232, 168, 50, 0.45)';
    ctx.fillRect(gx + gw * (o.lo / 1.2), gy, gw * ((o.hi - o.lo) / 1.2), gh);
    // ignition line
    ctx.fillStyle = 'rgba(220, 70, 40, 0.8)';
    ctx.fillRect(gx + gw * (1.0 / 1.2), gy - 2, 2, gh + 4);
    // avg marker
    const ax = gx + gw * (Math.min(1.2, s.avg) / 1.2);
    ctx.fillStyle = '#fdf6e8';
    ctx.beginPath();
    ctx.moveTo(ax, gy - 4);
    ctx.lineTo(ax - 5, gy - 11);
    ctx.lineTo(ax + 5, gy - 11);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(ax - 1.5, gy, 3, gh);
  }

  private drawPlate(s: DrawState): void {
    const { ctx, w, h } = this;
    const px = w / 2;
    const py = h * 0.62;
    ctx.fillStyle = '#e8e4da';
    ctx.beginPath();
    ctx.ellipse(px, py, w * 0.22, h * 0.02, 0, 0, Math.PI * 2);
    ctx.fill();
    // the treat: cracker / filling / chocolate stack
    const t = s.treat;
    const tw = w * 0.16;
    ctx.fillStyle = t.cracker;
    ctx.fillRect(px - tw / 2, py - 6, tw, 5);
    ctx.fillStyle = t.chocolate;
    ctx.fillRect(px - tw / 2 + 3, py - 11, tw - 6, 5);
    ctx.fillStyle = t.filling;
    ctx.fillRect(px - tw / 2 + 1, py - 17, tw - 2, 6);
  }

  private drawOrderCard(s: DrawState): void {
    const { ctx, w, h } = this;
    ctx.fillStyle = 'rgba(35, 43, 71, 0.94)';
    ctx.strokeStyle = '#3a4468';
    ctx.lineWidth = 3;
    const cw = Math.min(w * 0.8, 320);
    const ch = h * 0.16;
    const cx = (w - cw) / 2;
    const cy = h * 0.3;
    ctx.beginPath();
    ctx.roundRect(cx, cy, cw, ch, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f0e6d2';
    ctx.textAlign = 'center';
    ctx.font = `800 ${Math.round(ch * 0.3)}px ui-rounded, system-ui, sans-serif`;
    ctx.fillText(`Mallow ${s.orderIndex + 1}/${s.orderCount}`, w / 2, cy + ch * 0.38);
    ctx.font = `700 ${Math.round(ch * 0.24)}px ui-rounded, system-ui, sans-serif`;
    ctx.fillStyle = '#e8a832';
    ctx.fillText(s.orderLabel, w / 2, cy + ch * 0.72);
  }
}
