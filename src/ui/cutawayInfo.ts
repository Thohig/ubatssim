/**
 * The cutaway's information box: the tapped space's name, what is there and
 * its live state from the telemetry. Pure (no DOM), tested in tests/cutaway.test.ts.
 */
import type { SubmarineConfig } from '../sim/config/submarine';
import type { Telemetry } from '../sim/simulation';
import { OUTSIDE, spaces } from '../render/interior';

export interface CutawayInfo {
  title: string;
  description: string;
  /** Live values, one per line. */
  lines: string[];
}

const DEG = 180 / Math.PI;
const f = (v: number, d = 0) => v.toFixed(d).replace('.', ',');
const litres = (m3: number) => `${f(Math.abs(m3) * 1000)} l`;

/** What the box says about a space (interior.ts ids), or null for an unknown id. */
export function cutawayInfo(cfg: SubmarineConfig, id: string, t: Telemetry, extra: { bridgeManned: boolean }): CutawayInfo | null {
  const space = spaces(cfg).find((s) => s.id === id);
  if (!space) return null;
  const lines: string[] = [];
  const tank = t.tanks.find((x) => x.id === id);
  if (tank) {
    lines.push(`Fylld ${f(tank.fill * 100)} %: ${tank.volume >= 50 ? `${f(tank.water, 1)} av ${f(tank.volume)} m³` : `${litres(tank.water)} av ${litres(tank.volume)}`}`);
    if (tank.ventOpen) lines.push('Ventilerna är öppna: vatten strömmar in, luften går ut.');
    if (tank.blowOpen) lines.push('Blåses med tryckluft.');
    if (tank.kind === 'trim' && t.trimRemaining !== 0) lines.push(`Trimpumpen går: ${litres(t.trimRemaining)} kvar ${t.trimRemaining > 0 ? 'förut' : 'akterut'}.`);
    if (tank.kind === 'compensating' && t.compRemaining !== 0) lines.push(`Kompenseringspumpen går: ${litres(t.compRemaining)} kvar ${t.compRemaining > 0 ? 'in' : 'ut'}.`);
  } else if (space.kind === 'compartment') {
    // Sea pressure on the pressure hull: about 1 bar per 10 m.
    lines.push(`Tryck på skrovet: ${f(1 + Math.max(0, t.depth) * 0.1, 1)} bar (${f(t.depth)} m djup).`);
    if (id === 'control') {
      lines.push(`HP-luft: ${f(t.airPressure / 1e5)} bar.`);
      if (t.trimRemaining !== 0 || t.compRemaining !== 0) lines.push('Pumparna går.');
    }
    if (id === 'living') lines.push('Batteriets laddning simuleras inte ännu.');
    if (id === 'engine') lines.push('Dieselmotorerna och snorklingen simuleras inte ännu.');
    if (id === 'motor') lines.push(`Huvudmotorn: ${f(t.rps * 60)} rpm, ${f(t.shaftPower / 1000)} kW.`);
  } else if (id === 'sail') {
    lines.push(`Periskopet: ${t.periscope > 0.99 ? 'uppe' : t.periscope < 0.01 ? 'nere' : `${f(t.periscope * 100)} % uppe`}.`);
    lines.push(`Bryggan: ${extra.bridgeManned ? 'bemannad' : 'utrymd'}.`);
  } else if (id === 'aftPeak') {
    lines.push(`Roder: ${f(t.rudder * DEG, 1)}°, djuproder: ${f(t.sternPlanes * DEG, 1)}°.`);
    lines.push(`Propellern: ${f(t.rps * 60)} rpm.`);
  } else if (id in OUTSIDE) {
    lines.push('Fritt flödande: fylls med vatten när ubåten dyker.');
  }
  return { title: space.name, description: space.description, lines };
}

/** Body x [m] to centre the cutaway on for a space. */
export function spaceCentre(cfg: SubmarineConfig, id: string): number | undefined {
  const c = cfg.compartments.find((x) => x.id === id);
  if (c) return (c.xRange[0] + c.xRange[1]) / 2;
  const tk = cfg.tanks.find((x) => x.id === id);
  if (tk) return tk.position[0];
  const o = OUTSIDE[id as keyof typeof OUTSIDE];
  return o ? (o.xRange[0] + o.xRange[1]) / 2 : undefined;
}
