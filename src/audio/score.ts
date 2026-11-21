/**
 * The start page's music as a score: a generative timeline of sections and
 * events, without sound. Pure (a random function is passed in), so it can
 * be tested in Node; menuMusic.ts plays it with Web Audio.
 *
 * Calm and deep, the sea rather than the war, in D Aeolian (natural minor:
 * D E F G A B♭ C). Two sections follow each other, without a loop:
 *   calm  the drone, slow chords (Dm B♭ F C), distant sonar pings, the hull
 *         creaking, a radio far away;
 *   deep  a soft, slow pulse like a heartbeat comes in and grows a little,
 *         a long horn call, the chords lower.
 * Then calm again. Each section has its own levels for the continuous layers
 * (drone, chords, pulse, radio), which the player glides between.
 */

export type SectionKind = 'calm' | 'deep';

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
  /** One beat of the drum pulse; `level` 0…1. */
  | { t: number; kind: 'beat'; accent: boolean; level: number }
  /** A horn call: [frequency Hz, duration s] in turn. */
  | { t: number; kind: 'horn'; notes: [number, number][] }
  /** Morse from the radio: on/off durations [s], starting with a tone. */
  | { t: number; kind: 'morse'; pattern: number[] };

/** D1 [Hz]; every note is D1 · 2^(n/12). */
export const ROOT = 36.708;
/** Semitones above D of the D Aeolian scale (natural minor). */
export const SCALE = [0, 2, 3, 5, 7, 8, 10] as const;
export const note = (semitones: number): number => ROOT * 2 ** (semitones / 12);

/** Chords as semitones above D3 (24 above D1); all in the scale. */
const DM = [0, 3, 7];
const BB = [-4, 0, 3];
const FM = [3, 7, 10];
const CM = [-2, 2, 5];
const GM = [-7, -4, 0];
const PROGRESSIONS: Record<SectionKind, number[][]> = {
  calm: [DM, BB, FM, CM],
  deep: [DM, GM, BB, CM],
};

/** Original horn calls, semitones above D2 (12 above D1): long and falling, in the scale. */
const HORN_CALLS: [number, number][][] = [
  [[7, 1.8], [5, 1.2], [3, 1.2], [0, 3.6]],
  [[0, 1.4], [2, 1.4], [3, 2.6], [2, 3.2]],
  [[10, 1.6], [7, 1.2], [5, 1.2], [0, 3.6]],
];

const LEVELS: Record<SectionKind, Levels> = {
  calm: { drone: 0.8, pad: 0.75, pulse: 0, radio: 0.3 },
  deep: { drone: 0.95, pad: 0.65, pulse: 0.35, radio: 0.25 },
};
/** Section length [s]: base + up to `spread` more. */
const LENGTH: Record<SectionKind, [number, number]> = { calm: [60, 25], deep: [45, 20] };
const NEXT: Record<SectionKind, SectionKind> = { calm: 'deep', deep: 'calm' };
/** The pulse in the deep section: from this level to `PULSE_TOP`, never loud. */
const PULSE_START = 0.15;
const PULSE_TOP = 0.45;

/** Seconds per chord (they overlap by the release). */
const CHORD_EVERY = 13;
/** Seconds per beat of the pulse (50 bpm, a resting heartbeat). */
const BEAT = 1.2;

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
  private kind: SectionKind = 'deep'; // the first section is calm

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
    for (let t = start + this.between(4, 12); t < end; t += this.between(20, 40)) {
      ev.push({ t, kind: 'ping', freq: note(this.pick([67, 72])) });
    }
    for (let t = start + this.between(6, 15); t < end; t += this.between(15, 30)) ev.push({ t, kind: 'creak' });
    // Morse groups from the radio.
    for (let t = start + this.between(8, 20); t < end - 4; t += this.between(kind === 'calm' ? 22 : 14, kind === 'calm' ? 35 : 24)) {
      const word = Array.from({ length: 3 + Math.floor(this.rand() * 3) }, () => this.pick(LETTERS)).join('');
      ev.push({ t, kind: 'morse', pattern: morse(word) });
    }
    if (kind === 'deep') {
      // The pulse: soft, growing a little through the section, an accent every fourth beat.
      for (let t = start, i = 0; t < end; t += BEAT, i++) {
        const level = PULSE_START + (PULSE_TOP - PULSE_START) * ((t - start) / (end - start));
        ev.push({ t, kind: 'beat', accent: i % 4 === 0, level });
      }
      // One long horn call, in the middle.
      const call = this.pick(HORN_CALLS);
      ev.push({ t: start + this.between(0.35, 0.55) * (end - start), kind: 'horn', notes: call.map(([n, d]) => [note(n + 12), d] as [number, number]) });
    }
    ev.sort((a, b) => a.t - b.t);
    // Keep the queue in time order (the last section's chords may still be after this start).
    this.queue = [...this.queue, ...ev].sort((a, b) => a.t - b.t);
  }
}
