# Ubåtssim

En ubåtssimulator i 3D som körs i webbläsaren, på dator och mobil. Fokus ligger på realistisk simulering av en dieselelektrisk ubåt på cirka 60 m: flytkraft, ballast och tryckluft, trim, hydrodynamik, roder, propeller och grundstötning. Grafiken är medvetet enkel.

**Spela:** https://thohig.github.io/ubatssim/

## Innehåll

- [Spelet](#spelet)
- [Spellägen](#spellägen)
- [Styrning](#styrning)
- [Vyer](#vyer)
- [Kommandokonsolen](#kommandokonsolen)
- [Instrumentpanelen](#instrumentpanelen)
- [Scenarier](#scenarier)
- [Havsområden och väder](#havsområden-och-väder)
- [Fysik i korthet](#fysik-i-korthet)
- [Utveckling](#utveckling)
- [Projektstruktur](#projektstruktur)
- [Genväg på Mac](#genväg-på-mac)
- [Publicering](#publicering)

## Spelet

På startsidan väljer du spelläge, **förenklad** eller **realistisk simulering** (se [Spellägen](#spellägen)). Sedan finns fyra val:

| Val | Innehåll |
|---|---|
| **Fritt spel** | Välj havsområde (Västerhavet, Östersjön, Fjorden, Atlanten), ljus och sikt (dag, natt, dimma), sjögång (lugnt, måttlig, grov) och startläge, till exempel ytläge, periskopdjup (13 m, kölen på 16 m) eller djupt vatten. |
| **Scenarier** | Uppdrag med mål och ledtrådar. |
| **Inställningar** | Tidskomprimering ×1/×2/×4, autopilot tillåten i fritt spel (realistisk simulering), pekknappar (automatiskt, alltid, aldrig) och svävande partiklar. Inställningarna och valt spelläge sparas i webbläsaren. |
| **Hjälp** | Kontroller, alla konsolkommandon och tips. |

På iPhone och iPad kan spelet läggas på hemskärmen via Safaris Dela-meny ("Lägg till på hemskärmen"). Då startar det i helskärm med egen ikon.

Under spelet pausar du med ☰-knappen eller Esc. Pausmenyn har Fortsätt, Byt spelläge, Starta om, Inställningar, Hjälp och Huvudmeny. Spelet pausas också automatiskt när fliken döljs.

## Spellägen

Båda lägena kör samma simulering. Ballast, pumpar, tryckluft och hydrodynamik fungerar likadant. Skillnaden ligger i styrningen och i om spelet hjälper till.

| | Förenklad simulering | Realistisk simulering |
|---|---|---|
| **Styrning** | Du anger mål för djup och kurs, och autopiloten styr roder och djuproder. | Du lägger roder och djuproder själv. |
| **Ballast** | D dyker och S går till ytläge. Ett djupmål på 5 m eller mer i ytläge startar dykningen. | Du fyller och blåser huvudballasten med kommandon. Ett djupmål med tom huvudballast ger en påminnelse. |
| **Trim** | Assistenten kompenserar och trimmar. | Du kompenserar och trimmar själv. |
| **Skyddsnät** | Nödblåsning nära krossdjupet och varning för grunt vatten. | Inget. |
| **Instrumentpanel** | Djup, fart och kurs med mål, Under köl och Trim (Tung / Neutral / Lätt). Roder och tankar finns under "Mer". | Hela panelen. |

- **Standard:** förenklad simulering för nya spelare. Första gången visas en kort introduktion.
- **Byte:** läget kan bytas i pausmenyn utan ryck. Till förenklat läge sätts målen till nuvarande djup och kurs. Till realistiskt läge tar du över de senaste roderutslagen.
- **Trimassistenten** ger vanliga order, och varje order kvitteras i loggen, till exempel `Kompensera ut 150 liter, ja`. Den är begränsad av pumparnas kapacitet (5–6 l/s), så den hinner inte rädda allt.
  - **Kompensering:** när ubåten är nedsänkt med full huvudballast och har legat stilla på sitt djup en stund, pumpar assistenten bort flytkraftsöverskottet i portioner om högst 200 l. Små avvikelser (±50 kg) lämnas.
  - **Trim:** behöver djuprodret hela tiden ligga i samma riktning för att hålla djupet, flyttas vatten mellan trimtankarna.
- **Skyddsnätet:**
  - Nödblåsning under 255 m (85 % av krossdjupet 300 m), eller om ubåten sjunker fortare än 2 m/s under 250 m.
  - Djupmålet begränsas så att det är minst 10 m under kölen, under ubåten och upp till 150 m framåt.
  - Varning i loggen när det är mindre än 10 m under kölen.
- **Scenarier:** Trimövning går bara i realistisk simulering. I Nödblåsning finns ingen automatisk nödblåsning.

## Styrning

### Tangentbord

| Tangent | Förenklad simulering | Realistisk simulering |
|---|---|---|
| ← / → | Kurs 10° babord / styrbord | Roder 5° babord / styrbord |
| ↑ / ↓ | Djup 5 m grundare / djupare | Djuproder 5° upp / ned |
| Mellanslag | Håll nuvarande kurs och djup | Roder midskepps |
| D | Dyk (djupmål periskopdjup, 13 m, om inget djupare mål finns) | – |
| S | Ytläge | – |
| V | Byt vy (yttre, bryggan, periskopet). Bemannar bryggan i ytläge. | Byt vy (bryggan måste vara bemannad) |
| P | Periskop upp / ned | Samma |
| Z | Periskopets förstoring, 1,5× / 6× | Samma |
| B | Rapportera bäringen dit periskopet eller blicken pekar | Samma |
| ← / → i periskopet | Vrid periskopet (Shift + ← / → styr) | Samma |
| Shift + ↑ / ↓ | Fart ±1 knop (sätter fartautopiloten) | Samma |
| Enter eller / | Öppna kommandokonsolen | Samma |
| Esc | Lämna konsolen eller en vy, eller pausa | Samma |

Lägesindikatorn överst visar om piltangenterna styr ubåten (**STYRNING**) eller konsolen (**KONSOL**). I konsolen bläddrar ↑/↓ i kommandohistoriken.

Ett manuellt roder- eller djuproderutslag kopplar ur autopiloten för just den axeln. De andra axlarna fortsätter som förut. Det gäller också i förenklad simulering, om du ger roderkommandon i konsolen.

Knapparna Vy, Per, Zoom och Brg under ☰ gör samma sak som V, P, Z och B.

### Pekskärm (iPhone, iPad)

Längst ner finns knappar som motsvarar tangenterna:
- **Förenklad simulering:** kurs (◀, ▶), djup (▲, ▼), fart (−, +) och ballast (Dyk, Yta).
- **Realistisk simulering:** roder (BB, Mitt, SB), djuproder (Upp, Ned) och fart (−, +).

Håll in en knapp så upprepas den. `>_` öppnar konsolen med telefonens tangentbord, och ett tryck på en styrknapp stänger den igen. Instrumentpanelen är kompakt på smala skärmar, och "Mer ▾" visar resten.

Mus och finger styr kameran: dra för att vrida och nyp eller scrolla för att zooma. Kameran följer ubåten.

## Vyer

| Vy | Var du står | När den finns |
|---|---|---|
| **Yttre** | Bakom och ovanför ubåten. Dra för att vrida, nyp eller scrolla för att zooma. | Alltid |
| **Bryggan** | Överst i tornet. Dra för att titta runt. Kompassband med bäring och bojens riktning. | När bryggan är bemannad, i ytläge |
| **Periskopet** | I periskophuvudet: hårkors, bäringsskala och förstoring 1,5× eller 6×. Vrid med ←/→ eller genom att dra. | När periskopet är uppe |

- **Bryggan** är bemannad i ytläge. Den måste utrymmas innan ubåten dyker:
  - I realistisk simulering ger du order `klart bryggan`. Annars vägrar ubåten att fylla huvudballasten.
  - I förenklad simulering utryms bryggan automatiskt när du trycker D.
  - Når vattnet över brygglisten utryms bryggan, och vyn byter till den yttre.
- **Lågtrycksblåsaren** går när bryggan är bemannad och håller huvudballasten torr i sjögång.
- **Periskopet** tar 8 s att hissa. Vyn öppnas när det är uppe. Huvudet når över vattnet ner till ungefär 14 m djup i stilla sjö. I grov sjö kan vågtopparna skölja över det. Över 6 knop vibrerar bilden, och den våta masten ger motstånd.

## Kommandokonsolen

Alla kommandon kvitteras i loggen med simuleringstid, till exempel `[00:03:12] Djup 120, ja`. Felaktiga kommandon ger ett felmeddelande som pekar ut fel ord och föreslår rätt form ("Menade du styrbord?").

| Kommando | Exempel | Funktion |
|---|---|---|
| `djup <m>` | `djup 120` | Djupautopilot |
| `kurs <grader>` | `kurs 270` | Kursautopilot |
| `fart <knop> [knop]` | `fart 8 knop`, `fart stopp` | Fartautopilot |
| `varv <rpm>` | `varv 120` | Propellervarv direkt (fartautopiloten kopplas ur) |
| `roder sb\|bb <grader>` | `roder styrbord 15`, `roder midskepps` | Roder |
| `djuproder ned\|upp <grader>` | `djuproder ned 10`, `djuproder noll` | Djuproder |
| `fyll huvudballast [för\|akter]` | `fyll hb` | Öppna ventilerna, så att tanken vattenfylls |
| `blås huvudballast [för\|akter]` | `blås huvudballast` | Blås tanken tom med tryckluft |
| `stäng huvudballast [för\|akter]` | | Stäng ventiler och blåsning |
| `dyk` | | Fyll huvudballasten. Ventilerna stängs när tankarna är fulla. |
| `ytläge` | `yta` | Blås huvudballasten. En inkopplad djupautopilot får målet 0 m. |
| `klart bryggan` | | Utrym bryggan inför dykning |
| `bemanna bryggan` | | Gå upp på bryggan (bara i ytläge) |
| `periskop upp\|ned` | `per upp` | Hissa eller sänk periskopet |
| `bäring <grader>` | `bäring 63` | Rapportera bäringen till något du ser genom periskopet eller från bryggan |
| `trimma för\|akter <liter>` | `trimma för 200` | Pumpa vatten mellan trimtankarna |
| `kompensera in\|ut <liter>` | `kompensera ut 300` | Ta in vatten eller pumpa ut det |
| `autopilot på\|av [djup\|kurs\|fart]` | `autopilot av`, `ap på djup` | Slå på eller av autopilot |
| `hjälp` | | Visa listan |

Kommandona tolererar alias (`sb`, `bb`, `hb`, `kn`, `ap`), decimalkomma (`djup 45,5`), enheter (`120 m`, `10°`) och ett inledande `/`.

## Instrumentpanelen

- **Djup, fart och kurs:** med autopilotens börvärde och AP-markering. Farten är farten genom vattnet, som loggen mäter.
- **Stampvinkel och krängning.**
- **Under köl:** ekolodets djup under kölen. Rött under 5 m och vid grundstötning.
- **Roder och djuproder:** verkligt utslag och kommenderat utslag (orange markering). Rodren rör sig med begränsad hastighet, ~4°/s.
- **Trim** (förenklad simulering): Tung, Neutral eller Lätt (±100 kg), och Ytläge när ubåten inte är helt nedsänkt.
- **Under "Mer":** djupändring, fart och kurs över grund, strömmen, varvtal, axeleffekt, nivån i varje tank, ventil- och blåsstatus, HP-luftens tryck och flytkraftsöverskott (+ = lätt, − = tung).

## Scenarier

| Scenario | Svårighet | Mål |
|---|---|---|
| Första dykningen | lätt | Guidad övning: klara bryggan, fyll huvudballasten, dyk till 30 m, trimma neutralt och gå till ytläge igen. |
| Trimövning | medel | Håll 50 m ±2 m i tre minuter utan djupautopilot. |
| Språngskiktet | medel | Dyk genom termoklinen till 90 m och kompensera för att ubåten blir lättare där. |
| Genom sundet | medel | Gå i ytläge genom ett smalt sund i skärgården till en gul boj, utan att gå på grund. |
| Nödblåsning | svår | Ubåten är flera ton för tung på 200 m. Nå ytan innan krossdjupet 300 m. |
| Periskopspaning | medel | Ta ut bäringen till en fyr genom periskopet. Periskopet får inte synas mer än 60 s i taget. |
| Fyrljuset | medel | Natt: gå i ytläge mot en röd fyr tills den är 700 m bort. |
| Saltsprånget | svår | Östersjön: dyk genom saltsprångskiktet till 90 m och kompensera för de tonnen ubåten blir lättare. |
| Fjordinloppet | svår | Ta dig i undervattensläge över fjordens tröskel (55 m) och in till en boj, utan att gå grundare än 15 m. |

Ett scenario misslyckas om ubåten går på grund. Ledtrådarna anpassas efter spelläget. Trimövning kräver realistisk simulering.

## Havsområden och väder

| Område | Terräng | Vatten | Ström |
|---|---|---|---|
| **Västerhavet** | Öppet hav (280–375 m) och Bohusläns skärgård från ~2 km österut: granithällar, kobbar och 20–50 m djupa sund. | Salt (1 025 kg/m³), språngskikt på 40–70 m. | Baltiska strömmen, 0,25 m/s norrut vid ytan. |
| **Östersjön** | Grundare hav (110–130 m) och en låg skärgård från ~3 km österut. | Bräckt (1 005 kg/m³). Saltsprångskikt på 60–80 m, där vattnet blir 2,4 kg/m³ tätare. | Svag, 0,1 m/s. |
| **Fjorden** | En fjord som går norrut mellan 300 m höga berg. Tröskel på 55 m vid mynningen, 380 m djup bassäng innanför. | Sötare ytskikt (1 012 kg/m³) ovanpå atlantvatten under 9 m. | Ytvattnet strömmar ut, 0,4 m/s söderut i de översta metrarna. |
| **Atlanten** | Djuphav, ~1 800 m. Ingen botten inom räckhåll. | Salt och kallt (1 027 kg/m³). | Nordatlantiska strömmen, 0,3 m/s mot nordost, ända ner till djupet. |

- **Barlast:** ubåtens fasta barlast är anpassad för området, som när en marin flyttar en ubåt mellan hav. Den är alltså neutral på konstruktionsdjupet i alla områden. Skillnaden märks i skikten, till exempel att ubåten blir flera ton lättare under Östersjöns saltsprångskikt, och att den flyter något djupare i fjordens sötvatten.
- **Ljus och sikt:** dag, natt eller dimma (sikt ~200 m). På natten syns fyrarna, som blinkar med sin egen karaktär, långt innan land syns.
- **Sjögång:** lugnt, måttlig sjö (Hs 1,25 m) eller grov sjö (Hs 3 m). Vågorna påverkar flytkraften i ytläge, periskopet och bryggan. Djupare ner märks de inte.

Terrängen ingår i fysiken. Ubåten kan gå på grund, och det man ser i 3D är det man kan krocka med.

## Fysik i korthet

- **Rörelser:** 6 frihetsgrader enligt Fossens rörelseekvationer för undervattensfarkoster. Orienteringen är en quaternion, och integrationen sker med RK4 och ett fast tidssteg på 100 Hz. Simuleringen är deterministisk.
- **Flytkraft:** skrovet är uppdelat i 80 cirkulära skivor, och den nedsänkta delen av varje skiva räknas exakt. Samma modell ger flytkraft, flytcentrum och rätande moment i ytläge, halvt nedsänkt och helt nedsänkt läge.
- **Vatten och skrov:** vattnets densitet beror på havsområdet, djupet och skikten. Trycket är den exakta integralen av densiteten. Skrovet trycks ihop med djupet.
- **Ström och vågor:** de hydrodynamiska krafterna räknas mot vattnet, inte mot botten. Vågorna är en summa av sju reguljära vågor, och varje skiva av skrovet räknas mot den lokala vattenytan. I ytläge dämpas hiv och stamp av de vågor skrovet själv strålar ut.
- **Tankar som data:** två huvudballasttankar, två trimtankar och en kompenseringstank. Massa, tyngdpunkt och tröghet räknas om från tankarnas innehåll varje tidssteg.
- **Tryckluft:** HP-luften följer Boyles lag. Luften i huvudballasten expanderar när ubåten stiger och trycks ihop när den dyker.
- **Periskop:** masten hissas på 8 s och ger motstånd i vattnet.
- **Hydrodynamik:** medsvängande vattenmassa, linjär och kvadratisk dämpning, tvärströmsmotstånd, roder och djuproder med överstegring, tornets lyftkraft (ubåten krängar in i svängar) och en propeller med axeltröghet.
- **Grundstötning:** kontaktkrafter med fjäder, dämpare och friktion mot terrängen.

Ubåten är en generisk modern dieselelektrisk ubåt: 60 m lång, 6,2 m bred, ~1 530 t i undervattensläge. Den gör ~19 knop vid 2,9 MW och 240 rpm.

En utförlig beskrivning med ekvationer, källor och förenklingar finns i [docs/fysikmodell.md](docs/fysikmodell.md). Hur grafiken fungerar beskrivs i [docs/grafik.md](docs/grafik.md). Alla parametrar finns samlade, med källa och enhet, i `src/sim/config/`.

## Utveckling

Projektet kräver Node.js 22 eller senare.

```bash
npm install
```

```bash
npm run dev
```

Öppna http://localhost:5173/ubatssim/ (sökvägen följer `base` i `vite.config.ts`).

```bash
npm test
```

```bash
npm run lint
```

```bash
npm run build
```

- `npm test` kör alla enhetstester med Vitest. Fysiken testas utan grafik.
- `npm run lint` kör ESLint och kontrollerar bland annat att fysiklagret inte importerar Three.js eller DOM.
- `npm run build` gör typkontroll och produktionsbygge till `dist/`.

Testerna täcker bland annat:
- RK4:s konvergensordning, bevarad energi och rörelsemängdsmoment och determinism
- att en neutralt trimmad ubåt håller djupet, att en ubåt med tom huvudballast stiger och att energin inte växer utan drivkraft
- Boyles lag vid blåsning, toppfart, gir och roderhastighet
- kommandoparsern, orderkön och kvittona
- autopiloten (djup 120 m och kurs 270° utan stor översläng)
- spellägena: att förenklad simulering dyker till 50 m och trimmar neutralt utan spelarens hjälp, att nödblåsningen löser ut, att lägesbytet sker utan ryck och att simuleringen fortfarande är deterministisk
- att varje scenario går att klara och att det misslyckas när det ska
- terrängen, grundstötning och navigering genom sundet
- havsområdena: att trycket är integralen av densiteten, saltsprångskiktet, sötvattnet i fjorden, fjordens tröskel och att alla startlägen och fyrar ligger rätt
- strömmen (drift, fart genom vattnet och över grund) och vågorna (signifikant våghöjd, rörelser i ytläge, lågtrycksblåsaren)
- periskopet, bryggan och vyerna.

## Projektstruktur

```
src/
  sim/        Fysiken. Ren TypeScript utan Three.js eller DOM, deterministisk.
    config/   Parametrar för ubåt, vatten, havsområden, sjögång och terräng (SI-enheter, källa per värde).
    math/     Vektorer, matriser (LU), quaternioner.
  control/    Order, orderkö, svensk kommandoparser, PID-autopilot, controller, spellägen,
              trimassistent och skyddsnät, havsområdenas startlägen och fyrar, scenarier.
  render/     Three.js: ubåtsmodell i lager, terräng, vågor, fyrar, ljus och dimma, kameravyer.
  ui/         Meny, instrumentpanel, konsol, logg, tangentbord, pekknappar, inställningar,
              vyer och deras overlay (kompassband, periskop).
  main.ts     Spellägen (meny, spel, paus) och tidsstegsloopen.
tests/        Vitest.
docs/         Fördjupande dokumentation: fysikmodellen och grafiken.
public/       Ikoner (SVG, PNG för iOS och Android) och webbmanifest.
scripts/      make-mac-launcher.sh – bygger en Mac-genväg till spelet.
assets/       Källfil för ikonen utan rundade hörn (används för att rendera PNG-filerna).
```

## Genväg på Mac

`scripts/make-mac-launcher.sh` bygger `Ubåtssim.app`, ett litet macOS-program med spelets ikon som öppnar https://thohig.github.io/ubatssim/ i standardwebbläsaren. Programmet kan läggas i Dock.

```bash
scripts/make-mac-launcher.sh
```

Utan argument hamnar appen i `~/Projekt`. Ange en annan mapp som argument om du vill ha den någon annanstans:

```bash
scripts/make-mac-launcher.sh ~/Applications
```

Skriptet använder bara verktyg som följer med macOS:
- `qlmanage` renderar ikonen från `assets/icon-square.svg`.
- `iconutil` bygger `.icns`-filen.
- `osacompile` bygger appen av en enrads-AppleScript.
- `codesign` signerar appen ad hoc.

Kör skriptet igen om ikonen eller adressen ändras. Det ersätter då den gamla appen.

## Publicering

En push till `main` kör `.github/workflows/deploy.yml`, som kör lint, test och bygge och publicerar `dist/` till GitHub Pages. Pages-källan är "GitHub Actions".
