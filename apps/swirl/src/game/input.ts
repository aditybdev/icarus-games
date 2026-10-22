/**
 * Touch-first input: press-and-hold (or Space) dispenses; horizontal drag
 * (or Arrow keys / A,D) steers the cone. UI overlays sit above the canvas,
 * so pointer events here only fire for gameplay touches.
 */
import { CONE_RANGE } from '../core/constants';

export interface InputState {
  /** Finger/mouse currently held down on the canvas. */
  pointerHeld: boolean;
  /** Latest world-X drag target, if the pointer is steering. */
  pointerTargetX: number | null;
  /** Currently pressed key codes. */
  keys: ReadonlySet<string>;
  /** Whether dispensing is requested (pointer hold or Space). */
  readonly dispensing: boolean;
}

export function bindInput(
  canvas: HTMLCanvasElement,
  toWorldX: (clientX: number, clientY: number) => number | null,
  onFirstGesture: () => void,
): InputState {
  const keys = new Set<string>();
  let gestureFired = false;

  const state: InputState = {
    pointerHeld: false,
    pointerTargetX: null,
    keys,
    get dispensing() {
      return state.pointerHeld || keys.has('Space');
    },
  };

  const fireGesture = () => {
    if (!gestureFired) {
      gestureFired = true;
      onFirstGesture();
    }
  };

  canvas.addEventListener('pointerdown', (e) => {
    fireGesture();
    state.pointerHeld = true;
    const x = toWorldX(e.clientX, e.clientY);
    if (x !== null) state.pointerTargetX = x;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!state.pointerHeld) return;
    const x = toWorldX(e.clientX, e.clientY);
    if (x !== null) state.pointerTargetX = x;
  });

  const release = (e: PointerEvent) => {
    state.pointerHeld = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'KeyA' || e.code === 'KeyD') {
      fireGesture();
      keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
  });
  window.addEventListener('blur', () => {
    keys.clear();
    state.pointerHeld = false;
  });

  return state;
}

/** Keyboard steering speed (world units per second). */
export const KEY_STEER_SPEED = 3.2;

/** Apply keyboard steering to a target X for this frame. */
export function steerWithKeys(targetX: number, keys: ReadonlySet<string>, dt: number): number {
  let next = targetX;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) next -= KEY_STEER_SPEED * dt;
  if (keys.has('ArrowRight') || keys.has('KeyD')) next += KEY_STEER_SPEED * dt;
  return Math.min(CONE_RANGE, Math.max(-CONE_RANGE, next));
}
