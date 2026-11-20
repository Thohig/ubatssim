/**
 * The boat's interior for the cutaway view, as data: every space (the
 * pressure hull's compartments and decks, the tanks, and the free-flooding
 * spaces outside the pressure hull) and the equipment in them. No people.
 * Pure (no Three.js): cutaway.ts builds the meshes, the tests check that
 * everything lies where it belongs.
 *
 * Body frame (FRD): x forward, y starboard, z down [m]. The cutaway removes
 * the starboard half, so most furniture stands on the port side (y < 0);
 * what lies on the centre line is shown cut in two.
 */
import type { SubmarineConfig } from '../sim/config/submarine';
import { hullRadius } from '../sim/hull';
import type { Vec3 } from '../sim/math/vec3';

/** The torpedo tubes' positions across the bow (body y and z [m]), and the reserve racks (y, z). Used by cutaway.ts too. */
export const TUBE_Y = [-0.5, 0.5] as const;
export const TUBE_Z = [-0.3, 0.5] as const;
export const RACKS: readonly [number, number][] = [
  [-1.75, 0.55],
  [-1.75, -0.25],
  [-1.2, 0.55],
  [-1.2, -0.25],
  [1.2, 0.55],
  [1.2, -0.25],
  [1.75, 0.55],
  [1.75, -0.25],
];

export type Material = 'steel' | 'deck' | 'furniture' | 'console' | 'screen' | 'torpedo' | 'battery' | 'engine' | 'electric' | 'pipe' | 'air' | 'fabric';

export type Shape =
  | { type: 'box'; size: Vec3 }
  /** A cylinder along a body axis. */
  | { type: 'cylinder'; radius: number; length: number; axis: 'x' | 'y' | 'z' };

export interface Item {
  /** The space it stands in (see `spaces`). */
  space: string;
  shape: Shape;
  /** Centre, body frame [m]. */
  at: Vec3;
  material: Material;
  /** Passes through the pressure hull (mast trunks, shaft): not checked against it. */
  throughHull?: boolean;
  /** Turns with the propeller shaft. */
  shaft?: boolean;
}

/** A space the player can tap: a compartment, a tank or a space outside the pressure hull. */
export interface Space {
  id: string;
  name: string;
  /** What is there, for the information box. */
  description: string;
  kind: 'compartment' | 'tank' | 'outside';
}

/** Spaces outside the pressure hull [x range along the body, m]. */
export const OUTSIDE = {
  sonar: { name: 'Sonardom', xRange: [26.5, 30] as [number, number], description: 'Fritt flödande för. Bogsonarens hydrofoner lyssnar efter fartyg.' },
  sail: { name: 'Tornet', xRange: [4.5, 11.5] as [number, number], description: 'Fritt flödande torn med periskopmast, snorkel- och antennmaster och den öppna bryggan överst.' },
  aftPeak: { name: 'Akterpik', xRange: [-30, -27] as [number, number], description: 'Fritt flödande akter med styrmaskinerna för roder och djuproder och axelgenomföringen.' },
} as const;

const COMPARTMENT_TEXT: Record<string, string> = {
  torpedo: 'Fyra torpedtuber i två rader, åtta reservtorpeder på ställningar, laddräls och lastlucka. Trimtanken för ligger under durken.',
  control: 'Övre däck: periskopbrunn, roder- och djuproderpulpet, ballastpanel, plottbord, sonar- och radiohytt. Nedre däck: pumprummet och HP-luftflaskorna.',
  living: 'Övre däck: mäss, kabyss och kojer. Nedre däck: batterirummet med cellerna som driver huvudmotorn. Kompenseringstanken ligger under.',
  engine: 'Två dieselmotorer med generatorer som laddar batteriet vid snorkling.',
  motor: 'Huvudmotorn (elmotor), ställverket och axeln akterut. Trimtanken akter ligger under durken.',
};

const TANK_TEXT: Record<string, string> = {
  mainBallast: 'Huvudballasttank utanför tryckskrovet. Fylls genom att ventilerna öppnas och blåses tom med tryckluft.',
  trim: 'Trimtank under durken. Vatten pumpas mellan för och akter för att trimma stampvinkeln.',
  compensating: 'Kompenseringstank. Vatten pumpas in från havet eller ut för att göra ubåten neutral.',
};

/** Every space, for taps and the information box. */
export function spaces(cfg: SubmarineConfig): Space[] {
  return [
    ...cfg.compartments.map((c) => ({ id: c.id, name: c.name, description: COMPARTMENT_TEXT[c.id] ?? '', kind: 'compartment' as const })),
    ...cfg.tanks.map((t) => ({ id: t.id, name: t.name, description: TANK_TEXT[t.kind] ?? '', kind: 'tank' as const })),
    ...Object.entries(OUTSIDE).map(([id, o]) => ({ id, name: o.name, description: o.description, kind: 'outside' as const })),
  ];
}

/** Half the pressure hull's width at height z [m]. */
const halfWidth = (cfg: SubmarineConfig, z: number) => Math.sqrt(Math.max(0, cfg.hull.pressureHullRadius ** 2 - z * z));

/** True if a body point lies inside a tank's shape. */
function inTank(def: SubmarineConfig['tanks'][number], p: Vec3): boolean {
  const d: Vec3 = [p[0] - def.position[0], p[1] - def.position[1], p[2] - def.position[2]];
  if (def.shape.type === 'box') {
    const [sx, sy, sz] = def.shape.size;
    return Math.abs(d[0]) <= sx / 2 && Math.abs(d[1]) <= sy / 2 && Math.abs(d[2]) <= sz / 2;
  }
  return Math.abs(d[0]) <= def.shape.length / 2 && d[1] * d[1] + d[2] * d[2] <= def.shape.radius ** 2;
}

/**
 * The space at a body point (a tap on the cut face), or null outside the
 * boat. Tanks first, then the pressure hull's compartments, then the
 * free-flooding spaces.
 */
export function spaceAt(cfg: SubmarineConfig, p: Vec3): string | null {
  const [x, y, z] = p;
  for (const t of cfg.tanks) if (inTank(t, p)) return t.id;
  const [px0, px1] = cfg.hull.pressureHullX;
  if (x >= px0 && x <= px1 && y * y + z * z <= cfg.hull.pressureHullRadius ** 2) {
    return cfg.compartments.find((c) => x >= c.xRange[0] && x <= c.xRange[1])?.id ?? null;
  }
  const s = cfg.hull.sail;
  if (Math.abs(x - s.position[0]) <= s.length / 2 && z < 0 && z >= s.position[2] - s.height / 2 - 1) return 'sail';
  if (Math.abs(x) > cfg.hull.length / 2 || y * y + z * z > hullRadius(cfg.hull, x) ** 2) return null;
  if (x >= OUTSIDE.sonar.xRange[0]) return 'sonar';
  if (x <= OUTSIDE.aftPeak.xRange[1]) return 'aftPeak';
  return null;
}

/**
 * The equipment, by space. Shapes are boxes and cylinders; repeated things
 * (bunks, battery cells, torpedoes) are generated.
 */
export function interiorItems(cfg: SubmarineConfig): Item[] {
  const items: Item[] = [];
  const box = (space: string, at: Vec3, size: Vec3, material: Material, extra: Partial<Item> = {}) =>
    items.push({ space, at, shape: { type: 'box', size }, material, ...extra });
  const cyl = (space: string, at: Vec3, radius: number, length: number, axis: 'x' | 'y' | 'z', material: Material, extra: Partial<Item> = {}) =>
    items.push({ space, at, shape: { type: 'cylinder', radius, length, axis }, material, ...extra });
  const deck = (id: string, i: number) => cfg.compartments.find((c) => c.id === id)!.decks[i]!.floor;
  const comp = (id: string) => cfg.compartments.find((c) => c.id === id)!.xRange;
  /** Something of height h standing on the floor at z: its centre height. */
  const on = (floor: number, h: number) => floor - h / 2;

  // Floors: a plate across the hull's width at each deck's height.
  for (const c of cfg.compartments) {
    for (const d of c.decks) {
      const w = 2 * halfWidth(cfg, d.floor + 0.08) - 0.1; // as wide as the hull allows at the plate's underside
      box(c.id, [(c.xRange[0] + c.xRange[1]) / 2, 0, d.floor + 0.04], [c.xRange[1] - c.xRange[0] - 0.1, w, 0.08], 'deck');
    }
  }

  // ---- Torpedo room.
  {
    const [x0, x1] = comp('torpedo');
    const floor = deck('torpedo', 0);
    // Four tubes in two rows; the breech doors (lit after the tube's state) and
    // the reserve torpedoes (as many as are left) are drawn by cutaway.ts.
    for (const y of TUBE_Y) for (const z of TUBE_Z) cyl('torpedo', [x1 - 3.1, y, z], 0.3, 6.0, 'x', 'steel');
    // The racks for the reserve torpedoes, along both sides.
    for (const r of RACKS) box('torpedo', [x0 + 3.6, r[0], r[1] + 0.33], [5.0, 0.5, 0.06], 'steel');
    box('torpedo', [x0 + 4, 0, -2.25], [7.0, 0.14, 0.14], 'pipe'); // loading rail
    cyl('torpedo', [x0 + 4, -0.9, -2.35], 0.35, 0.3, 'z', 'steel'); // loading hatch
    box('torpedo', [x0 + 0.8, -1.4, on(floor, 1.8)], [0.6, 0.8, 1.8], 'console'); // fire control panel
  }

  // ---- Control room.
  {
    const [x0, x1] = comp('control');
    const up = deck('control', 0);
    const low = deck('control', 1);
    const per = cfg.periscope.base;
    // Periscope well and the conning tower trunk up into the sail (through the hull).
    cyl('control', [per[0], 0, (up + per[2]) / 2], 0.28, up - per[2], 'z', 'pipe', { throughHull: true });
    cyl('control', [per[0] + 1.2, 0, (up - 7) / 2], 0.2, up + 7, 'z', 'pipe', { throughHull: true }); // snorkel/antenna mast
    cyl('control', [cfg.bridge.deck[0] + 0.6, 0, (up + cfg.bridge.deck[2]) / 2], 0.42, up - cfg.bridge.deck[2], 'z', 'steel', { throughHull: true });
    // Ship control: helm and planes console with two seats, screens above.
    box('control', [x1 - 0.8, -1.4, on(up, 0.9)], [0.9, 1.6, 0.9], 'console');
    box('control', [x1 - 0.55, -1.4, up - 1.25], [0.08, 1.4, 0.6], 'screen');
    for (const y of [-1.85, -0.95]) {
      box('control', [x1 - 1.7, y, on(up, 0.45)], [0.5, 0.5, 0.45], 'fabric');
      box('control', [x1 - 1.95, y, on(up, 1.1)], [0.08, 0.5, 0.65], 'fabric');
    }
    // Ballast control panel on the port side, plot table, sonar and radio cabin.
    box('control', [x0 + 3.0, -1.95, on(up, 1.4)], [2.0, 0.25, 1.4], 'console');
    box('control', [x0 + 3.0, -1.8, up - 1.1], [1.6, 0.06, 0.5], 'screen');
    box('control', [x0 + 4.8, -0.7, on(up, 0.9)], [1.4, 1.0, 0.9], 'furniture'); // plot table
    box('control', [x0 + 1.9, -1.0, on(up, 1.8)], [0.05, 1.4, 1.8], 'steel'); // cabin wall
    box('control', [x0 + 0.9, -1.85, on(up, 1.1)], [1.2, 0.5, 1.1], 'console'); // sonar console
    box('control', [x0 + 0.9, -1.6, up - 1.4], [1.0, 0.06, 0.45], 'screen');
    box('control', [x0 + 0.9, -0.9, on(up, 0.45)], [0.45, 0.45, 0.45], 'fabric');
    // Lower deck: pumps, pipes and the HP air bottles.
    for (const x of [x1 - 2.5, x1 - 1.4]) cyl('control', [x, -1.0, on(low, 0.8)], 0.28, 0.8, 'z', 'engine');
    box('control', [x1 - 2.0, -1.6, low - 1.1], [3.0, 0.1, 0.1], 'pipe');
    for (const z of [low - 0.35, low - 0.85])
      for (const y of [-1.5, -1.05, -0.6]) cyl('control', [x0 + 3.0, y, z], 0.21, 3.2, 'x', 'air');
  }

  // ---- Living and battery spaces.
  {
    const [x0, x1] = comp('living');
    const up = deck('living', 0);
    const low = deck('living', 1);
    // Mess: table and benches; galley; bunks in two tiers; lockers.
    box('living', [x1 - 1.6, -0.9, on(up, 0.75)], [2.0, 0.9, 0.06], 'furniture');
    box('living', [x1 - 1.6, -0.9, on(up, 0.72) + 0.36], [0.1, 0.1, 0.7], 'steel');
    for (const y of [-1.6, -0.2]) box('living', [x1 - 1.6, y, on(up, 0.45)], [2.0, 0.4, 0.45], 'fabric');
    box('living', [x1 - 4.0, -1.85, on(up, 0.9)], [1.6, 0.6, 0.9], 'steel'); // galley
    box('living', [x1 - 4.0, -1.8, up - 1.45], [1.6, 0.35, 0.5], 'furniture'); // cupboards
    for (const x of [x0 + 1.0, x0 + 2.95])
      for (const z of [up - 0.45, up - 1.25]) {
        box('living', [x, -1.75, z], [1.9, 0.7, 0.12], 'furniture');
        box('living', [x, -1.75, z - 0.1], [1.8, 0.6, 0.08], 'fabric'); // mattress
      }
    box('living', [x0 + 0.25, -1.2, on(up, 1.8)], [0.4, 0.9, 1.8], 'steel'); // lockers
    // Battery room: rows of cells.
    for (let x = x0 + 0.4; x <= x1 - 0.4; x += 0.42)
      for (let y = -1.85; y <= 1.86; y += 0.37) box('living', [x, y, on(low, 1.0)], [0.36, 0.31, 1.0], 'battery');
  }

  // ---- Engine room: two diesel generators, the snorkel induction and exhaust.
  {
    const [x0, x1] = comp('engine');
    const floor = deck('engine', 0);
    for (const y of [-1.05, 1.05]) {
      box('engine', [x0 + 3.5, y, on(floor, 1.4)], [3.4, 0.9, 1.4], 'engine');
      for (let x = x0 + 2.1; x <= x0 + 4.9; x += 0.7) box('engine', [x, y, on(floor, 1.4) - 0.85], [0.5, 0.6, 0.3], 'steel'); // cylinder heads
      cyl('engine', [x1 - 1.0, y, on(floor, 1.2)], 0.55, 1.6, 'x', 'electric'); // generator
    }
    cyl('engine', [x1 - 1.6, -0.45, (floor - 2.4) / 2 - 0.4], 0.17, 2.6, 'z', 'pipe', { throughHull: true });
    box('engine', [x0 + 0.5, -1.6, on(floor, 1.6)], [0.6, 0.6, 1.6], 'console'); // engine control
  }

  // ---- Motor room: main motor, switchboards, shaft.
  {
    const [x0, x1] = comp('motor');
    const floor = deck('motor', 0);
    cyl('motor', [x0 + 2.8, 0, 0], 1.05, 3.0, 'x', 'electric');
    box('motor', [x1 - 1.4, -1.85, on(floor, 1.8)], [2.0, 0.4, 1.8], 'console'); // switchboards
    box('motor', [x1 - 1.4, -1.62, on(floor, 1.8) - 0.3], [1.8, 0.05, 0.6], 'screen');
    box('motor', [x0 + 0.6, 0, on(floor, 0.8)], [0.6, 1.0, 0.8], 'steel'); // thrust bearing
  }
  // Shaft from the motor through the aft end to the propeller (turns with it).
  {
    const x0 = cfg.propulsion.position[0];
    const x1 = comp('motor')[0] + 1.3;
    cyl('motor', [(x0 + x1) / 2, 0, 0], 0.16, x1 - x0, 'x', 'pipe', { throughHull: true, shaft: true });
  }

  // ---- Outside the pressure hull.
  cyl('sonar', [28.0, 0, 0], 1.1, 1.8, 'x', 'electric'); // hydrophone array
  for (const a of [0, 1, 2, 3, 4, 5]) {
    const ang = (a / 6) * 2 * Math.PI;
    box('sonar', [28.0, 1.25 * Math.cos(ang), 1.25 * Math.sin(ang)], [1.6, 0.12, 0.12], 'screen');
  }
  for (const y of [-0.4, 0.4]) cyl('aftPeak', [-27.3, y, 0.25], 0.12, 0.8, 'x', 'engine'); // steering rams
  // Sail: the bridge cockpit floor and the hatch.
  const s = cfg.hull.sail;
  box('sail', [cfg.bridge.deck[0], 0, cfg.bridge.deck[2] + 0.04], [2.2, 0.9, 0.08], 'deck');
  cyl('sail', [cfg.bridge.deck[0] + 0.6, 0, cfg.bridge.deck[2] + 0.1], 0.45, 0.12, 'z', 'steel');
  box('sail', [s.position[0] - 2.4, 0, s.position[2]], [0.06, 0.8, s.height - 0.6], 'steel'); // inner frame
  return items;
}

/** The corners of an item (boxes) or points around its ends (cylinders), body frame. For the tests. */
export function itemExtremes(item: Item): Vec3[] {
  const [cx, cy, cz] = item.at;
  if (item.shape.type === 'box') {
    const [sx, sy, sz] = item.shape.size;
    const out: Vec3[] = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) out.push([cx + (a * sx) / 2, cy + (b * sy) / 2, cz + (c * sz) / 2]);
    return out;
  }
  const { radius: r, length: l, axis } = item.shape;
  const out: Vec3[] = [];
  for (const e of [-l / 2, l / 2])
    for (let k = 0; k < 8; k++) {
      const u = r * Math.cos((k * Math.PI) / 4);
      const v = r * Math.sin((k * Math.PI) / 4);
      if (axis === 'x') out.push([cx + e, cy + u, cz + v]);
      else if (axis === 'y') out.push([cx + u, cy + e, cz + v]);
      else out.push([cx + u, cy + v, cz + e]);
    }
  return out;
}
