/**
 * What the control room view shows of a game (render/controlRoom.ts): the
 * light (red at night and dusk, in quiet running and with the periscope up),
 * the alarm lamp (after the log lines that sound the alarm, and while the
 * hull leaks or the boat is near crush depth), the shaking after depth
 * charges and groundings, the water in the room, the doors, and the
 * screens' contents. Reads the session; no DOM, no Three.js.
 */
import { CRUSH_WARNING_DEPTH } from '../audio/levels';
import { ALARM_TIME, SHAKE_DECAY, alarmFor, shakeFor } from '../render/controlRoom.data';
import type { ControlRoomFrame, ControlLighting } from '../render/controlRoom';
import type { ControlScreensState } from '../render/controlScreens';
import type { GameSession } from './session';

const DEG = 180 / Math.PI;
const KNOT = 1852 / 3600;
/** Signal excess [dB] drawn at full strength on the sonar's waterfall. */
const FULL_EXCESS = 30;

export class ControlRoomFeed {
  private shake = 0;
  private shakeAt = 0;
  private alarmUntil = -Infinity;
  private base: Omit<ControlRoomFrame, 'shake' | 'screens'> = { lighting: 'white', alarm: false, water: 0, doors: [] };
  private screens: ControlScreensState | null = null;

  /** A new game: no shaking or alarm left from the last one. */
  reset(): void {
    this.shake = 0;
    this.alarmUntil = -Infinity;
    this.screens = null;
  }

  /** A log line at simulation time t [s]. */
  onLog(text: string, t: number): void {
    const k = shakeFor(text);
    if (k > 0 && k >= this.shakeNow(t)) {
      this.shake = k;
      this.shakeAt = t;
    }
    if (alarmFor(text)) this.alarmUntil = t + ALARM_TIME;
  }

  private shakeNow(t: number): number {
    return this.shake * Math.exp(-Math.max(0, t - this.shakeAt) * SHAKE_DECAY);
  }

  /** Takes the room's state from the session (~10 times a second); `screens` also the screens' contents. */
  sample(s: GameSession, screens: boolean): void {
    const { sim, ctrl } = s;
    const t = sim.telemetry();
    const room = t.compartments.find((c) => c.id === 'control');
    const lighting: ControlLighting = s.conditions === 'night' || s.conditions === 'dusk' || ctrl.conn.quiet || t.periscope > 0.05 ? 'red' : 'white';
    const leaking = t.compartments.some((c) => c.holeArea > 0);
    this.base = {
      lighting,
      alarm: leaking || t.depth > CRUSH_WARNING_DEPTH || t.hullCollapsed,
      water: room ? (room.water / room.volume) * sim.cfg.damage.floodableFraction : 0,
      doors: t.doors,
    };
    if (!screens) return;
    const heading = t.heading * DEG;
    this.screens = {
      t: t.t,
      helm: {
        depth: t.depth,
        depthGoal: ctrl.depthGoal,
        speed: t.u / KNOT,
        speedGoal: ctrl.ap.speed ? ctrl.setpoints.speed : null,
        heading: ((heading % 360) + 360) % 360,
        headingGoal: ctrl.setpoints.heading,
        pitch: t.pitch * DEG,
        roll: t.roll * DEG,
        rudder: t.rudder * DEG,
        rudderCmd: t.rudderCmd * DEG,
        planes: t.sternPlanes * DEG,
        planesCmd: t.sternPlanesCmd * DEG,
        underKeel: t.depthUnderKeel,
      },
      ballast: {
        tanks: t.tanks.map((k) => ({ name: k.name, kind: k.kind, fill: k.fill, vent: k.ventOpen, blow: k.blowOpen })),
        air: t.airPressure / sim.cfg.air.bottlePressure,
        battery: t.battery,
        doors: t.doors,
      },
      sonar: {
        heading,
        contacts: ctrl.sonar.contacts.map((k) => ({ label: k.label, bearing: k.bearing, strength: Math.max(0, Math.min(1, k.excess / FULL_EXCESS)), bio: !!k.bio })),
      },
      plot: {
        north: t.position[0],
        east: t.position[1],
        heading,
        contacts: ctrl.sonar.contacts.filter((k) => !k.bio).map((k) => ({ label: k.label, bearing: k.bearing })),
        waypoint: s.scenario?.waypoint ?? null,
      },
    };
  }

  /** The frame for the renderer; the screens' contents only once after each sample with them. */
  frame(t: number): ControlRoomFrame {
    const screens = this.screens;
    this.screens = null;
    return { ...this.base, alarm: this.base.alarm || t < this.alarmUntil, shake: this.shakeNow(t), screens };
  }
}
