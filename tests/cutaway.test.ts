import { describe, expect, it } from 'vitest';
import { SUBMARINE } from '../src/sim/config/submarine';
import { hullRadius } from '../src/sim/hull';
import type { Vec3 } from '../src/sim/math/vec3';
import { OUTSIDE, interiorItems, itemExtremes, spaceAt, spaces } from '../src/render/interior';
import { tankSamples, waterLevel } from '../src/render/tankLevel';

const cfg = SUBMARINE;
const R = cfg.hull.pressureHullRadius;

describe('interior layout', () => {
  const items = interiorItems(cfg);

  it('has equipment in every compartment and every space outside the pressure hull', () => {
    for (const c of cfg.compartments) expect(items.filter((i) => i.space === c.id).length, c.id).toBeGreaterThan(5);
    for (const id of Object.keys(OUTSIDE)) expect(items.some((i) => i.space === id), id).toBe(true);
  });

  it('keeps everything in a compartment inside the pressure hull and inside its compartment', () => {
    for (const item of items) {
      const c = cfg.compartments.find((x) => x.id === item.space);
      if (!c || item.throughHull) continue;
      for (const p of itemExtremes(item)) {
        expect(p[1] ** 2 + p[2] ** 2, `${item.space} ${item.at.join(',')}`).toBeLessThanOrEqual((R - 0.02) ** 2);
        expect(p[0], `${item.space} x`).toBeGreaterThanOrEqual(c.xRange[0] - 0.01);
        expect(p[0], `${item.space} x`).toBeLessThanOrEqual(c.xRange[1] + 0.01);
      }
    }
  });

  it('keeps the bow and stern equipment inside the outer hull', () => {
    for (const item of items.filter((i) => i.space === 'sonar' || i.space === 'aftPeak')) {
      for (const p of itemExtremes(item)) expect(Math.hypot(p[1], p[2])).toBeLessThan(hullRadius(cfg.hull, p[0]));
    }
  });

  it('stands furniture on its deck: nothing reaches below the floor it is on', () => {
    for (const c of cfg.compartments) {
      const floors = c.decks.map((d) => d.floor);
      for (const item of items.filter((i) => i.space === c.id && !i.throughHull && i.material !== 'deck' && i.material !== 'steel')) {
        const bottom = Math.max(...itemExtremes(item).map((p) => p[2]));
        // Below the lowest floor only the tanks' space; equipment must not sink into a floor.
        expect(floors.some((f) => bottom <= f + 0.01), `${c.id} ${item.material} ${item.at.join(',')}`).toBe(true);
      }
    }
  });

  it('every compartment has a deck, and the two-deck compartments have room to stand', () => {
    for (const c of cfg.compartments) {
      expect(c.decks.length).toBeGreaterThan(0);
      const floors = c.decks.map((d) => d.floor);
      for (let i = 1; i < floors.length; i++) expect(floors[i]! - floors[i - 1]!).toBeGreaterThan(1.7);
      expect(floors[0]! + R).toBeGreaterThan(2.0); // headroom under the top of the hull
    }
  });
});

describe('spaces', () => {
  it('finds the compartment, tank or outside space at a point', () => {
    for (const c of cfg.compartments) expect(spaceAt(cfg, [(c.xRange[0] + c.xRange[1]) / 2, 0, -1])).toBe(c.id);
    for (const t of cfg.tanks) expect(spaceAt(cfg, t.position)).toBe(t.id);
    expect(spaceAt(cfg, [28.5, 0, 0])).toBe('sonar');
    expect(spaceAt(cfg, [-28, 0, 0])).toBe('aftPeak');
    expect(spaceAt(cfg, [cfg.hull.sail.position[0], 0, cfg.hull.sail.position[2]])).toBe('sail');
    expect(spaceAt(cfg, [0, 0, -6])).toBeNull();
    expect(spaceAt(cfg, [0, 10, 0])).toBeNull();
  });

  it('names and describes every space', () => {
    const all = spaces(cfg);
    expect(all.length).toBe(cfg.compartments.length + cfg.tanks.length + Object.keys(OUTSIDE).length);
    for (const s of all) {
      expect(s.name.length).toBeGreaterThan(2);
      expect(s.description.length, s.id).toBeGreaterThan(10);
    }
  });
});

describe('water level in a tank', () => {
  const trim = cfg.tanks.find((t) => t.id === 'trim_fwd')!;
  const mbt = cfg.tanks.find((t) => t.id === 'mbt_fwd')!;
  const UP: Vec3 = [0, 0, -1];
  const below = (samples: Vec3[], up: Vec3, h: number) => samples.filter((p) => p[0] * up[0] + p[1] * up[1] + p[2] * up[2] <= h).length / samples.length;

  it('is level with the fill in an upright box', () => {
    if (trim.shape.type !== 'box') throw new Error('box');
    const s = tankSamples(trim);
    const sz = trim.shape.size[2];
    const bottom = -(trim.position[2] + sz / 2); // height of the floor along up
    for (const fill of [0.1, 0.3, 0.5, 0.9]) expect(waterLevel(s, UP, fill)).toBeCloseTo(bottom + fill * sz, 1);
    expect(waterLevel(s, UP, 0)).toBeLessThan(bottom + 0.05);
    expect(waterLevel(s, UP, 1)).toBeGreaterThan(bottom + sz - 0.05);
  });

  it('fills the right fraction of a tilted cylinder (the boat 20° bow down, 10° heel)', () => {
    const s = tankSamples(mbt);
    const p = (-20 * Math.PI) / 180;
    const r = (10 * Math.PI) / 180;
    // True up in the body frame for pitch p and roll r (FRD).
    const up: Vec3 = [Math.sin(p), -Math.cos(p) * Math.sin(r), -Math.cos(p) * Math.cos(r)];
    for (const fill of [0.2, 0.5, 0.8]) expect(below(s, up, waterLevel(s, up, fill))).toBeCloseTo(fill, 2);
  });
});

describe('information box', () => {
  it('gives a title, a description and live values for every space', async () => {
    const { Simulation } = await import('../src/sim/simulation');
    const { cutawayInfo, spaceCentre } = await import('../src/ui/cutawayInfo');
    const sim = new Simulation({ depth: 50, designTrim: true });
    sim.requestTrimTransfer(0.2);
    sim.step();
    const t = sim.telemetry();
    for (const s of spaces(cfg)) {
      const info = cutawayInfo(cfg, s.id, t, { bridgeManned: false })!;
      expect(info.title).toBe(s.name);
      expect(info.lines.length, s.id).toBeGreaterThan(0);
      expect(spaceCentre(cfg, s.id), s.id).toBeTypeOf('number');
    }
    expect(cutawayInfo(cfg, 'control', t, { bridgeManned: false })!.lines.join(' ')).toMatch(/6,0 bar \(50 m djup\)/);
    expect(cutawayInfo(cfg, 'trim_fwd', t, { bridgeManned: false })!.lines.join(' ')).toMatch(/Trimpumpen går: \d+ l kvar förut/);
    expect(cutawayInfo(cfg, 'nothing', t, { bridgeManned: false })).toBeNull();
  });
});
