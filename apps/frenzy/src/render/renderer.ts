/**
 * Four-Leg Frenzy — canvas renderer. All drawing is procedural (no assets).
 * Purely visual: reads SimState but never mutates it.
 */
import {
  LEG_OFFSET_X,
  LEG_SIGN,
  TRACK_LENGTH,
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
}

interface Puff {
  x: number;
  birth: number;
  big: boolean;
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

/** Deterministic hash -> [0,1) for scenery placement. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private puffs: Puff[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  /** Dust puff at a hoof plant (world x). */
  addPuff(x: number, big: boolean, nowMs: number): void {
    this.puffs.push({ x, birth: nowMs, big });
    if (this.puffs.length > 40) this.puffs.splice(0, this.puffs.length - 40);
  }

  private get ppm(): number {
    return Math.min(this.w, this.h) * 0.28;
  }

  private get groundY(): number {
    return this.h > this.w ? this.h * 0.55 : this.h * 0.72;
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

    this.drawSky(camX, view.nowMs);
    ctx.save();
    ctx.translate(0, camY);
    this.drawHills(camX);
    this.drawGround(camX, sim.mode === 'race');
    this.drawCreature(sim, camX, view.nowMs);
    this.drawPuffs(camX, view.nowMs);
    ctx.restore();
  }

  // ---------------------------------------------------------------- scenery

  private drawSky(camX: number, nowMs: number): void {
    const { ctx, w, h } = this;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#7ec8ff');
    g.addColorStop(0.7, '#cfeeff');
    g.addColorStop(1, '#e8f7ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // sun
    ctx.fillStyle = '#ffd94a';
    ctx.beginPath();
    ctx.arc(w * 0.82, h * 0.16, Math.min(w, h) * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,217,74,0.35)';
    ctx.beginPath();
    ctx.arc(w * 0.82, h * 0.16, Math.min(w, h) * 0.11, 0, Math.PI * 2);
    ctx.fill();

    // clouds (parallax 0.2)
    const ppm = this.ppm;
    const span = w / ppm + 8;
    const base = camX * 0.2;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    for (let i = 0; i < 8; i++) {
      let cx = hash(i) * 40 + i * 7;
      cx = base + (((cx - base) % span) + span) % span - 4;
      const cy = h * (0.08 + hash(i + 20) * 0.2);
      const drift = Math.sin(nowMs * 0.0001 + i) * 6;
      const px = ((cx - base) * ppm + w * 0.3) % (w + 200) - 100 + drift;
      const s = ppm * (0.5 + hash(i + 40) * 0.5);
      ctx.beginPath();
      ctx.arc(px, cy, s * 0.32, 0, Math.PI * 2);
      ctx.arc(px + s * 0.3, cy + s * 0.06, s * 0.26, 0, Math.PI * 2);
      ctx.arc(px - s * 0.3, cy + s * 0.08, s * 0.24, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawHills(camX: number): void {
    const { ctx, w, h } = this;
    const layers: Array<[number, string, number, number]> = [
      [0.35, '#a5d977', 0.55, 0.9],
      [0.55, '#8ccb66', 0.35, 1.4],
    ];
    for (const [par, color, amp, freq] of layers) {
      const base = camX * par;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let px = 0; px <= w; px += 16) {
        const wx = base + px / this.ppm;
        const y =
          this.groundY -
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

  private drawGround(camX: number, race: boolean): void {
    const { ctx, w, h } = this;
    const gy = this.groundY;
    const ppm = this.ppm;

    ctx.fillStyle = '#7ec850';
    ctx.fillRect(0, gy, w, h - gy);
    ctx.fillStyle = '#6ab843';
    ctx.fillRect(0, gy, w, ppm * 0.1);

    const x0 = camX - w * 0.3 / ppm - 1;
    const x1 = x0 + w / ppm + 2;

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
      ctx.fillText(`${mx} m`, px, by - bh / 2);
    }

    if (race) this.drawFinish(camX);
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
    this.puffs = this.puffs.filter((p) => nowMs - p.birth < 450);
    for (const p of this.puffs) {
      const age = (nowMs - p.birth) / 450;
      const r = ppm * (p.big ? 0.22 : 0.13) * (0.4 + age);
      ctx.fillStyle = `rgba(214,186,140,${(1 - age) * 0.7})`;
      const px = this.sx(p.x, camX);
      const py = this.groundY - r * 0.4 - age * ppm * 0.15;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.arc(px + r * 0.8, py + 2, r * 0.7, 0, Math.PI * 2);
      ctx.arc(px - r * 0.8, py + 3, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawCreature(sim: SimState, camX: number, nowMs: number): void {
    const { ctx } = this;
    const ppm = this.ppm;
    const b = sim.body;
    const bx = this.sx(b.x, camX);
    const by = this.sy(b.h);

    // shadow
    const shScale = Math.max(0.4, 1 - (b.h - 0.3) * 0.8);
    ctx.fillStyle = 'rgba(40,70,20,0.25)';
    ctx.beginPath();
    ctx.ellipse(bx, this.groundY + ppm * 0.03, ppm * 0.5 * shScale, ppm * 0.09 * shScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // legs: far side (FR=1, BR=3) first, then near side (FL=0, BL=2)
    for (const i of [1, 3, 0, 2]) {
      this.drawLeg(sim, i, camX, i === 1 || i === 3);
    }

    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(-b.pitch);

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
