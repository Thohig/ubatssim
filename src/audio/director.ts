/**
 * Connects the game to the sound: levels from the telemetry ten times a
 * second, one-shot cues from log lines and state changes, and the voice.
 */
import { AudioEngine, type AudioOptions, type Cue } from './engine';
import { CRUSH_WARNING_DEPTH, soundLevels, type AudioInput } from './levels';
import { Voice, speechFor } from './voice';

export interface AudioSettings extends AudioOptions {
  voice: boolean;
}

/** Cue for a log line, or null. */
export function cueFor(text: string): Cue | null {
  if (/^Grundstötning/.test(text)) return 'grounding';
  if (/^Vatten över bryggan/.test(text)) return 'splash';
  if (/nödblåsning/.test(text)) return 'alarm';
  if (/^Huvudballasten är full/.test(text)) return 'clonk';
  if (/^Läckage i|^Skrovet kollapsade/.test(text)) return 'alarm';
  // A new speed order rings the engine-order telegraph (not "Fart öka 1 knop").
  if (/^(Back|Fart) \d[\d,]* knop, ja/.test(text)) return 'telegraph';
  if (/^Mål klart/.test(text)) return 'objective';
  return null;
}

export class AudioDirector {
  readonly engine = new AudioEngine();
  readonly voice = new Voice();
  private lastDepth = 0;
  private lastPeriscope = 0;
  private running = false;

  apply(s: AudioSettings): void {
    this.engine.setOptions(s);
    this.voice.enabled = s.voice;
  }

  /** Call from a user gesture (browsers require it before any sound). */
  unlock(): void {
    this.engine.unlock();
  }

  setRunning(on: boolean): void {
    this.running = on;
    this.engine.setRunning(on);
    if (!on) this.voice.stop();
  }

  /** A new game: forget the previous one's state. */
  reset(depth: number, periscope: number): void {
    this.lastDepth = depth;
    this.lastPeriscope = periscope;
  }

  update(input: AudioInput): void {
    this.engine.update(soundLevels(input));
    const t = input.t;
    // Alarm when passing the crush warning depth on the way down.
    if (this.lastDepth <= CRUSH_WARNING_DEPTH && t.depth > CRUSH_WARNING_DEPTH) this.engine.cue('alarm');
    // The periscope reaching its end stop.
    const p = t.periscope;
    if ((p >= 1 && this.lastPeriscope < 1) || (p <= 0 && this.lastPeriscope > 0)) this.engine.cue('clonk');
    this.lastDepth = t.depth;
    this.lastPeriscope = p;
  }

  onLog(text: string, kind: 'ack' | 'error' | 'info', source?: string): void {
    if (!this.running) return; // the demo behind the menu is silent
    const cue = cueFor(text);
    if (cue === 'splash') this.engine.cue('alarm');
    if (cue) this.engine.cue(cue);
    const speech = speechFor(text, kind, source);
    if (speech) this.voice.say(speech);
  }

  onScenarioEnd(completed: boolean): void {
    this.engine.cue(completed ? 'success' : 'failure');
  }
}
