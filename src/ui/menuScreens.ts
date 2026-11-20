/**
 * The menu screens: one function per screen, returning HTML from `html`
 * templates (every inserted value is escaped). Buttons carry
 * data-action/data-arg and inputs a name; menu.ts handles the events.
 */
import { formatSimTime } from '../control/controller';
import { HELP_TEXT } from '../control/parser';
import { SCENARIOS, lockText, type Scenario } from '../control/scenarios';
import { CREW_NAME, CREW_NOUN, CREW_ROLE, CREW_SYSTEMS, LOCK_TEXT, swedishList, type CrewDuties, type CrewLocks, type CrewSystem } from '../control/crew';
import { AREA_INFO, AREA_ORDER, CONDITIONS, SEA_CHOICES, type ConditionsId } from '../control/areas';
import type { SeaStateId } from '../sim/config/seaStates';
import type { AreaId } from '../sim/config/areas';
import { html, type SafeHtml } from './dom';
import type { Settings } from './settings';

export type Screen = 'main' | 'free' | 'free-area' | 'scenarios' | 'settings' | 'help' | 'pause' | 'crew' | 'result' | 'intro';

/** What the pause menu and ☰ → Besättning need to know about the running game. */
export interface PauseInfo {
  /** Who handles what (including orders still waiting in the queue); null outside a game. */
  duties: CrewDuties | null;
  locks: CrewLocks;
}

export interface ResultInfo {
  scenario: Scenario;
  completed: boolean;
  message: string;
  time: number;
  /** What the player handled at some time during the scenario. */
  selfHandled: CrewSystem[];
}

/** "Du skötte själv trimmet och ballasten · utan skyddsnät", or that the crew handled everything. */
export function handledText(self: readonly CrewSystem[]): string {
  const systems = self.filter((x) => x !== 'safetyNet').map((x) => CREW_NOUN[x]);
  const parts: string[] = [];
  if (systems.length) parts.push(`Du skötte själv ${swedishList(systems)}`);
  if (self.includes('safetyNet')) parts.push('utan skyddsnät');
  return parts.length ? `${parts.join(', ')}.` : 'Besättningen skötte allt.';
}

/** What the screens show. */
export interface MenuState {
  settings: Settings;
  pauseInfo: PauseInfo;
  result: ResultInfo | null;
  /** Free play: chosen area, light/visibility and sea state. */
  area: AreaId;
  conditions: ConditionsId;
  sea: SeaStateId;
}

const back = html`<button class="menu-btn secondary" data-action="back">‹ Tillbaka</button>`;

export const SCREENS: Record<Screen, (m: MenuState) => SafeHtml> = {
  main: () => {
    return html`
      <h1 class="menu-title">Ubåtssim</h1>
      <p class="menu-sub">Simulering av en dieselelektrisk ubåt</p>
      <p class="menu-note">Besättningen sköter ubåten från start. Ta över det du vill sköta själv, när du vill.</p>
      <div class="menu-list">
        <button class="menu-btn primary" data-action="nav" data-arg="free">Fritt spel</button>
        <button class="menu-btn" data-action="nav" data-arg="scenarios">Scenarier</button>
        <button class="menu-btn" data-action="nav" data-arg="settings">Inställningar</button>
        <button class="menu-btn" data-action="nav" data-arg="help">Hjälp</button>
      </div>`;
  },
  pause: (m) => {
    return html`
      <h2 class="menu-title small">Paus</h2>
      <p class="menu-sub">${crewSummary(m.pauseInfo.duties)}</p>
      <div class="menu-list">
        <button class="menu-btn primary" data-action="resume">Fortsätt</button>
        <button class="menu-btn" data-action="nav" data-arg="crew">Besättning</button>
        <button class="menu-btn" data-action="restart">Starta om</button>
        <button class="menu-btn" data-action="nav" data-arg="settings">Inställningar</button>
        <button class="menu-btn" data-action="nav" data-arg="help">Hjälp</button>
        <button class="menu-btn secondary" data-action="main">Huvudmeny</button>
      </div>`;
  },
  free: () => {
    return html`
      <h2 class="menu-title small">Fritt spel</h2>
      <p class="menu-sub">Välj havsområde.</p>
      <div class="menu-list">
        ${AREA_ORDER.map((id) => html`<button class="menu-btn choice" data-action="area" data-arg="${id}"><b>${AREA_INFO[id].title}</b><span>${AREA_INFO[id].description}</span></button>`)}
      </div>
      ${back}`;
  },
  'free-area': (m) => {
    const a = AREA_INFO[m.area];
    return html`
      <h2 class="menu-title small">${a.title}</h2>
      <fieldset><legend>Ljus och sikt</legend>
        ${CONDITIONS.map((c) => html`<label class="opt"><input type="radio" name="conditions" value="${c.id}" ${m.conditions === c.id ? 'checked' : ''}/> ${c.title}</label>`)}
      </fieldset>
      <fieldset><legend>Sjögång</legend>
        ${SEA_CHOICES.map((c) => html`<label class="opt" title="${c.description}"><input type="radio" name="sea" value="${c.id}" ${m.sea === c.id ? 'checked' : ''}/> ${c.title}</label>`)}
      </fieldset>
      <p class="menu-sub">Välj var du vill börja.</p>
      <div class="menu-list">
        ${a.starts.map((st) => html`<button class="menu-btn choice" data-action="free" data-arg="${st.id}"><b>${st.title}</b><span>${st.description}</span></button>`)}
      </div>
      <button class="menu-btn secondary" data-action="nav" data-arg="free">‹ Tillbaka</button>`;
  },
  scenarios: () => {
    const meta = (s: Scenario) => {
      const parts: string[] = lockText(s.locks);
      const area = s.initial.area ?? 'westCoast';
      if (area !== 'westCoast') parts.unshift(AREA_INFO[area].title);
      if (s.conditions === 'night') parts.unshift('Natt');
      if (s.conditions === 'fog') parts.unshift('Dimma');
      if (s.initial.sea === 'rough') parts.unshift('Grov sjö');
      if (s.initial.sea === 'moderate') parts.unshift('Måttlig sjö');
      parts.push(`${s.objectives.length} mål`);
      return parts.join(' · ');
    };
    const cards = SCENARIOS.map(
      (s) => html`
      <button class="menu-btn choice scenario" data-action="scenario" data-arg="${s.id}">
        <b>${s.title} <span class="badge ${s.difficulty}">${s.difficulty}</span></b>
        <span>${s.description}</span>
        <span class="meta">${meta(s)}</span>
      </button>`,
    );
    return html`<h2 class="menu-title small">Scenarier</h2><p class="menu-sub">Besättningen sköter det du inte tar över själv.</p><div class="menu-list">${cards}</div>${back}`;
  },
  settings: (m) => {
    const s = m.settings;
    const radio = (name: string, value: string, label: string, checked: boolean) =>
      html`<label class="opt"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}/> ${label}</label>`;
    return html`
      <h2 class="menu-title small">Inställningar</h2>
      <fieldset><legend>Tidskomprimering</legend>
        ${radio('timeScale', '1', '×1', s.timeScale === 1)}${radio('timeScale', '2', '×2', s.timeScale === 2)}${radio('timeScale', '4', '×4', s.timeScale === 4)}
      </fieldset>
      <fieldset><legend>Ljud</legend>
        <label class="opt">Volym <input type="range" name="volume" min="0" max="100" step="5" value="${Math.round(s.volume * 100)}"/></label><br/>
        <label class="opt"><input type="checkbox" name="soundEffects" ${s.soundEffects ? 'checked' : ''}/> Maskiner och larm</label>
        <label class="opt"><input type="checkbox" name="soundAmbience" ${s.soundAmbience ? 'checked' : ''}/> Hav, vind och måsar</label>
        <label class="opt"><input type="checkbox" name="voice" ${s.voice ? 'checked' : ''}/> Uppläsning av order (svensk röst)</label>
        <p class="menu-note">M stänger av och sätter på ljudet under spelet.</p>
      </fieldset>
      <fieldset><legend>Grafik</legend>
        <label class="opt"><input type="checkbox" name="particles" ${s.particles ? 'checked' : ''}/> Svävande partiklar</label>
      </fieldset>
      <p class="menu-note">Inställningarna sparas i den här webbläsaren.</p>
      ${back}`;
  },
  help: () => {
    return html`
      <h2 class="menu-title small">Hjälp</h2>
      <div class="help">
        <h3>Besättningen och du</h3>
        <p>Varje spel börjar med att besättningen sköter ubåten. Du tar över det du vill sköta själv, och lämnar tillbaka det när du vill:</p>
        <ul>
          <li><b>Djup</b> och <b>kurs</b>: omkopplaren <b>Auto / Hand</b> vid djupskalan och kompassen. På Auto håller djupstyraren och rorsmannen dina mål. På Hand styr du djuprodret och rodret själv.</li>
          <li><b>Fart</b>: telegrafen ger maskinen ett fartmål. Under <b>Fart ▾</b> styr du propellervarvet själv.</li>
          <li><b>Ballast och brygga</b>: Dyk / Yta låter besättningen sköta det. Under <b>Ballast ▾</b> fyller, blåser och stänger du huvudballasten och klarar bryggan själv.</li>
          <li><b>Trim</b>: trimassistenten kompenserar och trimmar. Under <b>Trim ▾</b> gör du det själv.</li>
          <li><b>Skyddsnät</b>: nödblåsning nära krossdjupet, djupgräns över botten och varning för grunt vatten. Slås av under ☰ → Besättning.</li>
        </ul>
        <p>Trycker du på en knapp i en panel tar du över systemet. Panelens övre knapp lämnar det till besättningen. ☰ → Besättning visar alla på ett ställe. Vissa scenarier låser något, till exempel Trimövning.</p>
        <h3>Kontrollerna</h3>
        <ul>
          <li><b>Djupskalan</b> (vänster, Auto) visar djupet (vit linje), djupmålet (blå pil), periskopdjupet, botten (brun) och skyddsnätets gräns (röd streckad). Tryck eller dra för att välja djup. Målet sätts när du släpper. ▲ / ▼ ändrar 5 m, och <b>13 m</b> går till periskopdjup. På Hand visar den djuprodret: tryck eller dra, eller Upp / Ned 5° och Noll.</li>
          <li><b>Kompassen</b> (höger, Auto) visar 60° åt varje håll från kursen (röd linje). Tryck eller dra för att välja kurs. ◀ / ▶ ändrar 10°. Bojen syns som en gul prick, och <b>Mot bojen</b> styr mot den. På Hand visar den rodret: tryck eller dra, eller BB / SB 5° och Mitt.</li>
          <li><b>Telegrafen</b> (mitten): Full, Halv och Sakta back, Stopp, och Sakta, Halv och Full fram (2, 4 och 6 knop back, 4, 8 och 12 knop fram).</li>
          <li><b>Dyk / Yta</b> byter efter ballasten. <b>Håll</b> behåller kurs och djup på Auto.</li>
          <li><b>Per</b> och <b>Vy</b> (uppe till höger) syns när ubåten är grundare än 25 m eller periskopet är uppe. <b>&gt;_</b> öppnar konsolen.</li>
        </ul>
        <h3>Tangentbord</h3>
        <table>
          <tr><th></th><th>Auto / besättningen</th><th>Hand / du</th></tr>
          <tr><td>← / →</td><td>Kurs 10° babord / styrbord</td><td>Roder 5° babord / styrbord</td></tr>
          <tr><td>↑ / ↓</td><td>Djup 5 m grundare / djupare</td><td>Djuproder 5° upp / ned</td></tr>
          <tr><td>Mellanslag</td><td>Håll kurs och djup</td><td>Roder midskepps</td></tr>
          <tr><td>Shift + ↑ / ↓</td><td>Telegrafen ett läge fram / back</td><td>Varv ±10 rpm</td></tr>
          <tr><td>D / S</td><td colspan="2">Dyk (till periskopdjup, 13 m, om inget djupare mål finns) / ytläge</td></tr>
          <tr><td>V</td><td colspan="2">Byt vy: yttre, bryggan (i ytläge) och periskopet (när det är uppe)</td></tr>
          <tr><td>P</td><td colspan="2">Periskop upp / ned. Vyn öppnas när masten är uppe.</td></tr>
          <tr><td>Z</td><td colspan="2">Periskopets förstoring, 1,5× eller 6×</td></tr>
          <tr><td>← / → i periskopet</td><td colspan="2">Vrid periskopet. Shift + ← / → styr.</td></tr>
          <tr><td>B</td><td colspan="2">Rapportera bäringen dit periskopet eller blicken från bryggan pekar</td></tr>
          <tr><td>Enter eller /</td><td colspan="2">Öppna konsolen (↑/↓ bläddrar i historiken)</td></tr>
          <tr><td>Esc</td><td colspan="2">Lämna konsolen eller en vy, eller pausa</td></tr>
          <tr><td>M</td><td colspan="2">Ljud av / på</td></tr>
        </table>
        <h3>Vyer</h3>
        <p><b>Bryggan:</b> i ytläge står du överst i tornet. Dra för att titta runt. Bryggan måste utrymmas innan ubåten dyker. Det gör besättningen, eller du med Klart bryggan under Ballast ▾.</p>
        <p><b>Periskopet:</b> hissa med P eller <code>periskop upp</code>. Det tar 8 s. Huvudet når över vattnet ner till ungefär 14 m djup. Över 6 knop vibrerar bilden.</p>
        <p>Knapparna Vy, Per, Zoom och Brg uppe till höger gör samma sak som tangenterna. Esc går tillbaka till den yttre vyn.</p>
        <h3>Ljud</h3>
        <p>Motorn, propellern, strömningen, ballasten och skrovet låter efter vad ubåten gör. Larm hörs vid grundstötning, grunt vatten, krossdjup och vatten över bryggan. M stänger av ljudet. Uppläsning av order slås på under Inställningar.</p>
        <h3>Havsområden och väder</h3>
        <p>I fritt spel väljer du havsområde, ljus och sikt (dag, natt, dimma) och sjögång. Ubåtens fasta barlast är anpassad för området, men skikten i vattnet skiljer sig:</p>
        <ul>
          <li><b>Västerhavet:</b> språngskikt på 40–70 m. Ström norrut längs kusten.</li>
          <li><b>Östersjön:</b> bräckt vatten och ett saltsprångskikt på 60–80 m. Under det blir ubåten flera ton lättare.</li>
          <li><b>Fjorden:</b> sötvatten i ytan som strömmar ut ur fjorden, en grund tröskel vid mynningen och 380 m djupt innanför.</li>
          <li><b>Atlanten:</b> ingen botten inom räckhåll. Krossdjupet 300 m är gränsen.</li>
        </ul>
        <p>I fritt spel går fartyg i varje område. De följer sina rutter, har lanternor i mörker och hörs genom skrovet när de är nära. Kom inte i vägen: en kollision loggas, och i ett scenario misslyckas uppdraget.</p>
        <p>Instrumentpanelen visar farten genom vattnet. Under "Mer" finns fart och kurs över grund och strömmen. I grov sjö rör sig ubåten i ytläge, och vågtopparna kan skölja över ett lågt periskop.</p>
        <h3>Konsolen</h3>
        <p>Konsolen (<b>&gt;_</b> eller Enter) är ett annat sätt att ge order, för den som vill skriva exakta värden. Ingenting kräver den. En order i konsolen tar över systemet den gäller, precis som en knapp: <code>roder sb 10</code> sätter kursen på Hand.</p>
        <h3>Kommandon</h3>
        <pre>${HELP_TEXT.join('\n')}</pre>
        <h3>Att tänka på</h3>
        <ul>
          <li>Djuprodren verkar bara när ubåten har fart: lyftkraften växer med farten i kvadrat.</li>
          <li><b>Flytkraft</b> (under Trim ▾) visar om ubåten är lätt (+) eller tung (−). Ta in eller pumpa ut vatten med In och Ut.</li>
          <li>Under språngskiktet (40–70 m) är vattnet tätare. Ubåten blir då lättare och behöver ta in vatten.</li>
          <li>Skrovet trycks ihop mer än vattnet på djupet, så ubåten blir långsamt tyngre ju djupare den går.</li>
          <li>Tryckluften räcker inte till hur många blåsningar som helst. Håll koll på HP-luften.</li>
          <li><b>Back</b> (telegrafen eller <code>back halv</code>): propellern ger mindre kraft bakåt, och farten blir högst ungefär 6,5 knop. Rodren verkar omvänt: roder styrbord vrider fören åt babord, och djuprodren likaså. Djupstyraren och rorsmannen tar hänsyn till det. Ubåten glider länge, så slå stopp i god tid.</li>
        </ul>
      </div>
      ${back}`;
  },
  intro: () => {
    return html`
      <h2 class="menu-title small">Besättningen sköter ubåten</h2>
      <ul class="intro">
        <li><b>Djupskalan</b> till vänster: tryck eller dra för att välja djup. ▲ / ▼ ändrar 5 m.</li>
        <li><b>Kompassen</b> till höger: tryck eller dra för att välja kurs. ◀ / ▶ ändrar 10°.</li>
        <li><b>Telegrafen</b> i mitten väljer fart, från Full back till Full fram.</li>
        <li><b>Dyk / Yta</b> sköter huvudballasten, och <b>Håll</b> behåller kurs och djup.</li>
        <li>Trimassistenten trimmar ubåten. Det den gör syns i loggen.</li>
        <li>Vill du sköta något själv? Växla djup eller kurs till <b>Hand</b>, eller öppna <b>Ballast ▾</b>, <b>Trim ▾</b> och <b>Fart ▾</b>. ☰ → Besättning visar allt.</li>
        <li>På dator fungerar också tangenterna: ↑ / ↓ djup, ← / → kurs, Shift + ↑ / ↓ fart, D dyk och S yta.</li>
      </ul>
      <div class="menu-list">
        <button class="menu-btn primary" data-action="introDone">Kör</button>
      </div>`;
  },
  crew: (m) => {
    const d = m.pauseInfo.duties;
    if (!d) return html`<h2 class="menu-title small">Besättning</h2>${back}`;
    const row = (x: CrewSystem) => {
      const lock = m.pauseInfo.locks[x];
      const crew = d[x];
      const choice = (value: boolean, label: string) =>
        html`<button class="menu-btn seg ${crew === value ? 'on' : ''}" data-action="crew" data-arg="${x}:${value ? '1' : '0'}" ${lock !== undefined && lock !== value ? 'disabled' : ''} aria-pressed="${String(crew === value)}">${label}</button>`;
      return html`<div class="crew-row">
        <div><b>${CREW_NAME[x]}</b><small>${lock !== undefined ? LOCK_TEXT[x][lock ? 0 : 1] : CREW_ROLE[x][crew ? 0 : 1]}</small></div>
        <div class="crew-choice">${choice(true, x === 'safetyNet' ? 'På' : 'Besättningen')}${choice(false, x === 'safetyNet' ? 'Av' : 'Du')}</div>
      </div>`;
    };
    return html`
      <h2 class="menu-title small">Besättning</h2>
      <p class="menu-sub">Vem sköter vad? Ändringen gäller när du fortsätter.</p>
      <div class="crew-list">${CREW_SYSTEMS.map(row)}</div>
      <div class="menu-list">
        <button class="menu-btn" data-action="crew" data-arg="all:1">Besättningen sköter allt</button>
        <button class="menu-btn" data-action="crew" data-arg="all:0">Du sköter allt</button>
      </div>
      ${back}`;
  },
  result: (m) => {
    const r = m.result!;
    return html`
      <h2 class="menu-title small ${r.completed ? 'ok' : 'fail'}">${r.completed ? 'Uppdrag slutfört' : 'Uppdraget misslyckades'}</h2>
      <p class="menu-sub">${r.scenario.title}</p>
      <p>${r.message}</p>
      ${r.completed ? html`<p>Tid: <b>${formatSimTime(r.time)}</b></p>` : ''}
      <p class="menu-note">${handledText(r.selfHandled)}</p>
      <div class="menu-list">
        <button class="menu-btn primary" data-action="restart">Spela igen</button>
        <button class="menu-btn" data-action="nav" data-arg="scenarios">Scenarier</button>
        <button class="menu-btn secondary" data-action="main">Huvudmeny</button>
      </div>`;
  },
};

/** The pause menu's line on who handles what. */
function crewSummary(d: CrewDuties | null): string {
  if (!d) return '';
  const self = CREW_SYSTEMS.filter((x) => x !== 'safetyNet' && !d[x]).map((x) => CREW_NAME[x].toLowerCase());
  const net = d.safetyNet ? '' : ' Skyddsnätet är av.';
  return (self.length ? `Du sköter ${swedishList(self)}. Besättningen sköter resten.` : 'Besättningen sköter allt.') + net;
}
