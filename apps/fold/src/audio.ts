/**
 * Synthesized audio for Fold — WebAudio only, no network assets.
 * The context is created lazily on the first user gesture, respects the
 * platform audio-enabled state, and mutes while paused.
 */

import type { Platform } from '@icarus/platform';

export class AudioFx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private hostEnabled = true;
  private paused = false;

  constructor(platform: Platform) {
    this.hostEnabled = platform.isAudioEnabled();
    platform.onAudioEnabledChange((enabled) => {
      this.hostEnabled = enabled;
      this.applyGain();
    });
  }

  /** Call from a user gesture (pointerdown) to create/resume the context. */
  unlock(): void {
    if (!this.ctx) {
      try {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(this.ctx.destination);
        // Shared noise buffer for the paper swish.
        const len = Math.floor(this.ctx.sampleRate * 0.4);
        this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        this.applyGain();
      } catch {
        this.ctx = null;
        this.master = null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyGain();
  }

  private applyGain(): void {
    if (!this.ctx || !this.master) return;
    const target = this.hostEnabled && !this.paused ? 0.55 : 0;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  private get ready(): boolean {
    return !!this.ctx && !!this.master && this.ctx.state === 'running';
  }

  /** Soft crease-select click. */
  click(): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(720, t);
    osc.frequency.exponentialRampToValueAtTime(340, t + 0.06);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  /** Low thud for an invalid fold. */
  thud(): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(170, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.12);
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /** Paper swish while a fold flips over. */
  swish(): void {
    if (!this.ready || !this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(420, t);
    filter.frequency.exponentialRampToValueAtTime(1900, t + 0.16);
    filter.frequency.exponentialRampToValueAtTime(500, t + 0.3);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.32, t + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + 0.34);
  }

  /** Gentle three-note chime on level complete. */
  chime(): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      if (!this.ctx || !this.master) return;
      const t = this.ctx.currentTime + i * 0.09;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.2, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  }
}
