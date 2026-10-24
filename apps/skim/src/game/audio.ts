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
  /** Fever bed while a perfect chain runs hot (chain >= 5). */
  private feverOn = false;
  private feverPad: { osc: OscillatorNode[]; gain: GainNode } | null = null;

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
    if (!this.running || !this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  private noise(duration: number, volume: number, filterFreq: number, delay = 0): void {
    if (!this.running || !this.ctx || !this.master || !this.noiseBuffer) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0, Math.random());
    src.stop(t0 + duration + 0.05);
  }

  /** Throw whoosh — filtered noise sweep, pitch scaled with throw power. */
  whoosh(power01: number): void {
    this.noise(0.28, 0.16 + power01 * 0.12, 900 + power01 * 2200);
    this.tone(180 + power01 * 120, 90, 0.22, 'sine', 0.1);
  }

  /**
   * Bounce plip — the pitch ladder (base 360 Hz + 16 Hz per skip, ±4%
   * jitter) makes identical taps never sound like a machine.
   */
  plip(skip: number): void {
    const jitter = 1 + (Math.random() * 2 - 1) * 0.04;
    const base = (360 + Math.min(24, skip) * 16) * jitter;
    this.tone(base, base * 0.72, 0.09, 'sine', 0.16);
    this.noise(0.05, 0.07, 3200);
  }

  /** Perfect tap chime layered on the plip. */
  perfect(chain: number): void {
    const step = Math.min(12, chain);
    const base = 520 + step * 40;
    this.tone(base, base * 1.5, 0.16, 'triangle', 0.16);
    this.tone(base * 1.5, base * 2, 0.14, 'sine', 0.1, 0.04);
  }

  /** Sink splash — the fail beat: low noise wash + descending tone. */
  splash(): void {
    this.noise(0.5, 0.3, 800);
    this.tone(220, 55, 0.45, 'sine', 0.18);
  }

  /** Medal sting on results (tier 0=none … 3=gold). */
  medal(tier: number): void {
    if (tier <= 0) return;
    const notes = [392, 494, 587, 784];
    for (let i = 0; i <= tier; i += 1) {
      this.tone(notes[i], notes[i], 0.22, 'triangle', 0.16, i * 0.09);
    }
  }

  /** Fever bed while a perfect chain runs hot; ramps out when it ends. */
  setFever(on: boolean): void {
    if (on === this.feverOn) return;
    this.feverOn = on;
    if (on) this.startFeverBed();
    else this.stopFeverBed();
  }

  private startFeverBed(): void {
    if (!this.running || !this.ctx || !this.master || this.feverPad) return;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.4);
    const osc = [110, 165, 220].map((f) => {
      const o = this.ctx!.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(gain);
      o.start();
      return o;
    });
    gain.connect(this.master);
    this.feverPad = { osc, gain };
  }

  private stopFeverBed(): void {
    if (!this.feverPad || !this.ctx) return;
    const { osc, gain } = this.feverPad;
    gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    const stopAt = this.ctx.currentTime + 0.6;
    osc.forEach((o) => o.stop(stopAt));
    this.feverPad = null;
  }
}
