/**
 * The menu screens: one function per screen, returning HTML from `html`
 * templates (every inserted value is escaped). Buttons carry
 * data-action/data-arg and inputs a name; menu.ts handles the events.
 */
import { formatSimTime } from '../control/controller';
import { HELP_TEXT } from '../control/parser';
import { SCENARIOS, scenarioModes, type Scenario } from '../control/scenarios';
import { GAME_MODES, GAME_MODE_NAME, GAME_MODE_TEXT, type GameMode } from '../control/gameMode';
import { AREA_INFO, AREA_ORDER, CONDITIONS, SEA_CHOICES, type ConditionsId } from '../control/areas';
import type { SeaStateId } from '../sim/config/seaStates';
import type { AreaId } from '../sim/config/areas';
import { html, type SafeHtml } from './dom';
import type { Settings } from './settings';

export type Screen = 'main' | 'free' | 'free-area' | 'scenarios' | 'settings' | 'help' | 'pause' | 'result' | 'intro';

/** What the pause menu needs to know about the running game. */
export interface PauseInfo {
  mode: GameMode;
  /** False when the scenario allows only one mode. */
  canSwitch: boolean;
}

export interface ResultInfo {
  scenario: Scenario;
  completed: boolean;
  message: string;
  time: number;
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
  main: (m) => {
    return html`
      <h1 class="menu-title">Ubåtssim</h1>
      <p class="menu-sub">Simulering av en dieselelektrisk ubåt</p>
      <div class="mode-choice" role="radiogroup" aria-label="Spelläge">
        ${GAME_MODES.map(
          (gm) => html`<label class="mode-opt"><input type="radio" name="mode" value="${gm}" ${m.settings.mode === gm ? 'checked' : ''}/>
            <span><b>${GAME_MODE_NAME[gm]}</b><small>${GAME_MODE_TEXT[gm]}</small></span></label>`,
        )}
      </div>
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
      <p class="menu-sub">${GAME_MODE_NAME[m.pauseInfo.mode]}</p>
      <div class="menu-list">
        <button class="menu-btn primary" data-action="resume">Fortsätt</button>
        ${
          m.pauseInfo.canSwitch
            ? html`<button class="menu-btn" data-action="switchMode">Byt till ${GAME_MODE_NAME[m.pauseInfo.mode === 'simplified' ? 'realistic' : 'simplified'].toLowerCase()}</button>`
            : html`<p class="menu-note">Det här scenariot kräver ${GAME_MODE_NAME[m.pauseInfo.mode].toLowerCase()}.</p>`
        }
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
  scenarios: (m) => {
    const mode = m.settings.mode;
    const meta = (s: Scenario) => {
      const parts: string[] = [];
      const modes = scenarioModes(s);
      if (!modes.includes(mode)) parts.push(`Kräver ${GAME_MODE_NAME[modes[0]!].toLowerCase()}`);
      const playedIn = modes.includes(mode) ? mode : modes[0]!;
      if (playedIn === 'realistic' && !s.autopilotAllowed) parts.push('Utan autopilot');
      if (playedIn === 'simplified' && s.safetyNet === false) parts.push('Utan automatisk nödblåsning');
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
    return html`<h2 class="menu-title small">Scenarier</h2><p class="menu-sub">${GAME_MODE_NAME[mode]}</p><div class="menu-list">${cards}</div>${back}`;
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
      <fieldset><legend>Realistisk simulering, fritt spel</legend>
        <label class="opt"><input type="checkbox" name="autopilot" ${s.autopilot ? 'checked' : ''}/> Tillåt autopilot för djup och kurs</label>
      </fieldset>
      <fieldset><legend>Pekknappar (realistisk simulering)</legend>
        ${radio('touch', 'auto', 'Automatiskt', s.touch === 'auto')}${radio('touch', 'on', 'Alltid', s.touch === 'on')}${radio('touch', 'off', 'Aldrig', s.touch === 'off')}
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
        <h3>Spelläge</h3>
        <p><b>Förenklad simulering:</b> du anger djup och kurs, och autopiloten styr roder och djuproder. Sätter du ett djupmål i ytläge fylls huvudballasten automatiskt, och går du mot ytan (grundare än 5 m) blåses den. Assistenten kompenserar och trimmar ubåten och nödblåser nära krossdjupet. Allt den gör syns i loggen.</p>
        <p><b>Realistisk simulering:</b> du styr roder och djuproder och sköter ballast, trim och kompensering själv.</p>
        <p>Läget väljs på startsidan och kan bytas i pausmenyn.</p>
        <h3>Tangentbord</h3>
        <table>
          <tr><th></th><th>Förenklad</th><th>Realistisk</th></tr>
          <tr><td>← / →</td><td>Kurs 10° babord / styrbord</td><td>Roder 5° babord / styrbord</td></tr>
          <tr><td>↑ / ↓</td><td>Djup 5 m grundare / djupare</td><td>Djuproder 5° upp / ned</td></tr>
          <tr><td>Mellanslag</td><td>Håll kurs och djup</td><td>Roder midskepps</td></tr>
          <tr><td>D</td><td>Dyk (till periskopdjup, 13 m, om inget djupare mål finns)</td><td>–</td></tr>
          <tr><td>S</td><td>Ytläge</td><td>–</td></tr>
          <tr><td>Shift + ↑ / ↓</td><td>Telegrafen ett läge fram / back</td><td>Fart ±1 knop. Under noll går ubåten back, högst 6 knop.</td></tr>
          <tr><td>V</td><td colspan="2">Byt vy: yttre, bryggan (i ytläge) och periskopet (när det är uppe)</td></tr>
          <tr><td>P</td><td colspan="2">Periskop upp / ned. Vyn öppnas när masten är uppe.</td></tr>
          <tr><td>Z</td><td colspan="2">Periskopets förstoring, 1,5× eller 6×</td></tr>
          <tr><td>← / → i periskopet</td><td colspan="2">Vrid periskopet. Shift + ← / → styr.</td></tr>
          <tr><td>B</td><td colspan="2">Rapportera bäringen dit periskopet eller blicken från bryggan pekar</td></tr>
          <tr><td>Enter eller /</td><td>– (ingen konsol)</td><td>Öppna konsolen (↑/↓ bläddrar i historiken)</td></tr>
          <tr><td>Esc</td><td colspan="2">Lämna konsolen eller en vy, eller pausa</td></tr>
          <tr><td>M</td><td colspan="2">Ljud av / på</td></tr>
        </table>
        <h3>Förenklad simulering: kontrollerna</h3>
        <p>Förenklad simulering har ingen konsol. Allt styrs med kontrollerna längst ner, på dator och mobil, eller med tangenterna ovan.</p>
        <ul>
          <li><b>Djupskalan</b> (vänster) visar djupet (vit linje), djupmålet (blå pil), periskopdjupet, botten (brun) och skyddsnätets gräns (röd streckad). Tryck eller dra för att välja djup. Målet sätts när du släpper. ▲ / ▼ ändrar 5 m, och <b>13 m</b> går till periskopdjup.</li>
          <li><b>Kompassen</b> (höger) visar 60° åt varje håll från kursen (röd linje). Tryck eller dra för att välja kurs. ◀ / ▶ ändrar 10°. Bojen syns som en gul prick, och <b>Mot bojen</b> styr mot den.</li>
          <li><b>Telegrafen</b> (mitten): Full, Halv och Sakta back, Stopp, och Sakta, Halv och Full fram (2, 4 och 6 knop back, 4, 8 och 12 knop fram).</li>
          <li><b>Dyk / Yta</b> byter efter ballasten. <b>Håll</b> behåller kurs och djup.</li>
          <li><b>Per</b> och <b>Vy</b> (uppe till höger) syns när ubåten är grundare än 25 m eller periskopet är uppe.</li>
        </ul>
        <h3>Vyer</h3>
        <p><b>Bryggan:</b> i ytläge står du överst i tornet. Dra för att titta runt. Bryggan måste utrymmas innan ubåten dyker: skriv <code>klart bryggan</code> i realistisk simulering. I förenklad simulering sköts det automatiskt.</p>
        <p><b>Periskopet:</b> hissa med P eller <code>periskop upp</code>. Det tar 8 s. Huvudet når över vattnet ner till ungefär 14 m djup. Över 6 knop vibrerar bilden.</p>
        <p>Knapparna Vy, Per, Zoom och Brg under ☰ gör samma sak som tangenterna. Esc går tillbaka till den yttre vyn.</p>
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
        <h3>Pekskärm</h3>
        <p>I realistisk simulering har knapparna längst ner samma funktioner som tangenterna: roder, djuproder och fart. Håll in för att upprepa. <code>&gt;_</code> öppnar konsolen och ☰ pausar. Inställningen Pekknappar gäller bara realistisk simulering.</p>
        <h3>Kommandon (realistisk simulering)</h3>
        <pre>${HELP_TEXT.join('\n')}</pre>
        <h3>Att tänka på</h3>
        <ul>
          <li>Djuprodren verkar bara när ubåten har fart: lyftkraften växer med farten i kvadrat.</li>
          <li><b>Flytkraftsöverskott</b> (under "Mer") visar om ubåten är lätt (+) eller tung (−). Trimma med <code>kompensera in/ut &lt;liter&gt;</code>.</li>
          <li>Under språngskiktet (40–70 m) är vattnet tätare. Ubåten blir då lättare och behöver ta in vatten.</li>
          <li>Skrovet trycks ihop mer än vattnet på djupet, så ubåten blir långsamt tyngre ju djupare den går.</li>
          <li>Tryckluften räcker inte till hur många blåsningar som helst. Håll koll på HP-luften.</li>
          <li><b>Back</b> (<code>back halv</code>, eller Shift + ↓ under noll): propellern ger mindre kraft bakåt, och farten blir högst ungefär 6,5 knop. Rodren verkar omvänt: roder styrbord vrider fören åt babord, och djuprodren likaså. Autopiloten tar hänsyn till det. Ubåten glider länge, så slå stopp i god tid.</li>
        </ul>
      </div>
      ${back}`;
  },
  intro: () => {
    return html`
      <h2 class="menu-title small">Förenklad simulering</h2>
      <ul class="intro">
        <li><b>Djupskalan</b> till vänster: tryck eller dra för att välja djup. ▲ / ▼ ändrar 5 m.</li>
        <li><b>Kompassen</b> till höger: tryck eller dra för att välja kurs. ◀ / ▶ ändrar 10°.</li>
        <li><b>Telegrafen</b> i mitten väljer fart, från Full back till Full fram.</li>
        <li><b>Dyk / Yta</b> sköter huvudballasten, och <b>Håll</b> behåller kurs och djup.</li>
        <li>Assistenten trimmar ubåten. Det den gör syns i loggen.</li>
        <li>På dator fungerar också tangenterna: ↑ / ↓ djup, ← / → kurs, Shift + ↑ / ↓ fart, D dyk och S yta.</li>
      </ul>
      <div class="menu-list">
        <button class="menu-btn primary" data-action="introDone">Kör</button>
      </div>`;
  },
  result: (m) => {
    const r = m.result!;
    return html`
      <h2 class="menu-title small ${r.completed ? 'ok' : 'fail'}">${r.completed ? 'Uppdrag slutfört' : 'Uppdraget misslyckades'}</h2>
      <p class="menu-sub">${r.scenario.title}</p>
      <p>${r.message}</p>
      ${r.completed ? html`<p>Tid: <b>${formatSimTime(r.time)}</b></p>` : ''}
      <div class="menu-list">
        <button class="menu-btn primary" data-action="restart">Spela igen</button>
        <button class="menu-btn" data-action="nav" data-arg="scenarios">Scenarier</button>
        <button class="menu-btn secondary" data-action="main">Huvudmeny</button>
      </div>`;
  },
};
