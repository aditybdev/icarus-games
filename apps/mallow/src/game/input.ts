/**
 * Golden Mallow — pointer input. One finger, two gestures:
 *  - drag: rotate the skewer — every move delta turns the mallow
 *  - tap (down/up, small travel): pull the mallow off the fire and serve
 * While flaming, alternating drag directions count as the extinguish shake
 * (main reads the deltas for flip detection). Pointer Events with capture.
 */

export interface InputCallbacks {
  onRotate(dAngle: number): void;
  onPull(): void;
}

const DRAG_PX = 14;
/** Pixels → radians: a full screen-width drag is about half a turn. */
const RAD_PER_PX = 0.008;

export function bindPointer(el: HTMLElement, cb: InputCallbacks): void {
  let activeId: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let dragging = false;

  el.addEventListener('pointerdown', (e) => {
    if (activeId !== null) return;
    activeId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    dragging = false;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported */
    }
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId) return;
    const dx = e.clientX - lastX;
    if (!dragging) {
      const dy = e.clientY - lastY;
      if (Math.hypot(dx, dy) < DRAG_PX) return;
      dragging = true;
    }
    if (dx !== 0) cb.onRotate(dx * RAD_PER_PX);
    lastX = e.clientX;
    lastY = e.clientY;
    e.preventDefault();
  });

  const end = (e: PointerEvent): void => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    if (!dragging) cb.onPull();
    dragging = false;
  };

  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => {
    activeId = null;
    dragging = false;
  });
}
