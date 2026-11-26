import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { Simulation } from '../src/sim/simulation';
import { PERISCOPE_RISING, ViewState, availableViews, cycleView, trainRateFactor } from '../src/ui/views';

describe('views', () => {
  it('cycles only through available views', () => {
    const v = new ViewState();
    v.cycle({ external: true, bridge: false, periscope: false, control: false, cutaway: false });
    expect(v.mode).toBe('external');
    v.cycle({ external: true, bridge: true, periscope: false, control: false, cutaway: false });
    expect(v.mode).toBe('bridge');
    v.cycle({ external: true, bridge: true, periscope: true, control: false, cutaway: false });
    expect(v.mode).toBe('periscope');
    v.cycle({ external: true, bridge: true, periscope: true, control: true, cutaway: true });
    expect(v.mode).toBe('control');
    v.cycle({ external: true, bridge: true, periscope: true, control: true, cutaway: true });
    expect(v.mode).toBe('cutaway');
    v.cycle({ external: true, bridge: true, periscope: true, control: true, cutaway: true });
    expect(v.mode).toBe('external');
  });

  it('the bridge view needs a manned bridge, the periscope view a raised mast', () => {
    const surfaced = new Controller(new Simulation());
    expect(availableViews(surfaced)).toEqual({ external: true, bridge: true, periscope: false, control: true, cutaway: true });
    const dived = new Controller(new Simulation({ depth: 13, designTrim: true }));
    expect(availableViews(dived).bridge).toBe(false);
    dived.sim.actuators.periscope = 1;
    expect(availableViews(dived).periscope).toBe(true);
  });

  it('the crew mans the bridge when the view is chosen on the surface', () => {
    const c = new Controller(new Simulation());
    c.crewTakesAll();
    c.submit({ kind: 'bridge', manned: false }, 'console');
    c.step();
    const v = new ViewState();
    cycleView(c, v, 'keyboard');
    c.step();
    expect(v.mode).toBe('bridge');
    expect(c.bridgeManned).toBe(true);
  });

  it('limits the bridge look and wraps the periscope bearing', () => {
    const v = new ViewState();
    v.set('bridge');
    v.drag(-100000, 100000);
    expect(v.bridgeYaw).toBeCloseTo((160 * Math.PI) / 180);
    expect(v.bridgePitch).toBeCloseTo((40 * Math.PI) / 180);
    v.set('periscope');
    v.trainDir = 1;
    for (let i = 0; i < 100; i++) v.update(0.1); // past the slow start (trainRateFactor)
    const before = v.periscopeBearing;
    for (let i = 0; i < 90; i++) v.update(0.1); // 9 s at the full 40°/s = 360°, wrapped
    expect(v.periscopeBearing).toBeCloseTo(before, 5);
    expect(v.periscopeBearing).toBeGreaterThanOrEqual(0);
    expect(v.periscopeBearing).toBeLessThan(2 * Math.PI);
    v.toggleZoom();
    const cam = v.camera(0, 3);
    expect(cam.mode === 'periscope' && cam.fov).toBe(8);
    const fast = v.camera(6, 3);
    expect(fast.mode === 'periscope' && fast.shake).toBeGreaterThan(0);
  });
});

describe('the bridge during a dive', () => {
  it('is not manned again while the vents are open', () => {
    const c = new Controller(new Simulation());
    c.crewTakesAll();
    c.submit({ kind: 'dive' }, 'keyboard');
    c.step();
    expect(c.bridgeManned).toBe(false);
    const v = new ViewState();
    cycleView(c, v, 'keyboard');
    c.submit({ kind: 'bridge', manned: true }, 'console');
    c.step();
    expect(c.bridgeManned).toBe(false);
    expect(v.mode).not.toBe('bridge');
    expect(c.log.some((e) => e.kind === 'error' && /ventilerna/.test(e.text))).toBe(true);
  });
});

describe('Vy while the periscope is raised', () => {
  it('passing the periscope on its way up says that its view opens by itself', () => {
    const c = new Controller(new Simulation({ depth: 13, neutral: true }));
    c.crewTakesAll();
    c.submit({ kind: 'periscope', up: true }, 'keyboard');
    for (let i = 0; i < 200; i++) c.step(); // 2 s: on its way up (8 s)
    const v = new ViewState();
    cycleView(c, v, 'keyboard');
    expect(v.mode).toBe('control');
    expect(c.log.some((e) => e.text === PERISCOPE_RISING)).toBe(true);
  });
});

describe('training the periscope with the keys', () => {
  it('a tap turns it about half a degree; held, it speeds up to the full rate', () => {
    expect(trainRateFactor(0)).toBeCloseTo(0.1);
    expect(trainRateFactor(2)).toBe(1);
    const v = new ViewState();
    v.set('periscope');
    v.trainDir = 1;
    for (let i = 0; i < 6; i++) v.update(1 / 60); // a 0,1 s tap
    expect((v.periscopeBearing * 180) / Math.PI).toBeGreaterThan(0.2);
    expect((v.periscopeBearing * 180) / Math.PI).toBeLessThan(0.6);
  });
});
