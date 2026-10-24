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
  /** Campfire crackle scheduler (pops on a jittered interval). */
  private crackleOn = false;
  private crackleTimer: ReturnType<typeof setInterval> | null = null;
  /** Sizzle loop while the mallow is aflame. */
  private sizzle: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

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
        if (this.crackleOn) this.startCrackle();
      }
      // .catch matters: a rejected resume() escapes the surrounding try as an
      // unhandled rejection and trips the error hooks.
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
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
    if (!this.running || !this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  private noise(duration: number, volume: number, filterFreq: number, delay = 0, q = 0.9): void {
    if (!this.running || !this.ctx || !this.master || !this.noiseBuffer) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  /* ------------------------------ campfire ------------------------------ */

  /** Ambient crackle bed — jittered pops forever, gated by the master gain. */
  setCrackle(on: boolean): void {
    this.crackleOn = on;
    if (!on) {
      if (this.crackleTimer) clearInterval(this.crackleTimer);
      this.crackleTimer = null;
      return;
    }
    this.startCrackle();
  }

  private startCrackle(): void {
    if (!this.running || this.crackleTimer) return;
    const pop = (): void => {
      if (!this.running) return;
      const f = 900 + Math.random() * 2200;
      this.noise(0.03 + Math.random() * 0.05, 0.05 + Math.random() * 0.09, f, 0, 2.5);
    };
    pop();
    this.crackleTimer = setInterval(pop, 140 + Math.random() * 240);
  }

  /** Skewer rotation creak — soft and pitch-jittered. */
  creak(): void {
    const f = 180 + Math.random() * 60;
    this.tone(f, f * 0.8, 0.06, 'triangle', 0.08);
  }

  /** Ignition: whoomp. */
  ignite(): void {
    this.noise(0.4, 0.7, 400);
    this.tone(220, 60, 0.4, 'sine', 0.7);
  }

  /** Sizzle loop while aflame; call sizzleOff on extinguish/char/pull. */
  sizzleOn(): void {
    if (!this.running || !this.ctx || !this.master || !this.noiseBuffer || this.sizzle) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 3000;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    gain.gain.setTargetAtTime(0.16, this.ctx.currentTime, 0.05);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
    this.sizzle = { src, gain };
  }

  sizzleOff(): void {
    if (!this.sizzle || !this.ctx) return;
    this.sizzle.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.06);
    const src = this.sizzle.src;
    setTimeout(() => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }, 300);
    this.sizzle = null;
  }

  /** Extinguish: wet pfff. */
  extinguish(): void {
    this.noise(0.35, 0.5, 2600, 0, 0.6);
  }

  /** Pull off the fire: quick swoosh. */
  pull(): void {
    this.noise(0.16, 0.3, 1200, 0, 0.5);
  }

  /** Golden! — warm two-note ding. */
  golden(): void {
    this.tone(523, 523, 0.14, 'triangle', 0.45);
    this.tone(784, 784, 0.22, 'triangle', 0.4, 0.1);
  }

  /** Burnt: the sad trombone womp. */
  burnt(): void {
    this.tone(196, 185, 0.25, 'sawtooth', 0.25);
    this.tone(165, 147, 0.4, 'sawtooth', 0.22, 0.22);
  }

  /** Rush-end medal sting, tiered 0-3. */
  medal(tier: number): void {
    if (tier <= 0) return;
    const notes = [392, 494, 587, 784];
    for (let i = 0; i <= tier; i += 1) {
      this.tone(notes[i], notes[i], 0.22, 'triangle', 0.42, i * 0.11);
    }
  }
}
