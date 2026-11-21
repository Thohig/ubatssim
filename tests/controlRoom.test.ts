// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ControlRoomFeed } from '../src/game/controlRoomFeed';
import { freePlaySpec, GameSession } from '../src/game/session';
import { bodyToLocal } from '../src/render/coords';
import { createControlRoom } from '../src/render/controlRoom';
import { ALARM_TIME, LOOK_YAW, STATION_NAME, STATION_ORDER, alarmFor, controlStations, screenFaces, shakeFor } from '../src/render/controlRoom.data';
import { shortName } from '../src/render/controlScreens';
import { interiorItems } from '../src/render/interior';
import { SUBMARINE } from '../src/sim/config/submarine';
import type { Vec3 } from '../src/sim/math/vec3';
import { ViewState } from '../src/ui/views';

const cfg = SUBMARINE;
const room = cfg.compartments.find((c) => c.id === 'control')!;
const stations = controlStations(cfg);
const free = (conditions: 'day' | 'night' = 'day', start = 'periscope') => new GameSession(freePlaySpec('westCoast', start, conditions, 'calm', '')!);

/** The look direction of a station in the body frame (yaw to starboard, pitch up). */
const lookDir = (yaw: number, pitch: number): Vec3 => [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch)];

describe('control room stations', () => {
  it('in their order, with their names', () => {
    expect(stations.map((s) => s.id)).toEqual([...STATION_ORDER]);
    for (const s of stations) expect(s.name).toBe(STATION_NAME[s.id]);
  });

  it('every eye stands in the room, at eye height over the upper deck, clear of the hull and of the equipment', () => {
    const floor = room.decks[0]!.floor;
    const R = cfg.hull.pressureHullRadius;
    const items = interiorItems(cfg).filter((i) => i.space === 'control');
    for (const s of stations) {
      const [x, y, z] = s.eye;
      expect(x, s.id).toBeGreaterThan(room.xRange[0] + 0.3);
      expect(x, s.id).toBeLessThan(room.xRange[1] - 0.3);
      expect(floor - z, s.id).toBeGreaterThan(1.4);
      expect(floor - z, s.id).toBeLessThan(1.9);
      expect(Math.hypot(y, z), s.id).toBeLessThan(R - 0.4);
      // Standing on free deck: nothing between the deck and the eye where the body stands (the floor plates aside).
      for (const it of items) {
        if (it.material === 'deck') continue;
        const d: Vec3 = [x - it.at[0], y - it.at[1], z - it.at[2]];
        let footprint: boolean;
        let half: number;
        if (it.shape.type === 'box') {
          footprint = Math.abs(d[0]) < it.shape.size[0] / 2 + 0.2 && Math.abs(d[1]) < it.shape.size[1] / 2 + 0.2;
          half = it.shape.size[2] / 2;
        } else if (it.shape.axis === 'z') {
          footprint = Math.hypot(d[0], d[1]) < it.shape.radius + 0.2;
          half = it.shape.length / 2;
        } else {
          const a = it.shape.axis === 'x' ? 0 : 1;
          footprint = Math.abs(d[a]!) < it.shape.length / 2 && Math.abs(d[1 - a]!) < it.shape.radius + 0.2;
          half = it.shape.radius;
        }
        // Overhead things (above the eye) and the lower deck's (under the floor) are no obstacle.
        const inTheWay = it.at[2] + half > z - 0.1 && it.at[2] - half < floor - 0.05;
        expect(footprint && inTheWay, `${s.id} stands in ${JSON.stringify(it.at)}`).toBe(false);
      }
    }
  });

  it('a station with a screen looks at it, and the screen faces the eye', () => {
    const faces = screenFaces(cfg);
    for (const s of stations) {
      if (!s.panel) continue;
      const f = faces.find((x) => x.panel === s.panel)!;
      const to: Vec3 = [f.center[0] - s.eye[0], f.center[1] - s.eye[1], f.center[2] - s.eye[2]];
      const len = Math.hypot(...to);
      const look = lookDir(s.yaw, s.pitch);
      const cos = (to[0] * look[0] + to[1] * look[1] + to[2] * look[2]) / len;
      expect(Math.acos(cos), s.id).toBeLessThan(0.15);
      // The face's normal (right × up) points back towards the eye.
      const n: Vec3 = [f.right[1] * f.up[2] - f.right[2] * f.up[1], f.right[2] * f.up[0] - f.right[0] * f.up[2], f.right[0] * f.up[1] - f.right[1] * f.up[0]];
      expect(n[0] * to[0] + n[1] * to[1] + n[2] * to[2], s.id).toBeLessThan(0);
      expect(len, s.id).toBeLessThan(2.6);
    }
    // Every screen belongs to a station.
    expect(faces.map((f) => f.panel).sort()).toEqual(stations.flatMap((s) => (s.panel ? [s.panel] : [])).sort());
  });
});

describe('the room and the log', () => {
  it('a depth charge shakes after its distance, a grounding hard; other lines not', () => {
    expect(shakeFor('Sjunkbomb 15 m från skrovet!')).toBe(1);
    expect(shakeFor('Sjunkbomb 60 m från skrovet.')).toBeCloseTo(0.5);
    expect(shakeFor('Sjunkbomb 900 m från skrovet.')).toBeCloseTo(0.08);
    expect(shakeFor('Grundstötning!')).toBeGreaterThan(0.5);
    expect(shakeFor('Fart 4 knop, ja')).toBe(0);
  });

  it('the lines that sound the alarm turn the alarm lamp', () => {
    expect(alarmFor('Läckage i Manöverrum.')).toBe(true);
    expect(alarmFor('Grundstötning!')).toBe(true);
    expect(alarmFor('Kurs 090, ja')).toBe(false);
  });

  it('tank names fit their columns on the ballast panel', () => {
    for (const t of cfg.tanks) expect(shortName(t.name).length).toBeLessThanOrEqual(10);
    expect(shortName('Kompenseringstank')).toBe('Komp.');
  });
});

describe('the view', () => {
  it('←/→ go round the stations; a station looks its own way; the look is limited', () => {
    const v = new ViewState();
    v.set('control');
    expect(v.stationName()).toBe('Periskopet');
    v.nextStation(-1);
    expect(v.stationName()).toBe('Sonarhytten');
    v.nextStation(1);
    v.nextStation(1);
    expect(v.stationName()).toBe('Pulpeten');
    v.drag(-10000, 0);
    expect(v.controlYaw).toBeCloseTo(LOOK_YAW);
    v.goToStation('plot');
    expect(v.controlYaw).toBe(0);
    expect(v.camera(0, 1)).toEqual({ mode: 'control', station: STATION_ORDER.indexOf('plot'), yaw: 0, pitch: 0 });
  });
});

describe('what the room shows of a game', () => {
  it('white light by day; red at night, and with the periscope going up', () => {
    const day = free();
    const f = new ControlRoomFeed();
    f.sample(day, true);
    expect(f.frame(day.sim.t).lighting).toBe('white');
    day.ctrl.submit({ kind: 'periscope', up: true }, 'keyboard');
    for (let i = 0; i < 200; i++) day.step();
    f.sample(day, false);
    expect(f.frame(day.sim.t).lighting).toBe('red');
    const night = free('night');
    f.sample(night, false);
    expect(f.frame(night.sim.t).lighting).toBe('red');
  });

  it('a depth charge shakes the room and dies away; an alarm line turns the lamp for a while; the screens once per sample', () => {
    const s = free();
    const f = new ControlRoomFeed();
    f.sample(s, true);
    const first = f.frame(10);
    expect(first.screens?.helm.depth).toBeCloseTo(s.sim.telemetry().depth);
    expect(first.screens?.ballast.tanks.length).toBe(cfg.tanks.length);
    expect(f.frame(10).screens).toBeNull();
    expect(first.shake).toBe(0);
    f.onLog('Sjunkbomb 30 m från skrovet!', 10);
    expect(f.frame(10).shake).toBeCloseTo(1);
    expect(f.frame(12).shake).toBeLessThan(0.1);
    f.onLog('Läckage i Manöverrum.', 10);
    expect(f.frame(10 + ALARM_TIME - 1).alarm).toBe(true);
    expect(f.frame(10 + ALARM_TIME + 1).alarm).toBe(false);
    f.reset();
    expect(f.frame(10).shake).toBe(0);
  });

  it('water in the room is its fraction of the room, and a leak keeps the alarm lamp on', () => {
    const spec = freePlaySpec('westCoast', 'periscope', 'day', 'calm', '')!;
    const s = new GameSession({ ...spec, initial: { ...spec.initial, leaks: { control: 0.02 } } });
    for (let i = 0; i < 1000; i++) s.step();
    const f = new ControlRoomFeed();
    f.sample(s, false);
    const fr = f.frame(s.sim.t);
    expect(fr.water).toBeGreaterThan(0);
    expect(fr.water).toBeLessThan(0.5);
    expect(fr.alarm).toBe(true);
  });
});

describe('the room in 3D', () => {
  it('builds, takes a frame with water and an alarm, and a ray from a station hits its screen', () => {
    const r = createControlRoom(cfg);
    r.update({ lighting: 'red', alarm: true, shake: 0.5, water: 0.2, doors: [1, 0], screens: null }, [0, 0, -1], 3);
    expect(r.scene.children.length).toBeGreaterThan(10);
    const water = r.scene.children.find((o) => o instanceof THREE.Mesh && (o.material as THREE.MeshBasicMaterial).opacity === 0.6 && o.visible);
    expect(water).toBeDefined();
    for (const s of r.stations) {
      if (!s.panel) continue;
      const f = screenFaces(cfg).find((x) => x.panel === s.panel)!;
      const from = bodyToLocal(s.eye);
      const dir = bodyToLocal(f.center).sub(from).normalize();
      expect(r.pick(new THREE.Raycaster(from, dir)), s.id).toBe(s.panel);
    }
    // Looking away from every screen hits none.
    const p = r.stations[0]!;
    expect(r.pick(new THREE.Raycaster(bodyToLocal(p.eye), new THREE.Vector3(0, -1, 0)))).toBeNull();
  });
});

describe('the field of view', () => {
  it('68° on a wide screen; wider on a phone held upright, at most 100°', async () => {
    const { controlFov } = await import('../src/render/scene');
    expect(controlFov(16 / 9)).toBe(68);
    expect(controlFov(375 / 812)).toBe(100);
    expect(controlFov(0.8)).toBeGreaterThan(68);
  });
});
