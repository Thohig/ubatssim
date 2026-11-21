import { describe, expect, it } from 'vitest';
import { ROOT, SCALE, Score, morse, seeded, type MusicEvent, type Section } from '../src/audio/score';

/** Semitones above D of a frequency, as a pitch class 0…11. */
const pitchClass = (f: number) => ((Math.round(12 * Math.log2(f / ROOT)) % 12) + 12) % 12;
const inScale = (f: number) => (SCALE as readonly number[]).includes(pitchClass(f));

function score(seed: number, seconds: number): MusicEvent[] {
  const s = new Score(seeded(seed));
  const out: MusicEvent[] = [];
  // Taken in small steps, as the player does.
  for (let t = 0.5; t <= seconds; t += 0.5) out.push(...s.take(t));
  return out;
}

describe('the start page score', () => {
  const ev = score(7, 1200);
  const sections = ev.flatMap((e) => (e.kind === 'section' ? [e.section] : []));
  const within = (e: MusicEvent, s: Section) => e.t >= s.start && e.t < s.end;
  const sectionOf = (e: MusicEvent) => sections.find((s) => within(e, s))!;

  it('calm and deep follow each other, each within its length', () => {
    expect(sections[0]!.kind).toBe('calm');
    sections.forEach((s, i) => {
      expect(s.kind).toBe((['calm', 'deep'] as const)[i % 2]);
      const len = s.end - s.start;
      expect(len).toBeGreaterThanOrEqual({ calm: 60, deep: 45 }[s.kind]);
      expect(len).toBeLessThanOrEqual({ calm: 85, deep: 65 }[s.kind]);
      if (i > 0) expect(s.start).toBe(sections[i - 1]!.end);
    });
    expect(sections.length).toBeGreaterThan(8);
  });

  it('events come in time order, each once', () => {
    for (let i = 1; i < ev.length; i++) expect(ev[i]!.t).toBeGreaterThanOrEqual(ev[i - 1]!.t);
    expect(new Set(ev).size).toBe(ev.length);
  });

  it('every note is in D Aeolian (natural minor)', () => {
    for (const e of ev) {
      if (e.kind === 'chord') for (const f of e.notes) expect(inScale(f), `chord ${f}`).toBe(true);
      if (e.kind === 'horn') for (const [f] of e.notes) expect(inScale(f), `horn ${f}`).toBe(true);
      if (e.kind === 'ping') expect(inScale(e.freq)).toBe(true);
    }
  });

  it('nothing warlike: no depth charges and no snare roll', () => {
    const kinds = new Set(ev.map((e) => e.kind as string));
    expect(kinds.has('charge')).toBe(false);
    expect(kinds.has('roll')).toBe(false);
  });

  it('the pulse only in the deep section, soft and growing a little; one horn call there', () => {
    for (const e of ev) {
      if (e.kind !== 'beat' && e.kind !== 'horn') continue;
      expect(sectionOf(e).kind).toBe('deep');
    }
    const deep = sections.filter((s) => s.kind === 'deep').slice(0, -1);
    const beats = ev.filter((e): e is Extract<MusicEvent, { kind: 'beat' }> => e.kind === 'beat' && within(e, deep[0]!));
    expect(beats[0]!.level).toBeLessThan(0.2);
    expect(beats.at(-1)!.level).toBeGreaterThan(0.35);
    expect(Math.max(...ev.flatMap((e) => (e.kind === 'beat' ? [e.level] : [])))).toBeLessThanOrEqual(0.45);
    for (const s of deep) expect(ev.filter((e) => e.kind === 'horn' && within(e, s))).toHaveLength(1);
  });

  it('pings and creaks in every section', () => {
    for (const s of sections.slice(0, -1)) {
      expect(ev.some((e) => e.kind === 'ping' && within(e, s)), s.kind).toBe(true);
    }
  });

  it('the same seed gives the same score; another seed another', () => {
    expect(score(7, 600)).toEqual(score(7, 600));
    expect(score(8, 600)).not.toEqual(score(7, 600));
  });

  it('Morse: SOS is three short, three long, three short', () => {
    expect(morse('SOS')).toEqual([0.08, 0.08, 0.08, 0.08, 0.08, 0.24, 0.24, 0.08, 0.24, 0.08, 0.24, 0.24, 0.08, 0.08, 0.08, 0.08, 0.08]);
  });
});
