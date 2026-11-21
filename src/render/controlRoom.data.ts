/**
 * The control room view (Manöverrum) as data, without Three.js: where the
 * camera stands at each station, which panel a tap on the station's screen
 * opens, and what the log lines mean in the room (shaking, alarm lamp).
 * controlRoom.ts builds and draws the room, views.ts moves between the
 * stations, the tests check that every eye is in the room and clear of the
 * furniture.
 *
 * Body frame (FRD): x forward, y starboard, z down [m]. `yaw` is positive to
 * starboard and `pitch` upwards, relative to the bow (as the bridge look).
 */
import type { SubmarineConfig } from '../sim/config/submarine';
import type { Vec3 } from '../sim/math/vec3';

export type StationId = 'periscope' | 'helm' | 'ballast' | 'plot' | 'sonar';
/** The stations in the order ←/→ and the Plats button go through them, with their names. */
export const STATION_ORDER: readonly StationId[] = ['periscope', 'helm', 'ballast', 'plot', 'sonar'];
export const STATION_NAME: Record<StationId, string> = { periscope: 'Periskopet', helm: 'Pulpeten', ballast: 'Ballastpanelen', plot: 'Plottbordet', sonar: 'Sonarhytten' };
/** What a tap on a station's screen opens: a helm panel, or the chart or the sonar. */
export type StationPanel = 'manoeuvre' | 'ballast' | 'chart' | 'sonar';

export interface Station {
  id: StationId;
  name: string;
  eye: Vec3;
  yaw: number;
  pitch: number;
  /** The screen there and what a tap on it opens (null: none). */
  panel: StationPanel | null;
}

/** Eye height above the deck [m]. */
const EYE = 1.62;

/** The stations, in `STATION_ORDER`. */
export function controlStations(cfg: SubmarineConfig): Station[] {
  const c = cfg.compartments.find((x) => x.id === 'control')!;
  const [x0, x1] = c.xRange;
  const up = c.decks[0]!.floor;
  const z = up - EYE;
  const per = cfg.periscope.base[0];
  return [
    // At the periscope well, on its port side, looking forward along the room to the helm.
    { id: 'periscope', name: STATION_NAME.periscope, eye: [per + 0.5, -0.6, z], yaw: -0.25, pitch: -0.1, panel: null },
    // Between the two seats at the helm and planes console, its screens ahead.
    { id: 'helm', name: STATION_NAME.helm, eye: [x1 - 2.65, -1.4, z + 0.05], yaw: 0, pitch: -0.15, panel: 'manoeuvre' },
    // The ballast panel on the port side.
    { id: 'ballast', name: STATION_NAME.ballast, eye: [x0 + 3.0, 0.35, z], yaw: -Math.PI / 2, pitch: -0.24, panel: 'ballast' },
    // Standing at the plot table, looking down on it.
    { id: 'plot', name: STATION_NAME.plot, eye: [x0 + 4.8, 0.75, z - 0.08], yaw: -Math.PI / 2, pitch: -0.5, panel: 'chart' },
    // In the door of the sonar cabin.
    { id: 'sonar', name: STATION_NAME.sonar, eye: [x0 + 0.9, 0.25, z + 0.07], yaw: -Math.PI / 2, pitch: -0.08, panel: 'sonar' },
  ];
}

/** A screen's face: centre, the texture's right and up (unit vectors), and its size [m] (body frame). */
export interface ScreenFace {
  panel: StationPanel;
  center: Vec3;
  right: Vec3;
  up: Vec3;
  width: number;
  height: number;
}

/**
 * The screens, just in front of the screens in interior.ts: the helm
 * console's facing aft, the ballast panel's and the sonar's facing
 * starboard, and the chart on the plot table's top (port side up, so it
 * reads from the starboard side).
 */
export function screenFaces(cfg: SubmarineConfig): ScreenFace[] {
  const c = cfg.compartments.find((x) => x.id === 'control')!;
  const [x0, x1] = c.xRange;
  const up = c.decks[0]!.floor;
  return [
    { panel: 'manoeuvre', center: [x1 - 0.6, -1.4, up - 1.25], right: [0, 1, 0], up: [0, 0, -1], width: 1.36, height: 0.58 },
    { panel: 'ballast', center: [x0 + 3.0, -1.765, up - 1.1], right: [1, 0, 0], up: [0, 0, -1], width: 1.56, height: 0.48 },
    { panel: 'sonar', center: [x0 + 0.9, -1.565, up - 1.4], right: [1, 0, 0], up: [0, 0, -1], width: 0.98, height: 0.44 },
    { panel: 'chart', center: [x0 + 4.8, -0.7, up - 0.905], right: [1, 0, 0], up: [0, -1, 0], width: 1.36, height: 0.97 },
  ];
}

/** How far the look may turn from a station's own direction [rad]. */
export const LOOK_YAW = 2.6;
export const LOOK_PITCH = 1.0;

/**
 * How hard a log line shakes the room, 0…1, or 0. A depth charge after its
 * distance ("Sjunkbomb 40 m från skrovet"), a grounding hard, a hit far away
 * a little.
 */
export function shakeFor(text: string): number {
  const charge = /^Sjunkbomb (\d+) m från skrovet/.exec(text);
  if (charge) return Math.max(0.08, Math.min(1, 30 / Math.max(1, Number(charge[1]))));
  if (/^Grundstötning/.test(text)) return 0.8;
  if (/^Kollision/.test(text)) return 0.8;
  if (/^Träff!/.test(text)) return 0.12;
  return 0;
}

/** Whether a log line turns the alarm lamp on (for `ALARM_TIME`): the lines that sound the alarm. */
export function alarmFor(text: string): boolean {
  return /^Läckage i|^Skrovet kollapsade|nödblåsning|^Grundstötning|^Vatten över bryggan/.test(text);
}

/** How long a log line keeps the alarm lamp turning [s]. */
export const ALARM_TIME = 8;
/** How fast a shake dies away [1/s]. */
export const SHAKE_DECAY = 1.6;
