/**
 * Procedural paper confetti for a perfect (3-star) completion. A fixed-size
 * particle pool is allocated once in the constructor and mutated in place —
 * drawing performs no allocations. All visuals are small rectangles in the
 * game's paper palette; no external assets.
 */

const MAX_PARTICLES = 34;
/** Seconds each particle lives (plus its stagger delay). */
const LIFE_S = 3.0;
/** Stagger window so the burst feels like a soft flutter, not a pop. */
const MAX_DELAY_S = 0.45;
const FADE_S = 0.6;

/** Warm paper-palette scraps (matches index.html CSS variables). */
const COLORS = ['#f8f2e6', '#c96f4a', '#7d9b76', '#e0a458', '#8a7358', '#e8c97e'];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  sway: number;
  swayPeriod: number;
  phase: number;
  delay: number;
  color: string;
}

export class Confetti {
  private readonly parts: Particle[] = [];
  private startAt = 0;
  private active = false;
  private seed = 22222;

  constructor() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.parts.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        rot: 0,
        vr: 0,
        w: 0,
        h: 0,
        sway: 0,
        swayPeriod: 1,
        phase: 0,
        delay: 0,
        color: COLORS[0],
      });
    }
  }

  /** Deterministic-enough LCG (same pattern as the paper grain). */
  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  /** Launch a burst drifting down from above the top edge (CSS px space). */
  burst(nowMs: number, width: number): void {
    // Vary the sequence per burst without Math.random (keeps it test-friendly).
    this.seed = (this.seed ^ ((nowMs | 0) * 2654435761)) & 0x7fffffff || 1;
    for (const p of this.parts) {
      p.x = this.rand() * width;
      p.y = -24 - this.rand() * 60;
      p.vx = (this.rand() - 0.5) * 36;
      p.vy = 78 + this.rand() * 78;
      p.rot = this.rand() * Math.PI * 2;
      p.vr = (this.rand() - 0.5) * 4.2;
      p.w = 5 + this.rand() * 5;
      p.h = 4 + this.rand() * 4;
      p.sway = 10 + this.rand() * 18;
      p.swayPeriod = 0.9 + this.rand() * 0.9;
      p.phase = this.rand() * Math.PI * 2;
      p.delay = this.rand() * MAX_DELAY_S;
      p.color = COLORS[(this.rand() * COLORS.length) | 0];
    }
    this.startAt = nowMs;
    this.active = true;
  }

  clear(): void {
    this.active = false;
  }

  /**
   * Draw one frame of particles; no-op (and near-zero cost) when inactive.
   * Self-deactivates once every particle has faded out.
   */
  draw(ctx: CanvasRenderingContext2D, nowMs: number): void {
    if (!this.active) return;
    const t0 = (nowMs - this.startAt) / 1000;
    if (t0 > LIFE_S + MAX_DELAY_S) {
      this.active = false;
      return;
    }
    for (const p of this.parts) {
      const t = t0 - p.delay;
      if (t <= 0 || t >= LIFE_S) continue;
      const x = p.x + p.vx * t + Math.sin((t / p.swayPeriod) * Math.PI * 2 + p.phase) * p.sway;
      const y = p.y + p.vy * t;
      const alpha = t > LIFE_S - FADE_S ? (LIFE_S - t) / FADE_S : 1;
      ctx.save();
      ctx.globalAlpha = alpha * 0.95;
      ctx.translate(x, y);
      ctx.rotate(p.rot + p.vr * t);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      // Same top-left key light as the paper: a lit hairline along the
      // scrap's top edge, a shaded one along the bottom.
      ctx.fillStyle = 'rgba(255, 252, 242, 0.28)';
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, 1);
      ctx.fillStyle = 'rgba(96, 68, 36, 0.18)';
      ctx.fillRect(-p.w / 2, p.h / 2 - 1, p.w, 1);
      ctx.restore();
    }
  }
}
