/**
 * Pointer input for the play surface. Tracks a short sample history so the
 * release velocity can fling the detached tissue. Uses Pointer Events with
 * pointer capture; `touch-action: none` on the canvas prevents scrolling.
 */

export interface InputCallbacks {
  onDown(x: number, y: number): void;
  onMove(x: number, y: number): void;
  /** Release velocity in px/s (already clamped). */
  onUp(x: number, y: number, vx: number, vy: number): void;
  onCancel(): void;
}

interface Sample {
  t: number;
  x: number;
  y: number;
}

const MAX_SPEED = 3200; // px/s clamp for fling velocity
const WINDOW_MS = 110; // velocity sampling window

export function bindPointer(el: HTMLElement, cb: InputCallbacks): void {
  let activeId: number | null = null;
  let samples: Sample[] = [];

  const pos = (e: PointerEvent): { x: number; y: number } => {
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const pushSample = (x: number, y: number): void => {
    samples.push({ t: performance.now(), x, y });
    const cutoff = performance.now() - WINDOW_MS * 2;
    while (samples.length > 2 && samples[0].t < cutoff) samples.shift();
  };

  const velocity = (): { vx: number; vy: number } => {
    const now = performance.now();
    const recent = samples.filter((s) => now - s.t <= WINDOW_MS);
    if (recent.length < 2) return { vx: 0, vy: 0 };
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0.001) return { vx: 0, vy: 0 };
    const clamp = (v: number): number => Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v));
    return { vx: clamp((last.x - first.x) / dt), vy: clamp((last.y - first.y) / dt) };
  };

  el.addEventListener('pointerdown', (e) => {
    if (activeId !== null) return;
    activeId = e.pointerId;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported */
    }
    const p = pos(e);
    samples = [];
    pushSample(p.x, p.y);
    cb.onDown(p.x, p.y);
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId) return;
    const p = pos(e);
    pushSample(p.x, p.y);
    cb.onMove(p.x, p.y);
    e.preventDefault();
  });

  const end = (e: PointerEvent, cancelled: boolean): void => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    const p = pos(e);
    pushSample(p.x, p.y);
    if (cancelled) {
      cb.onCancel();
    } else {
      const v = velocity();
      cb.onUp(p.x, p.y, v.vx, v.vy);
    }
    samples = [];
  };

  el.addEventListener('pointerup', (e) => end(e, false));
  el.addEventListener('pointercancel', (e) => end(e, true));
}
