/**
 * The menu screens: one function per screen, returning HTML from `html`
 * templates (every inserted value is escaped). Buttons carry
 * data-action/data-arg and inputs a name; menu.ts handles the events.
 */
import { formatSimTime } from '../control/controller';
import { SCENARIO_GROUPS, lockText, scenariosIn, type Scenario, type ScenarioGroup } from '../control/scenarios';
import { CREW_NAME, CREW_NOUN, CREW_ROLE, CREW_SYSTEMS, LOCK_TEXT, MANOEUVRE_SYSTEMS, swedishList, type CrewDuties, type CrewLocks, type CrewSystem } from '../control/crew';
import { AREA_INFO, AREA_ORDER, CONDITIONS, SEA_CHOICES, type ConditionsId } from '../control/areas';
import type { SeaStateId } from '../sim/config/seaStates';
import type { AreaId } from '../sim/config/areas';
import { html, type SafeHtml } from './dom';
import { TIME_SCALES, type Settings } from './settings';

export type Screen = 'main' | 'free' | 'free-area' | 'scenarios' | 'settings' | 'help' | 'pause' | 'crew' | 'result' | 'intro' | 'briefing' | 'graphics' | 'error' | 'logbook';

/** What the pause menu and ☰ → Besättning need to know about the running game. */
export interface PauseInfo {
  /** Who handles what (including orders still waiting in the queue); null outside a game. */
  duties: CrewDuties | null;
  locks: CrewLocks;
  /** Expert mode (the player may take the manoeuvre over), and whether the scenario forces it. */
  expert: boolean;
  expertForced: boolean;
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
  parts.push(systems.length ? `Du skötte själv ${swedishList(systems)}` : 'Besättningen skötte allt');
  if (self.includes('safetyNet')) parts.push('utan skyddsnät');
  return `${parts.join(', ')}.`;
}

/** What the screens show. */
export interface MenuState {
  settings: Settings;
  pauseInfo: PauseInfo;
  result: ResultInfo | null;
  /** The scenario about to start (the briefing); null otherwise. */
  briefing: Scenario | null;
  /** The log book's lines for ☰ → Loggbok (oldest first). */
  logLines: readonly { t: number; text: string; kind: string }[];
  /** The error report after an unexpected error; null otherwise. */
  error: string | null;
  /** The graphics came back after they were lost (the WebGL context). */
  graphicsBack: boolean;
  /** The start page's sailing order (fictional), and its number. */
  order: { text: string; no: number };
  /** Free play: chosen area, light/visibility and sea state. */
  area: AreaId;
  conditions: ConditionsId;
  sea: SeaStateId;
  /** Free play: the area's corvettes patrol (a choice only where there are any). */
  patrols: boolean;
  /** The scenario list's tab. */
  scenarioGroup: ScenarioGroup;
}

/** The start page's sailing orders: fictional and peaceful, short enough for one typed line on a phone. */
export const ORDERS = [
  'Övningsfärd i skärgården.',
  'Gå under skiktet och lyssna.',
  'Pejla fyren på periskopdjup.',
  'Ladda batteriet vid snorkeldjup.',
  'Följ farleden norrut, tyst.',
  'Mät djupet utanför sundet.',
] as const;

const back = html`<button class="menu-btn secondary" data-action="back">‹ Tillbaka</button>`;

export const SCREENS: Record<Screen, (m: MenuState) => SafeHtml> = {
  main: (m) => {
    return html`
      <div class="dispatch-head"><span class="dispatch-no">Färdorder nr ${m.order.no}</span><span class="stamp">Övning</span></div>
      <h1 class="menu-title main-title">Ubåtssim</h1>
      <p class="menu-sub">Simulering av en dieselelektrisk ubåt</p>
      <p class="dispatch-order"><span class="typed" style="--chars: ${[...m.order.text].length}">${m.order.text}</span></p>
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
        <button class="menu-btn" data-action="nav" data-arg="logbook">Loggbok</button>
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
      ${a.traffic.some((v) => v.kind === 'patrol')
        ? html`<fieldset><legend>Korvetter</legend>
        <label class="opt" title="Korvetterna lyssnar och jagar en ubåt de upptäcker."><input type="radio" name="patrols" value="on" ${m.patrols ? 'checked' : ''}/> Patrullerar</label>
        <label class="opt" title="Fredligt: bara civil trafik."><input type="radio" name="patrols" value="off" ${m.patrols ? '' : 'checked'}/> Inga</label>
      </fieldset>`
        : ''}
      <p class="menu-sub">Välj var du vill börja.</p>
      <div class="menu-list">
        ${a.starts.map((st) => html`<button class="menu-btn choice" data-action="free" data-arg="${st.id}"><b>${st.title}</b><span>${st.description}</span></button>`)}
      </div>
      <button class="menu-btn secondary" data-action="nav" data-arg="free">‹ Tillbaka</button>`;
  },
  scenarios: (m) => {
    // Tabs by what a scenario practises; compact cards (the briefing has the description).
    const meta = (s: Scenario) => [...scenarioConditions(s), `${s.objectives.length} mål`].join(' · ');
    const tabs = SCENARIO_GROUPS.map(
      (g) =>
        html`<button type="button" class="menu-tab${g.id === m.scenarioGroup ? ' on' : ''}" role="tab" aria-selected="${String(g.id === m.scenarioGroup)}" data-action="group" data-arg="${g.id}">${g.title}</button>`,
    );
    const lists = SCENARIO_GROUPS.map(
      (g) => html`
      <div class="menu-list scenario-group" role="tabpanel" data-group="${g.id}" ${g.id === m.scenarioGroup ? '' : 'hidden'}>
        <p class="menu-sub">${g.description}</p>
        ${scenariosIn(g.id).map(
          (s) => html`
          <button class="menu-btn choice scenario compact" data-action="scenario" data-arg="${s.id}" title="${s.description}">
            <b>${s.title} <span class="badge ${s.difficulty}">${s.difficulty}</span></b>
            <span class="meta">${meta(s)}</span>
          </button>`,
        )}
      </div>`,
    );
    return html`<h2 class="menu-title small">Scenarier</h2><div class="menu-tabs" role="tablist">${tabs}</div>${lists}${back}`;
  },
  settings: (m) => {
    const s = m.settings;
    const radio = (name: string, value: string, label: string, checked: boolean) =>
      html`<label class="opt"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}/> ${label}</label>`;
    return html`
      <h2 class="menu-title small">Inställningar</h2>
      <fieldset><legend>Tidskomprimering</legend>
        ${TIME_SCALES.map((k) => radio('timeScale', String(k), `×${k}`, s.timeScale === k))}
      </fieldset>
      <fieldset><legend>Ljud</legend>
        <label class="opt">Volym <input type="range" name="volume" min="0" max="100" step="5" value="${Math.round(s.volume * 100)}"/></label><br/>
        <label class="opt"><input type="checkbox" name="soundEffects" ${s.soundEffects ? 'checked' : ''}/> Maskiner och larm</label>
        <label class="opt"><input type="checkbox" name="soundAmbience" ${s.soundAmbience ? 'checked' : ''}/> Hav, vind och måsar</label>
        <label class="opt"><input type="checkbox" name="voice" ${s.voice ? 'checked' : ''}/> Uppläsning av order (svensk röst)</label><br/>
        <label class="opt"><input type="checkbox" name="music" ${s.music ? 'checked' : ''}/> Musik på startsidan</label>
        <label class="opt">Musikvolym <input type="range" name="musicVolume" min="0" max="100" step="5" value="${Math.round(s.musicVolume * 100)}"/></label>
        <p class="menu-note">M stänger av och sätter på ljudet, också på startsidan.</p>
      </fieldset>
      <fieldset><legend>Grafik</legend>
        <label class="opt"><input type="checkbox" name="particles" ${s.particles ? 'checked' : ''}/> Svävande partiklar</label>
        <label class="opt"><input type="checkbox" name="lightRays" ${s.lightRays ? 'checked' : ''}/> Ljusstrålar under ytan</label>
      </fieldset>
      <p class="menu-note">Inställningarna sparas i den här webbläsaren.</p>
      ${back}`;
  },
  help: () => {
    return html`
      <h2 class="menu-title small">Hjälp</h2>
      <div class="help">
        <h3>Besättningen och du</h3>
        <p>Du väljer fart på telegrafen, kurs på kompassen och djup: <b>Yta</b>, <b>Periskop</b> eller <b>Djup</b> (vilket djup som helst på djupskalan). Besättningen bestämmer själv hur det ska gå till: roder, djuproder, ballast, trim, fart, inbromsning och back. Planraden ovanför telegrafen säger vad den gör, och ett tryck på den visar varför.</p>
        <ul>
          <li><b>Djupbyten</b>: med fart på djuprodren, utan fart med kompenseringstanken (ubåten svävar). Går djuprodren inte att använda vid din fart, ökar maskinen till 4 knop tills djupet är nått. Före ett djupbyte pumpar trimassistenten för vattnet där nere, till exempel under ett språngskikt.</li>
          <li><b>Från djupet</b> stiger besättningen till 35 m, lyssnar runt och går sedan upp. <b>Yta</b> blåser huvudballasten på 15 m. Misstänker eller jagar en korvett ubåten, stannar besättningen på periskopdjup i stället för att blåsa, eftersom blåsningen hörs långt. Tryck Yta igen för att gå upp ändå.</li>
          <li><b>Nära periskopdjup</b> håller besättningen farten under 6 knop (inte på Full fram) och lägger högst 15° roder, så att tornet inte bryter ytan.</li>
          <li><b>Lägre fart</b>: ubåten glider ned i fart utan att backa, vilket är tystare. Stopp, och grunt vatten förut, backar för fullt.</li>
          <li><b>Expertläge</b> (☰ → Besättning): du kan ta över djup och kurs (<b>Auto / Hand</b> vid djupskalan och kompassen), farten (propellervarvet i panelen Fart), ballasten, trimmet och skyddsnätet. Panelens övre knapp lämnar det tillbaka. Vissa scenarier, till exempel Trimövning, spelas alltid i expertläge.</li>
          <li><b>Eldledning</b>: eldledaren mäter avståndet till målet genom periskopet och ger råd om kursbyten. Annars mäter du själv med <b>Avst</b>. Att skjuta är alltid din order.</li>
          <li><b>Skott:</b> vid en läcka stänger besättningen de vattentäta dörrarna, så att vattnet stannar i en avdelning. I panelen El stänger och öppnar du dem och väljer vilken avdelning länspumpen tar först. Står dörrarna öppna rinner vattnet till den låga änden när ubåten lutar.</li>
          <li><b>Torpedrum</b>: torpedrummet gör tuberna klara när ett mål är markerat, och säkrar och laddar om tomma tuber. I panelen <b>Torped</b> gör du det själv.</li>
          <li><b>Laddning</b>: maskinisten startar dieslarna när snorkeln är uppe eller ubåten ligger i ytläge. I panelen <b>El</b> startar och stoppar du dem själv. Snorkeln hissar alltid du.</li>
          <li><b>Skyddsnät</b>: nödblåsning nära krossdjupet och när ubåten tagit in mycket vatten, djupgräns över botten och varning för grunt vatten. Slås av under ☰ → Besättning.</li>
        </ul>
        <p>Planraden öppnar detaljerna: <b>Manöver</b> (vad besättningen gör, varför, och roder, djuproder och varv) och panelerna Ballast, Trim, Fart, El och Torped. Flikarna överst byter panel. I El och Torped kan du ta över laddningen och tuberna, och i expertläge också ballasten, trimmet och farten. ☰ → Besättning visar allt på ett ställe.</p>
        <h3>Kontrollerna</h3>
        <ul>
          <li><b>Djup</b> (vänster): <b>Yta</b>, <b>Periskop</b> (13 m, i ytläge dyker ubåten dit) och <b>Djup</b> (tillbaka till ditt senaste djupa djupmål, först 50 m). Djupskalan visar djupet (vit linje), djupmålet (blå pil), periskopdjupet, botten (brun) och skyddsnätets gräns (röd streckad). Tryck eller dra för att välja djup. Målet sätts när du släpper. I expertläge på Hand visar den djuprodret: tryck eller dra, eller Upp / Ned 5° och Noll.</li>
          <li><b>Kompassen</b> (höger) visar 60° åt varje håll från kursen (röd linje). Tryck eller dra för att välja kurs. Bojen syns som en gul prick, och <b>Mot bojen</b> styr mot den. I expertläge på Hand visar den rodret: tryck eller dra, eller BB / SB 5° och Mitt.</li>
          <li><b>Planraden</b> (ovanför telegrafen) säger vad besättningen gör just nu. Tryck på den för detaljerna.</li>
          <li><b>Telegrafen</b> (mitten, på mobil längst ner): Full, Halv och Sakta back, Stopp, och Sakta, Halv, Marsch och Full fram (2 och 4 knop back, 4, 8 och 12 knop fram, och Full back och Full fram är toppfarterna, 7 och 19 knop). På mobil är den ett reglage: tryck eller dra längs det.</li>
          <li><b>Nödblåsning</b> i panelen Ballast (eller Shift + S): är ubåten för tung för att stiga, blåses båda tankarna på vilket djup som helst, med full fart och ytan som mål.</li>
          <li><b>Vyknapparna</b> mellan telegrafen och kompassen: ögat byter vy (också till genomskärningen), sjökortet och sonarbågarna öppnar sjökortet och sonaren, och periskopet, snorkeln och radarn hissar och sänker masterna. Masterna syns när ubåten är grundare än 25 m eller en mast är uppe. På mobil ligger de under <b>Vyer ▾</b>.</li>
          <li><b>På mobil</b> visar statusraden överst tid, fart, vatten under kölen och trim. Tryck på den för hela instrumentpanelen.</li>
          <li><b>Loggboken</b> ligger överst i mitten och visar högst två rader. Varje rad tonas bort efter några sekunder (fel efter 6 s), och fönstret med den. Tryck på den för de senaste raderna, och tryck igen eller Esc för att stänga.</li>
        </ul>
        <h3>Tangentbord</h3>
        <table>
          <tr><th></th><th>Besättningen</th><th>Hand (expertläge)</th></tr>
          <tr><td>← / →</td><td>Kurs 10° babord / styrbord</td><td>Roder 5° babord / styrbord</td></tr>
          <tr><td>↑ / ↓</td><td>Djup 5 m grundare / djupare</td><td>Djuproder 5° upp / ned</td></tr>
          <tr><td>Mellanslag</td><td>Håll kurs och djup</td><td>Roder midskepps</td></tr>
          <tr><td>Shift + ↑ / ↓</td><td>Telegrafen ett läge fram / back</td><td>Varv ±10 rpm</td></tr>
          <tr><td>D / S</td><td colspan="2">Dyk (till periskopdjup, 13 m, om inget djupare mål finns) / Yta (stigning, huvudballasten blåses på 15 m)</td></tr>
          <tr><td>Shift + S</td><td colspan="2">Nödblåsning: blås på vilket djup som helst, full fart och ytan som mål</td></tr>
          <tr><td>V</td><td colspan="2">Byt vy: yttre, bryggan (i ytläge) och periskopet (när det är uppe)</td></tr>
          <tr><td>P</td><td colspan="2">Periskop upp / ned. Vyn öppnas när masten är uppe.</td></tr>
          <tr><td>Z</td><td colspan="2">Periskopets förstoring, 1,5× eller 6× (i genomskärningen: ovanifrån eller från sidan)</td></tr>
          <tr><td>C, + / −</td><td colspan="2">Genomskärning på / av, och zoom</td></tr>
          <tr><td>← / → i periskopet</td><td colspan="2">Vrid periskopet. Shift + ← / → styr.</td></tr>
          <tr><td>B</td><td colspan="2">Rapportera bäringen dit periskopet eller blicken från bryggan pekar</td></tr>
          <tr><td>Esc</td><td colspan="2">Stäng loggens historik, lämna en vy, eller pausa</td></tr>
          <tr><td>T / R / F</td><td colspan="2">Markera fartyget i hårkorset / mät avståndet / skjut (periskopet eller bryggan)</td></tr>
          <tr><td>N</td><td colspan="2">Snorkel upp / ned</td></tr>
          <tr><td>Y / X</td><td colspan="2">Radarmast upp / ned, radarn sänd / tyst</td></tr>
          <tr><td>A</td><td colspan="2">En ping med den aktiva sonaren</td></tr>
          <tr><td>L</td><td colspan="2">Lockmål akterut</td></tr>
          <tr><td>G</td><td colspan="2">Dieslarna start / stopp (du tar över laddningen)</td></tr>
          <tr><td>K / H</td><td colspan="2">Sjökortet / sonaren</td></tr>
          <tr><td>M</td><td colspan="2">Ljud av / på</td></tr>
          <tr><td>O</td><td colspan="2">Visa / fäll ihop målrutan i ett scenario (tipset och alla mål)</td></tr>
        </table>
        <h3>Vyer</h3>
        <p><b>Bryggan:</b> i ytläge står du överst i tornet. Dra för att titta runt. Bryggan måste utrymmas innan ubåten dyker. Det gör besättningen, eller du med Klart bryggan i panelen Ballast.</p>
        <p><b>Periskopet:</b> hissa med P eller <code>periskop upp</code>. Det tar 8 s. Huvudet når över vattnet ner till ungefär 14 m djup. Över 6 knop vibrerar bilden.</p>
        <p><b>Genomskärningen</b> (Vy eller C) visar ubåten uppskuren med alla avdelningar, tankarna med vattnet, pumparna och maskinerna. Dra för att vrida, scrolla eller nyp för att zooma, och tryck på ett rum eller en tank för att se vad som finns där. Ovan byter till snittet ovanifrån och Hela visar hela ubåten.</p>
        <p>Vyknapparna och Zoom och Brg uppe till höger (på mobil under Vyer ▾) gör samma sak som tangenterna. Esc går tillbaka till den yttre vyn.</p>
        <h3>Batteri och snorkling</h3>
        <p>Under vattnet går ubåten på batteriet (6 MWh). Vid 4 knop räcker det i ungefär två dygn, vid full fart under två timmar. Dieslarna laddar det, men de behöver luft: i ytläge, eller på periskopdjup med snorkeln uppe (snorkelknappen eller N). Sköljer en våg över snorkelns huvud stannar de efter några sekunder. Med tomt batteri får motorn bara det dieslarna ger.</p>
        <h3>Läckage</h3>
        <p>En hård grundstötning, en kollision eller ett djup under krossdjupet (300 m) ger en läcka i en avdelning. Vattnet strömmar in fortare ju djupare ubåten är. Besättningen tätar hålet och länspumpen länsar, men pumpen orkar mindre på djupet. Gå alltså grundare. Statusraden och panelen El visar vattnet. På 360 m kollapsar skrovet.</p>
        <h3>Sonar och sjökort</h3>
        <p><b>Sonaren</b> (H) hör fartyg och visar deras bäring som ett vattenfall: bäringen från fören tvärs över, tiden nedåt. Efter 20 s klassar operatören kontakten efter propellern. <b>Sjökortet</b> (K) visar djupet, spåret, bojen, fyrarna och sonarens bäringar.</p>
        <p>En <b>korvett</b> lyssnar efter ubåten och spanar efter master. Den hör dig bättre ju fortare du går (och när propellern kaviterar) och om dieslarna går, och den ser periskopet, snorkeln och tornet. Språngskiktet mellan er dämpar ljudet. Gå sakta, djupt och med masterna nere.</p>
        <h3>Aktiv sonar och radar</h3>
        <p><b>Ping</b> i sonaren (A) sänder en ping med den aktiva sonaren. Ekona ger avstånd och bäring till fartygen inom räckhåll, och ett mål får dem direkt: några pingar ger en bra lösning utan kursbyten. Men pingen hörs långt, och en korvett som hör den vet ungefär var du är och kommer. Mellan två pingar går minst 10 s.</p>
        <p><b>Radarn</b> sitter på en egen mast (radarknappen eller Y). På periskopdjup når antennen nätt och jämnt över vattnet. Hissad lyssnar <b>radarvarnaren</b>: den säger till när en korvetts radar når ubåten, med bäringen. <b>Radar</b> på sjökortet (X) sänder: varje svep (3 s) ger avstånd och bäring till fartygen innanför radarhorisonten, också i dimma och mörker, och de syns som gröna kryss på kortet. Men korvetternas radarvarnare hör radarn längre bort än radarn ser dem: sänd kort.</p>
        <h3>Torpedrummet</h3>
        <p>En tub skjuter bara när den är <b>klar</b>: torpeden i, tuben vattenfylld och mynningsluckan öppen (drygt 20 s). En korvett nära kan höra luckan. Efter skottet är tuben tom, full med vatten och öppen. <b>Säkra</b> stänger luckan och länsar tuben, och <b>Ladda</b> tar en torped från stället (2 min, en tub i taget på laddrälsen). I eldledningspanelen gör ett tryck på en laddad tub den klar, och på en tom tub laddar det om den. Torpederna väger: en salva gör ubåten lättare förut, och trimmet märker det.</p>
        <h3>Anfall</h3>
        <p>I periskopvyn finns eldledningen. Sätt hårkorset på ett fartyg och tryck <b>Mål</b> (T), mät avståndet med <b>Avst</b> (R, noggrannare på 6×) och vänta tills lösningen är ok eller bra. <b>Fyr</b> (F) skjuter mot träffpunkten från de klara tuberna (gröna), och ett tryck på en klar tub skjuter från just den. Har du flera mål visar panelen dem (M1, M2 …): tryck på ett för att sikta på det. Torpeden går 40 knop och söker själv det sista stycket. En sonarkontakt blir mål med ett tryck på den i sonarlistan. Då ger bäringarna avståndet först när du bytt kurs minst 30° och hållit den några minuter. Fyra tuber och åtta torpeder i stället (se Torpedrummet).</p>
        <p><b>Tråden:</b> torpeden är trådstyrd. I eldledningspanelen riktar <b>Styr</b> den mot målets lösning som den är nu, <b>Sök</b> väcker sökaren och <b>Kapa</b> kapar tråden. Skjut tidigt och styr när lösningen blivit bättre. Tråden går av över 8 knop eller om du svänger mer än 120°.</p>
        <p><b>Lockmål</b> (Lock eller L) låter som ubåten i fem minuter och går akterut. En korvett som hör det bättre än dig jagar det. Fyra finns.</p>
        <h3>Korvetter som jagar</h3>
        <p>En korvett som hört eller sett dig saktar in och svänger mot dig. Sedan söker den med aktiv sonar (pingar som hörs i skrovet) och anfaller med sjunkbomber inställda på djupet den mätte. Avfyrningar hörs. Kom undan genom att gå djupt under skiktet, sakta, byta kurs och byta djup när den går över dig. Den ger upp efter fem minuter utan kontakt, eller när bomberna är slut.</p>
        <h3>Scenarier</h3>
        <p>Ett scenario börjar med en genomgång: uppdraget, alla mål i ordning, förhållandena och vem som sköter vad. Där kan du ändra besättningen innan du trycker <b>Till sjöss</b>. Under spelet visar målrutan överst det aktuella målet på en rad. Tryck på den, eller O, för tipset och hela listan. Den öppnas också själv en stund när ett nytt mål börjar.</p>
        <h3>Ljud</h3>
        <p>Motorn, propellern, strömningen, ballasten och skrovet låter efter vad ubåten gör. Larm hörs vid grundstötning, grunt vatten, krossdjup och vatten över bryggan. M stänger av ljudet. Uppläsning av order slås på under Inställningar. På startsidan spelar mörk musik, som slås av eller sänks under Inställningar.</p>
        <h3>Om något går fel</h3>
        <p>Vid ett fel pausas spelet och en ruta visar en felrapport som går att kopiera. Starta om eller ladda om sidan. Tar webbläsaren tillbaka grafiken, till exempel när fliken legat i bakgrunden, väntar spelet tills den är tillbaka.</p>
        <h3>Havsområden och väder</h3>
        <p>I fritt spel väljer du havsområde, ljus och sikt (dag, natt, dimma) och sjögång. Ubåtens fasta barlast är anpassad för området, men skikten i vattnet skiljer sig:</p>
        <ul>
          <li><b>Västerhavet:</b> språngskikt på 40–70 m. Ström norrut längs kusten.</li>
          <li><b>Östersjön:</b> bräckt vatten och ett saltsprångskikt på 60–80 m. Under det blir ubåten flera ton lättare.</li>
          <li><b>Fjorden:</b> sötvatten i ytan som strömmar ut ur fjorden, en grund tröskel vid mynningen och 380 m djupt innanför.</li>
          <li><b>Atlanten:</b> ingen botten inom räckhåll. Krossdjupet 300 m är gränsen.</li>
        </ul>
        <p>I fritt spel går fartyg i varje område. De följer sina rutter, har lanternor i mörker och hörs genom skrovet när de är nära. Kom inte i vägen: en kollision loggas, och i ett scenario misslyckas uppdraget.</p>
        <p>Instrumentpanelen visar farten genom vattnet, och längre ner fart och kurs över grund och strömmen (på mobil: tryck på statusraden). I grov sjö rör sig ubåten i ytläge, och vågtopparna kan skölja över ett lågt periskop.</p>
        <h3>Att tänka på</h3>
        <ul>
          <li>Djuprodren verkar bara när ubåten har fart: lyftkraften växer med farten i kvadrat. Stillastående <b>svävar</b> besättningen i stället: den gör ubåten lite tung eller lätt med kompenseringen och neutral igen vid djupmålet. Det går långsamt, några meter i minuten, men tyst.</li>
          <li><b>Flytkraft</b> (i panelen Trim) visar om ubåten är lätt (+) eller tung (−). Ta in eller pumpa ut vatten med In och Ut.</li>
          <li>Under språngskiktet (40–70 m) är vattnet tätare. Ubåten blir då lättare och behöver ta in vatten.</li>
          <li>Skrovet trycks ihop mer än vattnet på djupet, så ubåten blir långsamt tyngre ju djupare den går.</li>
          <li>Tryckluften räcker inte till hur många blåsningar som helst. Håll koll på HP-luften.</li>
          <li><b>Back</b> (telegrafen eller <code>back halv</code>): propellern ger mindre kraft bakåt, och farten blir högst ungefär 6,8 knop (Full back). Rodren verkar omvänt: roder styrbord vrider fören åt babord, och djuprodren likaså. Djupstyraren och rorsmannen tar hänsyn till det. Ubåten glider länge, så slå stopp i god tid.</li>
        </ul>
      </div>
      ${back}`;
  },
  intro: () => {
    return html`
      <h2 class="menu-title small">Besättningen sköter ubåten</h2>
      <ul class="intro">
        <li>Du väljer fart, kurs och djup. Besättningen bestämmer hur: roder, ballast, trim, inbromsning och back.</li>
        <li><b>Yta</b>, <b>Periskop</b> och <b>Djup</b> till vänster, och djupskalan: tryck eller dra för att välja djup.</li>
        <li><b>Kompassen</b> till höger: tryck eller dra för att välja kurs.</li>
        <li><b>Telegrafen</b> väljer fart, från Full back till Full fram. På mobil drar du längs reglaget.</li>
        <li><b>Planraden</b> ovanför telegrafen säger vad besättningen gör. Tryck på den för detaljer, ballast, trim, el och torpeder.</li>
        <li>Vill du styra själv? Slå på <b>Expertläge</b> under ☰ → Besättning.</li>
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
    const { expert, expertForced } = m.pauseInfo;
    const mode = (on: boolean, label: string) =>
      html`<button class="menu-btn seg ${expert === on ? 'on' : ''}" data-action="expert" data-arg="${on ? '1' : '0'}" ${expertForced ? 'disabled' : ''} aria-pressed="${String(expert === on)}">${label}</button>`;
    const modeRow = html`<div class="crew-row crew-expert">
        <div><b>Manövern</b><small>${
          expertForced
            ? 'Här styr du själv delar av manövern (expertläge).'
            : expert
              ? 'Expertläge: du kan ta över roder, djuproder, varvtal, ballast, trim och skyddsnät.'
              : 'Du väljer fart, kurs och djup. Besättningen sköter roder, ballast, trim och fart och väljer själv hur.'
        }</small></div>
        <div class="crew-choice">${mode(false, 'Besättningen')}${mode(true, 'Expert')}</div>
      </div>`;
    const systems = expert ? CREW_SYSTEMS : CREW_SYSTEMS.filter((x) => !MANOEUVRE_SYSTEMS.includes(x));
    return html`
      <h2 class="menu-title small">Besättning</h2>
      <p class="menu-sub">Vem sköter vad? Ändringen gäller när du fortsätter.</p>
      <div class="crew-list">${modeRow}${systems.map(row)}</div>
      <div class="menu-list">
        <button class="menu-btn" data-action="crew" data-arg="all:1">Besättningen sköter allt</button>
        ${expert ? html`<button class="menu-btn" data-action="crew" data-arg="all:0">Du sköter allt</button>` : ''}
      </div>
      ${back}`;
  },
  briefing: (m) => {
    const s = m.briefing;
    if (!s) return html`<h2 class="menu-title small">Uppdrag</h2>${back}`;
    const limit = s.timeLimit !== undefined ? `Tidsgräns ${Math.round(s.timeLimit / 60)} min` : null;
    const meta = [...scenarioConditions(s), ...(limit ? [limit] : [])].join(' · ');
    const goals = s.objectives.map(
      (o) => html`<li>${o.text}${o.holdSeconds ? html` <span class="hold">(håll ${o.holdSeconds} s)</span>` : ''}</li>`,
    );
    return html`
      <h2 class="menu-title small">${s.title} <span class="badge ${s.difficulty}">${s.difficulty}</span></h2>
      <p class="menu-sub">${s.description}</p>
      <h3 class="briefing-head">Mål</h3>
      <ol class="briefing-goals">${goals}</ol>
      ${meta ? html`<p class="menu-note">${meta}</p>` : ''}
      <p class="menu-note">${crewSummary(m.pauseInfo.duties)} Målen finns överst på skärmen under spelet: tryck på dem för tipsen och hela listan.</p>
      <div class="menu-list">
        <button class="menu-btn primary" data-action="briefingDone">Till sjöss</button>
        <button class="menu-btn" data-action="nav" data-arg="crew">Besättning</button>
        <button class="menu-btn secondary" data-action="main">Avbryt</button>
      </div>`;
  },
  logbook: (m) => {
    const lines = m.logLines.map((e) => html`<div class="log-entry ${e.kind}"><span class="time">[${formatSimTime(e.t)}]</span>${e.text}</div>`);
    return html`
      <h2 class="menu-title small">Loggbok</h2>
      <div class="logbook">${lines.length ? lines : html`<p class="menu-note">Inget loggat än.</p>`}</div>
      ${back}`;
  },
  graphics: (m) => {
    return html`
      <h2 class="menu-title small">Grafiken försvann</h2>
      <p class="menu-sub">${m.graphicsBack ? 'Grafiken är tillbaka.' : 'Webbläsaren tog tillbaka grafikkortet, till exempel när fliken låg i bakgrunden. Spelet står i paus och fortsätter när grafiken kommer tillbaka.'}</p>
      <div class="menu-list">
        ${m.graphicsBack ? html`<button class="menu-btn primary" data-action="graphicsOk">Fortsätt</button>` : ''}
        <button class="menu-btn ${m.graphicsBack ? '' : 'primary'}" data-action="reload">Ladda om sidan</button>
      </div>`;
  },
  error: (m) => {
    return html`
      <h2 class="menu-title small fail">Något gick fel</h2>
      <p class="menu-sub">Spelet stötte på ett fel och står i paus. Starta om, eller ladda om sidan om felet kommer tillbaka.</p>
      <textarea class="error-report" readonly rows="6" aria-label="Felrapport">${m.error ?? ''}</textarea>
      <div class="menu-list">
        <button class="menu-btn primary" data-action="restart">Starta om</button>
        <button class="menu-btn" data-action="copyError">Kopiera felrapport</button>
        <button class="menu-btn" data-action="reload">Ladda om sidan</button>
        <button class="menu-btn secondary" data-action="main">Huvudmeny</button>
      </div>`;
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

/** Area, light, sea state and locks of a scenario, for the list and the briefing. */
function scenarioConditions(s: Scenario): string[] {
  const parts: string[] = lockText(s.locks);
  const area = s.initial.area ?? 'westCoast';
  if (area !== 'westCoast') parts.unshift(AREA_INFO[area].title);
  if (s.conditions === 'night') parts.unshift('Natt');
  if (s.conditions === 'dusk') parts.unshift('Skymning');
  if (s.conditions === 'fog') parts.unshift('Dimma');
  if (s.initial.sea === 'rough') parts.unshift('Grov sjö');
  if (s.initial.sea === 'moderate') parts.unshift('Måttlig sjö');
  return parts;
}

/** The pause menu's line on who handles what. */
function crewSummary(d: CrewDuties | null): string {
  if (!d) return '';
  const self = CREW_SYSTEMS.filter((x) => x !== 'safetyNet' && !d[x]).map((x) => CREW_NAME[x].toLowerCase());
  const net = d.safetyNet ? '' : ' Skyddsnätet är av.';
  return (self.length ? `Du sköter ${swedishList(self)}. Besättningen sköter resten.` : 'Besättningen sköter allt.') + net;
}
