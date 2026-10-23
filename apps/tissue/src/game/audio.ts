/**
 * All sound is synthesized with WebAudio — no audio assets.
 * The context is created lazily on the first user gesture. The master gain is
 * gated INSIDE this class (host audio state × SFX toggle × pause) so callers
 * can never desync the composite flag. Nothing is ever scheduled on a
 * suspended context — queued nodes would burst-fire when it resumed.
 */
import type { Platform } from '@icarus/platform';

export class AudioSfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private hostEnabled = true;
  private sfxOn = true;
  private paused = false;
  /** Rustle fires per pointermove — cap the rate or it turns to static. */
  private lastRustleMs = 0;
  /** Fever bed: pad oscillators + hat scheduler while a streak runs hot. */
  private feverOn = false;
  private feverPad: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  private feverTimer: ReturnType<typeof setInterval> | null = null;

  constructor(platform: Platform) {
    this.hostEnabled = platform.isAudioEnabled();
    platform.onAudioEnabledChange((enabled) => {
      this.hostEnabled = enabled;
      this.applyGain();
    });
  }

  /** Create/resume the AudioContext. Call from a user-gesture handler. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(this.ctx.destination);
        const length = this.ctx.sampleRate;
        this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.5;
        this.applyGain();
      }
      // .catch matters: a rejected resume() escapes the surrounding try as an
      // unhandled rejection and trips the error hooks.
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      if (this.feverOn) this.startFeverBed(); // context arrived after fever
    } catch {
      /* audio unavailable */
    }
  }

  setSfx(on: boolean): void {
    this.sfxOn = on;
    this.applyGain();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyGain();
  }

  private gateOpen(): boolean {
    return this.hostEnabled && this.sfxOn && !this.paused;
  }

  private applyGain(): void {
    if (!this.master || !this.ctx) return;
    this.master.gain.setTargetAtTime(this.gateOpen() ? 0.5 : 0, this.ctx.currentTime, 0.02);
  }

  /** Never schedule on a suspended context — it burst-fires on resume. */
  private get running(): boolean {
    return !!this.ctx && !!this.master && this.ctx.state === 'running';
  }

  private tone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    delay = 0,
  ): void {
    if (!this.running) return;
    const ctx = this.ctx!;
    const master = this.master!;
    try {
      const t0 = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freqStart, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(volume, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain).connect(master);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    } catch {
      /* ignore */
    }
  }

  private noise(
    duration: number,
    filterType: BiquadFilterType,
    freqStart: number,
    freqEnd: number,
    volume: number,
    delay = 0,
  ): void {
    if (!this.running || !this.noiseBuffer) return;
    const ctx = this.ctx!;
    const master = this.master!;
    try {
      const t0 = ctx.currentTime + delay;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      // Random start offset so repeated rustles do not sound identical.
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(freqStart, t0);
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + duration);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      src.connect(filter).connect(gain).connect(master);
      src.start(t0, Math.random());
      src.stop(t0 + duration + 0.05);
    } catch {
      /* ignore */
    }
  }

  /** Short UI click. */
  click(): void {
    this.tone(660, 540, 0.06, 'square', 0.1);
  }

  /** Paper rustle while dragging a tissue upward. Pitch scales with streak heat. */
  rustle(pitch = 1): void {
    // Fires per pointermove; unthrottled bursts stack into white-noise static.
    const now = performance.now();
    if (now - this.lastRustleMs < 50) return;
    this.lastRustleMs = now;
    this.noise(0.06, 'bandpass', 1900 * pitch, 2600 * pitch, 0.22);
  }

  /** Soft pop when the perforation lets go. Pitch scales with streak heat. */
  pop(pitch = 1): void {
    this.tone(420 * pitch, 170 * pitch, 0.09, 'sine', 0.4);
    this.noise(0.05, 'lowpass', 900 * pitch, 500 * pitch, 0.25);
  }

  /** Whoosh as the freed tissue flies off. Pitch scales with streak heat. */
  whoosh(pitch = 1): void {
    this.noise(0.32, 'bandpass', 500 * pitch, 2600 * pitch, 0.3);
  }

  /** Muted thup when a short pull snaps back into the box. */
  snap(): void {
    this.tone(220, 140, 0.08, 'triangle', 0.25);
    this.noise(0.07, 'bandpass', 1200, 700, 0.18);
  }

  /** Countdown blip (steps 0..2 rising, 3 = GO). */
  blip(step: number): void {
    const base = 440 + step * 110;
    this.tone(base, base, step >= 3 ? 0.22 : 0.1, 'triangle', 0.28);
  }

  /** Happy finish arpeggio. */
  chime(): void {
    this.tone(659.25, 659.25, 0.16, 'triangle', 0.22);
    this.tone(830.61, 830.61, 0.16, 'triangle', 0.22, 0.09);
    this.tone(987.77, 987.77, 0.2, 'triangle', 0.22, 0.18);
    this.tone(1318.5, 1318.5, 0.34, 'triangle', 0.24, 0.27);
  }

  /** Descending two-note blip: a chain just lost its mercy / broke. */
  descend(): void {
    this.tone(520, 520, 0.09, 'square', 0.14);
    this.tone(330, 330, 0.14, 'square', 0.14, 0.09);
  }

  /** Bonus arpeggio for the golden tissue (bright major run + sparkle). */
  golden(): void {
    this.tone(783.99, 783.99, 0.1, 'triangle', 0.2);
    this.tone(987.77, 987.77, 0.1, 'triangle', 0.2, 0.07);
    this.tone(1174.7, 1174.7, 0.1, 'triangle', 0.2, 0.14);
    this.tone(1568, 1568, 0.22, 'triangle', 0.22, 0.21);
    this.noise(0.18, 'highpass', 6500, 8000, 0.08, 0.14);
  }

  /* ------------------------------ fever bed ------------------------------ */

  /**
   * Fever mode audio bed: a soft pad (two detuned sines through a lowpass)
   * plus light high-passed noise hats on a 250 ms scheduler. Layers in while
   * a streak is hot; ramps out cleanly when it ends. No-ops until unlocked.
   */
  setFever(on: boolean): void {
    if (on === this.feverOn) return;
    this.feverOn = on;
    if (on) this.startFeverBed();
    else this.stopFeverBed();
  }

  private startFeverBed(): void {
    if (!this.running || this.feverPad) return;
    const ctx = this.ctx!;
    const master = this.master!;
    try {
      const t0 = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.05, t0 + 0.9); // slow fade-in
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      const osc = [196, 246.94].map((freq, i) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = freq * (i === 0 ? 1 : 1.003); // gentle detune shimmer
        o.connect(filter);
        o.start(t0);
        return o;
      });
      filter.connect(gain).connect(master);
      this.feverPad = { osc, gain };
      this.feverTimer = setInterval(() => {
        // Eighth-note hats at 120 bpm. Skip while muted — audible silence is
        // free, but scheduling nodes forever while paused is not.
        if (!this.gateOpen()) return;
        this.noise(0.03, 'highpass', 7000, 7000, 0.045);
      }, 250);
    } catch {
      /* audio unavailable */
    }
  }

  private stopFeverBed(): void {
    if (this.feverTimer !== null) {
      clearInterval(this.feverTimer);
      this.feverTimer = null;
    }
    const pad = this.feverPad;
    this.feverPad = null;
    if (!pad || !this.ctx) return;
    try {
      const t0 = this.ctx.currentTime;
      pad.gain.gain.cancelScheduledValues(t0);
      pad.gain.gain.setTargetAtTime(0, t0, 0.08);
      for (const o of pad.osc) o.stop(t0 + 0.4);
    } catch {
      /* already stopped */
    }
  }
}
