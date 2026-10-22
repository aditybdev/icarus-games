/**
 * All sound is synthesized with WebAudio — no audio assets.
 * The context is created lazily on the first user gesture; output is muted
 * whenever the platform disables audio or the game is paused.
 */
export class AudioSfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private dispense: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private tension: { osc: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
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
      if (this.ctx.state === 'suspended') {
        // resume() can reject outside a user gesture — never let it escape.
        void this.ctx.resume().catch(() => undefined);
      }
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
      gain.gain.linearRampToValueAtTime(volume, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    } catch {
      /* ignore */
    }
  }

  private noiseBurst(duration: number, filterFreq: number, volume: number, delay = 0): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    try {
      const t0 = this.ctx.currentTime + delay;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(volume, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      src.connect(filter).connect(gain).connect(this.master);
      src.start(t0);
      src.stop(t0 + duration + 0.05);
    } catch {
      /* ignore */
    }
  }

  /** Short UI click. */
  click(): void {
    this.tone(620, 520, 0.06, 'square', 0.12);
  }

  /** Looping soft extrusion noise while dispensing. */
  startDispense(): void {
    if (!this.ctx || !this.master || !this.noiseBuffer || this.dispense) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      filter.Q.value = 0.8;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.32, this.ctx.currentTime + 0.12);
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      this.dispense = { src, gain };
    } catch {
      this.dispense = null;
    }
  }

  stopDispense(): void {
    if (!this.ctx || !this.dispense) return;
    try {
      const { src, gain } = this.dispense;
      gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
      src.stop(this.ctx.currentTime + 0.2);
    } catch {
      /* ignore */
    }
    this.dispense = null;
  }

  /**
   * Continuous near-topple tension riser. `level` in [0, 1] maps to
   * pitch/brightness/volume; 0 silences it. Nodes are created lazily on
   * first use and reused, so per-frame calls allocate nothing. Output
   * routes through the master gain, so host-audio-off mutes it too.
   */
  setTension(level: number): void {
    if (!this.ctx || !this.master) return;
    const l = Math.min(1, Math.max(0, level));
    try {
      if (!this.tension) {
        if (l <= 0) return;
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 2;
        const gain = this.ctx.createGain();
        gain.gain.value = 0;
        osc.connect(filter).connect(gain).connect(this.master);
        osc.start();
        this.tension = { osc, filter, gain };
      }
      const t = this.ctx.currentTime;
      this.tension.osc.frequency.setTargetAtTime(85 + l * 165, t, 0.08);
      this.tension.filter.frequency.setTargetAtTime(220 + l * 980, t, 0.08);
      this.tension.gain.gain.setTargetAtTime(l * 0.14, t, 0.08);
    } catch {
      /* ignore */
    }
  }

  /** Heavy wobble crash when the swirl topples. */
  topple(): void {
    this.tone(150, 42, 0.4, 'sine', 0.5);
    this.noiseBurst(0.25, 300, 0.4, 0.05);
  }

  /** Happy success arpeggio. */
  chime(): void {
    this.tone(659.25, 659.25, 0.18, 'triangle', 0.22);
    this.tone(783.99, 783.99, 0.18, 'triangle', 0.22, 0.09);
    this.tone(1046.5, 1046.5, 0.3, 'triangle', 0.24, 0.18);
  }

  /** One ascending blip per earned star. */
  starBlip(index: number): void {
    const base = 620 + index * 160;
    this.tone(base, base * 1.2, 0.12, 'sine', 0.25);
  }

  /** Sad descending tone for a failed order. */
  fail(): void {
    this.tone(240, 130, 0.35, 'sawtooth', 0.14);
  }
}
