/**
 * All sound is synthesized with WebAudio — no audio assets.
 * The context is created lazily on the first user gesture; output is muted
 * whenever the platform disables audio or the game is paused.
 */
export class AudioSfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private enabled = true;

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
        this.master.gain.value = this.enabled ? 0.5 : 0;
        this.master.connect(this.ctx.destination);
        const length = this.ctx.sampleRate;
        this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.5;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      /* audio unavailable */
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(enabled ? 0.5 : 0, this.ctx.currentTime, 0.02);
    }
  }

  private tone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master) return;
    try {
      const t0 = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freqStart, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(volume, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain).connect(this.master);
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
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    try {
      const t0 = this.ctx.currentTime + delay;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      // Random start offset so repeated rustles do not sound identical.
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(freqStart, t0);
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + duration);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      src.connect(filter).connect(gain).connect(this.master);
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

  /** Paper rustle while dragging a tissue upward. */
  rustle(): void {
    this.noise(0.06, 'bandpass', 1900, 2600, 0.22);
  }

  /** Soft pop when the perforation lets go. */
  pop(): void {
    this.tone(420, 170, 0.09, 'sine', 0.4);
    this.noise(0.05, 'lowpass', 900, 500, 0.25);
  }

  /** Whoosh as the freed tissue flies off. */
  whoosh(): void {
    this.noise(0.32, 'bandpass', 500, 2600, 0.3);
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
}
