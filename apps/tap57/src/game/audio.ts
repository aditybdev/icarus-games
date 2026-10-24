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
  /** Fever bed: pad oscillators while a perfect streak runs hot. */
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
      if (this.feverOn) this.startFeverBed();
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

  private noise(duration: number, volume: number, filterFreq: number, delay = 0): void {
    if (!this.running || !this.ctx || !this.master || !this.noiseBuffer) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 0.9;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  /** Bottle tap: woody thock on the streak pitch ladder (360 + 16/step,
   *  ±4% jitter — ten identical clicks sound like a machine). */
  thock(streak: number): void {
    const ladder = Math.min(streak, 24);
    const f = (360 + 16 * ladder) * (1 + (Math.random() * 0.08 - 0.04));
    this.tone(f, f * 0.55, 0.09, 'triangle', 0.5);
    this.noise(0.04, 0.18, 2400);
  }

  /** The squirt: pressure-scaled noise gush with a falling glug. */
  squirt(power01: number): void {
    const v = 0.25 + 0.5 * Math.max(0, Math.min(1, power01));
    this.noise(0.28, v, 900 + 900 * power01);
    this.tone(240 + 260 * power01, 90, 0.3, 'sine', 0.4);
  }

  /** The splat: big burst + low thud — the greed tax, sold with juice. */
  splat(): void {
    this.noise(0.5, 0.9, 500);
    this.noise(0.3, 0.6, 1800, 0.02);
    this.tone(160, 40, 0.45, 'sine', 0.9);
  }

  /** Plated! — two-note ding on a center hit. */
  plated(): void {
    this.tone(523, 523, 0.12, 'triangle', 0.45);
    this.tone(784, 784, 0.2, 'triangle', 0.4, 0.09);
  }

  /** Rush-end medal sting, tiered 0-3. */
  medal(tier: number): void {
    if (tier <= 0) return;
    const notes = [392, 494, 587, 784];
    for (let i = 0; i <= tier; i += 1) {
      this.tone(notes[i], notes[i], 0.22, 'triangle', 0.42, i * 0.11);
    }
  }

  /** Fever bed (perfect streak ≥5): soft triad pad. */
  setFever(on: boolean): void {
    if (on === this.feverOn) return;
    this.feverOn = on;
    if (!on) {
      if (this.feverPad && this.ctx) {
        this.feverPad.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      }
      this.feverPad = null;
      return;
    }
    this.startFeverBed();
  }

  private startFeverBed(): void {
    if (!this.running || !this.ctx || !this.master || this.feverPad) return;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.06, this.ctx.currentTime, 0.3);
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
}
