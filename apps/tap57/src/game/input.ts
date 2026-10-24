/**
 * Tap the 57 — pointer input. One finger, two gestures:
 *  - tap (down/up, small travel): a rhythm tap on the bottle
 *  - drag past 14px: aim mode — horizontal drag steers the launch angle,
 *    release fires the squirt (slingshot-style, angle starts at 45°)
 * Pointer Events with capture; `touch-action: none` on the stage prevents
 * scrolling. Angle mapping: full screen width ≈ the whole aim envelope.
 */
import { AIM_MAX, AIM_MIN } from '../core/constants';

export interface InputCallbacks {
  onTap(): void;
  onAimStart(): void;
  onAim(angle: number): void;
  onFire(angle: number): void;
}

const DRAG_PX = 14;
const AIM_MID = Math.PI / 4;

export function bindPointer(el: HTMLElement, cb: InputCallbacks): void {
  let activeId: number | null = null;
  let startX = 0;
  let startY = 0;
  let aiming = false;
  let angle = AIM_MID;

  const angleFor = (clientX: number): number => {
    const rect = el.getBoundingClientRect();
    const k = (AIM_MAX - AIM_MIN) / Math.max(1, rect.width);
    return Math.max(AIM_MIN, Math.min(AIM_MAX, AIM_MID + (clientX - startX) * k));
  };

  el.addEventListener('pointerdown', (e) => {
    if (activeId !== null) return;
    activeId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    aiming = false;
    angle = AIM_MID;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported */
    }
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId) return;
    if (!aiming) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.hypot(dx, dy) < DRAG_PX) return;
      aiming = true;
      cb.onAimStart();
    }
    angle = angleFor(e.clientX);
    cb.onAim(angle);
    e.preventDefault();
  });

  const end = (e: PointerEvent): void => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    if (aiming) {
      aiming = false;
      cb.onFire(angle);
    } else {
      cb.onTap();
    }
  };

  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => {
    activeId = null;
    aiming = false;
  });
}
