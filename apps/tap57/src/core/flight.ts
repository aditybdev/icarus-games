/**
 * The squirt: one viscous blob on a parametric arc — blobby by design, never
 * a fluid sim. Pressure is the distance throttle: speed scales from a sad
 * dribble at zero pressure to full at P_FULL, so every tap is range — and
 * range past the target is the overshoot near-miss that mirrors the splat.
 * Deterministic fixed-step integration with sub-step landing interpolation.
 */
import { AIM_MAX, AIM_MIN, BLOB_R, DRIBBLE_MIN, DT, GRAVITY, NOZZLE_H, P_FULL, V_BASE } from './constants';

export interface Blob {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  landed: boolean;
  landX: number;
}

/** Launch speed (m/s): linear in pressure up to P_FULL, then capped. */
export function speedFor(pressure: number): number {
  const k = Math.max(0, Math.min(1, pressure / P_FULL));
  return V_BASE * (DRIBBLE_MIN + (1 - DRIBBLE_MIN) * k);
}

/** Inverse: pressure whose 45° range equals R, launched from NOZZLE_H.
 *  Closed form of R = s(s + √(s²+2gh))/g with s = v·sin45°. */
export function pressureForRange(range: number): number {
  const s2 = (range * range * GRAVITY) / (2 * (range + NOZZLE_H));
  const v = Math.sqrt(s2) * Math.SQRT2;
  const f = v / V_BASE;
  const k = (f - DRIBBLE_MIN) / (1 - DRIBBLE_MIN);
  return Math.max(0.05, k * P_FULL);
}

/** Overshoot label for UI/audio: under-band dribble, in-band true, past hot. */
export type Power = 'dribble' | 'true' | 'over';

export function powerFor(pressure: number, band: readonly [number, number]): Power {
  if (pressure < band[0]) return 'dribble';
  if (pressure > band[1]) return 'over';
  return 'true';
}

/** Clamp a drag-derived angle into the aim envelope. */
export function clampAim(angle: number): number {
  return Math.max(AIM_MIN, Math.min(AIM_MAX, angle));
}

export function launch(pressure: number, angle: number): Blob {
  const v = speedFor(pressure);
  const a = clampAim(angle);
  return {
    x: 0,
    y: NOZZLE_H,
    vx: v * Math.cos(a),
    vy: v * Math.sin(a),
    r: BLOB_R,
    landed: false,
    landX: 0,
  };
}

/** One fixed step. On the landing step the x is interpolated to the exact
 *  plate-contact point, so the answer does not depend on step alignment. */
export function step(b: Blob): void {
  if (b.landed) return;
  const px = b.x;
  const py = b.y;
  b.vy -= GRAVITY * DT;
  b.x += b.vx * DT;
  b.y += b.vy * DT;
  if (b.y <= 0 && b.vy < 0) {
    const frac = py <= 0 ? 1 : py / (py - b.y);
    b.landX = px + (b.x - px) * frac;
    b.y = 0;
    b.landed = true;
  }
}

/** Preview points for the aim arc (N dots along the un-fired path). */
export function previewArc(pressure: number, angle: number, n = 9): { x: number; y: number }[] {
  const b = launch(pressure, angle);
  const pts: { x: number; y: number }[] = [];
  const stride = 3;
  for (let i = 0; i < n * stride && !b.landed; i += 1) {
    step(b);
    if (i % stride === stride - 1) pts.push({ x: b.x, y: b.y });
  }
  return pts;
}
