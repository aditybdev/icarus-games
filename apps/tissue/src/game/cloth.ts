/**
 * Tiny verlet rope used to render a pulled tissue as a soft cloth ribbon.
 * ~10 points per active tissue only; a few relaxation passes per frame.
 * Rendering code lives in renderer.ts — this is just point dynamics.
 */

export interface ClothPoint {
  x: number;
  y: number;
  px: number;
  py: number;
}

export interface RibbonOptions {
  /** Gravity in px/s^2 applied to free points. */
  gravity?: number;
  /** Velocity retention per step (0..1). */
  damping?: number;
  /** Constraint relaxation passes per step. */
  iterations?: number;
  /** Extra rest length factor (0 = taut, ~0.25 = stretched to ripping). */
  stretch?: number;
  /** Pin the last point to (bx, by). Default true. */
  pinEnd?: boolean;
  /** Fixed rest length per segment (overrides the span-derived length). */
  restLength?: number;
}

export class Ribbon {
  readonly points: ClothPoint[];

  constructor(count = 11) {
    this.points = [];
    for (let i = 0; i < count; i += 1) {
      this.points.push({ x: 0, y: 0, px: 0, py: 0 });
    }
  }

  /** Lay the points out evenly between two endpoints with zero velocity. */
  reset(ax: number, ay: number, bx: number, by: number): void {
    const n = this.points.length;
    for (let i = 0; i < n; i += 1) {
      const t = i / (n - 1);
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const p = this.points[i];
      p.x = x;
      p.y = y;
      p.px = x;
      p.py = y;
    }
  }

  /**
   * Advance the sim. The first point is always pinned to (ax, ay); the last
   * is pinned to (bx, by) when `pinEnd` is set.
   */
  step(
    dt: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    opts: RibbonOptions = {},
  ): void {
    const gravity = opts.gravity ?? 900;
    const damping = opts.damping ?? 0.985;
    const iterations = opts.iterations ?? 3;
    const stretch = opts.stretch ?? 0;
    const pinEnd = opts.pinEnd ?? true;
    const pts = this.points;
    const n = pts.length;
    const dtc = Math.min(dt, 1 / 30);

    // Verlet integration for free points.
    const lastFree = pinEnd ? n - 1 : n;
    for (let i = 1; i < lastFree; i += 1) {
      const p = pts[i];
      const vx = (p.x - p.px) * damping;
      const vy = (p.y - p.py) * damping;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy + gravity * dtc * dtc;
    }

    // Pin endpoints.
    pts[0].x = ax;
    pts[0].y = ay;
    pts[0].px = ax;
    pts[0].py = ay;
    if (pinEnd) {
      const e = pts[n - 1];
      e.x = bx;
      e.y = by;
      e.px = bx;
      e.py = by;
    }

    // Relax distance constraints.
    const rest =
      opts.restLength ?? (Math.hypot(bx - ax, by - ay) / (n - 1)) * (1 + stretch);
    for (let k = 0; k < iterations; k += 1) {
      for (let i = 0; i < n - 1; i += 1) {
        const p = pts[i];
        const q = pts[i + 1];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const diff = (dist - rest) / dist;
        const pPinned = i === 0;
        const qPinned = pinEnd && i + 1 === n - 1;
        if (pPinned && qPinned) continue;
        if (pPinned) {
          q.x -= dx * diff;
          q.y -= dy * diff;
        } else if (qPinned) {
          p.x += dx * diff;
          p.y += dy * diff;
        } else {
          const half = diff * 0.5;
          p.x += dx * half;
          p.y += dy * half;
          q.x -= dx * half;
          q.y -= dy * half;
        }
      }
      pts[0].x = ax;
      pts[0].y = ay;
      if (pinEnd) {
        const e = pts[n - 1];
        e.x = bx;
        e.y = by;
      }
    }
  }
}
