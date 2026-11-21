/**
 * What the plant does on its own, told in the log: the diesels starting and
 * stopping, the battery running low, leaks, sealing and pumping out. The
 * safety net blows the main ballast when the boat takes in much water.
 * Called by the controller once per step, after the simulation step.
 */
import type { Controller } from './controller';

/** The crew stops the diesels at this state of charge (controller.ts starts them). */
export const CHARGE_STOP = 0.99;
/** Battery warnings at these states of charge (the last: empty). */
const BATTERY_WARNINGS = [0.3, 0.15, 0.05, 0.005] as const;
/** Water inside the hull [m^3, ~tonnes] that calls for blowing (and the safety net blows). */
const FLOOD_WARNING = 15;
const LEAK_CAUSE = { grounding: 'grundstötning', collision: 'kollision', depth: 'under krossdjupet', charge: 'sjunkbomb' } as const;

export class PlantWatch {
  /** Battery warnings already given (state of charge thresholds), and what the diesels did last step. */
  private batteryWarned = new Set<number>();
  private dieselWasRunning = false;
  private floodWarned = false;
  /** Log a hint after the next acknowledgement: the diesels were ordered on without air (set by the diesel order). */
  dieselNeedsAir = false;

  constructor(private readonly c: Controller) {}

  /**
   * Reports what the plant did on its own: the diesels starting and
   * stopping, the battery running low, leaks, sealing and pumping out. The
   * safety net blows the main ballast when the boat takes in much water.
   */
  update(): void {
    const c = this.c;
    const sim = c.sim;
    const el = sim.systems.electrics;
    if (this.dieselNeedsAir) {
      this.dieselNeedsAir = false;
      if (!el.dieselRunning) c.addLog('Dieslarna startar när snorkeln är uppe eller ubåten ligger i ytläge.', 'info');
    }
    if (el.dieselRunning !== this.dieselWasRunning) {
      if (el.dieselRunning) c.addLog('Dieslarna går. Batteriet laddas.', 'info');
      // The snorkel lowered on purpose with the diesels running (surfaced: the induction is the open hatch) is no fault.
      else if (sim.commands.diesel && el.starved > 0 && !sim.commands.snorkelUp && sim.actuators.snorkel < 1 && !el.airAtInduction()) {
        c.addLog('Dieslarna stoppade: snorkeln är nere.', 'info');
      } else if (sim.commands.diesel && el.starved > 0) c.addLog('Dieslarna har stannat: luftintaget är under vatten.', 'error');
      else if (sim.commands.diesel) c.addLog('Dieslarna har stannat: maskinrummet tar in vatten.', 'error');
      else if (el.soc >= CHARGE_STOP) c.addLog('Batteriet är laddat. Dieslarna stoppade.', 'info');
      else c.addLog('Dieslarna stoppade.', 'info');
      this.dieselWasRunning = el.dieselRunning;
    }
    for (const level of BATTERY_WARNINGS) {
      if (el.soc < level && !this.batteryWarned.has(level)) {
        this.batteryWarned.add(level);
        const pct = Math.round(level * 100);
        if (level === 0.005) c.addLog('Batteriet är tomt. Motorn får bara det dieslarna ger.', 'error');
        else c.addLog(`Batteriet är under ${pct} %. Snorkla eller gå till ytläge och ladda.`, level <= 0.1 ? 'error' : 'info');
      } else if (el.soc > level + 0.05) this.batteryWarned.delete(level);
    }

    const fl = sim.systems.flooding;
    for (const ev of fl.drainEvents()) {
      const name = fl.compartments.find((x) => x.id === ev.compartment)?.name.toLowerCase() ?? ev.compartment;
      if (ev.kind === 'leak') c.addLog(`Läckage i ${name}${ev.cause ? ` (${LEAK_CAUSE[ev.cause]})` : ''}! Länspumpen går. Gå grundare, så tätar besättningen fortare än vattnet kommer in.`, 'error');
      else if (ev.kind === 'sealed') c.addLog(`Läckan i ${name} är tätad.`, 'info');
      else if (ev.kind === 'pumpedOut') c.addLog(`${name[0]!.toUpperCase()}${name.slice(1)} är länsat.`, 'info');
      else c.addLog('Skrovet kollapsade!', 'error');
    }
    const water = fl.water;
    if (water > FLOOD_WARNING && !this.floodWarned) {
      this.floodWarned = true;
      c.addLog(`Ubåten har tagit in ${Math.round(water)} ton vatten. Blås huvudballasten och gå upp.`, 'error');
      // The safety net blows for the surface (as a crew would), unless the tanks already blow.
      if (c.options.crew.safetyNet && !sim.tanks.some((t) => t.blowOpen)) {
        c.addLog('Assistent: nödblåsning! Ubåten tar in vatten.', 'error', 'assist');
        c.submit({ kind: 'surface' }, 'assist');
        if (c.ap.speed && c.setpoints.speed < 8) c.submit({ kind: 'setSpeed', knots: 8 }, 'assist');
      }
    } else if (water < FLOOD_WARNING / 2) this.floodWarned = false;
  }
}
