/**
 * Game content for the sea areas: names, free-play starting positions,
 * lighthouses and the light/visibility conditions. The physics of each
 * area (terrain and water) is in src/sim/config/areas.ts.
 */
import type { AreaId } from '../sim/config/areas';
import type { InitialConditions } from '../sim/simulation';
import type { SeaStateId } from '../sim/config/seaStates';
import type { AircraftDef } from '../sim/aircraft';
import type { CreatureDef } from '../sim/life';
import type { VesselDef } from '../sim/vessel';
import type { RadarStation } from './lookouts';

const KN = 1852 / 3600;
const DEG = Math.PI / 180;

export interface FreeStart {
  id: string;
  title: string;
  /** One line for the menu. */
  description: string;
  /** Log line when the game starts. */
  text: string;
  initial: InitialConditions;
}

export interface Lighthouse {
  name: string;
  /** [north, east] [m], on land. */
  position: [number, number];
  color: 'white' | 'red' | 'green';
  /** Flash period [s] and the lit part of it [s] (a deterministic character, e.g. "Fl 5s"). */
  period: number;
  lit: number;
}

export interface AreaInfo {
  id: AreaId;
  title: string;
  description: string;
  starts: FreeStart[];
  lighthouses: Lighthouse[];
  /** The area's own ships (at peace without its corvettes). */
  traffic: VesselDef[];
  /** Whales and fish schools in free play. */
  life?: CreatureDef[];
  /** Patrol aircraft in free play. */
  aircraft?: AircraftDef[];
  /** Coastal radar stations. */
  stations?: RadarStation[];
  /** Lit buoys marking the leads [north, east] [m], and their colour. Graphics only. */
  buoys?: { position: [number, number]; color: 'red' | 'green' | 'yellow' }[];
  /** Where the patrol's ships go (control/patrol.ts). */
  patrol: PatrolRoutes;
}

/** The patrol's routes in an area, all in water deep enough for a freighter (tests/life.test.ts). */
export interface PatrolRoutes {
  /** The corvettes' patrol line (tension: one; war: two hunting together). */
  line: [number, number][];
  /** The convoy's route at war: two freighters and an escort, offset to the side of it. */
  convoy: [number, number][];
  /** Lanes the new traffic comes in on, from the edge of the area; reinforcements come in on the first. */
  lanes: [number, number][][];
  /** The depot ship at anchor, where the boat takes on torpedoes and decoys. */
  depot: { name: string; position: [number, number] };
}

const KNOTS = (kn: number) => (kn * 1852) / 3600;
const DEG_S = (deg: number) => (deg * Math.PI) / 180;

/** Typical ships. Sizes and speeds are illustrative. */
export const freighter = (id: string, name: string, route: [number, number][], length = 130): VesselDef => ({
  id, name, kind: 'freighter', length, beam: length * 0.155, draft: length * 0.06, speed: KNOTS(12), turnRate: DEG_S(0.6),
  route, repeat: 'shuttle', propellerRps: 2, blades: 4,
});
const ferry = (id: string, name: string, route: [number, number][], length: number, kn: number, turnDegS = 1.5): VesselDef => ({
  id, name, kind: 'ferry', length, beam: length * 0.17, draft: Math.min(6.5, length * 0.045), speed: KNOTS(kn), turnRate: DEG_S(turnDegS),
  route, repeat: 'shuttle', propellerRps: 2.5, blades: 5,
});
/** A corvette on patrol: a hull sonar and lookouts (control/sonar.ts). */
export const corvette = (id: string, name: string, route: [number, number][], kn = 10): VesselDef => ({
  id, name, kind: 'patrol', length: 72, beam: 10, draft: 3.5, speed: KNOTS(kn), turnRate: DEG_S(2.5),
  route, repeat: 'shuttle', propellerRps: 4, blades: 5,
});
const fishing = (id: string, name: string, route: [number, number][]): VesselDef => ({
  id, name, kind: 'fishing', length: 18, beam: 6, draft: 3, speed: KNOTS(5), turnRate: DEG_S(4),
  route, repeat: 'loop', propellerRps: 6, blades: 3,
});

/** A sailing yacht: no propeller, nearly silent. */
const sail = (id: string, name: string, route: [number, number][], kn = 6): VesselDef => ({
  id, name, kind: 'sail', length: 11, beam: 3.6, draft: 1.9, speed: KNOTS(kn), turnRate: DEG_S(6),
  route, repeat: 'loop', propellerRps: 0, blades: 0,
});
/** A fishing boat towing a trawl `distance` metres astern between `top` and `bottom` metres deep. */
const trawler = (id: string, name: string, route: [number, number][], top: number, bottom: number): VesselDef => ({
  ...fishing(id, name, route), length: 24, beam: 7, draft: 3.5, speed: KNOTS(3.5), turnRate: DEG_S(2),
  trawl: { distance: 350, width: 35, top, bottom },
});

/** Whales and fish. Sizes, depths and dive times are typical of each species. APPROX. */
const spermWhale = (id: string, route: [number, number][], phase = 0): CreatureDef => ({
  id, name: 'en kaskelot', kind: 'whale', sound: 'clicks', route, speed: 1.5, depth: 500, dive: 2400, surface: 480, callPeriod: 60, callOn: 45, size: 15, phase,
});
const humpback = (id: string, route: [number, number][], phase = 0): CreatureDef => ({
  id, name: 'en knölval', kind: 'whale', sound: 'song', route, speed: 1.8, depth: 60, dive: 600, surface: 150, callPeriod: 900, callOn: 600, size: 14, phase,
});
const minke = (id: string, route: [number, number][], phase = 0): CreatureDef => ({
  id, name: 'en vikval', kind: 'whale', sound: 'pulse', route, speed: 2.2, depth: 40, dive: 300, surface: 60, callPeriod: 240, callOn: 60, size: 8, phase,
});
const orcas = (id: string, route: [number, number][], phase = 0): CreatureDef => ({
  id, name: 'en flock späckhuggare', kind: 'whale', sound: 'whistle', route, speed: 2.5, depth: 30, dive: 240, surface: 60, callPeriod: 180, callOn: 90, size: 7, phase,
});
const herring = (id: string, route: [number, number][], depth: number, nightDepth: number, size = 60): CreatureDef => ({
  id, name: 'ett sillstim', kind: 'school', sound: 'frt', route, speed: 0.6, depth, nightDepth, size,
});

export type ConditionsId = 'day' | 'dusk' | 'night' | 'fog';

export const SEA_CHOICES: { id: SeaStateId; title: string; description: string }[] = [
  { id: 'calm', title: 'Lugnt', description: 'Ingen sjögång.' },
  { id: 'moderate', title: 'Måttlig sjö', description: 'Våghöjd 1,25 m.' },
  { id: 'rough', title: 'Grov sjö', description: 'Våghöjd 3 m.' },
];

export const CONDITIONS: { id: ConditionsId; title: string; description: string }[] = [
  { id: 'day', title: 'Dag', description: 'God sikt, ungefär 15 km.' },
  { id: 'dusk', title: 'Skymning', description: 'Mörkrött ljus. Lanternorna tänds.' },
  { id: 'night', title: 'Natt', description: 'Mörkt. Fyrarna blinkar.' },
  { id: 'fog', title: 'Dimma', description: 'Sikt ungefär 200 m.' },
];

export const AREA_INFO: Record<AreaId, AreaInfo> = {
  westCoast: {
    id: 'westCoast',
    title: 'Västerhavet',
    description: 'Öppet hav och Bohusläns skärgård. Språngskikt på 40–70 m.',
    starts: [
      { id: 'surface', title: 'Ytläge', description: 'Stilla vid ytan på öppet hav, skärgården 2 km österut.', text: 'Ubåten ligger i ytläge.', initial: {} },
      {
        id: 'archipelago',
        title: 'Skärgården',
        description: 'I ytläge i ett smalt sund mellan kobbar och skär.',
        text: 'Ubåten ligger i ytläge i ett sund i skärgården. Sundet slingrar sig mot nordost. Håll koll på "Under köl".',
        initial: { east: 2560, heading: 20 * DEG },
      },
      {
        id: 'periscope',
        title: 'Periskopdjup',
        description: '13 m (kölen på 16 m), 4 knop, neutralt trimmad. Hissa periskopet med P.',
        text: 'Ubåten går på periskopdjup, 13 m. Tryck P för att hissa periskopet.',
        initial: { depth: 13, speed: 4 * KN, neutral: true },
      },
      {
        id: 'deep',
        title: 'Djupt vatten',
        description: '100 m, 8 knop, under språngskiktet.',
        text: 'Ubåten går på 100 m djup, under språngskiktet.',
        initial: { depth: 100, speed: 8 * KN, neutral: true },
      },
    ],
    patrol: {
      line: [[-5500, -6000], [5500, -6000]],
      convoy: [[8000, -9000], [-8000, -9000]],
      lanes: [[[10000, -7000], [-10000, -7000]], [[-10000, -2500], [10000, -2500]]],
      depot: { name: 'depåfartyget Vega', position: [-3000, -800] },
    },
    lighthouses: [
      { name: 'Västra fyren', position: [800, 2300], color: 'white', period: 5, lit: 0.6 },
      { name: 'Södra fyren', position: [-800, 2580], color: 'red', period: 3, lit: 1 },
    ],
    traffic: [
      freighter('skagerack', 'M/S Skagerack', [[-6000, -1500], [6000, -1500]]),
      fishing('maja', 'fiskebåten Maja', [[-1500, 600], [-1500, 1200], [-900, 1200], [-900, 600]]),
      trawler('ostkust', 'trålaren Östkust', [[-4500, -3500], [3500, -3500], [3500, -2500], [-4500, -2500]], 18, 45),
      sail('linnea', 'segelbåten Linnéa', [[-1200, 900], [700, 1100], [1600, 200], [-300, -300]]),
    ],
    life: [herring('sill-vast', [[-2500, -3000], [-600, -4200], [1500, -3200]], 90, 25), minke('vikval-vast', [[3000, -2000], [-3000, -2500], [-500, 200]], 100)],
    stations: [{ id: 'kustradar-vast', name: 'kustradarn på Västra holmen', position: [650, 2450], height: 40 }],
    buoys: [
      { position: [-260, 2470], color: 'red' },
      { position: [-260, 2650], color: 'green' },
      { position: [400, 2560], color: 'red' },
      { position: [400, 2760], color: 'green' },
    ],
  },
  baltic: {
    id: 'baltic',
    title: 'Östersjön',
    description: 'Bräckt vatten och en låg skärgård. Saltsprångskikt på 60–80 m.',
    starts: [
      { id: 'surface', title: 'Ytläge', description: 'Stilla vid ytan, 110 m djup, skärgården 3 km österut.', text: 'Ubåten ligger i ytläge i Östersjön.', initial: { area: 'baltic' } },
      {
        id: 'periscope',
        title: 'Periskopdjup',
        description: '13 m, 4 knop, neutralt trimmad.',
        text: 'Ubåten går på periskopdjup i Östersjön.',
        initial: { area: 'baltic', depth: 13, speed: 4 * KN, neutral: true },
      },
      {
        id: 'halocline',
        title: 'Över saltsprångskiktet',
        description: '50 m, 5 knop. Under 60 m blir vattnet saltare och tätare.',
        text: 'Ubåten går på 50 m, strax över saltsprångskiktet.',
        initial: { area: 'baltic', depth: 50, speed: 5 * KN, neutral: true },
      },
    ],
    patrol: {
      line: [[-4000, -6000], [-4000, 0]],
      convoy: [[6000, -8000], [6000, 0]],
      lanes: [[[5000, -9000], [5000, 1000]], [[-8000, -4000], [8000, -4000]]],
      depot: { name: 'depåfartyget Belos', position: [0, -3000] },
    },
    lighthouses: [
      { name: 'Ytterskärs fyr', position: [0, 2980], color: 'white', period: 6, lit: 1 },
      { name: 'Norra prickens fyr', position: [1600, 2630], color: 'green', period: 4, lit: 0.5 },
    ],
    traffic: [
      ferry('ostersjo', 'färjan Östersjö', [[3000, -6000], [3000, 1200]], 170, 17),
      corvette('spejaren', 'korvetten Spejaren', [[-2500, -5000], [-2500, 800]]),
      sail('stina', 'segelbåten Stina', [[1500, -2000], [3500, -500], [1800, 1200], [300, -600]], 5),
    ],
    life: [herring('stromming', [[-1000, -3000], [800, -4500], [2000, -2500]], 70, 30, 80)],
    stations: [{ id: 'kustradar-ost', name: 'kustradarn på Ytterskär', position: [100, 3040], height: 30 }],
  },
  fjord: {
    id: 'fjord',
    title: 'Fjorden',
    description: 'Djup fjord mellan höga berg, med en grund tröskel vid mynningen och sötvatten i ytan.',
    starts: [
      {
        id: 'sea',
        title: 'Utanför fjorden',
        description: 'I ytläge till havs, 2 km söder om mynningen.',
        text: 'Ubåten ligger i ytläge utanför fjorden. Mynningen ligger 2 km norrut.',
        initial: { area: 'fjord', north: -2500, east: 0 },
      },
      {
        id: 'inside',
        title: 'Inne i fjorden',
        description: 'I ytläge över fjordens djupbassäng, 380 m djup.',
        text: 'Ubåten ligger i ytläge inne i fjorden.',
        initial: { area: 'fjord', north: 2000, east: 320 },
      },
      {
        id: 'periscope',
        title: 'Periskopdjup vid mynningen',
        description: '13 m, 4 knop, på väg in mot tröskeln.',
        text: 'Ubåten går på periskopdjup mot fjordens mynning. Tröskeln är 55 m djup.',
        initial: { area: 'fjord', north: -1500, depth: 13, speed: 4 * KN, neutral: true },
      },
    ],
    patrol: {
      line: [[-4500, -2000], [-4500, 2000]],
      convoy: [[-6000, -4000], [-6000, 4000]],
      lanes: [[[-7000, -5000], [-7000, 5000]], [[-8000, 3000], [-8000, -3000]]],
      depot: { name: 'depåfartyget Fjordvakt', position: [-3500, 0] },
    },
    lighthouses: [
      { name: 'Västra mynningsfyren', position: [-480, -510], color: 'red', period: 4, lit: 1 },
      { name: 'Östra mynningsfyren', position: [-480, 480], color: 'green', period: 4, lit: 1 },
    ],
    traffic: [
      // A small, handy ferry across the fjord: tight turns between the steep sides.
      ferry('fjordfarjan', 'fjordfärjan', [[2000, 100], [2000, 580]], 60, 7, 3),
      fishing('fjordfiske', 'fiskebåten Fjord', [[-3200, -900], [-3200, 900], [-2400, 900], [-2400, -900]]),
      sail('fjordsegel', 'segelbåten Bris', [[-1800, -600], [-3500, 600], [-2000, 1200]], 5),
    ],
    // Killer whales follow the herring into the fjords in winter.
    life: [
      herring('sill-fjord', [[1500, 440], [2500, 50], [3500, -460], [4500, -400], [5500, 120], [4500, -400], [3000, -260], [2000, 320]], 120, 35, 70),
      orcas('spackhuggare', [[1000, 360], [2500, 50], [4000, -510], [5000, -160], [6000, 360], [5000, -160], [3500, -460], [2000, 320]]),
    ],
  },
  atlantic: {
    id: 'atlantic',
    title: 'Atlanten',
    description: 'Djuphav utan botten inom räckhåll. Krossdjupet är gränsen.',
    starts: [
      { id: 'surface', title: 'Ytläge', description: 'Stilla vid ytan, 1 800 m djup.', text: 'Ubåten ligger i ytläge på Atlanten.', initial: { area: 'atlantic' } },
      {
        id: 'periscope',
        title: 'Periskopdjup',
        description: '13 m, 4 knop, neutralt trimmad.',
        text: 'Ubåten går på periskopdjup på Atlanten.',
        initial: { area: 'atlantic', depth: 13, speed: 4 * KN, neutral: true },
      },
      {
        id: 'deep',
        title: 'Djupt vatten',
        description: '200 m, 8 knop. Krossdjupet är 300 m.',
        text: 'Ubåten går på 200 m djup. Krossdjupet är 300 m.',
        initial: { area: 'atlantic', depth: 200, speed: 8 * KN, neutral: true },
      },
    ],
    patrol: {
      line: [[-5000, -6000], [5000, -6000]],
      convoy: [[10000, -3000], [-10000, -3000]],
      lanes: [[[6000, -10000], [6000, 10000]], [[-10000, 4000], [10000, 4000]]],
      depot: { name: 'depåfartyget Thule', position: [0, 6000] },
    },
    lighthouses: [],
    traffic: [freighter('atlantica', 'M/S Atlantica', [[-8000, 3000], [8000, 3000]], 200)],
    life: [
      spermWhale('kaskelot', [[-4000, -4000], [4000, -3000], [2000, -6000]]),
      humpback('knolval', [[3000, 2000], [-3000, 1000], [-1000, 4000]], 200),
      herring('sill-atlant', [[-2000, 1500], [1000, 2500], [2500, 500]], 380, 45, 90),
    ],
  },
  shelf: {
    id: 'shelf',
    title: 'Eggakanten',
    description: 'Kontinentalsockeln utanför Norge: sockeln, branten ned mot djuphavet, en undervattenskanjon och undervattensberg.',
    starts: [
      {
        id: 'shelf',
        title: 'På sockeln',
        description: 'I ytläge på sockeln, 150 m djup. Kanjonen 1,5 km norrut, branten 3 km västerut.',
        text: 'Ubåten ligger i ytläge på sockeln. Kanjonen går öst–väst 1,5 km norrut, och 3 km västerut stupar botten ned mot djuphavet.',
        initial: { area: 'shelf', north: -1500, east: 3000 },
      },
      {
        id: 'canyon',
        title: 'I kanjonen',
        description: '200 m, 4 knop, i kanjonen under sockelns nivå. Väggarna reser sig till 150 m.',
        text: 'Ubåten går på 200 m i kanjonen. Sockeln ligger på 150 m på båda sidor: följ kanjonen och håll koll på "Under köl".',
        initial: { area: 'shelf', north: -376, east: 3000, depth: 200, speed: 4 * KN, neutral: true, heading: 270 * DEG },
      },
      {
        id: 'periscope',
        title: 'Periskopdjup vid kanten',
        description: '13 m, 4 knop, där sockeln tar slut.',
        text: 'Ubåten går på periskopdjup över sockelns kant. Västerut blir det snabbt djupt.',
        initial: { area: 'shelf', north: -1500, east: 300, depth: 13, speed: 4 * KN, neutral: true, heading: 270 * DEG },
      },
      {
        id: 'seamount',
        title: 'Över Havbåen',
        description: '120 m, 5 knop, över ett flatt undervattensberg i djuphavet.',
        text: 'Ubåten går på 120 m över Havbåen, ett undervattensberg med flat topp på 190 m. Runt det är det 1 600 m djupt.',
        initial: { area: 'shelf', north: -7000, east: -11000, depth: 120, speed: 5 * KN, neutral: true, heading: 0 },
      },
    ],
    patrol: {
      line: [[-8000, -6000], [8000, -6000]],
      convoy: [[-14000, -9000], [14000, -9000]],
      lanes: [[[14000, -12000], [-14000, -12000]], [[-12000, -4500], [12000, -4500]]],
      depot: { name: 'depåfartyget Skarv', position: [-2000, -1500] },
    },
    lighthouses: [
      { name: 'Eggøy fyr', position: [2000, 9400], color: 'white', period: 10, lit: 1 },
      { name: 'Sørskjær fyr', position: [-3000, 10000], color: 'red', period: 6, lit: 2 },
    ],
    traffic: [
      ferry('nordstjerna', 'kustfärjan Nordstjerna', [[-14000, 7200], [14000, 7200]], 120, 15, 1),
      freighter('eggafjell', 'M/S Eggafjell', [[14000, -3000], [-14000, -3000]], 150),
      // A bottom trawl along the shelf (the bottom is ~150 m).
      trawler('havbris', 'trålaren Havbris', [[-5000, 4500], [5000, 4500], [5000, 5200], [-5000, 5200]], 125, 152),
      sail('nordlys', 'segelbåten Nordlys', [[-3000, 7600], [3000, 7700], [4000, 7300], [-2000, 7300]]),
    ],
    life: [
      spermWhale('kaskelot-egga', [[-6000, -4500], [6000, -4000], [0, -7000]], 300),
      orcas('spackhuggare-egga', [[-4000, 2000], [3000, 3500], [4000, 1500], [-2000, 1000]]),
      herring('sill-egga', [[-3000, 2500], [2000, 3500], [3500, 1800]], 120, 35, 90),
      herring('sill-kant', [[1500, -1500], [-2500, -800], [-500, -2500]], 400, 50, 70),
      minke('vikval-egga', [[5000, 5500], [-4000, 6000], [0, 4000]], 50),
    ],
    aircraft: [
      {
        id: 'ornen', name: 'spaningsplanet Ørnen', altitude: 300, speed: 85, turnRate: (3 * Math.PI) / 180, arrives: 900,
        route: [[-18000, -6000], [18000, -6000], [18000, 3000], [-18000, 3000]],
      },
    ],
    stations: [{ id: 'kustradar-egga', name: 'kustradarn på Eggøy', position: [2000, 9700], height: 90 }],
  },
};

export const AREA_ORDER: AreaId[] = ['westCoast', 'baltic', 'fjord', 'atlantic', 'shelf'];

/** Lighthouse lamp on at simulation time t (deterministic). */
export const lighthouseOn = (l: Lighthouse, t: number): boolean => t % l.period < l.lit;
