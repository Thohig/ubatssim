import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/control/scenarios';
import { GameFlow } from '../src/game/flow';
import { FixedStepLoop } from '../src/game/loop';
import { DEMO_DEPTH, GameSession, demoSession, freePlaySpec, scenarioSpec } from '../src/game/session';
import { audioInput, overlayState } from '../src/game/wiring';
import { AREA_INFO } from '../src/control/areas';

const free = (area: 'westCoast' | 'atlantic' = 'westCoast', start = 'periscope') =>
  new GameSession(freePlaySpec(area, start, 'day', 'calm', 'Styr med kontrollerna.')!);

describe('game session', () => {
  it('free play has the area\'s traffic; a scenario only its own', () => {
    expect(free().ctrl.world.vessels.map((v) => v.def.id)).toEqual(AREA_INFO.westCoast.traffic.map((d) => d.id));
    const recce = SCENARIOS.find((s) => s.id === 'ship-recce')!;
    expect(new GameSession(scenarioSpec(recce, '')).ctrl.world.vessels.map((v) => v.def.id)).toEqual(['skagerack']);
    const dive = SCENARIOS.find((s) => s.id === 'first-dive')!;
    expect(new GameSession(scenarioSpec(dive, '')).ctrl.world.vessels).toHaveLength(0);
  });

  it('free play without corvettes has only the civil traffic', () => {
    const baltic = (patrols: boolean) => new GameSession(freePlaySpec('baltic', 'periscope', 'day', 'calm', '', patrols)!);
    expect(baltic(true).ctrl.world.vessels.some((v) => v.def.kind === 'patrol')).toBe(true);
    const peaceful = baltic(false).ctrl.world.vessels;
    expect(peaceful.some((v) => v.def.kind === 'patrol')).toBe(false);
    expect(peaceful.length).toBe(AREA_INFO.baltic.traffic.length - 1);
    // "Starta om" keeps the choice.
    expect(baltic(false).restart().ctrl.world.vessels.some((v) => v.def.kind === 'patrol')).toBe(false);
  });

  it('logs the start and where the controls are, in that order', () => {
    const texts = free().ctrl.log.map((e) => e.text);
    expect(texts[0]).toMatch(/periskopdjup/);
    expect(texts[1]).toBe('Styr med kontrollerna.');
  });

  it('every game starts with the crew handling everything; "Starta om" starts over, crew included', () => {
    const s = free();
    expect(Object.values(s.ctrl.duties()).every((d) => d)).toBe(true);
    s.ctrl.submit({ kind: 'crew', system: 'all', crew: false }, 'touch');
    for (let i = 0; i < 500; i++) s.step();
    expect(s.ctrl.duties().trim).toBe(false);
    const again = s.restart();
    expect(Object.values(again.ctrl.duties()).every((d) => d)).toBe(true);
    expect(Array.from(again.sim.y)).toEqual(Array.from(free().sim.y));
    expect(again.sim.t).toBe(0);
  });

  it('a scenario\'s locks apply from the start and are logged', () => {
    const trim = SCENARIOS.find((s) => s.id === 'trim-drill')!;
    const g = new GameSession(scenarioSpec(trim, ''));
    expect(g.ctrl.duties()).toMatchObject({ depth: false, trim: false, heading: true });
    expect(g.ctrl.log.some((e) => /Du sköter djup och trim själv/.test(e.text))).toBe(true);
  });

  it('the demo cruises north at 5 knots on autopilot', () => {
    const d = demoSession();
    for (let i = 0; i < 6000; i++) d.step();
    expect(d.ctrl.ap.heading && d.ctrl.ap.speed).toBe(true);
    expect(d.sim.kinematics().u).toBeGreaterThan(2);
  });
});

describe('fixed-step loop', () => {
  it('runs one step per 10 ms, times the compression', () => {
    const loop = new FixedStepLoop();
    let n = 0;
    expect(loop.advance(0.05, 1, true, () => n++)).toBe(5);
    expect(loop.advance(0.05, 4, true, () => n++)).toBe(20);
    expect(n).toBe(25);
    expect(loop.advance(0.05, 1, false, () => n++)).toBe(0);
  });

  it('caps the steps per frame and drops the backlog instead of stalling', () => {
    const loop = new FixedStepLoop(25);
    let n = 0;
    expect(loop.advance(0.25, 1, true, () => n++)).toBe(25); // 0.25 s would be 25 steps: exactly the cap
    expect(loop.advance(10, 1, true, () => n++)).toBe(25); // a 10 s gap counts as 0.25 s
    expect(loop.advance(0.005, 1, true, () => n++)).toBe(0); // the backlog was dropped
  });

  it('×16 runs sixteen times real time at a normal frame rate, but at most 100 steps in one frame', () => {
    const loop = new FixedStepLoop(25);
    let n = 0;
    for (let i = 0; i < 30; i++) loop.advance(1 / 30, 16, true, () => n++);
    expect(n).toBeGreaterThanOrEqual(1599);
    expect(n).toBeLessThanOrEqual(1601);
    expect(loop.advance(0.25, 16, true, () => n++)).toBe(100);
  });
});

describe('game flow', () => {
  it('allows the transitions of the game and refuses the rest', () => {
    const f = new GameFlow();
    const seen: string[] = [];
    f.onChange((s) => seen.push(s));
    expect(f.go('ended')).toBe(false); // a scenario cannot end from the menu
    expect(f.go('playing')).toBe(true);
    expect(f.go('menu')).toBe(false); // only from pause or the result screen
    expect(f.go('paused')).toBe(true);
    expect(f.simRunning).toBe(false);
    expect(f.go('playing')).toBe(true);
    expect(f.go('ended')).toBe(true);
    expect(f.simRunning).toBe(true);
    expect(f.go('menu')).toBe(true);
    expect(f.inGame).toBe(false);
    expect(seen).toEqual(['playing', 'paused', 'playing', 'ended', 'menu']);
  });
});

describe('wiring', () => {
  it('feeds the sound: no gulls on the Atlantic, the nearest ship', () => {
    expect(audioInput(free('atlantic', 'surface'), 'bridge', false).coastal).toBe(false);
    const a = audioInput(free(), 'external', true);
    expect(a.coastal).toBe(true);
    expect(a.ship!.range).toBeGreaterThan(0);
  });

  it('gives the overlay the true bearing of the look and the buoy', () => {
    const sound = SCENARIOS.find((s) => s.id === 'sound-transit')!;
    const s = new GameSession(scenarioSpec(sound, ''));
    const o = overlayState(s, { mode: 'bridge', relative: Math.PI / 2, zoom: 0, fov: 70 });
    expect(o.bearing).toBeCloseTo(20 + 90, 0); // heading 020 + 90° to starboard
    expect(o.waypointBearing).not.toBeNull();
  });
});

describe('effects input', () => {
  it('the main ballast tanks, the propeller, and mast heads only when raised', async () => {
    const { effectsInput } = await import('../src/game/wiring');
    const { GameSession } = await import('../src/game/session');
    const s = new GameSession({ initial: { depth: 13, neutral: true }, scenario: null, intro: '', conditions: 'day', helpHint: '' });
    let e = effectsInput(s);
    expect(e.tanks).toHaveLength(2);
    expect(e.periscopeHead).toBeNull();
    expect(e.snorkelHead).toBeNull();
    s.ctrl.submit({ kind: 'snorkel', up: true }, 'keyboard');
    for (let i = 0; i < 1100; i++) s.step();
    e = effectsInput(s);
    expect(e.snorkelHead).not.toBeNull();
    expect(e.propeller).toEqual(s.sim.cfg.propulsion.position);
  });

  it('every area has its own water look', async () => {
    const { WATER_LOOK } = await import('../src/render/environment');
    const { AREA_IDS } = await import('../src/sim/config/areas');
    for (const a of AREA_IDS) expect(WATER_LOOK[a]).toBeDefined();
    expect(WATER_LOOK.baltic.fog).toBeGreaterThan(WATER_LOOK.atlantic.fog);
  });
});

describe('the demo behind the start page', () => {
  it('the demo behind the menu: dived at 16 m in daylight, gliding slowly north, no corvette and no charges', () => {
    const d = demoSession();
    expect(d.conditions).toBe('day');
    expect(d.ctrl.world.vessels.some((x) => x.def.kind === 'patrol')).toBe(false);
    for (let i = 0; i < 6000; i++) d.step();
    const k = d.sim.kinematics();
    expect(Math.abs(k.depth - DEMO_DEPTH)).toBeLessThan(2);
    expect(k.u / (1852 / 3600)).toBeGreaterThan(3);
    expect(k.u / (1852 / 3600)).toBeLessThan(5);
    expect(d.ctrl.world.charges).toHaveLength(0);
    expect(d.ctrl.blasts).toHaveLength(0);
  });
});

describe('expert mode', () => {
  it('off, the crew always manoeuvres and hand orders are refused; on, the player may take over', () => {
    const g = free();
    g.setExpert(false);
    g.ctrl.submit({ kind: 'rudder', angle: 10 }, 'touch');
    g.step();
    expect(g.ctrl.ap.heading).toBe(true);
    expect(g.ctrl.log.some((e) => /Expertläge/.test(e.text))).toBe(true);
    g.setExpert(true);
    g.ctrl.submit({ kind: 'rudder', angle: 10 }, 'touch');
    g.step();
    expect(g.ctrl.ap.heading).toBe(false);
    // Off again: the crew takes the rudder back.
    g.setExpert(false);
    g.step();
    expect(g.ctrl.ap.heading).toBe(true);
  });

  it('a scenario that makes the player steer is played in expert mode', () => {
    const trim = SCENARIOS.find((s) => s.id === 'trim-drill')!;
    const g = new GameSession(scenarioSpec(trim, ''));
    expect(g.expertForced).toBe(true);
    g.setExpert(false);
    expect(g.ctrl.options.expert).toBe(true);
    const dive = SCENARIOS.find((s) => s.id === 'first-dive')!;
    expect(new GameSession(scenarioSpec(dive, '')).expertForced).toBe(false);
  });
});
