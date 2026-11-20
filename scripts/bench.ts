/**
 * Benchmark of the physics: time per fixed step (100 Hz) for typical
 * situations. Run with `npm run bench`. The budget is in docs/prestanda.md.
 */
import { it } from 'vitest';
import { Controller } from '../src/control/controller';
import { Simulation, type InitialConditions } from '../src/sim/simulation';

const KN = 1852 / 3600;
const cases: [string, InitialConditions][] = [
  ['Ytläge, lugnt', {}],
  ['Ytläge, grov sjö', { sea: 'rough' }],
  ['Periskopdjup, måttlig sjö', { depth: 13, speed: 4 * KN, neutral: true, sea: 'moderate' }],
  ['100 m, 8 knop', { depth: 100, speed: 8 * KN, neutral: true }],
  ['Skärgården (terräng nära)', { east: 2560 }],
  ['Fjorden, 30 m', { area: 'fjord', depth: 30, north: -200, speed: 5 * KN, neutral: true }],
];

it('fysikens tid per tidssteg', () => {
for (const [name, init] of cases) {
  const c = new Controller(new Simulation(init));
  c.setMode('simplified');
  c.submit({ kind: 'setSpeed', knots: 6 }, 'console');
  for (let i = 0; i < 500; i++) c.step(); // warm up the JIT and the terrain cache
  const n = 3000;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) c.step();
  const step = (performance.now() - t0) / n;
  const t1 = performance.now();
  for (let i = 0; i < 300; i++) c.sim.telemetry();
  const tel = (performance.now() - t1) / 300;
  console.log(`${name.padEnd(30)} steg ${(step * 1000).toFixed(0).padStart(4)} µs  (×1: ${(step * 100).toFixed(1)} ms/s, ×4: ${(step * 400).toFixed(1)} ms/s)  telemetri ${(tel * 1000).toFixed(0)} µs`);
}
}, 600000);
