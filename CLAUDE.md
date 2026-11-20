# CLAUDE.md – Ubåtssim

En realistisk ubåtssimulator i 3D som körs i webbläsaren. Realismen ligger i simuleringen och grafiken hålls enkel. Projektet använder TypeScript, Vite, Three.js och Vitest och publiceras på GitHub Pages (repo `ubatssim`, `base: '/ubatssim/'`). Användardokumentationen finns i `README.md`, fysikmodellen beskrivs i `docs/fysikmodell.md`, grafiken i `docs/grafik.md`, ljudet i `docs/ljud.md`, prestandan och dess budget i `docs/prestanda.md` och idéer om vad som kan göras härnäst i `docs/ideer.md`.

## Kommandon
- `npm run dev`: utvecklingsserver på http://localhost:5173/ubatssim/ (observera sökvägen).
- `npm test`: de snabba testerna (~20 s). `npm run test:all`: alla, också de långa i `tests/long/` (~2 min). Publiceringen kör `test:all`. Fysiktesterna körs utan grafik. `testTimeout` är 60 s eftersom testerna simulerar minuter av spelets tid och CI-maskinerna är långsamma.
- **Tester som simulerar mer än någon minut speltid** läggs i `tests/long/*.long.test.ts`. Inget test bör ta mer än ~20 s på en vanlig dator: korta tidsgränser i testet hellre än att simulera länge (se "Fyrljuset fails when time runs out").
- `npm run lint`: ESLint. Kontrollerar bland annat lagergränserna.
- `npm run build`: `tsc --noEmit` och Vite-bygge till `dist/`. Three.js hamnar i en egen fil, och terrängens Web Worker i en tredje.
- `npm run bench`: fysikens tid per tidssteg (inte del av `npm test`). `?perf` i adressen visar tid per bild i spelet. Budget i `docs/prestanda.md`.
- `scripts/make-mac-launcher.sh [mapp]`: bygger `Ubåtssim.app` (standard `~/Projekt/Github Pages`), som öppnar GitHub Pages-sidan med spelets ikon. Kör det igen om ikonen eller adressen ändras.
- **Ikoner:** källan för appikoner är `assets/icon-square.svg` (kantfylld, utan rundade hörn). `public/icon.svg` är flikikonen med rundade hörn. PNG-filerna i `public/` renderas från källan med `qlmanage -t -s <px>`. Ändras ikonen, ska båda SVG-filerna och alla PNG-filer uppdateras.
- **Publicering:** en push till `main` kör `.github/workflows/deploy.yml` (lint → test → build → GitHub Pages). Pages-källan är "GitHub Actions".

## Arkitektur
```
src/sim/      Ren fysik. Inga beroenden på Three.js, DOM eller andra lager.
  config/     submarine.ts, environment.ts, terrain.ts, waters.ts, areas.ts, seaStates.ts
              – alla parametrar (SI, källa per värde).
  math/       vec3, mat (Mat3, MatN, LU), quat.
  rigidBody   M_RB, Kirchhoff-Coriolis, RigidBody (13 tillstånd).
  hull, hydrostatics, tanks, massProperties, airSystem, hydrodynamics,
  controlSurfaces, propulsion, contact, terrain, terrainGrid, environment, waves, rk4
  systems/    Delsystem: actuators, mainBallast (och tryckluft), pumps, periscopeMast.
  simulation  Simulation: spelarens ubåt. Äger tillståndet och delsystemen, stegar 100 Hz.
  vessel      Andra farkoster: rutt, fart, girhastighet (kinematiska).
  world       World: ubåten och farkosterna, stegas tillsammans; bäring, avstånd, kollision.
src/control/  orders (Order-union + kvitton), orderQueue, parser (svenska), autopilot (PID),
              controller (kö → börvärden → autopilot → ställdon → sim.step → assistent),
              crew (besättningen: system, låsningar, telegrafen), trimAssist (trimassistent och skyddsnät),
              areas (startlägen, fyrar, väder), scenarios.
src/render/   Three.js. Läser bara simuleringens tillstånd och skriver aldrig till det.
              coords (NED↔Three), submarineModel (lager), terrain (+ terrainBuild, terrainWorker),
              environment, waveShader (vågor på grafikkortet), vessels, scene,
              cutaway (genomskärningen), interior (inredningen som data), tankLevel (vattenytan).
src/audio/    Web Audio, syntetiserat. levels (ren: telemetri → ljudnivåer), engine (ljudgraf),
              voice (talsyntes), director (kopplar ihop). Läser simuleringen, skriver aldrig.
src/ui/       dom (html-mallar med escaping, h(), Component), menu + menuScreens (en funktion per
              skärm), instruments (komponenter, layout efter vem som sköter vad), console, log,
              keyboard, button (skärmknappar), helm (skärmkontroller och panelerna), inputMode,
              objective, settings, views, viewOverlay, perfMeter.
src/game/     session (GameSession: simulering, kontroll, scenario, trafik, omstart), flow
              (GameFlow: menu | playing | paused | ended och tillåtna övergångar), loop
              (FixedStepLoop), wiring (session → ljud och overlay), app (kopplingen till DOM).
src/main.ts   Bara uppstart (startApp).
```
- **Simulering:** deterministisk. Samma starttillstånd och samma order ger exakt samma resultat. Använd aldrig `Math.random()` eller väggklocka i `src/sim` eller `src/control`.
- **Order:** alla styrkommandon, från tangentbord, pekknappar och konsol, blir `Order`-objekt i `OrderQueue`. Kön verkställs i början av nästa tidssteg, och varje order kvitteras i loggen med simuleringstid. Nya kommandon kräver tre saker: en ny variant i `Order`, ett kvitto i `acknowledgement()` och en post i orderregistret `Controller.ORDERS` (`apply`, och vid behov `refuse` och `effects`, vilka system ordern tar över eller lämnar). TypeScript kräver en post för varje ordertyp. Läggs kommandot till i parsern, ska `HELP_TEXT` och README uppdateras.
- **Delsystem** (`src/sim/systems/`, mönstret i `types.ts`): `update(dt)` en gång per tidssteg och/eller `forces(ctx, tau)` vid varje kraftberäkning, i fast ordning (`Simulation.updateOrder`, `forceOrder`). Nya system (batteri, diesel, läckage) läggs till som delsystem, inte direkt i `Simulation`.
- **Världen:** `Controller.world` (`World`) stegar ubåten och farkosterna. Fritt spel har områdets trafik (`AREA_INFO[area].traffic`), scenarier sin egen (`Scenario.traffic`). Kollision med ett fartyg gör att ett scenario misslyckas, som grundstötning.
- **Manuell styrning:** ett manuellt utslag kopplar ur autopiloten för den axeln, alltså Hand.
- **Back:** propellern back har egna gränser (`propulsion.asternFactor`, `maxRpsAstern`), och `rpsForSpeed()` tar negativ fart. Med vattnet bakifrån verkar rodren omvänt, så djup- och kursautopiloten vänder tecken via `Autopilot.direction()` (hysteres ±0,2 m/s, regulatorerna nollställs vid bytet). Skyddsnätet tittar i färdriktningen. `back <knop>|sakta|halv|full` blir `setSpeed` med negativ fart.
- **Besättningen** (`src/control/crew.ts`): ett spelläge. Varje system sköts av besättningen eller av spelaren: djup, kurs och fart (= autopiloten för axeln, `Controller.ap`; Auto / Hand), ballast, trim och skyddsnät (`Controller.options.crew`). Samma `Simulation` oavsett val.
  - Varje spel börjar med `Controller.crewTakesAll()` (i `GameSession`). En ny `Controller` låter spelaren sköta allt, så befintliga tester påverkas inte.
  - Byte sker med ordern `crew` (system eller `'all'`, kvitteras, konsolen: `besättning|själv <system>`). Manuella order tar över via `effects` i orderregistret: `rudder`, `planes`, `setRpm`, `mainBallast`, `trim`, `compensate`. Mål (`setDepth`, `setHeading`, `setSpeed`, telegrafen) lämnar axeln till besättningen. Order från `'assist'` tar aldrig över något. `pendingDuties()` räknar med order som väntar i kön (pausmenyn).
  - Scenariots låsningar (`Scenario.locks`, `Controller.options.locks`) gäller från start och vägrar order som skulle ändra dem (`LOCK_TEXT`).
  - När besättningen sköter ballasten utryms bryggan vid dykning, ett djupmål ≥ 5 m med tom huvudballast startar dykningen och ett djupmål < 5 m med fylld huvudballast blåser den. Sköter spelaren ballasten blir det en påminnelse i loggen. I ytläge med tom ballast och grunt mål håller djupautopiloten djuprodret i noll (`Controller.surfaceHold`).
  - `TrimAssist` körs efter `sim.step()` medan besättningen sköter trimmet eller skyddsnätet och ger vanliga order med källan `'assist'` (kompensering, trim, nödblåsning). Den ändrar aldrig simuleringens tillstånd direkt och är deterministisk. Undantaget är djupbörvärdet, som skyddsnätet begränsar på grunt vatten.
  - `Controller.selfHandled` samlar vad spelaren skött (resultatskärmen).
- **Skärmkontrollerna** (`src/ui/helm.ts`) visas alltid: djupskala eller djuproder, kompassband eller roder (Auto / Hand), maskintelegraf (`TELEGRAPH` i crew.ts), Dyk/Yta, Håll och panelerna Ballast ▾, Trim ▾ och Fart ▾. Tangenterna följer Auto / Hand. Konsolen är ett andra sätt att ge order (`>_`, Enter) och visas bara när den är öppen. Inga scenariotips får kräva konsolen (test i `tests/helm.test.ts`).
- **Genomskärningen** (vy `cutaway`, Snitt / C): ubåten uppskuren längs mittlinjen eller genom övre däck med klippningsplan. Inredningen är data i `src/render/interior.ts` (inga människor; ny utrustning är en post där, testerna kräver att den ligger inom sin avdelning och tryckskrovet). Däcken ligger i `compartments[].decks` i `config/submarine.ts`. Vattenytan i tankarna är vågrät via `waterLevel` (tankLevel.ts, testad mot volymen). Tryck på ett utrymme → `spaceAt` → informationsrutan (`src/ui/cutawayInfo.ts`). Kameran ramar in ubåten i den fria ytan (`SceneView.setSafeArea`, mätt med `ResizeObserver`).
- **Vyer:** vyn är spelarens tillstånd, inte simuleringens. Periskopet (`periskop upp|ned`) och bryggan (`klart bryggan`, `bemanna bryggan`) styrs med order. Bryggvyn kräver bemannad brygga, periskopvyn en hissad mast. `Simulation.bodyPointDepth()` räknar djup under den lokala vågytan.
- **Havsområden:** terräng, vatten och ström i `src/sim/config/areas.ts`, spelinnehåll (namn, startlägen, fyrar) i `src/control/areas.ts`. `InitialConditions.area` och `.sea` väljer område och sjögång. Ljus och sikt (`ConditionsId`) är bara grafik. Ubåtens fasta barlast härleds med områdets vatten.
- **Ljud:** `soundLevels()` är en ren funktion och testas i `tests/audio.test.ts`. Engångsljud och uppläsning styrs av loggraderna (`cueFor`, `speechFor`). Ljud får använda `Math.random()`, eftersom det inte påverkar simuleringen. Ljudet startar först vid ett användartryck och är tyst utanför `playing`.
- **Sessioner:** `GameSession` (src/game/session.ts) skapar en ny `Simulation` och `Controller` per spelstart och vet hur den startas om. Den har ingen DOM och testas i `tests/game.test.ts`. `app.ts` kopplar sessionen till vyer, ljud och meny. Indata-bindningarna får kontrollern via en getter som returnerar `null` när inget spel pågår. Bakom menyn kör en demo-session.
- **Spelflödet:** byt mellan meny, spel, paus och slut bara via `GameFlow.go()`. Otillåtna övergångar vägras.
- **Gränssnittet:** HTML byggs med `html` från `src/ui/dom.ts`, som escapar allt som infogas. Använd aldrig vanliga mallsträngar till `innerHTML`. Nya instrument är en post i `INSTRUMENTS` och ett id i `instrumentLayout` (instruments.ts), nya menyskärmar en funktion i `SCREENS` (menuScreens.ts). Gränssnittstester körs med happy-dom (`// @vitest-environment happy-dom`, se `tests/ui.test.ts`).
- **Scenarier** är data i `src/control/scenarios.ts`: startläge (`InitialConditions`), mål med villkor och hålltid (med `system`: `hintCrew` när besättningen sköter systemet, annars `hint`), villkor för misslyckande, tidsgräns, boj och låsningar (`locks`). `ScenarioRunner` kontrollerar dem 10 gånger per sekund mot `Telemetry`. Grundstötning gör alltid att scenariot misslyckas. Varje scenario ska ha ett test som visar att det går att klara och att det misslyckas när det ska, både när besättningen sköter allt och när spelaren sköter allt som låsningarna tillåter (`tests/long/`).
- **Prestanda:** `Simulation.telemetry()` gör en full kraftberäkning, men sparar den per tillstånd (`y`, tid, massegenskaper, ställdon, varvtalskommando), så flera anrop mellan två tidssteg kostar nästan inget. Ändra därför aldrig `sim.y` på plats efter konstruktionen: ersätt hela vektorn. Använd `kinematics()` när bara läge och hastighet behövs, till exempel i autopiloten och i orderregistret. Håll budgeten i `docs/prestanda.md`. Mät med `npm run bench` och `?perf` före och efter ändringar i fysik eller grafik.
- **Gränssnittet och layout:** läs inte `clientWidth`, `offsetHeight` eller `getComputedStyle` i uppdateringen 10 gånger per sekund. Det tvingar fram en layout efter textändringarna. Använd `ResizeObserver` och läs färger en gång (se `src/ui/helm.ts`).
- **Optimeringar ska vara exakta** eller ha ett test som jämför mot den enkla beräkningen: kontaktgenvägen mot `contactForces` utan `shallowestIn`, och vågshadern (`elevationFromPacked`) mot `waveElevation`.

## Fysikkonventioner
- **Enheter:** SI överallt i `src/sim`. Knop och grader används bara i order, UI och kvitton (`src/sim/units.ts`).
- **Koordinater:** NED i världen och FRD i kroppen, enligt Fossen. Kroppens origo ligger midskepps på skrovets centrumlinje. Orienteringen är en quaternion. Bara `src/render/coords.ts` översätter till Three.js-koordinater (Y uppåt).
- **Modell:** (M_RB + M_A)ν̇ + C_RB(ν)ν = τ, där τ innehåller återförande krafter, dämpning, fenor, propeller och kontakt. C_A tas inte med separat, eftersom de hydrodynamiska koefficienterna redan innehåller Munk-momentet (se docs/fysikmodell.md). RK4 med dt = 0,01 s. Massegenskaperna fryses under ett tidssteg.
- **Tecken:** positivt roder = styrbord (kursen ökar). Positivt djuproder = dyk (fören ned). Negativ stampvinkel = fören ned.
- **Tankar och avdelningar:** beskrivs som data (id, position, form, volym, fyllnadsgrad). Massa och tyngdpunkt härleds från dem. Strukturen används senare av genomskärningsvyn och får inte förenklas bort.
- **Konstruktionsläget:** torrvikt och torr tyngdpunkt härleds så att ubåten är neutral och plan på 25 m med full huvudballast och tankarna på `designFill`. Kompenseringstanken startar 0,6 m³ tyngre (`initialFill`), alltså trimmad tung för dykning.
- **Terräng:** `src/sim/terrain.ts` har deterministiska höjdfunktioner (skärgård, fjord, djuphav) med parametrar i `config/terrain.ts`. `heightFunction(spec)` väljer funktion per område. Simuleringen läser dem via ett cachat rutnät med 4 m upplösning per område (`terrainGrid.ts`). Grundstötning hanteras i `contact.ts`. Renderingen använder samma funktion, så det man ser är det man kan krocka med. Ändras terrängen, måste farlederna i "Genom sundet", "Fjordinloppet", "Fyrljuset" och "Back" (scenario och test), startlägena och fyrarnas platser (`tests/areas.test.ts`) kontrolleras igen.
- **Ström och vågor:** hydrodynamiska krafter räknas mot vattnet (ν − ν_c). `kinematics().u` och `Telemetry.u` är fart genom vattnet. Vågorna (`waves.ts`) används av hydrostatiken, vyerna och den ritade ytan. Den ritade ytan förskjuts på grafikkortet (`waveShader.ts`). Ändras vågformeln, ska shadern och `elevationFromPacked` ändras på samma sätt (testet i `tests/waveShader.test.ts`).
- **Parametrar:** alla ligger i `src/sim/config/` med kommentar om källa och enhet. Värden som inte är kontrollerade mot källan märks `// APPROX`.
- **3D-modellen:** byggs i separata lager (yttre skrov, tryckskrov, tankar, avdelningar, utrustning) med egna material. Genomskärningen lägger sitt klippningsplan på dem (`renderer.localClippingEnabled`).

## Kodkonventioner
- Identifierare och kommentarer skrivs på engelska. UI-texter, konsolkommandon och dokumentation på svenska.
- `strict` TypeScript med `noUncheckedIndexedAccess`.
- Ny fysik ska ha Vitest-tester i `tests/`.
- `localStorage` används bara för inställningar (bland annat ljud och om introduktionen visats), alltid inom try/catch (`src/ui/settings.ts`). Bästa tider sparas inte längre.
- Pekskärm: skärmkontrollerna visas alltid, och `--helm-h` (deras höjd) håller loggen, konsolen och instrumentpanelen ovanför dem. `body.touch` finns för små anpassningar. Konsolens textfält ska ha teckenstorlek ≥ 16 px på iOS, annars zoomar Safari.

## Integritetsregler
- Inga absoluta lokala sökvägar, användarnamn, e-postadresser eller annan personlig information i kod, kommentarer, README, docs eller CLAUDE.md.
- Ingen `author` eller annan personlig information i `package.json`.
- Commits görs med en noreply-adress. Kontrollera `git config user.email` innan commit.
  - Lokalt: GitHub noreply-adressen (`...@users.noreply.github.com`).
  - I Claude Code-molnsessioner: `Claude <noreply@anthropic.com>`. Sessionens kontrollskript kräver den adressen, annars visar GitHub commiten som "Unverified".
- Ingen `Co-Authored-By`-rad i commit-meddelanden.
- `.gitignore` utesluter `node_modules/`, `dist/`, `.env*` och `.claude/settings.local.json`.
- Fråga alltid användaren innan något skapas, pushas eller ändras på GitHub.
