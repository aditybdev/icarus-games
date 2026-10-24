/**
 * Skim — Canvas 2D lake renderer. Side view, camera follows the stone.
 * Hot-loop rules (BENCHMARK T4): no per-frame allocations — ripples and
 * splash particles live in fixed pools, the water path is rebuilt into one
 * Path2D per frame, gradients are cached by size.
 */
import { HAND_HEIGHT, STONE_R } from '../core/constants';
import { waveY, windowFrac, type Lake, type Stone } from '../core/sim';
import type { StoneSkin } from '../core/stones';

const MAX_RIPPLES = 24;
const MAX_PARTS = 90;

interface Ripple { x: number; t0: number; life: number; big: boolean; }
interface Particle {
  x: number; y: number; vx: number; vy: number; t0: number; life: number; r: number;
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  /** Pixels per metre — ~20 m of lake across the short side. */
  private scale = 24;
  private camX = 0;
  private shake = 0;
  private shakeX = 0;
  private shakeY = 0;
  private reducedMotion = false;
  private fever = false;
  private skin: StoneSkin | null = null;
  private skyGrad: CanvasGradient | null = null;
  private waterGrad: CanvasGradient | null = null;
  private readonly ripples: Ripple[] = [];
  private readonly parts: Particle[] = [];
  private rippleHead = 0;
  private partHead = 0;
  private stoneSpin = 0;
  private lastX = 0;
  private lastY = HAND_HEIGHT;

  constructor(stage: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'scene';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'A lake at morning — your stone skims across the water');
    stage.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    for (let i = 0; i < MAX_RIPPLES; i += 1) this.ripples.push({ x: 0, t0: -9, life: 1, big: false });
    for (let i = 0; i < MAX_PARTS; i += 1) {
      this.parts.push({ x: 0, y: 0, vx: 0, vy: 0, t0: -9, life: 1, r: 1 });
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get el(): HTMLCanvasElement {
    return this.canvas;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w === 0 || h === 0) return; // hidden-webview cert trap: never divide by 0
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.w = w;
    this.h = h;
    this.scale = Math.min(w, h) / 9; // ~9 m across the short side
    const sky = this.ctx.createLinearGradient(0, 0, 0, h * 0.62);
    sky.addColorStop(0, '#a8dcf2');
    sky.addColorStop(0.7, '#cfeefb');
    sky.addColorStop(1, '#eafaf0');
    this.skyGrad = sky;
    const water = this.ctx.createLinearGradient(0, h * 0.55, 0, h);
    water.addColorStop(0, '#3a93b4');
    water.addColorStop(0.35, '#2e7d9b');
    water.addColorStop(1, '#17506a');
    this.waterGrad = water;
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
  }

  setFeverVisual(on: boolean): void {
    this.fever = on;
  }

  setSkin(skin: StoneSkin): void {
    this.skin = skin;
  }

  addShake(amount: number): void {
    if (this.reducedMotion) return;
    this.shake = Math.min(1, this.shake + amount);
  }

  /** Splash particles + ripple at a water contact (x in metres). */
  splash(x: number, lake: Lake, t: number, big: boolean): void {
    const r = this.ripples[this.rippleHead];
    this.rippleHead = (this.rippleHead + 1) % MAX_RIPPLES;
    r.x = x;
    r.t0 = t;
    r.life = big ? 1.4 : 0.9;
    r.big = big;
    if (this.reducedMotion) return;
    const count = big ? 18 : 10; // benchmark juice band: 10–20 per burst
    const surface = waveY(lake, x, t);
    for (let i = 0; i < count; i += 1) {
      const p = this.parts[this.partHead];
      this.partHead = (this.partHead + 1) % MAX_PARTS;
      const ang = (Math.PI * (0.15 + 0.7 * (i / count))) + (Math.random() - 0.5) * 0.5;
      const sp = (big ? 3.4 : 2.2) * (0.45 + Math.random() * 0.55);
      p.x = x;
      p.y = surface;
      p.vx = Math.cos(ang) * sp * (Math.random() < 0.5 ? -1 : 1) * 0.6;
      p.vy = Math.sin(ang) * sp;
      p.t0 = t;
      p.life = 0.55 + Math.random() * 0.4;
      p.r = big ? 2.2 : 1.6;
    }
  }

  /** World → screen. Water base sits at 62% of height. */
  private sx(x: number): number {
    return (x - this.camX) * this.scale + this.w * 0.32 + this.shakeX;
  }

  private sy(y: number): number {
    return this.h * 0.62 - y * this.scale + this.shakeY;
  }

  /**
   * Draw one frame. `t` is sim seconds; `aim` previews the throw arc while
   * the player drags. All sim objects are read-only here.
   */
  draw(
    lake: Lake,
    stone: Stone | null,
    t: number,
    aiming: { speed01: number; angle: number } | null,
    chain: number,
  ): void {
    const { ctx, w, h } = this;

    // Camera follows the stone with a little lead; eases back to the hand.
    const targetCam = stone ? Math.max(0, stone.x - 2) : 0;
    this.camX += (targetCam - this.camX) * 0.08;

    // Shake decay (translation + slight rotation — pure translation reads as
    // a glitch, a few tenths of a degree reads as force).
    let shakeRot = 0;
    if (this.shake > 0.001) {
      const s = this.shake * 7;
      this.shakeX = (Math.random() - 0.5) * s;
      this.shakeY = (Math.random() - 0.5) * s;
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

    // ---- sky ----
    ctx.fillStyle = this.skyGrad ?? '#bfe6f5';
    ctx.fillRect(0, 0, w, h);
    this.drawHills();

    // ---- water ----
    const base = this.sy(0);
    ctx.beginPath();
    ctx.moveTo(-4, this.sy(waveY(lake, this.camX - 1, t)));
    const stepPx = 8;
    for (let px = -4; px <= w + 4; px += stepPx) {
      const wx = this.camX + (px - this.w * 0.32) / this.scale;
      ctx.lineTo(px + this.shakeX, this.sy(waveY(lake, wx, t)));
    }
    ctx.lineTo(w + 4, h + 4);
    ctx.lineTo(-4, h + 4);
    ctx.closePath();
    ctx.fillStyle = this.waterGrad ?? '#2e7d9b';
    ctx.fill();

    // Surface glint line.
    ctx.beginPath();
    for (let px = -4; px <= w + 4; px += stepPx) {
      const wx = this.camX + (px - this.w * 0.32) / this.scale;
      const y = this.sy(waveY(lake, wx, t));
      if (px === -4) ctx.moveTo(px + this.shakeX, y);
      else ctx.lineTo(px + this.shakeX, y);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Fever tint on the water while a chain runs hot.
    if (this.fever) {
      ctx.fillStyle = 'rgba(232, 160, 32, 0.08)';
      ctx.fillRect(0, base - 6, w, h - base + 6);
    }

    this.drawBuoys(lake, t);
    this.drawRipples(t);

    // ---- aim preview ----
    if (aiming) this.drawAim(aiming);

    // ---- stone ----
    if (stone) this.drawStone(stone, t, chain);

    // ---- particles ----
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const p of this.parts) {
      const age = t - p.t0;
      if (age < 0 || age > p.life) continue;
      const k = age / p.life;
      const px = p.x + p.vx * age;
      const py = p.y + p.vy * age - 4.9 * age * age;
      ctx.globalAlpha = 1 - k;
      ctx.beginPath();
      ctx.arc(this.sx(px), this.sy(py), p.r * (1 - k * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore(); // shake rotation
  }

  private drawHills(): void {
    const { ctx, w, h } = this;
    // Two parallax hill layers; positions derive from camX, no state kept.
    const layers = [
      { par: 0.25, color: '#9fd4b8', amp: 0.5, yOff: 0.52 },
      { par: 0.45, color: '#7cc4a6', amp: 0.32, yOff: 0.56 },
    ] as const;
    for (const L of layers) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let px = 0; px <= w; px += 10) {
        const wx = this.camX * L.par + px / this.scale;
        const y = h * L.yOff - Math.abs(Math.sin(wx * 0.22 + L.par * 7)) * h * 0.12 * L.amp * 2;
        ctx.lineTo(px, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = L.color;
      ctx.fill();
    }
    // Soft sun.
    ctx.beginPath();
    ctx.arc(w * 0.78, h * 0.16, Math.min(w, h) * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 244, 200, 0.9)';
    ctx.fill();
  }

  private drawBuoys(lake: Lake, t: number): void {
    const { ctx, w } = this;
    const startM = Math.max(10, Math.floor(this.camX / 10) * 10);
    for (let m = startM; ; m += 10) {
      const px = this.sx(m);
      if (px > w + 30) break;
      const y = this.sy(waveY(lake, m, t));
      const major = m % 50 === 0;
      ctx.strokeStyle = major ? '#c2456e' : 'rgba(255,255,255,0.75)';
      ctx.lineWidth = major ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.lineTo(px, y - (major ? 26 : 12));
      ctx.stroke();
      if (major) {
        ctx.fillStyle = '#c2456e';
        ctx.font = '800 11px ui-rounded, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${m} m`, px, y - 28);
      }
    }
  }

  private drawRipples(t: number): void {
    const { ctx } = this;
    for (const r of this.ripples) {
      const age = t - r.t0;
      if (age < 0 || age > r.life) continue;
      const k = age / r.life;
      ctx.strokeStyle = `rgba(255,255,255,${(0.65 * (1 - k)).toFixed(3)})`;
      ctx.lineWidth = 2;
      const rad = (r.big ? 2.2 : 1.2) * k * this.scale;
      ctx.beginPath();
      ctx.ellipse(this.sx(r.x), this.sy(0), Math.max(1, rad), Math.max(1, rad * 0.32), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawAim(aim: { speed01: number; angle: number }): void {
    const { ctx } = this;
    const x0 = this.sx(0);
    const y0 = this.sy(HAND_HEIGHT);
    const len = 60 + aim.speed01 * 130;
    const dx = Math.cos(aim.angle) * len;
    const dy = -Math.sin(aim.angle) * len;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + dx, y0 + dy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(x0 + dx, y0 + dy, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawStone(stone: Stone, t: number, chain: number): void {
    const { ctx } = this;
    const x = this.sx(stone.x);
    const y = this.sy(stone.y);
    // Spin from horizontal travel since last frame.
    const dx = stone.x - this.lastX;
    this.stoneSpin += dx * 2.2;
    this.lastX = stone.x;
    this.lastY = stone.y;

    const r = Math.max(4, STONE_R * this.scale);
    const skin = this.skin;

    // Contact window ring — the timing affordance: shrinks as time runs out.
    if (stone.awaitingTap && !stone.dead) {
      const frac = windowFrac(stone, t);
      const ringR = r + 14 + frac * 10;
      const hue = frac > 0.5 ? '#3fae8a' : frac > 0.25 ? '#e8a020' : '#c2456e';
      ctx.strokeStyle = hue;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(x, y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, ringR + 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Body (squash a touch when skimming fast along the surface).
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.stoneSpin * 0.06);
    const squash = stone.awaitingTap ? 1 : 0.82;
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * squash, 0, 0, Math.PI * 2);
    ctx.fillStyle = skin?.body ?? '#8d9299';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-r * 0.25, -r * 0.28, r * 0.45, r * 0.3 * squash, -0.4, 0, Math.PI * 2);
    ctx.fillStyle = skin?.band ?? '#6e747b';
    ctx.globalAlpha = 0.7;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();

    // Chain glow at high perfect streaks.
    if (chain >= 5 && !stone.dead) {
      ctx.beginPath();
      ctx.arc(x, y, r + 6 + Math.sin(t * 8) * 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(232, 160, 32, 0.7)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  resetCamera(): void {
    this.camX = 0;
    this.lastX = 0;
    this.lastY = HAND_HEIGHT;
    this.stoneSpin = 0;
  }
}
