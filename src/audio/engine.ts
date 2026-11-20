/**
 * Synthesised sound with the Web Audio API: oscillators, noise and filters,
 * no sound files. The engine reads the simulation through `soundLevels`
 * and never writes to it.
 *
 *   sources ─┬─ inside bus (the boat's own machinery) ──────────┐
 *            └─ outside bus (flow, sea, wind, gulls) → low-pass ┴→ master → speakers
 *
 * Browsers only start audio after a user gesture, so the context is
 * created by `unlock()` from a click or key press.
 */
import type { SoundLevels } from './levels';

export type Cue = 'grounding' | 'alarm' | 'splash' | 'clonk' | 'objective' | 'success' | 'failure' | 'ping';

export interface AudioOptions {
  /** Master volume 0…1. */
  volume: number;
  effects: boolean;
  ambience: boolean;
}

/** Smoothing time constant for level changes [s]. */
const SMOOTH = 0.15;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private inside!: GainNode;
  private outside!: GainNode;
  private outsideFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private ch: Record<string, { gain: GainNode; set: (l: SoundLevels) => number }> = {};
  private ambienceGains = new Set<string>();
  private options: AudioOptions = { volume: 0.6, effects: true, ambience: true };
  private muted = false;
  private running = false;
  /** Next scheduled time for random events [s, audio clock]. */
  private next = { creak: 0, ping: 0, gull: 0, foghorn: 0 };

  get available(): boolean {
    return typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window);
  }

  /** Creates (or resumes) the audio context. Call from a user gesture. */
  unlock(): void {
    if (!this.available) return;
    if (!this.ctx) this.build();
    if (this.running) void this.ctx!.resume();
  }

  setOptions(o: AudioOptions): void {
    this.options = o;
    this.applyMaster();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyMaster();
    return this.muted;
  }

  /** Sound runs while a game is being played; it is silent in menus and paused. */
  setRunning(on: boolean): void {
    this.running = on;
    if (!this.ctx) return;
    if (on) void this.ctx.resume();
    else void this.ctx.suspend();
  }

  /** Applies new levels (call ~10 times a second). */
  update(l: SoundLevels): void {
    const ctx = this.ctx;
    if (!ctx || !this.running) return;
    const now = ctx.currentTime;
    for (const [name, c] of Object.entries(this.ch)) {
      const enabled = this.ambienceGains.has(name) ? this.options.ambience : this.options.effects;
      c.gain.gain.setTargetAtTime(enabled ? c.set(l) : 0, now, SMOOTH);
    }
    this.outsideFilter.frequency.setTargetAtTime(l.outsideCutoff, now, SMOOTH);

    // Random events: creaks, echo sounder pings, gulls and the fog horn.
    const due = (key: 'creak' | 'ping' | 'gull' | 'foghorn', rate: number, jitter: boolean): boolean => {
      if (rate <= 0) {
        this.next[key] = 0;
        return false;
      }
      if (this.next[key] === 0) this.next[key] = now + (jitter ? Math.random() : 1) / rate;
      if (now < this.next[key]) return false;
      this.next[key] = now + (jitter ? 0.5 + Math.random() : 1) / rate;
      return true;
    };
    if (this.options.effects) {
      if (due('creak', l.creakRate, true)) this.creak();
      if (due('ping', l.pingRate, false)) this.cue('ping');
    }
    if (this.options.ambience) {
      if (due('gull', l.gullRate, true)) this.gull();
      if (due('foghorn', l.foghornRate, false)) this.foghorn();
    }
  }

  /** One-shot sounds: alarms and signals. */
  cue(c: Cue): void {
    const ctx = this.ctx;
    if (!ctx || !this.running || !this.options.effects) return;
    const t = ctx.currentTime;
    switch (c) {
      case 'ping':
        this.tone(1450, t, 0.09, 0.25, 'sine', this.inside);
        break;
      case 'alarm':
        for (let i = 0; i < 4; i++) this.tone(i % 2 ? 660 : 880, t + i * 0.25, 0.2, 0.18, 'square', this.inside);
        break;
      case 'grounding':
        this.burst(t, 1.2, 0.9, 180, 'lowpass', this.outside);
        this.tone(45, t, 0.8, 0.6, 'sine', this.inside);
        for (let i = 0; i < 6; i++) this.tone(i % 2 ? 660 : 880, t + 0.6 + i * 0.25, 0.2, 0.18, 'square', this.inside);
        break;
      case 'splash':
        this.burst(t, 0.7, 0.6, 2500, 'lowpass', this.outside);
        break;
      case 'clonk':
        this.tone(90, t, 0.25, 0.35, 'triangle', this.inside);
        this.burst(t, 0.08, 0.3, 1200, 'bandpass', this.inside);
        break;
      case 'objective':
        this.tone(660, t, 0.15, 0.2, 'sine', this.inside);
        this.tone(990, t + 0.15, 0.25, 0.2, 'sine', this.inside);
        break;
      case 'success':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.16, 0.3, 0.2, 'triangle', this.inside));
        break;
      case 'failure':
        [392, 330, 262].forEach((f, i) => this.tone(f, t + i * 0.25, 0.4, 0.22, 'sawtooth', this.inside));
        break;
    }
  }

  // ------------------------------------------------------------------ setup

  private build(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.inside = ctx.createGain();
    this.inside.connect(this.master);
    this.outsideFilter = ctx.createBiquadFilter();
    this.outsideFilter.type = 'lowpass';
    this.outsideFilter.frequency.value = 12000;
    this.outsideFilter.connect(this.master);
    this.outside = ctx.createGain();
    this.outside.connect(this.outsideFilter);
    this.applyMaster();

    // Two seconds of white noise, looped by every noise source.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const B = this.inside;
    const O = this.outside;

    // Electric motor: a low hum that rises with the shaft speed.
    {
      const g = this.channel('motor', B, (l) => l.motor.gain * 0.5);
      const lp = this.filter('lowpass', 320, 0.7, g);
      const a = this.osc('sawtooth', 50, lp);
      const b = this.osc('sine', 100, lp);
      this.ch.motor!.set = (l) => {
        a.frequency.setTargetAtTime(l.motor.freq, ctx.currentTime, SMOOTH);
        b.frequency.setTargetAtTime(l.motor.freq * 2, ctx.currentTime, SMOOTH);
        return l.motor.gain * 0.5;
      };
    }
    // Propeller: a noise band beating at the blade rate.
    {
      const g = this.channel('propeller', O, (l) => l.propeller.gain);
      const am = ctx.createGain();
      am.gain.value = 0.5;
      am.connect(g);
      this.noiseSource(this.filter('bandpass', 420, 1.2, am));
      const lfo = this.osc('sine', 1, null);
      const depth = ctx.createGain();
      depth.gain.value = 0.45;
      lfo.connect(depth);
      depth.connect(am.gain);
      this.ch.propeller!.set = (l) => {
        lfo.frequency.setTargetAtTime(Math.max(0.1, l.propeller.bladeRate), ctx.currentTime, SMOOTH);
        return l.propeller.gain;
      };
    }
    this.noiseChannel('cavitation', O, 'highpass', 2500, 0.7, (l) => l.cavitation);
    // Flow noise: brighter with speed.
    {
      const g = this.channel('flow', O, (l) => l.flow.gain);
      const lp = this.filter('lowpass', 300, 0.5, g);
      this.noiseSource(lp);
      this.ch.flow!.set = (l) => {
        lp.frequency.setTargetAtTime(l.flow.cutoff, ctx.currentTime, SMOOTH);
        return l.flow.gain;
      };
    }
    // Hydraulics: a whine with a buzz underneath.
    {
      const g = this.channel('hydraulics', B, (l) => l.hydraulics * 0.6);
      this.noiseSource(this.filter('bandpass', 950, 6, g));
      const lp = this.filter('lowpass', 500, 0.7, g);
      this.osc('square', 118, lp);
    }
    this.noiseChannel('vent', B, 'highpass', 1800, 0.7, (l) => l.vent);
    // Water pouring in: a low band that wobbles.
    {
      const g = this.channel('flood', O, (l) => l.flood);
      const bp = this.filter('bandpass', 320, 3, g);
      this.noiseSource(bp);
      const lfo = this.osc('sine', 3.3, null);
      const depth = ctx.createGain();
      depth.gain.value = 140;
      lfo.connect(depth);
      depth.connect(bp.frequency);
    }
    this.noiseChannel('blow', B, 'lowpass', 1300, 0.7, (l) => l.blow);
    // Pumps and the periscope hoist: motors.
    {
      const g = this.channel('pump', B, (l) => l.pump * 0.6);
      const lp = this.filter('lowpass', 420, 0.7, g);
      this.osc('sawtooth', 50, lp);
      this.osc('sawtooth', 100.7, lp);
    }
    {
      const g = this.channel('periscopeMotor', B, (l) => l.periscopeMotor * 0.4);
      this.osc('sawtooth', 185, this.filter('lowpass', 900, 0.7, g));
    }
    {
      const g = this.channel('blower', B, (l) => l.blower);
      this.noiseSource(this.filter('bandpass', 650, 1.5, g));
      this.osc('triangle', 92, g);
    }
    // Surroundings: wind and waves, swelling slowly.
    {
      const g = this.channel('wind', O, (l) => l.wind, true);
      const bp = this.filter('bandpass', 520, 0.6, g);
      this.noiseSource(bp);
      const lfo = this.osc('sine', 0.13, null);
      const depth = ctx.createGain();
      depth.gain.value = 220;
      lfo.connect(depth);
      depth.connect(bp.frequency);
    }
    {
      const g = this.channel('waves', O, (l) => l.waves, true);
      const am = ctx.createGain();
      am.gain.value = 0.6;
      am.connect(g);
      this.noiseSource(this.filter('lowpass', 450, 0.7, am));
      const lfo = this.osc('sine', 0.11, null);
      const depth = ctx.createGain();
      depth.gain.value = 0.4;
      lfo.connect(depth);
      depth.connect(am.gain);
    }
    if (!this.running) void ctx.suspend();
  }

  private applyMaster(): void {
    if (!this.ctx) return;
    const v = this.muted ? 0 : this.options.volume;
    this.master.gain.setTargetAtTime(v * v, this.ctx.currentTime, 0.05);
  }

  private channel(name: string, bus: GainNode, set: (l: SoundLevels) => number, ambience = false): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = 0;
    g.connect(bus);
    this.ch[name] = { gain: g, set };
    if (ambience) this.ambienceGains.add(name);
    return g;
  }

  private noiseChannel(name: string, bus: GainNode, type: BiquadFilterType, freq: number, q: number, set: (l: SoundLevels) => number): void {
    const g = this.channel(name, bus, set);
    this.noiseSource(this.filter(type, freq, q, g));
  }

  private filter(type: BiquadFilterType, freq: number, q: number, to: AudioNode): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(to);
    return f;
  }

  private osc(type: OscillatorType, freq: number, to: AudioNode | null): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (to) o.connect(to);
    o.start();
    return o;
  }

  private noiseSource(to: AudioNode): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    // Start each loop at a different point so the sources do not correlate.
    s.start(0, Math.random() * 2);
    s.connect(to);
    return s;
  }

  /** A short tone with a fast attack and an exponential decay. */
  private tone(freq: number, at: number, dur: number, gain: number, type: OscillatorType, bus: GainNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g);
    g.connect(bus);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  /** A burst of filtered noise. */
  private burst(at: number, dur: number, gain: number, freq: number, type: BiquadFilterType, bus: GainNode): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(f);
    f.connect(g);
    g.connect(bus);
    s.start(at, Math.random() * 1.5, dur + 0.05);
  }

  /** The hull creaking: a resonant noise burst and a dull thud. */
  private creak(): void {
    const t = this.ctx!.currentTime;
    const f = 140 + Math.random() * 260;
    this.burst(t, 0.3 + Math.random() * 0.5, 0.35, f, 'bandpass', this.inside);
    if (Math.random() < 0.4) this.tone(38 + Math.random() * 20, t, 0.4, 0.4, 'sine', this.inside);
  }

  /** A gull: two or three falling cries. */
  private gull(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const at = t + i * 0.32;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(1900 + Math.random() * 300, at);
      o.frequency.exponentialRampToValueAtTime(1150, at + 0.22);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.06, at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
      o.connect(g);
      g.connect(this.outside);
      o.start(at);
      o.stop(at + 0.3);
    }
  }

  /** A distant fog horn: two low notes, long and soft. */
  private foghorn(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.4);
    g.gain.setValueAtTime(0.12, t + 2.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    lp.connect(g);
    g.connect(this.outside);
    for (const f of [110, 165]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + 3.1);
    }
  }
}
