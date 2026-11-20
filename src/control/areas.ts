/**
 * Game content for the sea areas: names, free-play starting positions,
 * lighthouses and the light/visibility conditions. The physics of each
 * area (terrain and water) is in src/sim/config/areas.ts.
 */
import type { AreaId } from '../sim/config/areas';
import type { InitialConditions } from '../sim/simulation';
import type { SeaStateId } from '../sim/config/seaStates';
import type { VesselDef } from '../sim/vessel';

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
  /** Ships in free play (scenarios bring their own). */
  traffic: VesselDef[];
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

export type ConditionsId = 'day' | 'night' | 'fog';

export const SEA_CHOICES: { id: SeaStateId; title: string; description: string }[] = [
  { id: 'calm', title: 'Lugnt', description: 'Ingen sjögång.' },
  { id: 'moderate', title: 'Måttlig sjö', description: 'Våghöjd 1,25 m.' },
  { id: 'rough', title: 'Grov sjö', description: 'Våghöjd 3 m.' },
];

export const CONDITIONS: { id: ConditionsId; title: string; description: string }[] = [
  { id: 'day', title: 'Dag', description: 'God sikt, ungefär 15 km.' },
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
    lighthouses: [
      { name: 'Västra fyren', position: [800, 2300], color: 'white', period: 5, lit: 0.6 },
      { name: 'Södra fyren', position: [-800, 2580], color: 'red', period: 3, lit: 1 },
    ],
    traffic: [
      freighter('skagerack', 'M/S Skagerack', [[-6000, -1500], [6000, -1500]]),
      fishing('maja', 'fiskebåten Maja', [[-1500, 600], [-1500, 1200], [-900, 1200], [-900, 600]]),
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
    lighthouses: [
      { name: 'Ytterskärs fyr', position: [0, 2980], color: 'white', period: 6, lit: 1 },
      { name: 'Norra prickens fyr', position: [1600, 2630], color: 'green', period: 4, lit: 0.5 },
    ],
    traffic: [
      ferry('ostersjo', 'färjan Östersjö', [[3000, -6000], [3000, 1200]], 170, 17),
      corvette('spejaren', 'korvetten Spejaren', [[-2500, -5000], [-2500, 800]]),
    ],
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
    lighthouses: [
      { name: 'Västra mynningsfyren', position: [-480, -510], color: 'red', period: 4, lit: 1 },
      { name: 'Östra mynningsfyren', position: [-480, 480], color: 'green', period: 4, lit: 1 },
    ],
    traffic: [
      // A small, handy ferry across the fjord: tight turns between the steep sides.
      ferry('fjordfarjan', 'fjordfärjan', [[2000, 100], [2000, 580]], 60, 7, 3),
      fishing('fjordfiske', 'fiskebåten Fjord', [[-3200, -900], [-3200, 900], [-2400, 900], [-2400, -900]]),
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
    lighthouses: [],
    traffic: [freighter('atlantica', 'M/S Atlantica', [[-8000, 3000], [8000, 3000]], 200)],
  },
};

export const AREA_ORDER: AreaId[] = ['westCoast', 'baltic', 'fjord', 'atlantic'];

/** Lighthouse lamp on at simulation time t (deterministic). */
export const lighthouseOn = (l: Lighthouse, t: number): boolean => t % l.period < l.lit;
