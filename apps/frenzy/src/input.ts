/**
 * Four-Leg Frenzy — multi-touch leg input.
 * Tracks each pointer independently so simultaneous holds work; every release
 * path (pointerup / pointercancel / lostpointercapture / blur) clears state —
 * a stuck leg input is a critical bug.
 */

export type LegKey = 0 | 1 | 2 | 3;

const KEY_MAP: Record<string, LegKey | undefined> = {
  q: 0,
  w: 1,
  o: 2,
  p: 3,
  a: 0,
  s: 1,
  k: 2,
  l: 3,
};

export class LegInput {
  /** Current held state per leg [FL, FR, BL, BR]. */
  readonly held: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  private pointerLeg = new Map<number, LegKey>();
  private keyDown = new Set<string>();
  private buttons: HTMLButtonElement[] = [];
  /** Called on the first user gesture (for audio unlock). */
  onFirstGesture: (() => void) | null = null;
  /** Non-leg keys forwarded to the host: 'r' (restart) and 'enter' (confirm). */
  onMetaKey: ((key: 'r' | 'enter') => void) | null = null;
  private gestured = false;

  attach(): void {
    for (let i = 0; i < 4; i++) {
      const el = document.getElementById(`leg-${i}`) as HTMLButtonElement | null;
      if (!el) continue;
      this.buttons[i] = el;
      el.addEventListener('pointerdown', (e) => this.onDown(e, i as LegKey));
      el.addEventListener('pointerup', (e) => this.onUp(e));
      el.addEventListener('pointercancel', (e) => this.onUp(e));
      el.addEventListener('lostpointercapture', (e) => this.onUp(e));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
    window.addEventListener('touchstart', () => document.body.classList.add('touch'), {
      once: true,
      passive: true,
    });
  }

  private gesture(): void {
    if (!this.gestured) {
      this.gestured = true;
      this.onFirstGesture?.();
    }
  }

  private onDown(e: PointerEvent, leg: LegKey): void {
    e.preventDefault();
    this.gesture();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported — pointerup still fires on the element */
    }
    this.pointerLeg.set(e.pointerId, leg);
    this.setLeg(leg, true);
  }

  private onUp(e: PointerEvent): void {
    const leg = this.pointerLeg.get(e.pointerId);
    if (leg === undefined) return;
    this.pointerLeg.delete(e.pointerId);
    // only release if no other pointer still holds this leg
    let stillHeld = false;
    for (const l of this.pointerLeg.values()) if (l === leg) stillHeld = true;
    if (!stillHeld) this.setLeg(leg, false);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    // Meta keys never collide with the QWOP/ASKL leg map.
    if (k === 'r' || k === 'enter') {
      if (down) {
        e.preventDefault();
        this.gesture();
        this.onMetaKey?.(k === 'r' ? 'r' : 'enter');
      }
      return;
    }
    const leg = KEY_MAP[k];
    if (leg === undefined) return;
    e.preventDefault();
    this.gesture();
    if (down) {
      this.keyDown.add(k);
    } else {
      this.keyDown.delete(k);
    }
    // a leg is held if any of its keys is down
    let heldNow = false;
    for (const key of this.keyDown) if (KEY_MAP[key] === leg) heldNow = true;
    this.setLeg(leg, heldNow);
  }

  private setLeg(leg: LegKey, down: boolean): void {
    this.held[leg] = down;
    this.buttons[leg]?.classList.toggle('down', down);
  }

  releaseAll(): void {
    this.pointerLeg.clear();
    this.keyDown.clear();
    for (let i = 0; i < 4; i++) this.setLeg(i as LegKey, false);
  }
}
