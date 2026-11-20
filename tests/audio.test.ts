import { describe, expect, it } from 'vitest';
import { cueFor } from '../src/audio/director';
import { PROPELLER_BLADES, soundLevels, type AudioInput } from '../src/audio/levels';
import { speechFor } from '../src/audio/voice';
import { Controller } from '../src/control/controller';
import { Simulation } from '../src/sim/simulation';

const KN = 1852 / 3600;

const input = (sim: Simulation, over: Partial<AudioInput> = {}): AudioInput => ({
  t: sim.telemetry(),
  maxPower: sim.cfg.propulsion.maxPower,
  lpBlower: sim.commands.lpBlower,
  view: 'external',
  cameraUnderwater: false,
  conditions: 'day',
  seaHs: 0,
  coastal: true,
  ...over,
});

describe('sound levels', () => {
  it('are silent for a boat lying still on the surface in a calm sea', () => {
    const l = soundLevels(input(new Simulation()));
    expect(l.motor.gain).toBe(0);
    expect(l.propeller.gain).toBe(0);
    expect(l.flow.gain).toBe(0);
    expect(l.vent + l.flood + l.blow + l.pump + l.hydraulics).toBe(0);
  });

  it('the motor, propeller and flow follow the shaft speed and the speed through the water', () => {
    const slow = soundLevels(input(new Simulation({ depth: 50, speed: 4 * KN, designTrim: true })));
    const fast = soundLevels(input(new Simulation({ depth: 50, speed: 15 * KN, designTrim: true })));
    expect(fast.motor.freq).toBeGreaterThan(slow.motor.freq);
    expect(fast.motor.gain).toBeGreaterThan(slow.motor.gain);
    expect(fast.flow.gain).toBeGreaterThan(slow.flow.gain);
    const sim = new Simulation({ depth: 50, speed: 15 * KN, designTrim: true });
    expect(soundLevels(input(sim)).propeller.bladeRate).toBeCloseTo(PROPELLER_BLADES * Math.abs(sim.y[13]!), 6);
  });

  it('cavitation only near the surface at high shaft speed', () => {
    const shallow = new Simulation({ depth: 10, speed: 18 * KN, designTrim: true });
    const deep = new Simulation({ depth: 120, speed: 18 * KN, designTrim: true });
    expect(soundLevels(input(shallow)).cavitation).toBeGreaterThan(0);
    expect(soundLevels(input(deep)).cavitation).toBe(0);
  });

  it('venting, flooding, blowing and pumping are heard only while they happen', () => {
    const c = new Controller(new Simulation());
    c.submit({ kind: 'bridge', manned: false }, 'console');
    c.submit({ kind: 'dive' }, 'console');
    c.step();
    const venting = soundLevels(input(c.sim));
    expect(venting.vent).toBeGreaterThan(0);
    expect(venting.flood).toBeGreaterThan(0);
    for (let i = 0; i < 1000; i++) c.step(); // some water in the tanks to blow out
    c.submit({ kind: 'surface' }, 'console');
    c.submit({ kind: 'compensate', litres: 300 }, 'console');
    c.step();
    const blowing = soundLevels(input(c.sim));
    expect(blowing.vent).toBe(0);
    expect(blowing.blow).toBeGreaterThan(0);
    expect(blowing.pump).toBeGreaterThan(0);
  });

  it('the echo sounder pings faster in shallower water, and not at all in deep water', () => {
    const at = (east: number) => soundLevels(input(new Simulation({ east }))).pingRate;
    expect(at(0)).toBe(0); // 270 m of water
    const sim = new Simulation({ east: 2560 });
    const t = sim.telemetry();
    const l = soundLevels(input(sim, { t: { ...t, depthUnderKeel: 2 } }));
    const l2 = soundLevels(input(sim, { t: { ...t, depthUnderKeel: 8 } }));
    expect(l.pingRate).toBeGreaterThan(l2.pingRate);
  });

  it('the surroundings: wind on the bridge, waves with the sea, muffled under water, gulls by day near land', () => {
    const sim = new Simulation({ sea: 'rough' });
    const bridge = soundLevels(input(sim, { view: 'bridge', seaHs: 3 }));
    const calm = soundLevels(input(sim, { view: 'bridge', seaHs: 0 }));
    expect(bridge.wind).toBeGreaterThan(calm.wind);
    expect(bridge.waves).toBeGreaterThan(calm.waves);
    expect(bridge.gullRate).toBeGreaterThan(0);
    expect(soundLevels(input(sim, { view: 'bridge', conditions: 'night' })).gullRate).toBe(0);
    expect(soundLevels(input(sim, { view: 'bridge', coastal: false })).gullRate).toBe(0);
    const under = soundLevels(input(sim, { cameraUnderwater: true }));
    expect(under.wind).toBe(0);
    expect(under.outsideCutoff).toBeLessThan(1000);
    expect(soundLevels(input(sim, { conditions: 'fog' })).foghornRate).toBeGreaterThan(0);
  });
});

describe('cues and speech', () => {
  it('log lines give the right cues', () => {
    expect(cueFor('Grundstötning! Fart 3,1 knop.')).toBe('grounding');
    expect(cueFor('Vatten över bryggan! Bryggan är utrymd.')).toBe('splash');
    expect(cueFor('Assistent: nödblåsning! Ubåten närmar sig krossdjupet.')).toBe('alarm');
    expect(cueFor('Huvudballasten är full. Ventilerna stängda.')).toBe('clonk');
    expect(cueFor('Mål klart: Hissa periskopet')).toBe('objective');
    expect(cueFor('Back 4 knop, ja')).toBe('telegraph');
    expect(cueFor('Fart 8 knop, ja')).toBe('telegraph');
    expect(cueFor('Fart öka 1 knop, ja')).toBeNull();
    expect(cueFor('Djup 32, ja')).toBeNull();
  });

  it('reads the player\'s orders and alarms, not the assistant\'s routine or typing errors', () => {
    expect(speechFor('Djup 32, ja', 'ack', 'keyboard')).toBe('Djup 32, ja');
    expect(speechFor('Kompensera in 200 liter, ja', 'ack', 'assist')).toBeNull();
    expect(speechFor('Okänt kommando "djupp". Menade du "djup"?', 'error', 'console')).toBeNull();
    expect(speechFor('Grundstötning! Fart 3,1 knop.', 'error')).toBe('Grundstötning');
    expect(speechFor('Mål klart: Hissa periskopet', 'info')).toBe('Mål klart');
    expect(speechFor('Skriv "hjälp" i konsolen för kommandon.', 'info')).toBeNull();
  });
});

describe('ships', () => {
  it('are heard louder when near and when submerged, not beyond the audible range', () => {
    const sub = new Simulation({ depth: 30, designTrim: true });
    const surfaced = new Simulation();
    const at = (sim: Simulation, range: number) => soundLevels(input(sim, { ship: { range, bladeRate: 8 } })).shipNoise.gain;
    expect(at(sub, 500)).toBeGreaterThan(at(sub, 2000));
    expect(at(sub, 500)).toBeGreaterThan(at(surfaced, 500));
    expect(at(sub, 5000)).toBe(0);
    expect(soundLevels(input(sub)).shipNoise.gain).toBe(0);
  });
});
