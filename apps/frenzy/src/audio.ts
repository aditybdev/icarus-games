/**
 * Four-Leg Frenzy — synthesized WebAudio SFX (no assets).
 * The AudioContext is created lazily on the first user gesture and the master
 * gain respects the host's audio-enabled state, the SFX setting, and pause.
 */
import type { Platform } from '@icarus/platform';

export class AudioFx {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private hostEnabled = true;
  private sfxOn = true;
  private paused = false;

  constructor(private platform: Platform) {
    this.hostEnabled = platform.isAudioEnabled();
    platform.onAudioEnabledChange((enabled) => {
      this.hostEnabled = enabled;
      this.updateGain();
    });
  }

  /** Must be called from a user gesture before any sound plays. */
  unlock(): void {
    if (!this.ac) {
      try {
        this.ac = new AudioContext();
        this.master = this.ac.createGain();
        this.master.connect(this.ac.destination);
        this.updateGain();
      } catch {
        this.ac = null;
      }
    }
    if (this.ac?.state === 'suspended') this.ac.resume().catch(() => {});
  }

  setSfx(on: boolean): void {
    this.sfxOn = on;
    this.updateGain();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.updateGain();
  }

  private updateGain(): void {
    if (!this.master || !this.ac) return;
    const on = this.hostEnabled && this.sfxOn && !this.paused;
    this.master.gain.setTargetAtTime(on ? 0.5 : 0, this.ac.currentTime, 0.02);
  }

  private get ready(): boolean {
    return !!this.ac && !!this.master && this.ac.state === 'running';
  }

  /** Comedic hoof thud; pitch varies per leg, volume per plant strength. */
  thud(leg: number, strength: number): void {
    if (!this.ready) return;
    const ac = this.ac!;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const startFreq = 150 - leg * 12 + strength * 30;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, t0);
    osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.12);
    const vol = 0.25 + Math.min(0.5, strength * 0.5);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    osc.connect(gain).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + 0.18);

    // little noise tap for the "clop"
    const dur = 0.05;
    const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(vol * 0.5, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(ng).connect(this.master!);
    src.start(t0);
  }

  /** Slide-whistle-ish stumble sound. */
  whistle(): void {
    if (!this.ready) return;
    const ac = this.ac!;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(900, t0);
    osc.frequency.exponentialRampToValueAtTime(260, t0 + 0.28);
    osc.frequency.exponentialRampToValueAtTime(520, t0 + 0.5);
    gain.gain.setValueAtTime(0.22, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);
    osc.connect(gain).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + 0.6);
  }

  /** Short descending "bonk" for full falls. */
  bonk(): void {
    if (!this.ready) return;
    const ac = this.ac!;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, t0);
    osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.25);
    gain.gain.setValueAtTime(0.16, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    osc.connect(gain).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + 0.32);
  }

  /** Descending sad-trombone wah for timeouts (wah-wah-wah-waaah). */
  trombone(): void {
    if (!this.ready) return;
    const ac = this.ac!;
    const notes = [392, 370, 349, 330]; // G4, F#4, F4, E4
    notes.forEach((freq, i) => {
      const last = i === notes.length - 1;
      const t0 = ac.currentTime + i * 0.28;
      const dur = last ? 0.9 : 0.3;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t0);
      // each note droops; the final one slides hard down for the "waaah"
      osc.frequency.exponentialRampToValueAtTime(freq * (last ? 0.8 : 0.94), t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain).connect(this.master!);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    });
  }

  /** Finish fanfare arpeggio. */
  fanfare(): void {
    if (!this.ready) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const ac = this.ac!;
      const t0 = ac.currentTime + i * 0.12;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + (i === notes.length - 1 ? 0.5 : 0.18));
      osc.connect(gain).connect(this.master!);
      osc.start(t0);
      osc.stop(t0 + 0.55);
    });
  }

  /** Countdown blip: pitch rises with each count; "go" is higher and longer. */
  countBlip(go: boolean, step: number): void {
    if (!this.ready) return;
    const ac = this.ac!;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(go ? 880 : 440 + step * 110, t0);
    gain.gain.setValueAtTime(0.2, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + (go ? 0.35 : 0.15));
    osc.connect(gain).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + (go ? 0.4 : 0.18));
  }

  click(): void {
    if (!this.ready) return;
    const ac = this.ac!;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, t0);
    gain.gain.setValueAtTime(0.12, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
    osc.connect(gain).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + 0.07);
  }
}
