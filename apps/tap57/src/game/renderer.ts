/**
 * Tap the 57 — Canvas 2D diner renderer. Side view: bottle at the left,
 * plate zone on the counter to the right. Hot-loop rules (BENCHMARK T4):
 * no per-frame allocations — splat particles/stains/float texts live in
 * fixed pools, gradients are cached by size, the arc preview reuses one
 * array. The landing marker (build phase) is closed-form, not stepped.
 */
import { GRAVITY, NOZZLE_H, P_FULL } from '../core/constants';
import { rhythmPeriod, ringPhase, type Bottle } from '../core/bottle';
import { previewArc, speedFor } from '../core/flight';
import { targetCxAt, type OrderSpec } from '../core/orders';
import type { BottleSkin } from '../core/bottles';

const MAX_PARTS = 60;
const MAX_STAINS = 6;
const MAX_FLOATS = 4;

interface Particle { x: number; y: number; vx: number; vy: number; t0: number; life: number; r: number; }
interface Stain { x: number; t0: number; seed: number; }
interface FloatText { x: number; text: string; t0: number; kind: 'score' | 'splat'; }

export interface DrawState {
  order: OrderSpec | null;
  bottle: Bottle | null;
  blob: { x: number; y: number; r: number } | null;
  /** Order-local sim seconds (drives ring, movers, decay visuals). */
  t: number;
  phase: 'card' | 'build' | 'aim' | 'flight' | 'judge' | 'menu';
  aimAngle: number;
  streak: number;
  fever: boolean;
  orderLabel: string;
  orderIndex: number;
  orderCount: number;
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private scale = 24;
  private wallGrad: CanvasGradient | null = null;
  private counterGrad: CanvasGradient | null = null;
  private shake = 0;
  private shakeX = 0;
  private shakeY = 0;
  private reducedMotion = false;
  private fever = false;
  private skin: BottleSkin = { name: 'Classic Ketchup', glass: '#e8b48c', blob: '#d9381e', label: '#f4f0e6', cap: '#d9381e' };
  /** Bottle squash timer after a tap (seconds remaining of the 0.42s ease). */
  private squashT = 0;
  private foodBounceT = 0;
  private readonly parts: Particle[] = [];
  private readonly stains: Stain[] = [];
  private readonly floats: FloatText[] = [];
  private partCursor = 0;
  private stainCursor = 0;

  constructor(stage: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'scene';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'A diner counter — your ketchup bottle waits for the taps');
    stage.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    for (let i = 0; i < MAX_PARTS; i += 1) {
      this.parts.push({ x: 0, y: 0, vx: 0, vy: 0, t0: -9, life: 1, r: 1 });
    }
    for (let i = 0; i < MAX_STAINS; i += 1) this.stains.push({ x: 0, t0: -99, seed: i });
    for (let i = 0; i < MAX_FLOATS; i += 1) this.floats.push({ x: 0, text: '', t0: -9, kind: 'score' });
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
    this.scale = Math.min(w / 5.2, h / 3.0);
    this.wallGrad = null;
    this.counterGrad = null;
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
  }

  setSkin(skin: BottleSkin): void {
    this.skin = skin;
  }

  setFeverVisual(on: boolean): void {
    this.fever = on;
  }

  addShake(amount: number): void {
    if (this.reducedMotion) return;
    this.shake = Math.min(1, this.shake + amount);
  }

  tapSquash(): void {
    this.squashT = 0.42;
  }

  servedBounce(): void {
    this.foodBounceT = 0.5;
  }

  floatText(x: number, text: string, kind: 'score' | 'splat'): void {
    const f = this.floats.reduce((a, b) => (a.t0 < b.t0 ? a : b));
    f.x = x;
    f.text = text;
    f.t0 = this.now;
    f.kind = kind;
  }

  splatAt(x: number): void {
    for (let i = 0; i < 18; i += 1) {
      const p = this.parts[this.partCursor];
      this.partCursor = (this.partCursor + 1) % MAX_PARTS;
      const ang = Math.PI * (0.15 + 0.7 * (i / 18)) + (Math.random() - 0.5) * 0.5;
      const v = 1.6 + Math.random() * 2.4;
      p.x = x;
      p.y = 0.12;
      p.vx = Math.cos(ang) * v * 0.6;
      p.vy = Math.sin(ang) * v;
      p.t0 = this.now;
      p.life = 0.55 + Math.random() * 0.4;
      p.r = 0.03 + Math.random() * 0.05;
    }
    const st = this.stains[this.stainCursor];
    this.stainCursor = (this.stainCursor + 1) % MAX_STAINS;
    st.x = x;
    st.t0 = this.now;
  }

  /** Sim-clock mirror for pools (set every draw). */
  private now = 0;

  /** World → screen. Counter top sits at 80% of height. */
  private sx(x: number): number {
    return this.w * 0.07 + x * this.scale + this.shakeX;
  }

  private sy(y: number): number {
    return this.h * 0.8 - y * this.scale + this.shakeY;
  }

  /** Closed-form landing x for a pressure at 45° (the build-phase marker). */
  private landX45(pressure: number): number {
    const v = speedFor(pressure);
    const s = v * Math.SQRT1_2;
    return (s * (s + Math.sqrt(s * s + 2 * GRAVITY * NOZZLE_H))) / GRAVITY;
  }

  draw(s: DrawState): void {
    const { ctx, w, h } = this;
    this.now = s.t;
    this.fever = s.fever;

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
    if (this.squashT > 0) this.squashT = Math.max(0, this.squashT - 1 / 60);
    if (this.foodBounceT > 0) this.foodBounceT = Math.max(0, this.foodBounceT - 1 / 60);

    ctx.save();
    if (shakeRot !== 0) {
      ctx.translate(w / 2, h / 2);
      ctx.rotate(shakeRot);
      ctx.translate(-w / 2, -h / 2);
    }

    // ---- backdrop: diner wall + counter ----
    if (!this.wallGrad) {
      this.wallGrad = ctx.createLinearGradient(0, 0, 0, h);
      this.wallGrad.addColorStop(0, '#f9edd8');
      this.wallGrad.addColorStop(0.75, '#f3e0bd');
      this.wallGrad.addColorStop(1, '#eed3a8');
    }
    ctx.fillStyle = this.wallGrad;
    ctx.fillRect(0, 0, w, h);
    // window glow + checkered trim, static diner dressing
    ctx.fillStyle = 'rgba(255, 252, 240, 0.7)';
    ctx.beginPath();
    ctx.roundRect(w * 0.55, h * 0.08, w * 0.34, h * 0.2, 14);
    ctx.fill();
    ctx.fillStyle = 'rgba(217, 56, 30, 0.16)';
    const tile = this.scale * 0.5;
    for (let x = 0; x < w; x += tile) {
      ctx.fillRect(x, this.sy(0) - tile * 0.5, tile / 2, tile / 2);
    }
    // counter
    if (!this.counterGrad) {
      this.counterGrad = ctx.createLinearGradient(0, this.sy(0), 0, h);
      this.counterGrad.addColorStop(0, '#e8d3ae');
      this.counterGrad.addColorStop(1, '#d9be92');
    }
    ctx.fillStyle = this.counterGrad;
    ctx.fillRect(0, this.sy(0), w, h - this.sy(0));

    // ---- stains (fade over ~6s) ----
    for (const st of this.stains) {
      const age = s.t - st.t0;
      if (age < 0 || age > 6) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(0.85, 0.85 * (1 - age / 6) + 0.1);
      ctx.fillStyle = this.skin.blob;
      const bx = this.sx(st.x);
      const by = this.sy(0) + 3;
      for (let i = 0; i < 5; i += 1) {
        const a = (i / 5) * Math.PI * 2 + st.seed;
        const rr = this.scale * (0.10 + 0.05 * Math.sin(st.seed * 3 + i));
        ctx.beginPath();
        ctx.ellipse(bx + Math.cos(a) * rr * 0.5, by + Math.sin(a) * rr * 0.18, rr, rr * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // ---- target zone + food ----
    if (s.order && s.phase !== 'menu') this.drawTarget(s);

    // ---- landing marker (build) / arc preview (aim) ----
    if (s.bottle && !s.bottle.splatted && (s.phase === 'build' || s.phase === 'aim')) {
      if (s.phase === 'build') {
        const lx = this.landX45(s.bottle.pressure);
        this.drawLandMarker(lx, s.t);
      } else {
        const pts = previewArc(s.bottle.pressure, s.aimAngle, 9);
        ctx.fillStyle = 'rgba(74, 44, 26, 0.55)';
        for (const pt of pts) {
          ctx.beginPath();
          ctx.arc(this.sx(pt.x), this.sy(pt.y), 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // ---- blob in flight ----
    if (s.blob) this.drawBlob(s.blob, s.t);

    // ---- bottle ----
    if (s.bottle && s.phase !== 'menu') this.drawBottle(s);

    // ---- particles ----
    ctx.fillStyle = this.skin.blob;
    for (const p of this.parts) {
      const age = s.t - p.t0;
      if (age < 0 || age > p.life) continue;
      const k = age / p.life;
      const px = p.x + p.vx * age;
      const py = Math.max(0, p.y + p.vy * age - 4.9 * age * age);
      ctx.globalAlpha = 1 - k * 0.7;
      ctx.beginPath();
      ctx.arc(this.sx(px), this.sy(py), Math.max(1.5, p.r * this.scale * (1 - k * 0.4)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ---- float texts ----
    for (const f of this.floats) {
      const age = s.t - f.t0;
      if (age < 0 || age > 1.2 || !f.text) continue;
      ctx.globalAlpha = 1 - age / 1.2;
      ctx.fillStyle = f.kind === 'splat' ? '#a82310' : '#5b8c5a';
      ctx.font = `800 ${Math.round(this.scale * 0.42)}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(f.text, this.sx(f.x), this.sy(0.65 + age * 0.5));
      ctx.globalAlpha = 1;
    }

    // ---- order card (canvas, brief) ----
    if (s.phase === 'card' && s.order) this.drawOrderCard(s);

    ctx.restore(); // shake rotation
  }

  /* ------------------------------- pieces ------------------------------- */

  private drawTarget(s: DrawState): void {
    const { ctx } = this;
    const o = s.order!;
    const cx = targetCxAt(o, s.t);
    const zx = this.sx(cx - o.w / 2);
    const zw = o.w * this.scale;

    // mover rail
    if (o.moveAmp > 0) {
      ctx.strokeStyle = 'rgba(74, 44, 26, 0.25)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.moveTo(this.sx(cx - o.moveAmp - o.w / 2), this.sy(0) + 4);
      ctx.lineTo(this.sx(cx + o.moveAmp + o.w / 2), this.sy(0) + 4);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // zone highlight + plate
    ctx.fillStyle = 'rgba(91, 140, 90, 0.22)';
    ctx.fillRect(zx, this.sy(0) - 6, zw, 10);
    ctx.fillStyle = '#fdfdfa';
    ctx.strokeStyle = 'rgba(74, 44, 26, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(this.sx(cx), this.sy(0) + 6, zw * 0.62, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // food (bounces on a served hit)
    const bounce = this.foodBounceT > 0 ? Math.sin((0.5 - this.foodBounceT) * Math.PI * 4) * this.foodBounceT * 0.35 : 0;
    const fy = this.sy(0.02 + Math.max(0, bounce));
    const fx = this.sx(cx);
    if (o.kind === 'fries') this.drawFries(fx, fy, zw);
    else if (o.kind === 'burger') this.drawBurger(fx, fy, zw);
    else this.drawHotdog(fx, fy, zw);
  }

  private drawFries(fx: number, fy: number, zw: number): void {
    const { ctx } = this;
    const u = this.scale;
    ctx.fillStyle = '#f2c018';
    for (let i = -2; i <= 2; i += 1) {
      ctx.save();
      ctx.translate(fx + i * u * 0.07, fy);
      ctx.rotate(i * 0.09);
      ctx.fillRect(-u * 0.025, -u * 0.34, u * 0.05, u * 0.34);
      ctx.restore();
    }
    ctx.fillStyle = '#d9381e';
    ctx.beginPath();
    ctx.moveTo(fx - zw * 0.3, fy);
    ctx.lineTo(fx + zw * 0.3, fy);
    ctx.lineTo(fx + zw * 0.22, fy - u * 0.26);
    ctx.lineTo(fx - zw * 0.22, fy - u * 0.26);
    ctx.closePath();
    ctx.fill();
  }

  private drawBurger(fx: number, fy: number, zw: number): void {
    const { ctx } = this;
    const u = this.scale;
    const bw = Math.min(zw * 0.7, u * 0.42);
    ctx.fillStyle = '#e8a020'; // bottom bun
    ctx.beginPath();
    ctx.ellipse(fx, fy - u * 0.04, bw * 0.5, u * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5b8c5a'; // lettuce
    ctx.fillRect(fx - bw * 0.5, fy - u * 0.1, bw, u * 0.035);
    ctx.fillStyle = '#7a4a22'; // patty
    ctx.beginPath();
    ctx.ellipse(fx, fy - u * 0.15, bw * 0.48, u * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f0b23a'; // top bun
    ctx.beginPath();
    ctx.ellipse(fx, fy - u * 0.2, bw * 0.5, u * 0.1, 0, Math.PI, Math.PI * 2);
    ctx.fill();
  }

  private drawHotdog(fx: number, fy: number, zw: number): void {
    const { ctx } = this;
    const u = this.scale;
    const hw = Math.min(zw * 0.9, u * 0.66);
    ctx.fillStyle = '#e8b46a'; // bun
    ctx.beginPath();
    ctx.ellipse(fx, fy - u * 0.05, hw * 0.5, u * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b3492f'; // sausage
    ctx.beginPath();
    ctx.ellipse(fx, fy - u * 0.1, hw * 0.46, u * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f2c018'; // mustard zigzag
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 8; i += 1) {
      const x = fx - hw * 0.4 + (hw * 0.8 * i) / 8;
      const y = fy - u * 0.1 + (i % 2 === 0 ? -1 : 1) * u * 0.02;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  private drawLandMarker(lx: number, t: number): void {
    const { ctx } = this;
    const pulse = this.reducedMotion ? 1 : 1 + 0.15 * Math.sin(t * 6);
    ctx.strokeStyle = 'rgba(74, 44, 26, 0.8)';
    ctx.lineWidth = 3;
    const r = 7 * pulse;
    const x = this.sx(lx);
    const y = this.sy(0) - 2;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.stroke();
  }

  private drawBlob(blob: { x: number; y: number; r: number }, t: number): void {
    const { ctx } = this;
    const x = this.sx(blob.x);
    const y = this.sy(blob.y);
    const r = blob.r * this.scale;
    const wob = this.reducedMotion ? 0 : Math.sin(t * 18) * 0.12;
    ctx.fillStyle = this.skin.blob;
    ctx.beginPath();
    ctx.ellipse(x, y, r * (1 + wob), r * (1 - wob), 0, 0, Math.PI * 2);
    ctx.fill();
    // satellite droplets
    ctx.beginPath();
    ctx.ellipse(x - r * 0.9, y - r * 0.4, r * 0.35, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawBottle(s: DrawState): void {
    const { ctx } = this;
    const b = s.bottle!;
    const u = this.scale;
    // bottle pivot at the nozzle world (0, 1.0)
    const nx = this.sx(0);
    const ny = this.sy(NOZZLE_H);

    // high-pressure tremble
    let jx = 0;
    let jy = 0;
    if (!this.reducedMotion && b.pressure > 0.75 && !b.splatted) {
      const m = (b.pressure - 0.75) * u * 0.05;
      jx = (Math.random() - 0.5) * m;
      jy = (Math.random() - 0.5) * m;
    }

    // squash: 0.42s ease after each tap
    const k = this.squashT > 0 ? this.squashT / 0.42 : 0;
    const ease = 1 - Math.pow(1 - k, 3);
    const sqX = 1 + 0.12 * ease;
    const sqY = 1 - 0.1 * ease;

    ctx.save();
    ctx.translate(nx + jx, ny + jy);
    ctx.rotate(-Math.PI * 0.72); // nozzle down-forward toward the plate
    ctx.scale(sqX, sqY);

    // neck + cap
    ctx.fillStyle = this.skin.cap;
    ctx.fillRect(-u * 0.05, -u * 0.06, u * 0.22, u * 0.12);
    ctx.fillStyle = this.skin.glass;
    ctx.strokeStyle = 'rgba(74, 44, 26, 0.5)';
    ctx.lineWidth = 2;
    // body
    ctx.beginPath();
    ctx.roundRect(u * 0.1, -u * 0.22, u * 0.85, u * 0.44, u * 0.1);
    ctx.fill();
    ctx.stroke();
    // shoulder
    ctx.beginPath();
    ctx.moveTo(u * 0.1, -u * 0.22);
    ctx.lineTo(-u * 0.05, -u * 0.06);
    ctx.lineTo(-u * 0.05, u * 0.06);
    ctx.lineTo(u * 0.1, u * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // ketchup fill level inside glass
    ctx.fillStyle = this.skin.blob;
    ctx.globalAlpha = 0.85;
    const fillH = 0.1 + 0.74 * Math.max(0.05, b.pressure / P_FULL) * 0.9;
    ctx.beginPath();
    ctx.roundRect(u * 0.16, -u * 0.17, u * 0.72 * fillH + u * 0.1, u * 0.34, u * 0.06);
    ctx.fill();
    ctx.globalAlpha = 1;
    // label with the 57
    ctx.fillStyle = this.skin.label;
    ctx.beginPath();
    ctx.roundRect(u * 0.38, -u * 0.14, u * 0.34, u * 0.28, 6);
    ctx.fill();
    ctx.fillStyle = '#a82310';
    ctx.font = `800 ${Math.round(u * 0.2)}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('57', u * 0.55, 0);

    // pulse ring on the sweet spot (the 57) — closes mid-period
    if (!b.splatted && (s.phase === 'build' || s.phase === 'card')) {
      const period = rhythmPeriod(b.pressure);
      const phase = ringPhase(s.t, period);
      const close = 1 - Math.abs(phase - 0.5) * 2; // 1 at the beat
      const rr = u * (0.34 - 0.16 * close);
      const onBeat = close >= 0.8;
      ctx.strokeStyle = this.fever || onBeat ? '#e8a020' : 'rgba(217, 56, 30, 0.75)';
      ctx.lineWidth = onBeat ? 4 : 2.5;
      ctx.beginPath();
      ctx.arc(u * 0.55, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // ---- pressure gauge (playfield-is-UI, beside the bottle) ----
    const gx = nx - u * 0.5;
    const gy = ny - u * 1.15;
    const gh = u * 1.0;
    const gw = u * 0.14;
    ctx.fillStyle = 'rgba(255, 250, 240, 0.85)';
    ctx.strokeStyle = 'rgba(74, 44, 26, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(gx, gy, gw, gh, gw / 2);
    ctx.fill();
    ctx.stroke();
    // band zone
    if (s.order) {
      const b0 = gy + gh * (1 - s.order.band[1]);
      const b1 = gy + gh * (1 - s.order.band[0]);
      ctx.fillStyle = 'rgba(91, 140, 90, 0.4)';
      ctx.fillRect(gx + 1, b0, gw - 2, Math.max(2, b1 - b0));
    }
    // fill
    const fh = gh * Math.min(1, b.pressure);
    ctx.fillStyle = b.pressure >= 0.9 ? '#a82310' : this.skin.blob;
    ctx.fillRect(gx + 2, gy + gh - fh + 1, gw - 4, Math.max(0, fh - 2));
    // splat line at 0.9
    ctx.strokeStyle = '#a82310';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(gx - 2, gy + gh * 0.1);
    ctx.lineTo(gx + gw + 2, gy + gh * 0.1);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawOrderCard(s: DrawState): void {
    const { ctx, w, h } = this;
    ctx.fillStyle = 'rgba(255, 250, 240, 0.92)';
    ctx.strokeStyle = 'rgba(74, 44, 26, 0.6)';
    ctx.lineWidth = 3;
    const cw = Math.min(w * 0.8, 320);
    const ch = h * 0.16;
    const cx = (w - cw) / 2;
    const cy = h * 0.3;
    ctx.beginPath();
    ctx.roundRect(cx, cy, cw, ch, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#4a2c1a';
    ctx.textAlign = 'center';
    ctx.font = `800 ${Math.round(ch * 0.3)}px ui-rounded, system-ui, sans-serif`;
    ctx.fillText(`Order ${s.orderIndex + 1}/${s.orderCount}`, w / 2, cy + ch * 0.38);
    ctx.font = `700 ${Math.round(ch * 0.24)}px ui-rounded, system-ui, sans-serif`;
    ctx.fillStyle = '#a82310';
    ctx.fillText(s.orderLabel, w / 2, cy + ch * 0.72);
  }
}
