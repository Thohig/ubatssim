# Ubåtssim

En ubåtssimulator i 3D som körs i webbläsaren, på dator och mobil. Fokus ligger på realistisk simulering av en dieselelektrisk ubåt på cirka 60 m: flytkraft, ballast och tryckluft, trim, hydrodynamik, roder, propeller och grundstötning. Grafiken är medvetet enkel.

**Spela:** https://thohig.github.io/ubatssim/

## Innehåll

- [Spelet](#spelet)
- [Styrning](#styrning)
- [Kommandokonsolen](#kommandokonsolen)
- [Instrumentpanelen](#instrumentpanelen)
- [Scenarier](#scenarier)
- [Miljön](#miljön)
- [Fysik i korthet](#fysik-i-korthet)
- [Utveckling](#utveckling)
- [Projektstruktur](#projektstruktur)
- [Publicering](#publicering)

## Spelet

Startmenyn har fyra val:

| Val | Innehåll |
|---|---|
| **Fritt spel** | Välj startläge: ytläge på öppet hav, periskopdjup (18 m), djupt vatten (100 m) eller i ett sund i skärgården. |
| **Scenarier** | Uppdrag med mål, ledtrådar och bästa tid. |
| **Inställningar** | Tidskomprimering ×1/×2/×4, autopilot tillåten i fritt spel, pekknappar (automatiskt, alltid, aldrig) och svävande partiklar. Inställningarna sparas i webbläsaren. |
| **Hjälp** | Kontroller, alla konsolkommandon och tips. |

Under spelet pausar du med ☰-knappen eller Esc. Pausmenyn har Fortsätt, Starta om, Inställningar, Hjälp och Huvudmeny. Spelet pausas också automatiskt när fliken döljs.

## Styrning

### Tangentbord

| Tangent | Funktion |
|---|---|
| ← / → | Roder 5° babord / styrbord |
| ↑ / ↓ | Djuproder 5° upp / ned |
| Shift + ↑ / ↓ | Fart ±1 knop (sätter fartautopiloten) |
| Mellanslag | Roder midskepps |
| Enter eller / | Öppna kommandokonsolen |
| Esc | Lämna konsolen, eller pausa |

Lägesindikatorn överst visar om piltangenterna styr ubåten (**STYRNING**) eller konsolen (**KONSOL**). I konsolen bläddrar ↑/↓ i kommandohistoriken.

Ett manuellt roder- eller djuproderutslag kopplar ur autopiloten för just den axeln. De andra axlarna fortsätter som förut.

### Pekskärm (iPhone, iPad)

Längst ner finns knappar för roder (BB, Mitt, SB), djuproder (Upp, Ned) och fart (−, +). Håll in en knapp så upprepas den. `>_` öppnar konsolen med telefonens tangentbord, och ett tryck på en styrknapp stänger den igen. Instrumentpanelen är kompakt på smala skärmar, och "Mer ▾" visar resten.

Mus och finger styr kameran: dra för att vrida och nyp eller scrolla för att zooma. Kameran följer ubåten.

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
| `trimma för\|akter <liter>` | `trimma för 200` | Pumpa vatten mellan trimtankarna |
| `kompensera in\|ut <liter>` | `kompensera ut 300` | Ta in vatten eller pumpa ut det |
| `autopilot på\|av [djup\|kurs\|fart]` | `autopilot av`, `ap på djup` | Slå på eller av autopilot |
| `hjälp` | | Visa listan |

Kommandona tolererar alias (`sb`, `bb`, `hb`, `kn`, `ap`), decimalkomma (`djup 45,5`), enheter (`120 m`, `10°`) och ett inledande `/`.

## Instrumentpanelen

- **Djup, fart och kurs:** med autopilotens börvärde och AP-markering.
- **Stampvinkel och krängning.**
- **Under köl:** ekolodets djup under kölen. Rött under 5 m och vid grundstötning.
- **Roder och djuproder:** verkligt utslag och kommenderat utslag (orange markering). Rodren rör sig med begränsad hastighet, ~4°/s.
- **Under "Mer":** djupändring, varvtal, axeleffekt, nivån i varje tank, ventil- och blåsstatus, HP-luftens tryck och flytkraftsöverskott (+ = lätt, − = tung).

## Scenarier

| Scenario | Svårighet | Mål |
|---|---|---|
| Första dykningen | lätt | Guidad övning: fyll huvudballasten, dyk till 30 m, trimma neutralt och gå till ytläge igen. |
| Trimövning | medel | Håll 50 m ±2 m i tre minuter utan djupautopilot. |
| Språngskiktet | medel | Dyk genom termoklinen till 90 m och kompensera för att ubåten blir lättare där. |
| Genom sundet | medel | Gå i ytläge genom ett smalt sund i skärgården till en gul boj, utan att gå på grund. |
| Nödblåsning | svår | Ubåten är flera ton för tung på 200 m. Nå ytan innan krossdjupet 300 m. |

Ett scenario misslyckas om ubåten går på grund. Bästa tid sparas per webbläsare.

## Miljön

Ubåten börjar på öppet hav (280–375 m djup) väster om en skärgård i Bohusläns stil, cirka 2 km österut. Där finns:

- rundade granithällar och öar upp till ~50 m höjd
- kobbar och skär mellan öarna
- sund, 20–50 m djupa, som följer berggrundens nord–sydliga sprickdalar
- ett mörkt lavbälte vid vattenlinjen och sand och dy under vattnet.

Terrängen ingår i fysiken. Ubåten kan gå på grund, och det man ser i 3D är det man kan krocka med. Vattnet har ett språngskikt (termoklin) på 40–70 m djup, där vattnet blir tätare.

## Fysik i korthet

- **Rörelser:** 6 frihetsgrader enligt Fossens rörelseekvationer för undervattensfarkoster. Orienteringen är en quaternion, och integrationen sker med RK4 och ett fast tidssteg på 100 Hz. Simuleringen är deterministisk.
- **Flytkraft:** skrovet är uppdelat i 80 cirkulära skivor, och den nedsänkta delen av varje skiva räknas exakt. Samma modell ger flytkraft, flytcentrum och rätande moment i ytläge, halvt nedsänkt och helt nedsänkt läge.
- **Vatten och skrov:** vattnets densitet beror på djup och språngskikt. Skrovet trycks ihop med djupet.
- **Tankar som data:** två huvudballasttankar, två trimtankar och en kompenseringstank. Massa, tyngdpunkt och tröghet räknas om från tankarnas innehåll varje tidssteg.
- **Tryckluft:** HP-luften följer Boyles lag. Luften i huvudballasten expanderar när ubåten stiger och trycks ihop när den dyker.
- **Hydrodynamik:** medsvängande vattenmassa, linjär och kvadratisk dämpning, tvärströmsmotstånd, roder och djuproder med överstegring, tornets lyftkraft (ubåten krängar in i svängar) och en propeller med axeltröghet.
- **Grundstötning:** kontaktkrafter med fjäder, dämpare och friktion mot terrängen.

Ubåten är en generisk modern dieselelektrisk ubåt: 60 m lång, 6,2 m bred, ~1 530 t i undervattensläge. Den gör ~19 knop vid 2,9 MW och 240 rpm.

En utförlig beskrivning med ekvationer, källor och förenklingar finns i [docs/fysikmodell.md](docs/fysikmodell.md). Alla parametrar finns samlade, med källa och enhet, i `src/sim/config/`.

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
- att varje scenario går att klara och att det misslyckas när det ska
- terrängen, grundstötning och navigering genom sundet.

## Projektstruktur

```
src/
  sim/        Fysiken. Ren TypeScript utan Three.js eller DOM, deterministisk.
    config/   Parametrar för ubåt, miljö och terräng (SI-enheter, källa per värde).
    math/     Vektorer, matriser (LU), quaternioner.
  control/    Order, orderkö, svensk kommandoparser, PID-autopilot, controller, scenarier.
  render/     Three.js: ubåtsmodell i lager, terräng, yta, partiklar, dimma, kamera.
  ui/         Meny, instrumentpanel, konsol, logg, tangentbord, pekknappar, inställningar.
  main.ts     Spellägen (meny, spel, paus) och tidsstegsloopen.
tests/        Vitest.
docs/         Fördjupande dokumentation.
```

## Publicering

En push till `main` kör `.github/workflows/deploy.yml`, som kör lint, test och bygge och publicerar `dist/` till GitHub Pages. Pages-källan är "GitHub Actions".
