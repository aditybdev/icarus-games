/**
 * Skim — pointer input. One finger, two phases:
 *  - aim: drag and release — the flick velocity/angle becomes the throw
 *  - skip: any pointerdown during play is a tap (answered against the live
 *    contact window in main)
 * Pointer Events with capture; `touch-action: none` on the stage prevents
 * scrolling. Velocity is sampled over a short window like Tissue Rush.
 */

export interface InputCallbacks {
  /** Raw flick: screen px/s velocity and angle (radians, + = upward). */
  onThrow(speed: number, angle: number): void;
  onTap(): void;
}

interface Sample {
  t: number;
  x: number;
  y: number;
}

const MAX_PX_SPEED = 4200; // px/s clamp for flick velocity
const WINDOW_MS = 110;

export function bindPointer(el: HTMLElement, cb: InputCallbacks): void {
  let activeId: number | null = null;
  let samples: Sample[] = [];

  const pushSample = (x: number, y: number): void => {
    samples.push({ t: performance.now(), x, y });
    const cutoff = performance.now() - WINDOW_MS * 2;
    while (samples.length > 2 && samples[0].t < cutoff) samples.shift();
  };

  const flick = (): { speed: number; angle: number } | null => {
    const now = performance.now();
    const recent = samples.filter((s) => now - s.t <= WINDOW_MS);
    if (recent.length < 2) return null;
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0.02) return null;
    const vx = (last.x - first.x) / dt;
    const vy = (first.y - last.y) / dt; // screen y down → world y up
    const speed = Math.min(MAX_PX_SPEED, Math.hypot(vx, vy));
    if (speed < 250) return null; // too gentle to be a throw
    return { speed, angle: Math.atan2(vy, vx) };
  };

  el.addEventListener('pointerdown', (e) => {
    cb.onTap();
    if (activeId !== null) return;
    activeId = e.pointerId;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported */
    }
    samples = [];
    pushSample(e.clientX, e.clientY);
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId) return;
    pushSample(e.clientX, e.clientY);
    e.preventDefault();
  });

  const end = (e: PointerEvent): void => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    pushSample(e.clientX, e.clientY);
    const f = flick();
    if (f) cb.onThrow(f.speed, f.angle);
    samples = [];
  };

  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => {
    activeId = null;
    samples = [];
  });
}
