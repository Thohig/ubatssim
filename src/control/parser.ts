/**
 * Swedish command parser for the command console.
 *
 * Examples: "djup 120", "kurs 270", "fart 8 knop", "roder sb 15",
 * "djuproder ned 10", "fyll huvudballast", "blås hb akter",
 * "trimma för 200", "kompensera ut 300", "autopilot av", "dyk", "ytläge",
 * "back halv".
 */
import { SUBMARINE } from '../sim/config/submarine';
import type { AutopilotAxis, Order, TankGroup } from './orders';

export type ParseResult =
  | { ok: true; order: Order }
  | { ok: true; help: true }
  | { ok: false; error: string };

export const LIMITS = {
  maxDepth: 400,
  maxSpeed: 20,
  minSpeed: -6,
  maxRpm: 240,
  /** Astern shaft speed is limited by the drive [rpm]. */
  maxRpmAstern: Math.round(SUBMARINE.propulsion.maxRpsAstern * 60),
  maxRudder: 30,
  maxPlanes: 30,
  maxTrimLitres: 7500,
  maxCompLitres: 20000,
} as const;

export const HELP_TEXT = [
  'djup <m>                 – autopilot djup, t.ex. "djup 120"',
  'kurs <grader>            – autopilot kurs, t.ex. "kurs 270"',
  'fart <knop> [knop]       – autopilot fart, t.ex. "fart 8 knop", "fart stopp"',
  'back <knop>|sakta|halv|full – back 2, 4 eller 6 knop, t.ex. "back 3"',
  'varv <rpm>               – propellervarv direkt (fartautopilot av)',
  'roder sb|bb <grader>     – t.ex. "roder styrbord 15", "roder midskepps"',
  'djuproder ned|upp <gr>   – t.ex. "djuproder ned 10", "djuproder noll"',
  'fyll huvudballast [för|akter]   – öppna ventilerna',
  'blås huvudballast [för|akter]   – blås med tryckluft',
  'stäng huvudballast [för|akter]  – stäng ventiler och blåsning',
  'dyk                      – fyll huvudballasten, ventilerna stängs när den är full',
  'ytläge                   – blås huvudballasten (djupautopiloten går till 0 m)',
  'klart bryggan            – utrym bryggan före dykning',
  'bemanna bryggan          – gå upp på bryggan (i ytläge)',
  'periskop upp|ned',
  'bäring <grader>          – rapportera bäringen till något du ser',
  'trimma för|akter <liter> – pumpa mellan trimtankarna',
  'kompensera in|ut <liter> – ta in eller pumpa ut vatten',
  'autopilot på|av [djup|kurs|fart]',
  'hjälp                    – visa denna lista',
];

/** Canonical command words and their aliases. */
const COMMANDS: Record<string, string[]> = {
  djup: ['djup', 'dj'],
  kurs: ['kurs', 'k'],
  fart: ['fart', 'f'],
  varv: ['varv', 'rpm'],
  roder: ['roder', 'r'],
  djuproder: ['djuproder', 'dr'],
  fyll: ['fyll', 'ventilera'],
  dyk: ['dyk', 'dykning'],
  ytläge: ['ytläge', 'ytlage', 'yta'],
  klart: ['klart', 'klara', 'utrym'],
  bemanna: ['bemanna'],
  periskop: ['periskop', 'per'],
  bäring: ['bäring', 'baring', 'brg'],
  blås: ['blås', 'blas'],
  stäng: ['stäng', 'stang'],
  trimma: ['trimma', 'trim'],
  kompensera: ['kompensera', 'komp'],
  autopilot: ['autopilot', 'ap'],
  stopp: ['stopp', 'stop'],
  back: ['back', 'backa'],
  hjälp: ['hjälp', 'hjalp', 'help', '?'],
};

const ALIAS: Map<string, string> = new Map(
  Object.entries(COMMANDS).flatMap(([canon, aliases]) => aliases.map((a) => [a, canon] as [string, string])),
);

const STARBOARD = new Set(['sb', 'styrbord', 'stb']);
const PORT = new Set(['bb', 'babord']);
const MIDSHIPS = new Set(['midskepps', 'mitt', 'noll', 'midship']);
const DOWN = new Set(['ned', 'ner', 'dyk']);
const UP = new Set(['upp']);
const FWD = new Set(['för', 'fören', 'förut', 'for', 'forut', 'fram']);
const AFT = new Set(['akter', 'aktern', 'akterut']);
const ON = new Set(['på', 'pa', 'in', 'till']);
const OFF = new Set(['av', 'ur', 'från', 'fran']);
const BALLAST_WORDS = new Set(['huvudballast', 'hb', 'ballast', 'huvudballasten', 'ventiler', 'ventilerna', 'tankar']);
const UNIT_WORDS = new Set(['m', 'meter', 'knop', 'kn', 'grader', 'gr', '°', 'l', 'liter', 'rpm', 'varv']);

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length]![b.length]!;
}

function suggest(word: string, candidates: Iterable<string>): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = levenshtein(word, c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best !== null && bestD <= Math.max(1, Math.floor(word.length / 3)) ? best : null;
}

/** "back sakta|halv|full" [knots astern]. */
const ASTERN_BELLS: Record<string, number> = { sakta: 2, halv: 4, full: 6 };

const NUMBER_RE = /^[+-]?\d+(?:\.\d+)?$/;

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/^\s*\//, '') // tolerate a leading slash: "/djup 120"
    .replace(/°/g, ' ')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[.!]+$/, '')
    .replace(/(\d)(m|kn|l|°)\b/g, '$1 $2')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

class Tokens {
  private i = 0;
  constructor(private readonly t: string[]) {}
  peek(): string | undefined {
    return this.t[this.i];
  }
  next(): string | undefined {
    return this.t[this.i++];
  }
  rest(): string[] {
    return this.t.slice(this.i);
  }
  /** Removes all unit words and returns the remaining tokens. */
  withoutUnits(): string[] {
    return this.rest().filter((t) => !UNIT_WORDS.has(t));
  }
}

const err = (error: string): ParseResult => ({ ok: false, error });
const ok = (order: Order): ParseResult => ({ ok: true, order });

function parseNumber(tok: string | undefined): number | null {
  return tok !== undefined && NUMBER_RE.test(tok) ? Number(tok) : null;
}

function unexpected(word: string, expected: string): ParseResult {
  return err(`Förstår inte "${word}". Förväntade ${expected}.`);
}

function parseNumberArg(args: string[], what: string, example: string, min: number, max: number): number | ParseResult {
  if (args.length === 0) return err(`Ange ${what}, t.ex. "${example}".`);
  const n = parseNumber(args[0]);
  if (n === null) return err(`"${args[0]}" är inget tal. Ange ${what}, t.ex. "${example}".`);
  if (args.length > 1) return unexpected(args[1]!, 'inget mer efter talet');
  if (n < min || n > max) return err(`${what[0]!.toUpperCase()}${what.slice(1)} måste vara mellan ${min} och ${max}.`);
  return n;
}

const isResult = (v: unknown): v is ParseResult => typeof v === 'object' && v !== null && 'ok' in v;

function parseGroup(args: string[], verb: string): TankGroup | ParseResult {
  let group: TankGroup = 'all';
  for (const a of args) {
    if (BALLAST_WORDS.has(a)) continue;
    if (FWD.has(a)) group = 'fwd';
    else if (AFT.has(a)) group = 'aft';
    else {
      const s = suggest(a, [...BALLAST_WORDS, 'för', 'akter']);
      return err(`Förstår inte "${a}" efter "${verb}".${s ? ` Menade du "${s}"?` : ''} Exempel: "${verb} huvudballast", "${verb} hb akter".`);
    }
  }
  return group;
}

export function parseCommand(input: string): ParseResult {
  const tokens = tokenize(input);
  if (tokens.length === 0) return err('Tomt kommando. Skriv "hjälp" för en lista.');
  const t = new Tokens(tokens);
  const word = t.next()!;
  const cmd = ALIAS.get(word);
  if (!cmd) {
    const s = suggest(word, ALIAS.keys());
    return err(`Okänt kommando "${word}".${s ? ` Menade du "${ALIAS.get(s)}"?` : ''} Skriv "hjälp" för en lista.`);
  }

  switch (cmd) {
    case 'hjälp':
      return { ok: true, help: true };

    case 'djup': {
      const n = parseNumberArg(t.withoutUnits(), 'ett djup i meter', 'djup 120', 0, LIMITS.maxDepth);
      return isResult(n) ? n : ok({ kind: 'setDepth', depth: n });
    }

    case 'kurs': {
      const n = parseNumberArg(t.withoutUnits(), 'en kurs i grader', 'kurs 270', 0, 360);
      return isResult(n) ? n : ok({ kind: 'setHeading', heading: n % 360 });
    }

    case 'dyk':
    case 'ytläge':
      if (t.peek() !== undefined) return unexpected(t.peek()!, `inget mer efter "${cmd}"`);
      return ok({ kind: cmd === 'dyk' ? 'dive' : 'surface' });

    case 'klart':
    case 'bemanna': {
      const args = t.rest();
      if (args.length === 0 || !['bryggan', 'brygga', 'bryggen'].includes(args[0]!) || args.length > 1) {
        return err(`Skriv "${cmd} bryggan".`);
      }
      return ok({ kind: 'bridge', manned: cmd === 'bemanna' });
    }

    case 'bäring': {
      const n = parseNumberArg(t.withoutUnits(), 'en bäring i grader', 'bäring 75', 0, 360);
      return isResult(n) ? n : ok({ kind: 'reportBearing', bearing: n % 360 });
    }

    case 'periskop': {
      const args = t.rest();
      if (args.length === 1 && UP.has(args[0]!)) return ok({ kind: 'periscope', up: true });
      if (args.length === 1 && (DOWN.has(args[0]!) || args[0] === 'ned')) return ok({ kind: 'periscope', up: false });
      return err('Skriv "periskop upp" eller "periskop ned".');
    }

    case 'stopp':
      if (t.peek() !== undefined) return unexpected(t.peek()!, 'inget mer efter "stopp"');
      return ok({ kind: 'setSpeed', knots: 0 });

    case 'fart': {
      const args = t.withoutUnits();
      if (args.length === 1 && (args[0] === 'stopp' || args[0] === 'stop')) return ok({ kind: 'setSpeed', knots: 0 });
      const n = parseNumberArg(args, 'en fart i knop', 'fart 8 knop', LIMITS.minSpeed, LIMITS.maxSpeed);
      return isResult(n) ? n : ok({ kind: 'setSpeed', knots: n });
    }

    case 'back': {
      const args = t.withoutUnits();
      const named = args.length === 1 ? ASTERN_BELLS[args[0]!] : undefined;
      if (named !== undefined) return ok({ kind: 'setSpeed', knots: -named });
      if (args.length === 1 && parseNumber(args[0]) === null) {
        const s = suggest(args[0]!, Object.keys(ASTERN_BELLS));
        return err(`Förstår inte "${args[0]}" efter "back".${s ? ` Menade du "${s}"?` : ''} Exempel: "back 3", "back halv".`);
      }
      const n = parseNumberArg(args, 'en fart back i knop', 'back 3', 0, -LIMITS.minSpeed);
      return isResult(n) ? n : ok({ kind: 'setSpeed', knots: n === 0 ? 0 : -n });
    }

    case 'varv': {
      const n = parseNumberArg(t.withoutUnits(), 'propellervarv (rpm)', 'varv 120', -LIMITS.maxRpmAstern, LIMITS.maxRpm);
      return isResult(n) ? n : ok({ kind: 'setRpm', rpm: n });
    }

    case 'roder': {
      const args = t.withoutUnits();
      if (args.length === 0) return err('Ange riktning och vinkel, t.ex. "roder styrbord 15" eller "roder midskepps".');
      let side = 0;
      let angle: number | null = null;
      for (const a of args) {
        if (STARBOARD.has(a)) side = 1;
        else if (PORT.has(a)) side = -1;
        else if (MIDSHIPS.has(a)) angle = 0;
        else if (parseNumber(a) !== null) angle = parseNumber(a);
        else {
          const s = suggest(a, ['styrbord', 'babord', 'sb', 'bb', 'midskepps']);
          return err(`Förstår inte "${a}" efter "roder".${s ? ` Menade du "${s}"?` : ''} Exempel: "roder sb 15".`);
        }
      }
      if (angle === null) return err('Ange vinkel i grader, t.ex. "roder styrbord 15".');
      if (angle !== 0 && side === 0) return err('Ange styrbord (sb) eller babord (bb), t.ex. "roder bb 10".');
      if (Math.abs(angle) > LIMITS.maxRudder) return err(`Roderutslaget kan vara högst ${LIMITS.maxRudder}°.`);
      return ok({ kind: 'rudder', angle: side * Math.abs(angle) });
    }

    case 'djuproder': {
      const args = t.withoutUnits();
      if (args.length === 0) return err('Ange riktning och vinkel, t.ex. "djuproder ned 10" eller "djuproder noll".');
      let dir = 0;
      let angle: number | null = null;
      for (const a of args) {
        if (DOWN.has(a)) dir = 1;
        else if (UP.has(a)) dir = -1;
        else if (MIDSHIPS.has(a)) angle = 0;
        else if (parseNumber(a) !== null) angle = parseNumber(a);
        else {
          const s = suggest(a, ['ned', 'upp', 'noll']);
          return err(`Förstår inte "${a}" efter "djuproder".${s ? ` Menade du "${s}"?` : ''} Exempel: "djuproder ned 10".`);
        }
      }
      if (angle === null) return err('Ange vinkel i grader, t.ex. "djuproder upp 5".');
      if (angle !== 0 && dir === 0) return err('Ange "ned" eller "upp", t.ex. "djuproder ned 10".');
      if (Math.abs(angle) > LIMITS.maxPlanes) return err(`Djuproderutslaget kan vara högst ${LIMITS.maxPlanes}°.`);
      return ok({ kind: 'planes', angle: dir * Math.abs(angle) });
    }

    case 'fyll':
    case 'blås':
    case 'stäng': {
      const args = t.rest();
      const g = parseGroup(args, cmd);
      if (isResult(g)) return g;
      const action = cmd === 'fyll' ? 'flood' : cmd === 'blås' ? 'blow' : 'shut';
      return ok({ kind: 'mainBallast', action, group: g });
    }

    case 'trimma': {
      const args = t.withoutUnits();
      let dir = 0;
      let litres: number | null = null;
      for (const a of args) {
        if (FWD.has(a)) dir = 1;
        else if (AFT.has(a)) dir = -1;
        else if (parseNumber(a) !== null) litres = parseNumber(a);
        else {
          const s = suggest(a, ['för', 'akter']);
          return err(`Förstår inte "${a}" efter "trimma".${s ? ` Menade du "${s}"?` : ''} Exempel: "trimma för 200".`);
        }
      }
      if (dir === 0) return err('Ange "för" eller "akter", t.ex. "trimma för 200".');
      if (litres === null) return err('Ange mängd i liter, t.ex. "trimma akter 150".');
      if (litres <= 0 || litres > LIMITS.maxTrimLitres) return err(`Mängden måste vara mellan 1 och ${LIMITS.maxTrimLitres} liter.`);
      return ok({ kind: 'trim', litres: dir * litres });
    }

    case 'kompensera': {
      const args = t.withoutUnits();
      let dir = 0;
      let litres: number | null = null;
      for (const a of args) {
        if (a === 'in') dir = 1;
        else if (a === 'ut') dir = -1;
        else if (parseNumber(a) !== null) {
          litres = parseNumber(a);
          if (a.startsWith('-')) dir = -1;
          else if (a.startsWith('+')) dir = 1;
        } else {
          const s = suggest(a, ['in', 'ut']);
          return err(`Förstår inte "${a}" efter "kompensera".${s ? ` Menade du "${s}"?` : ''} Exempel: "kompensera ut 300".`);
        }
      }
      if (litres === null) return err('Ange mängd i liter, t.ex. "kompensera in 200" eller "kompensera ut 300".');
      if (dir === 0) return err('Ange "in" (ta in vatten) eller "ut" (pumpa ut), t.ex. "kompensera ut 300".');
      const amount = Math.abs(litres);
      if (amount === 0 || amount > LIMITS.maxCompLitres) return err(`Mängden måste vara mellan 1 och ${LIMITS.maxCompLitres} liter.`);
      return ok({ kind: 'compensate', litres: dir * amount });
    }

    case 'autopilot': {
      const args = t.rest();
      let on: boolean | null = null;
      let axis: AutopilotAxis = 'all';
      for (const a of args) {
        if (ON.has(a)) on = true;
        else if (OFF.has(a)) on = false;
        else if (a === 'djup') axis = 'depth';
        else if (a === 'kurs') axis = 'heading';
        else if (a === 'fart') axis = 'speed';
        else {
          const s = suggest(a, ['på', 'av', 'djup', 'kurs', 'fart']);
          return err(`Förstår inte "${a}" efter "autopilot".${s ? ` Menade du "${s}"?` : ''} Exempel: "autopilot av", "autopilot på djup".`);
        }
      }
      if (on === null) return err('Ange "på" eller "av", t.ex. "autopilot av".');
      return ok({ kind: 'autopilot', axis, on });
    }
  }
  return err(`Okänt kommando "${word}".`);
}
