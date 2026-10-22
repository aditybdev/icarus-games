/**
 * Canvas 2D renderer for Tissue Rush (DOM side — no gameplay rules here).
 * Everything is procedural: fresh sky/mint gradient with drifting bubbles,
 * a pastel tissue box with polka dots and a slot, soft wavy tissue sheets,
 * a verlet cloth ribbon while pulling, flung tissue flyers, and confetti.
 */
import { type RoundState } from '../core/round';
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
  alpha: number;
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
  private evtExited = false;
  private evtPopped = false;

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

    const rand = mulberry32(20240521);
    for (let i = 0; i < 14; i += 1) {
      this.bubbles.push({
        x: rand(),
        y: rand(),
        r: 8 + rand() * 30,
        speed: 10 + rand() * 22,
        drift: 8 + rand() * 20,
        alpha: 0.1 + rand() * 0.16,
        seed: rand() * TAU,
      });
    }
    for (let i = 0; i < 9; i += 1) {
      this.sparkles.push({
        x: rand(),
        y: rand(),
        r: 2 + rand() * 3,
        speed: 0.6 + rand() * 1.4,
        seed: rand() * TAU,
      });
    }
    this.resize();
  }

  get domElement(): HTMLCanvasElement {
    return this.canvas;
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
    g.addColorStop(0, '#8fd4ff');
    g.addColorStop(0.55, '#c6efff');
    g.addColorStop(1, '#e3fbee');
    this.bgGradient = g;
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
  launchFlyer(x: number, y: number, vx: number, vy: number): void {
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
      if (this.popT >= 1) this.evtPopped = true;
    }

    if (this.ribbon) {
      const stretch = clamp((pullTension - 0.75) * 0.7, 0, 0.28);
      this.ribbon.step(dt, L.boxCX, L.slotY, this.grabX, this.grabY, {
        gravity: 650,
        damping: 0.97,
        iterations: 3,
        stretch,
      });
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

    const phase = round?.phase ?? 'idle';
    const boxEmpty = phase === 'finished' || phase === 'flying';

    // Sheet behind the box front so it looks tucked into the slot. While a
    // pull is held, this is the NEXT sheet rising to replace the ribbon.
    if (!boxEmpty && this.popT > 0.01) {
      this.drawIdleSheet(time);
    }
    this.drawBox(round, time);

    if (this.ribbon) {
      this.drawRibbon(this.ribbon, this.layout.sheetW * (1 - 0.38 * pullTension));
      this.drawTensionMeter(pullTension, time);
    }

    for (const f of this.flyers) this.drawFlyer(f);

    if (showHint && phase === 'idle' && round && round.pulled === 0) {
      this.drawHint(time);
    }

    this.drawConfetti();
  }

  private drawBubbles(time: number): void {
    const { ctx, w, h } = this;
    for (const b of this.bubbles) {
      const y = (((b.y * h - time * b.speed) % (h + 80)) + h + 80) % (h + 80) - 40;
      const x = b.x * w + Math.sin(time * 0.4 + b.seed) * b.drift;
      ctx.fillStyle = `rgba(255,255,255,${b.alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, b.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${b.alpha * 0.8})`;
      ctx.beginPath();
      ctx.arc(x - b.r * 0.3, y - b.r * 0.35, b.r * 0.32, 0, TAU);
      ctx.fill();
    }
    for (const s of this.sparkles) {
      const a = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(time * s.speed * 2 + s.seed));
      const x = s.x * w;
      const y = s.y * h * 0.6;
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.lineWidth = 1.6;
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

  private drawBox(round: RoundState | null, time: number): void {
    const { ctx } = this;
    const L = this.layout;
    const x = L.boxCX - L.boxW / 2;
    const y = L.boxTop;

    // Drop shadow.
    ctx.fillStyle = 'rgba(46,110,160,0.18)';
    this.roundedRectPath(x + 4, y + 10, L.boxW, L.boxH, L.boxR);
    ctx.fill();

    // Body.
    const g = ctx.createLinearGradient(0, y, 0, y + L.boxH);
    g.addColorStop(0, '#a5e3ff');
    g.addColorStop(1, '#5fb8ef');
    ctx.fillStyle = g;
    this.roundedRectPath(x, y, L.boxW, L.boxH, L.boxR);
    ctx.fill();

    // Polka-dot pattern, clipped to the body.
    ctx.save();
    this.roundedRectPath(x, y, L.boxW, L.boxH, L.boxR);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    const step = 34;
    for (let row = 0; row < L.boxH / step + 1; row += 1) {
      for (let col = 0; col < L.boxW / step + 1; col += 1) {
        const px = x + col * step + (row % 2 === 0 ? 0 : step / 2);
        const py = y + row * step + 8;
        ctx.beginPath();
        ctx.arc(px, py, 5.5, 0, TAU);
        ctx.fill();
      }
    }
    // Top rim band.
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    this.roundedRectPath(x, y, L.boxW, L.boxH * 0.3, L.boxR, true, false);
    ctx.fill();
    ctx.restore();

    // Slot.
    const slotH = 13;
    ctx.fillStyle = '#2e6b96';
    this.roundedRectPath(L.boxCX - L.slotW / 2, L.slotY - slotH / 2, L.slotW, slotH, slotH / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    this.roundedRectPath(L.boxCX - L.slotW / 2 + 3, L.slotY + slotH / 2 - 3, L.slotW - 6, 2.5, 1.2);
    ctx.fill();

    // Remaining-stack hint inside the slot (a few layered sheet edges).
    if (!round || round.remaining > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 3; i += 1) {
        const yy = L.slotY - 2 + i * 3;
        ctx.beginPath();
        ctx.moveTo(L.boxCX - L.slotW / 2 + 8, yy);
        ctx.lineTo(L.boxCX + L.slotW / 2 - 8, yy);
        ctx.stroke();
      }
    }

    // Brand label.
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `800 ${Math.round(L.boxW * 0.105)}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SOFTIES', L.boxCX, y + L.boxH * 0.62);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = `700 ${Math.round(L.boxW * 0.055)}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    ctx.fillText('cloud-soft tissues', L.boxCX, y + L.boxH * 0.78);

    // Gentle breathing of the whole scene (kept subtle).
    void time;
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
    const bottom = L.slotY + 7;

    // Soft shadow behind the sheet.
    ctx.fillStyle = 'rgba(46,110,160,0.10)';
    this.sheetPath(L.boxCX + 4, bottom + 4, L.sheetW, h, sway, time);
    ctx.fill();

    const g = ctx.createLinearGradient(0, bottom - h, 0, bottom);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#e9eef6');
    ctx.fillStyle = g;
    this.sheetPath(L.boxCX, bottom, L.sheetW, h, sway, time);
    ctx.fill();

    // Fold shading lines.
    ctx.strokeStyle = 'rgba(168,188,214,0.4)';
    ctx.lineWidth = 1.4;
    for (const f of [0.34, 0.66]) {
      ctx.beginPath();
      ctx.moveTo(L.boxCX - L.sheetW / 2 + L.sheetW * f + sway * 1.5, bottom - 2);
      ctx.quadraticCurveTo(
        L.boxCX - L.sheetW / 2 + L.sheetW * f + sway * 4,
        bottom - h * 0.55,
        L.boxCX - L.sheetW / 2 + L.sheetW * f + sway * 6,
        bottom - h + 7,
      );
      ctx.stroke();
    }
  }

  private drawRibbon(ribbon: Ribbon, baseW: number): void {
    const { ctx } = this;
    const pts = ribbon.points;
    const n = pts.length;
    if (n < 2) return;

    // Edge points via per-point normals; width tapers toward the fingers.
    const left: { x: number; y: number }[] = [];
    const right: { x: number; y: number }[] = [];
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
      left.push({ x: p.x - dy * halfW, y: p.y + dx * halfW });
      right.push({ x: p.x + dy * halfW, y: p.y - dx * halfW });
    }

    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < n; i += 1) ctx.lineTo(left[i].x, left[i].y);
    for (let i = n - 1; i >= 0; i -= 1) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
    const g = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[n - 1].x, pts[n - 1].y);
    g.addColorStop(0, '#f4f7fb');
    g.addColorStop(0.5, '#ffffff');
    g.addColorStop(1, '#e9eef6');
    ctx.fillStyle = g;
    ctx.fill();

    // Cloth folds: translucent lines running lengthwise.
    ctx.strokeStyle = 'rgba(168,188,214,0.35)';
    ctx.lineWidth = 1.4;
    for (const f of [0.33, 0.66]) {
      ctx.beginPath();
      for (let i = 0; i < n; i += 1) {
        const px = left[i].x + (right[i].x - left[i].x) * f;
        const py = left[i].y + (right[i].y - left[i].y) * f;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  private drawTensionMeter(t: number, time: number): void {
    const { ctx } = this;
    const L = this.layout;
    const mw = 13;
    const mh = L.sheetH + 46;
    const mx = L.boxCX + L.boxW / 2 + 16;
    const my = L.slotY + 14 - mh;

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    this.roundedRectPath(mx, my, mw, mh, mw / 2);
    ctx.fill();

    const fillH = mh * clamp(t, 0, 1);
    if (fillH > 2) {
      ctx.fillStyle = `hsl(${Math.round(160 - t * 150)}, 78%, 62%)`;
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
    // Trailing cloth tail first, body over it.
    this.drawRibbon(f.ribbon, f.w * 0.8);

    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rot);
    const wobble = Math.sin(f.age * 14) * 0.15;
    const g = ctx.createLinearGradient(0, -f.h, 0, f.h);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#e7edf5');
    ctx.fillStyle = g;
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
    ctx.strokeStyle = `rgba(168,188,214,${0.4 + wobble})`;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-f.w * 0.18, -f.h / 2 + 4);
    ctx.lineTo(-f.w * 0.18, f.h / 2 - 2);
    ctx.moveTo(f.w * 0.16, -f.h / 2 + 3);
    ctx.lineTo(f.w * 0.16, f.h / 2 - 2);
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
