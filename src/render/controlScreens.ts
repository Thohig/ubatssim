/**
 * The screens in the control room (controlRoom.ts), drawn on canvases that
 * become textures: the helm and planes console, the ballast panel, the
 * sonar's bearing waterfall and the plot table. Drawn from the simulation's
 * values a few times a second; they only read.
 */
import type { StationPanel } from './controlRoom.data';

export interface ControlScreensState {
  /** Simulation time [s]. */
  t: number;
  helm: {
    depth: number;
    depthGoal: number;
    /** Through the water [knots]; the ordered speed, or null with the player on the revolutions. */
    speed: number;
    speedGoal: number | null;
    /** [deg] */
    heading: number;
    headingGoal: number;
    pitch: number;
    roll: number;
    rudder: number;
    rudderCmd: number;
    planes: number;
    planesCmd: number;
    /** Water under the keel [m]. */
    underKeel: number;
  };
  ballast: {
    tanks: readonly { name: string; kind: string; fill: number; vent: boolean; blow: boolean }[];
    /** HP air and battery, 0…1. */
    air: number;
    battery: number;
    /** The watertight doors from forward, 0 open … 1 shut. */
    doors: readonly number[];
  };
  sonar: {
    heading: number;
    /** True bearing [deg], strength 0…1. */
    contacts: readonly { label: string; bearing: number; strength: number; bio: boolean }[];
  };
  plot: {
    north: number;
    east: number;
    heading: number;
    contacts: readonly { label: string; bearing: number }[];
    waypoint: readonly [number, number] | null;
  };
}

/** Pixels of each screen (the aspect of its face in interior.ts). */
export const SCREEN_SIZE: Record<StationPanel, [number, number]> = {
  manoeuvre: [560, 240],
  ballast: [576, 180],
  sonar: [448, 200],
  chart: [448, 320],
};

const BG = '#06141c';
const INK = '#7fe3ff';
const DIM = '#2f6a80';
const WARN = '#ffc94a';
const BAD = '#ff6b6b';
const OK = '#5ee08a';

/** A tank's name short enough for its column ("HB för", "Trim akter", "Komp."). */
export function shortName(name: string): string {
  return name
    .replace(/^Huvudballast(tank)? ?/i, 'HB ')
    .replace(/^Kompensering(stank)?/i, 'Komp.')
    .replace(/tank/i, '')
    .trim()
    .slice(0, 10);
}

export class ControlScreens {
  readonly canvases: Record<StationPanel, HTMLCanvasElement>;
  /** Waterfall rows, newest first: contacts per second. */
  private rows: { t: number; contacts: ControlScreensState['sonar']['contacts'] }[] = [];
  private track: [number, number][] = [];
  private lastTrackT = -Infinity;

  constructor() {
    const make = (k: StationPanel) => {
      const c = document.createElement('canvas');
      [c.width, c.height] = SCREEN_SIZE[k];
      return c;
    };
    this.canvases = { manoeuvre: make('manoeuvre'), ballast: make('ballast'), sonar: make('sonar'), chart: make('chart') };
  }

  /** Forget the waterfall and the track (a new game). */
  reset(): void {
    this.rows = [];
    this.track = [];
    this.lastTrackT = -Infinity;
  }

  draw(s: ControlScreensState): void {
    // A jump back in time or far away is a new game.
    const lastTrack = this.track[this.track.length - 1];
    if ((this.rows[0] && s.t < this.rows[0].t) || (lastTrack && Math.hypot(s.plot.north - lastTrack[0], s.plot.east - lastTrack[1]) > 3000)) this.reset();
    this.helm(s);
    this.ballast(s);
    this.sonar(s);
    this.chart(s);
  }

  private ctx(k: StationPanel): CanvasRenderingContext2D | null {
    const g = this.canvases[k].getContext('2d');
    if (!g) return null;
    const [w, h] = SCREEN_SIZE[k];
    g.fillStyle = BG;
    g.fillRect(0, 0, w, h);
    g.textBaseline = 'middle';
    return g;
  }

  private helm(s: ControlScreensState): void {
    const g = this.ctx('manoeuvre');
    if (!g) return;
    const m = s.helm;
    const [w, h] = SCREEN_SIZE.manoeuvre;
    // Three readouts: depth, speed, course, each with its target.
    const cell = (x: number, label: string, value: string, goal: string, warn = false) => {
      g.fillStyle = DIM;
      g.font = '600 16px monospace';
      g.fillText(label, x, 22);
      g.fillStyle = warn ? WARN : INK;
      g.font = '700 40px monospace';
      g.fillText(value, x, 62);
      g.fillStyle = DIM;
      g.font = '600 18px monospace';
      g.fillText(goal, x, 96);
    };
    cell(14, 'DJUP m', m.depth.toFixed(1), `→ ${m.depthGoal.toFixed(0)}`, m.underKeel < 15);
    cell(196, 'FART kn', m.speed.toFixed(1), m.speedGoal === null ? 'varv' : `→ ${m.speedGoal.toFixed(0)}`);
    cell(370, 'KURS °', String(Math.round(m.heading) % 360).padStart(3, '0'), `→ ${String(Math.round(m.headingGoal) % 360).padStart(3, '0')}`);
    // Rudder and stern planes: the ordered angle (outline) and the real one (bar).
    const gauge = (y: number, label: string, angle: number, cmd: number, max: number) => {
      const x0 = 120;
      const x1 = w - 150;
      const mid = (x0 + x1) / 2;
      const at = (a: number) => mid + (Math.max(-max, Math.min(max, a)) / max) * ((x1 - x0) / 2);
      g.fillStyle = DIM;
      g.font = '600 16px monospace';
      g.fillText(label, 14, y);
      g.strokeStyle = DIM;
      g.lineWidth = 2;
      g.strokeRect(x0, y - 9, x1 - x0, 18);
      g.fillStyle = INK;
      g.fillRect(Math.min(mid, at(angle)), y - 7, Math.abs(at(angle) - mid), 14);
      g.strokeStyle = WARN;
      g.beginPath();
      g.moveTo(at(cmd), y - 13);
      g.lineTo(at(cmd), y + 13);
      g.stroke();
      g.fillStyle = INK;
      g.font = '600 16px monospace';
      g.fillText(`${angle >= 0 ? '+' : ''}${angle.toFixed(0)}°`, x1 + 10, y);
    };
    gauge(138, 'RODER', m.rudder, m.rudderCmd, 30);
    gauge(174, 'DJUPRODER', m.planes, m.planesCmd, 30);
    // The inclinometer: a bubble in a curved tube, the pitch (bow up to the left).
    const cx = w - 70;
    const cy = 214;
    g.strokeStyle = DIM;
    g.lineWidth = 10;
    g.beginPath();
    g.arc(cx, cy - 150, 160, Math.PI / 2 - 0.35, Math.PI / 2 + 0.35);
    g.stroke();
    const a = Math.PI / 2 + Math.max(-0.33, Math.min(0.33, (m.pitch / 30) * 0.33));
    g.fillStyle = Math.abs(m.pitch) > 15 ? WARN : OK;
    g.beginPath();
    g.arc(cx + 160 * Math.cos(a), cy - 150 + 160 * Math.sin(a), 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = DIM;
    g.font = '600 14px monospace';
    g.fillText(`STAMP ${m.pitch >= 0 ? '+' : ''}${m.pitch.toFixed(1)}°`, 14, h - 20);
    g.fillText(`KRÄNG ${m.roll >= 0 ? '+' : ''}${m.roll.toFixed(1)}°`, 190, h - 20);
    g.fillText(`UNDER KÖL ${m.underKeel > 999 ? '>999' : m.underKeel.toFixed(0)} m`, 340, h - 20);
  }

  private ballast(s: ControlScreensState): void {
    const g = this.ctx('ballast');
    if (!g) return;
    const b = s.ballast;
    const [w] = SCREEN_SIZE.ballast;
    // One column per tank: the fill, and lamps for the vents (V) and the blow (B).
    const n = b.tanks.length;
    const colW = (w - 150) / Math.max(1, n);
    b.tanks.forEach((tk, i) => {
      const x = 12 + i * colW;
      const bw = colW - 18;
      g.strokeStyle = DIM;
      g.lineWidth = 2;
      g.strokeRect(x, 30, bw, 90);
      g.fillStyle = tk.kind === 'mainBallast' ? '#2f78b7' : '#3b9a9a';
      const f = Math.max(0, Math.min(1, tk.fill));
      g.fillRect(x + 2, 30 + 88 * (1 - f), bw - 4, 88 * f);
      g.fillStyle = INK;
      g.font = '600 13px monospace';
      g.fillText(shortName(tk.name), x, 14);
      const lamp = (lx: number, on: boolean, color: string, label: string) => {
        g.fillStyle = on ? color : '#1b2c34';
        g.beginPath();
        g.arc(lx, 140, 8, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = DIM;
        g.font = '600 12px monospace';
        g.fillText(label, lx - 4, 162);
      };
      if (tk.kind === 'mainBallast') {
        lamp(x + 10, tk.vent, WARN, 'V');
        lamp(x + 34, tk.blow, OK, 'B');
      } else {
        g.fillStyle = DIM;
        g.font = '600 12px monospace';
        g.fillText(`${Math.round(f * 100)} %`, x, 140);
      }
    });
    // HP air and the battery, and the watertight doors.
    const bar = (y: number, label: string, v: number) => {
      const x = w - 132;
      g.fillStyle = DIM;
      g.font = '600 13px monospace';
      g.fillText(label, x, y - 12);
      g.strokeStyle = DIM;
      g.strokeRect(x, y, 120, 14);
      g.fillStyle = v < 0.2 ? BAD : v < 0.35 ? WARN : OK;
      g.fillRect(x + 2, y + 2, 116 * Math.max(0, Math.min(1, v)), 10);
    };
    bar(30, 'HP-LUFT', b.air);
    bar(78, 'BATTERI', b.battery);
    const open = b.doors.some((d) => d < 0.99);
    g.fillStyle = open ? WARN : OK;
    g.font = '600 13px monospace';
    g.fillText(open ? 'DÖRRAR ÖPPNA' : 'DÖRRAR STÄNGDA', w - 132, 128);
  }

  private sonar(s: ControlScreensState): void {
    const g = this.ctx('sonar');
    if (!g) return;
    const [w, h] = SCREEN_SIZE.sonar;
    // A row per second, newest at the top; bearings across, own heading in the middle.
    if (!this.rows[0] || s.t - this.rows[0].t >= 1) this.rows.unshift({ t: s.t, contacts: s.sonar.contacts });
    if (this.rows.length > 80) this.rows.length = 80;
    const top = 22;
    const rowH = (h - top) / 80;
    const xOf = (bearing: number) => {
      const rel = ((((bearing - s.sonar.heading) % 360) + 540) % 360) - 180; // −180…180, 0 = ahead
      return w / 2 + (rel / 180) * (w / 2);
    };
    this.rows.forEach((row, i) => {
      for (const k of row.contacts) {
        g.fillStyle = k.bio ? `rgba(94, 224, 138, ${0.3 + 0.6 * k.strength})` : `rgba(127, 227, 255, ${0.35 + 0.65 * k.strength})`;
        g.fillRect(xOf(k.bearing) - 2, top + i * rowH, 4, Math.max(1.5, rowH));
      }
    });
    g.strokeStyle = DIM;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(w / 2, top);
    g.lineTo(w / 2, h);
    g.stroke();
    g.fillStyle = DIM;
    g.font = '600 12px monospace';
    g.fillText('AKTER', 4, 10);
    g.fillText('FÖR', w / 2 - 12, 10);
    g.fillText('AKTER', w - 44, 10);
    g.fillStyle = INK;
    for (const k of s.sonar.contacts) if (!k.bio) g.fillText(k.label, Math.min(w - 26, Math.max(2, xOf(k.bearing) - 8)), top + 8);
  }

  private chart(s: ControlScreensState): void {
    const g = this.ctx('chart');
    if (!g) return;
    const [w, h] = SCREEN_SIZE.chart;
    const p = s.plot;
    if (s.t - this.lastTrackT >= 10) {
      this.track.push([p.north, p.east]);
      if (this.track.length > 200) this.track.shift();
      this.lastTrackT = s.t;
    }
    // North up, the boat in the middle, 4 km across; a grid every kilometre.
    const scale = w / 4000;
    const at = (n: number, e: number): [number, number] => [w / 2 + (e - p.east) * scale, h / 2 - (n - p.north) * scale];
    g.fillStyle = '#0d2531';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#173b4b';
    g.lineWidth = 1;
    for (let k = -3; k <= 3; k++) {
      const gx = w / 2 + (Math.round(p.east / 1000) * 1000 + k * 1000 - p.east) * scale;
      const gy = h / 2 - (Math.round(p.north / 1000) * 1000 + k * 1000 - p.north) * scale;
      g.beginPath();
      g.moveTo(gx, 0);
      g.lineTo(gx, h);
      g.moveTo(0, gy);
      g.lineTo(w, gy);
      g.stroke();
    }
    // The track, the bearing lines to the contacts, the buoy and the boat.
    g.strokeStyle = DIM;
    g.lineWidth = 2;
    g.beginPath();
    this.track.forEach(([n, e], i) => {
      const [x, y] = at(n, e);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.lineTo(w / 2, h / 2);
    g.stroke();
    g.font = '600 13px monospace';
    for (const k of p.contacts) {
      const a = (k.bearing * Math.PI) / 180;
      g.strokeStyle = 'rgba(255, 201, 74, 0.6)';
      g.setLineDash([6, 5]);
      g.beginPath();
      g.moveTo(w / 2, h / 2);
      g.lineTo(w / 2 + Math.sin(a) * w, h / 2 - Math.cos(a) * w);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = WARN;
      g.fillText(k.label, Math.min(w - 26, Math.max(4, w / 2 + Math.sin(a) * 120)), Math.min(h - 10, Math.max(10, h / 2 - Math.cos(a) * 120)));
    }
    if (p.waypoint) {
      const [x, y] = at(p.waypoint[0], p.waypoint[1]);
      g.fillStyle = '#ffcc22';
      g.beginPath();
      g.arc(Math.min(w - 6, Math.max(6, x)), Math.min(h - 6, Math.max(6, y)), 6, 0, Math.PI * 2);
      g.fill();
    }
    const hd = (p.heading * Math.PI) / 180;
    g.strokeStyle = INK;
    g.fillStyle = INK;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(w / 2, h / 2);
    g.lineTo(w / 2 + Math.sin(hd) * 30, h / 2 - Math.cos(hd) * 30);
    g.stroke();
    g.beginPath();
    g.arc(w / 2, h / 2, 5, 0, Math.PI * 2);
    g.fill();
    g.fillText('N', 8, 14);
    g.fillStyle = DIM;
    g.fillText('1 km', w - 44, h - 12);
  }
}
