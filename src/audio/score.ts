/**
 * The start page's music as a score: a generative timeline of sections and
 * events, without sound. Pure (a random function is passed in), so it can
 * be tested in Node; menuMusic.ts plays it with Web Audio.
 *
 * Dark and threatening, in D Phrygian (D E♭ F G A B♭ C: the half step D–E♭
 * is the threat). Three sections follow each other, without a loop:
 *   calm    the drone, slow chords, distant sonar pings, the hull creaking,
 *           a radio far away;
 *   threat  a muffled drum pulse comes in and grows, a horn call;
 *   attack  depth charges in series, the pulse at full strength, a snare roll.
 * Then calm again. Each section has its own levels for the continuous layers
 * (drone, chords, pulse, radio), which the player glides between.
 */

export type SectionKind = 'calm' | 'threat' | 'attack';

/** Levels 0…1 of the continuous layers in a section. */
export interface Levels {
  drone: number;
  pad: number;
  pulse: number;
  radio: number;
}

export interface Section {
  kind: SectionKind;
  start: number;
  end: number;
  levels: Levels;
}

export type MusicEvent =
  | { t: number; kind: 'section'; section: Section }
  /** A chord: frequencies [Hz], held `dur` seconds (slow attack and release). */
  | { t: number; kind: 'chord'; notes: number[]; dur: number }
  /** A sub-bass swell under the drone. */
  | { t: number; kind: 'swell' }
  /** A distant sonar ping (in the key) and its echo. */
  | { t: number; kind: 'ping'; freq: number }
  | { t: number; kind: 'creak' }
  /** A depth charge far away: `distance` 0 (near) … 1 (far). */
  | { t: number; kind: 'charge'; distance: number }
  /** One beat of the drum pulse; `level` 0…1. */
  | { t: number; kind: 'beat'; accent: boolean; level: number }
  /** A horn call: [frequency Hz, duration s] in turn. */
  | { t: number; kind: 'horn'; notes: [number, number][] }
  /** Morse from the radio: on/off durations [s], starting with a tone. */
  | { t: number; kind: 'morse'; pattern: number[] }
  | { t: number; kind: 'roll'; dur: number };

/** D1 [Hz]; every note is D1 · 2^(n/12). */
export const ROOT = 36.708;
/** Semitones above D of the D Phrygian scale. */
export const SCALE = [0, 1, 3, 5, 7, 8, 10] as const;
export const note = (semitones: number): number => ROOT * 2 ** (semitones / 12);

/** Chords as semitones above D3 (24 above D1); all in the scale. */
const DM = [0, 3, 7];
const EB = [1, 5, 8];
const CM = [-2, 1, 5];
const GM = [-7, -4, 0];
const PROGRESSIONS: Record<SectionKind, number[][]> = {
  calm: [DM, EB, DM, GM],
  threat: [DM, EB, CM, DM],
  attack: [DM, EB, DM, EB],
};

/** Original horn calls, semitones above D2 (12 above D1): falling, in the scale. */
const HORN_CALLS: [number, number][][] = [
  [[7, 1.6], [3, 1.1], [0, 3.2]],
  [[0, 1.2], [1, 2.4], [0, 3]],
  [[10, 1.4], [8, 1], [7, 1], [0, 3.4]],
];

const LEVELS: Record<SectionKind, Levels> = {
  calm: { drone: 0.9, pad: 0.7, pulse: 0, radio: 0.35 },
  threat: { drone: 1, pad: 0.8, pulse: 0.6, radio: 0.5 },
  attack: { drone: 1, pad: 0.55, pulse: 1, radio: 0.6 },
};
/** Section length [s]: base + up to `spread` more. */
const LENGTH: Record<SectionKind, [number, number]> = { calm: [60, 25], threat: [45, 20], attack: [35, 15] };
const NEXT: Record<SectionKind, SectionKind> = { calm: 'threat', threat: 'attack', attack: 'calm' };

/** Seconds per chord (they overlap by the release). */
const CHORD_EVERY = 13;
/** Seconds per drum beat (60 bpm). */
const BEAT = 1;

const MORSE: Record<string, string> = {
  A: '.-', D: '-..', E: '.', K: '-.-', N: '-.', O: '---', R: '.-.', S: '...', T: '-', U: '..-', V: '...-',
};
const DOT = 0.08;

/** A word in Morse as on/off durations, starting with a tone. */
export function morse(word: string): number[] {
  const out: number[] = [];
  [...word].forEach((ch, i) => {
    if (i > 0) out[out.length - 1] = 3 * DOT; // gap between letters
    for (const s of MORSE[ch] ?? '') out.push(s === '.' ? DOT : 3 * DOT, DOT);
  });
  return out.slice(0, -1);
}
/** Five-letter groups, as a cipher sounds. */
const LETTERS = Object.keys(MORSE);

/** Small deterministic random generator (mulberry32), for tests and for a fixed seed. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Score {
  private queue: MusicEvent[] = [];
  private sectionEnd = 0;
  private kind: SectionKind = 'attack'; // the first section is calm

  constructor(private readonly rand: () => number) {}

  /** The events with t < `until` not yet taken, in time order. */
  take(until: number): MusicEvent[] {
    while (this.sectionEnd <= until) this.compose();
    const out: MusicEvent[] = [];
    while (this.queue.length && this.queue[0]!.t < until) out.push(this.queue.shift()!);
    return out;
  }

  private between(a: number, b: number): number {
    return a + this.rand() * (b - a);
  }

  private pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rand() * xs.length)]!;
  }

  /** Writes the next section's events into the queue. */
  private compose(): void {
    const kind = NEXT[this.kind];
    this.kind = kind;
    const start = this.sectionEnd;
    const [base, spread] = LENGTH[kind];
    const end = start + base + this.rand() * spread;
    this.sectionEnd = end;
    const section: Section = { kind, start, end, levels: LEVELS[kind] };
    const ev: MusicEvent[] = [{ t: start, kind: 'section', section }];

    // Chords, overlapping into the next section by their release.
    const prog = PROGRESSIONS[kind];
    for (let t = start, i = 0; t < end; t += CHORD_EVERY, i++) {
      ev.push({ t, kind: 'chord', notes: prog[i % prog.length]!.map((n) => note(n + 24)), dur: CHORD_EVERY + 4 });
    }
    // Sub-bass swells.
    for (let t = start + this.between(2, 6); t < end; t += this.between(8, 12)) ev.push({ t, kind: 'swell' });
    // Sonar pings: A5 or D6, now and then.
    for (let t = start + this.between(4, 12); t < end; t += this.between(kind === 'attack' ? 14 : 20, kind === 'attack' ? 24 : 40)) {
      ev.push({ t, kind: 'ping', freq: note(this.pick([67, 72])) });
    }
    for (let t = start + this.between(6, 15); t < end; t += this.between(15, 30)) ev.push({ t, kind: 'creak' });
    // Morse groups from the radio.
    for (let t = start + this.between(8, 20); t < end - 4; t += this.between(kind === 'calm' ? 22 : 14, kind === 'calm' ? 35 : 24)) {
      const word = Array.from({ length: 3 + Math.floor(this.rand() * 3) }, () => this.pick(LETTERS)).join('');
      ev.push({ t, kind: 'morse', pattern: morse(word) });
    }
    if (kind === 'threat' || kind === 'attack') {
      // The pulse: grows through the threat, full in the attack, an accent every fourth beat.
      for (let t = start, i = 0; t < end; t += BEAT, i++) {
        const level = kind === 'threat' ? 0.25 + 0.75 * ((t - start) / (end - start)) : 1;
        ev.push({ t, kind: 'beat', accent: i % 4 === 0, level });
      }
      // Horn calls: two in the threat, one in the attack.
      const calls = kind === 'threat' ? [0.25, 0.7] : [0.15];
      for (const f of calls) {
        const call = this.pick(HORN_CALLS);
        ev.push({ t: start + f * (end - start), kind: 'horn', notes: call.map(([n, d]) => [note(n + 12), d] as [number, number]) });
      }
    }
    if (kind === 'attack') {
      // Depth charges in series of 3–4, a few seconds apart, with quiet between the series.
      for (let t = start + this.between(3, 8); t < end - 3; ) {
        const n = 3 + Math.floor(this.rand() * 2);
        const distance = this.rand();
        for (let k = 0; k < n && t < end; k++) {
          ev.push({ t, kind: 'charge', distance: Math.min(1, distance + this.between(-0.1, 0.1)) });
          t += this.between(3, 6);
        }
        t += this.between(8, 14);
      }
      ev.push({ t: start + this.between(0.3, 0.6) * (end - start), kind: 'roll', dur: this.between(2, 3.5) });
    }
    ev.sort((a, b) => a.t - b.t);
    // Keep the queue in time order (the last section's chords may still be after this start).
    this.queue = [...this.queue, ...ev].sort((a, b) => a.t - b.t);
  }
}
