/**
 * The start page's music, synthesised: plays the score (score.ts) with Web
 * Audio, no sound files.
 *
 *   drone ──────────┐
 *   chords → pad ───┤
 *   swells, creaks, ├→ mix ─┬──────────────→ out → master
 *   pulse, roll     │       └→ reverb → wet ─┘
 *   radio + morse ──┘
 *   pings, charges, horn → far ─→ reverb (mostly) and a little dry
 *
 * The score runs on its own clock whenever the start page shows, also
 * before the browser lets sound start: `onEvent` then still reports the
 * depth charges, which the demo behind the menu shows as water columns.
 * Sound may use Math.random(): it does not touch the simulation.
 */
import { ROOT, Score, note, type Levels, type MusicEvent } from './score';

/** How far ahead events are scheduled [s]. */
const LOOKAHEAD = 1.0;
/** How often the scheduler runs [ms]. */
const TICK_MS = 200;
/** Fade in and out [s]. */
const FADE_IN = 3;
const FADE_OUT = 1.5;
/** Glide between the sections' layer levels [s, time constant]. */
const GLIDE = 4;

export class MenuMusic {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private out!: GainNode;
  private mix!: GainNode;
  private far!: GainNode;
  private pad!: GainNode;
  private radio!: GainNode;
  private layers!: { drone: GainNode; pad: GainNode; radio: GainNode };
  private readonly score = new Score(Math.random);
  /** Score time [s] when the clock last stopped, and the wall time it started at. */
  private elapsed = 0;
  private startedAt: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private audible = false;
  private volume = 0.7;
  private listeners: ((e: MusicEvent, delay: number) => void)[] = [];
  /** The layer levels of the section playing (set again on attach). */
  private levels: Levels = { drone: 0, pad: 0, pulse: 0, radio: 0 };

  /** Called for every event as it is scheduled, `delay` seconds ahead (the depth charges are shown). */
  onEvent(fn: (e: MusicEvent, delay: number) => void): void {
    this.listeners.push(fn);
  }

  /** Connects to the audio context once the browser allows sound. */
  attach(ctx: AudioContext, destination: AudioNode, noise: AudioBuffer): void {
    this.ctx = ctx;
    this.noise = noise;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);

    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx, 4.5);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    reverb.connect(wet);
    wet.connect(this.out);

    this.mix = ctx.createGain();
    this.mix.connect(this.out);
    this.mix.connect(reverb);
    // Far things: mostly reverb.
    this.far = ctx.createGain();
    this.far.connect(reverb);
    const farDry = ctx.createGain();
    farDry.gain.value = 0.3;
    this.far.connect(farDry);
    farDry.connect(this.out);

    // The drone: two slightly detuned saws on D1 and a fifth, through a slowly breathing low-pass.
    const drone = ctx.createGain();
    drone.gain.value = 0;
    drone.connect(this.mix);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 150;
    lp.Q.value = 3;
    lp.connect(drone);
    for (const [type, f, g] of [['sawtooth', ROOT, 0.22], ['sawtooth', ROOT * 1.007, 0.22], ['sine', ROOT, 0.5], ['sawtooth', note(7), 0.08]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const gg = ctx.createGain();
      gg.gain.value = g;
      o.connect(gg);
      gg.connect(lp);
      o.start();
    }
    lfo(ctx, 0.045, 70, lp.frequency);

    // The chords go through a soft low-pass; a breath of filtered noise under them.
    const pad = ctx.createGain();
    pad.gain.value = 0;
    pad.connect(this.mix);
    this.pad = ctx.createGain();
    const padLp = ctx.createBiquadFilter();
    padLp.type = 'lowpass';
    padLp.frequency.value = 900;
    this.pad.connect(padLp);
    padLp.connect(pad);
    const breath = ctx.createBiquadFilter();
    breath.type = 'bandpass';
    breath.frequency.value = 600;
    breath.Q.value = 0.8;
    const breathGain = ctx.createGain();
    breathGain.gain.value = 0.05;
    breath.connect(breathGain);
    breathGain.connect(pad);
    this.loopNoise(breath);
    lfo(ctx, 0.07, 0.04, breathGain.gain);

    // The radio: band-passed static far away.
    const radio = ctx.createGain();
    radio.gain.value = 0;
    radio.connect(this.mix);
    this.radio = ctx.createGain();
    this.radio.gain.value = 1;
    const radioBand = ctx.createBiquadFilter();
    radioBand.type = 'bandpass';
    radioBand.frequency.value = 1700;
    radioBand.Q.value = 1.6;
    this.radio.connect(radioBand);
    radioBand.connect(radio);
    const hiss = ctx.createGain();
    hiss.gain.value = 0.025;
    hiss.connect(this.radio);
    this.loopNoise(hiss);
    lfo(ctx, 0.2, 0.012, hiss.gain);

    this.layers = { drone, pad, radio };
    this.applyLevels(this.levels, ctx.currentTime);
    this.applyOutput();
  }

  /** The start page shows (true) or not: the score's clock runs only while it does. */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    if (on) {
      this.startedAt = performance.now() / 1000;
      this.tick();
      this.timer ??= setInterval(() => this.tick(), TICK_MS);
    } else {
      this.elapsed = this.now();
      this.startedAt = null;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    }
    this.applyOutput();
  }

  /** Whether the music is heard (the setting), and its volume 0…1. */
  setOptions(audible: boolean, volume: number): void {
    this.audible = audible;
    this.volume = volume;
    this.applyOutput();
  }

  /** Score time [s]. */
  private now(): number {
    return this.startedAt === null ? this.elapsed : this.elapsed + performance.now() / 1000 - this.startedAt;
  }

  private applyOutput(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const on = this.active && this.audible;
    const target = on ? this.volume * this.volume * 0.9 : 0;
    this.out.gain.cancelScheduledValues(ctx.currentTime);
    this.out.gain.setTargetAtTime(target, ctx.currentTime, (on ? FADE_IN : FADE_OUT) / 3);
  }

  private tick(): void {
    const now = this.now();
    for (const e of this.score.take(now + LOOKAHEAD)) {
      const delay = Math.max(0, e.t - now);
      for (const fn of this.listeners) fn(e, delay);
      const ctx = this.ctx;
      if (ctx && ctx.state === 'running') this.play(e, ctx.currentTime + delay);
      else if (e.kind === 'section') this.levels = e.section.levels;
    }
  }

  private play(e: MusicEvent, at: number): void {
    switch (e.kind) {
      case 'section':
        this.levels = e.section.levels;
        this.applyLevels(e.section.levels, at);
        break;
      case 'chord':
        for (const f of e.notes) this.padNote(f, at, e.dur);
        break;
      case 'swell':
        this.env(this.voice('sine', ROOT, this.mix), at, 3, 4, 0.3 * this.levels.drone);
        break;
      case 'ping': {
        const g = this.voice('sine', e.freq, this.far);
        this.voice('sine', e.freq * 1.003, g);
        this.perc(g, at, 1.6, 0.16);
        this.perc(this.voice('sine', e.freq, this.far), at + 1.7, 1.4, 0.05);
        break;
      }
      case 'creak':
        this.creak(at);
        break;
      case 'charge':
        this.charge(at, e.distance);
        break;
      case 'beat':
        this.beat(at, e.accent, e.level);
        break;
      case 'horn':
        this.horn(at, e.notes);
        break;
      case 'morse':
        this.morse(at, e.pattern);
        break;
      case 'roll':
        this.roll(at, e.dur);
        break;
    }
  }

  private applyLevels(l: Levels, at: number): void {
    this.layers.drone.gain.setTargetAtTime(l.drone * 0.5, at, GLIDE);
    this.layers.pad.gain.setTargetAtTime(l.pad, at, GLIDE);
    this.layers.radio.gain.setTargetAtTime(l.radio, at, GLIDE);
  }

  // ----------------------------------------------------------------- voices

  /** An oscillator into a new gain (returned, at 0) into `to`; stopped by the envelope helpers. */
  private voice(type: OscillatorType, freq: number, to: AudioNode): GainNode & { oscs?: OscillatorNode[] } {
    const ctx = this.ctx!;
    const g = ctx.createGain() as GainNode & { oscs?: OscillatorNode[] };
    g.gain.value = 0;
    g.connect(to);
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(g);
    g.oscs = [o];
    return g;
  }

  /** Slow attack, hold, slow release; starts and stops the voice's oscillators. */
  private env(g: GainNode & { oscs?: OscillatorNode[] }, at: number, attack: number, release: number, peak: number, hold = 0): void {
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.setValueAtTime(peak, at + attack + hold);
    g.gain.linearRampToValueAtTime(0, at + attack + hold + release);
    for (const o of g.oscs ?? []) {
      o.start(at);
      o.stop(at + attack + hold + release + 0.1);
    }
  }

  /** Fast attack, exponential decay. */
  private perc(g: GainNode & { oscs?: OscillatorNode[] }, at: number, dur: number, peak: number): void {
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    for (const o of g.oscs ?? []) {
      o.start(at);
      o.stop(at + dur + 0.1);
    }
  }

  private padNote(f: number, at: number, dur: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain() as GainNode & { oscs?: OscillatorNode[] };
    g.gain.value = 0;
    g.connect(this.pad);
    g.oscs = [];
    for (const [type, mult, level] of [['sawtooth', 0.998, 0.5], ['sawtooth', 1.002, 0.5], ['sine', 0.5, 0.7]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mult;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og);
      og.connect(g);
      g.oscs.push(o);
    }
    this.env(g, at, 5, 5, 0.045, Math.max(0, dur - 10));
  }

  private noiseBurst(at: number, dur: number, to: AudioNode, type: BiquadFilterType, freq: number, q: number, peak: number): BiquadFilterNode {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.05, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(f);
    f.connect(g);
    g.connect(to);
    s.start(at, Math.random() * 1.5, dur + 0.1);
    return f;
  }

  /** The hull groaning: a resonant noise band sweeping down, and a dull knock. */
  private creak(at: number): void {
    const f = this.noiseBurst(at, 1.8, this.mix, 'bandpass', 420, 12, 0.5);
    f.frequency.setValueAtTime(380 + Math.random() * 120, at);
    f.frequency.exponentialRampToValueAtTime(100 + Math.random() * 40, at + 1.6);
    if (Math.random() < 0.6) this.perc(this.voice('sine', 40 + Math.random() * 12, this.mix), at + 0.2, 0.6, 0.2);
  }

  /** A depth charge far away: a deep falling boom and a long rumble; a crack when it is nearer. */
  private charge(at: number, distance: number): void {
    const near = 1 - distance;
    const boom = this.voice('sine', 55, this.far);
    boom.oscs![0]!.frequency.setValueAtTime(55, at);
    boom.oscs![0]!.frequency.exponentialRampToValueAtTime(24, at + 2.5);
    this.perc(boom, at, 3, 0.35 + 0.45 * near);
    this.noiseBurst(at + 0.05, 4, this.far, 'lowpass', 160 + 180 * near, 0.7, 0.25 + 0.35 * near);
    if (near > 0.6) this.noiseBurst(at, 0.12, this.mix, 'lowpass', 2200, 0.7, 0.15 * near);
  }

  /** One beat of the pulse: a muffled drum (falling pitch) and a soft click. */
  private beat(at: number, accent: boolean, level: number): void {
    const g = this.voice('sine', 75, this.mix);
    g.oscs![0]!.frequency.setValueAtTime(accent ? 80 : 72, at);
    g.oscs![0]!.frequency.exponentialRampToValueAtTime(42, at + 0.3);
    this.perc(g, at, 0.7, (accent ? 0.42 : 0.26) * level);
    this.noiseBurst(at, 0.09, this.mix, 'lowpass', 380, 0.7, (accent ? 0.08 : 0.05) * level);
  }

  /** A horn call: brassy saws through a low-pass that opens with each note. */
  private horn(at: number, notes: [number, number][]): void {
    const ctx = this.ctx!;
    let t = at;
    for (const [f, d] of notes) {
      const g = ctx.createGain() as GainNode & { oscs?: OscillatorNode[] };
      g.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 1.5;
      lp.frequency.setValueAtTime(250, t);
      lp.frequency.linearRampToValueAtTime(950, t + 0.4);
      lp.frequency.linearRampToValueAtTime(450, t + d);
      lp.connect(g);
      g.connect(this.far);
      g.oscs = [];
      for (const mult of [1, 1.006, 0.5]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f * mult;
        o.connect(lp);
        g.oscs.push(o);
      }
      this.env(g, t, 0.45, 0.8, 0.075, Math.max(0, d - 0.45));
      t += d;
    }
  }

  /** Morse from the radio: a tone keyed on and off. */
  private morse(at: number, pattern: number[]): void {
    const g = this.voice('sine', 710, this.radio);
    let t = at;
    pattern.forEach((d, i) => {
      if (i % 2 === 0) {
        g.gain.setValueAtTime(0.05, t);
        g.gain.setValueAtTime(0, t + d);
      }
      t += d;
    });
    const o = g.oscs![0]!;
    o.start(at);
    o.stop(t + 0.1);
  }

  /** A snare roll far away: quick noise strokes, growing. */
  private roll(at: number, dur: number): void {
    const n = Math.round(dur * 14);
    for (let i = 0; i < n; i++) {
      const level = 0.015 + 0.08 * (i / n) ** 2;
      this.noiseBurst(at + i / 14, 0.07, this.far, 'highpass', 1800, 0.7, level);
    }
  }

  private loopNoise(to: AudioNode): void {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(0, Math.random() * 1.5);
    s.connect(to);
  }
}

/** A slow sine LFO adding ±`depth` to `param`. */
function lfo(ctx: AudioContext, freq: number, depth: number, param: AudioParam): void {
  const o = ctx.createOscillator();
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = depth;
  o.connect(g);
  g.connect(param);
  o.start();
}

/** A generated reverb impulse: decaying stereo noise, darker towards the end. */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const n = Math.round(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      // A one-pole low-pass that closes with time: the tail loses its high end, as in water.
      const k = 0.6 - 0.5 * x;
      lp += k * (Math.random() * 2 - 1 - lp);
      d[i] = lp * (1 - x) ** 2.5;
    }
  }
  return b;
}
