import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/control/scenarios';
import { GameFlow } from '../src/game/flow';
import { FixedStepLoop } from '../src/game/loop';
import { GameSession, demoSession, freePlaySpec, scenarioSpec } from '../src/game/session';
import { audioInput, overlayState } from '../src/game/wiring';
import { AREA_INFO } from '../src/control/areas';

const free = (area: 'westCoast' | 'atlantic' = 'westCoast', start = 'periscope') =>
  new GameSession(freePlaySpec(area, start, 'day', 'calm', 'simplified', true, 'Skriv "hjälp".')!);

describe('game session', () => {
  it('free play has the area\'s traffic; a scenario only its own', () => {
    expect(free().ctrl.world.vessels.map((v) => v.def.id)).toEqual(AREA_INFO.westCoast.traffic.map((d) => d.id));
    const recce = SCENARIOS.find((s) => s.id === 'ship-recce')!;
    expect(new GameSession(scenarioSpec(recce, 'simplified', true, '')).ctrl.world.vessels.map((v) => v.def.id)).toEqual(['skagerack']);
    const dive = SCENARIOS.find((s) => s.id === 'first-dive')!;
    expect(new GameSession(scenarioSpec(dive, 'simplified', true, '')).ctrl.world.vessels).toHaveLength(0);
  });

  it('logs the start, the mode and where the commands are, in that order', () => {
    const texts = free().ctrl.log.map((e) => e.text);
    expect(texts[0]).toMatch(/periskopdjup/);
    expect(texts[1]).toMatch(/^Förenklad simulering/);
    expect(texts[2]).toBe('Skriv "hjälp".');
  });

  it('"Starta om" gives the same start, in the mode the game is in now', () => {
    const s = free();
    for (let i = 0; i < 500; i++) s.step();
    s.ctrl.setMode('realistic');
    const again = s.restart();
    expect(again.ctrl.options.mode).toBe('realistic');
    expect(Array.from(again.sim.y)).toEqual(Array.from(free().sim.y));
    expect(again.sim.t).toBe(0);
  });

  it('a scenario that allows only one mode starts in it', () => {
    const trim = SCENARIOS.find((s) => s.id === 'trim-drill')!;
    expect(new GameSession(scenarioSpec(trim, 'simplified', true, '')).ctrl.options.mode).toBe('realistic');
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
    const s = new GameSession(scenarioSpec(sound, 'simplified', true, ''));
    const o = overlayState(s, { mode: 'bridge', relative: Math.PI / 2, zoom: 0, fov: 70 });
    expect(o.bearing).toBeCloseTo(20 + 90, 0); // heading 020 + 90° to starboard
    expect(o.waypointBearing).not.toBeNull();
  });
});
