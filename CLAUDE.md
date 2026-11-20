# CLAUDE.md – Ubåtssim

En realistisk ubåtssimulator i 3D som körs i webbläsaren. Realismen ligger i simuleringen och grafiken hålls enkel. Projektet använder TypeScript, Vite, Three.js och Vitest och publiceras på GitHub Pages (repo `ubatssim`, `base: '/ubatssim/'`). Användardokumentationen finns i `README.md`, och fysikmodellen beskrivs i `docs/fysikmodell.md`.

## Kommandon
- `npm run dev`: utvecklingsserver på http://localhost:5173/ubatssim/ (observera sökvägen).
- `npm test`: Vitest. Fysiktesterna körs utan grafik. `testTimeout` är 60 s eftersom testerna simulerar minuter av spelets tid och CI-maskinerna är långsamma.
- `npm run lint`: ESLint. Kontrollerar bland annat lagergränserna.
- `npm run build`: `tsc --noEmit` och Vite-bygge till `dist/`.
- `scripts/make-mac-launcher.sh [mapp]`: bygger `Ubåtssim.app` (standard `~/Projekt`), som öppnar GitHub Pages-sidan med spelets ikon. Kör det igen om ikonen eller adressen ändras.
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
  simulation  Simulation: äger allt tillstånd och stegar 100 Hz.
src/control/  orders (Order-union + kvitton), orderQueue, parser (svenska), autopilot (PID),
              controller (kö → börvärden → autopilot → ställdon → sim.step → assistent),
              gameMode, trimAssist (trimassistent och skyddsnät), areas (startlägen, fyrar, väder), scenarios.
src/render/   Three.js. Läser bara simuleringens tillstånd och skriver aldrig till det.
              coords (NED↔Three), submarineModel (lager), terrain, environment, scene.
src/ui/       menu, instruments, console, log, keyboard, touch, inputMode, objective, settings,
              views (yttre/brygga/periskop), viewOverlay (kompassband, periskopmask).
src/main.ts   Spellägen (menu | playing | paused | ended), sessioner och tidsstegsloopen.
```
- **Simulering:** deterministisk. Samma starttillstånd och samma order ger exakt samma resultat. Använd aldrig `Math.random()` eller väggklocka i `src/sim` eller `src/control`.
- **Order:** alla styrkommandon, från tangentbord, pekknappar och konsol, blir `Order`-objekt i `OrderQueue`. Kön verkställs i början av nästa tidssteg, och varje order kvitteras i loggen med simuleringstid. Nya kommandon kräver tre saker: en ny variant i `Order`, ett kvitto i `acknowledgement()` och ett fall i `Controller.apply()`. Läggs kommandot till i parsern, ska `HELP_TEXT` och README uppdateras.
- **Manuell styrning:** ett manuellt utslag kopplar ur autopiloten för den axeln. `Controller.options.autopilotAllowed = false` spärrar djup- och kursautopiloten i realistisk simulering (fartautopiloten tillåts).
- **Spellägen** (`GameMode`: `'simplified' | 'realistic'`) kör samma `Simulation`. Skillnaden ligger bara i `src/control` och `src/ui`:
  - Förenklad simulering bygger på djup- och kursautopiloten. Tangenter och pekknappar ger `adjustDepth`, `adjustHeading`, `holdCourse`, `dive` och `surface`. Ett djupmål ≥ 5 m med tom huvudballast startar dykningen (realistiskt läge: en påminnelse i loggen).
  - `TrimAssist` körs efter `sim.step()` i förenklat läge och ger vanliga order med källan `'assist'` (kompensering, trim, nödblåsning). Den ändrar aldrig simuleringens tillstånd direkt och är deterministisk. Undantaget är djupbörvärdet, som skyddsnätet begränsar på grunt vatten.
  - Byt läge med `Controller.setMode()`, som tar över utan ryck. `Controller` startar i realistiskt läge, så befintliga tester påverkas inte.
  - Valt läge sparas i inställningarna. Standard är förenklad simulering.
- **Vyer:** vyn är spelarens tillstånd, inte simuleringens. Periskopet (`periskop upp|ned`) och bryggan (`klart bryggan`, `bemanna bryggan`) styrs med order. Bryggvyn kräver bemannad brygga, periskopvyn en hissad mast. `Simulation.bodyPointDepth()` räknar djup under den lokala vågytan.
- **Havsområden:** terräng, vatten och ström i `src/sim/config/areas.ts`, spelinnehåll (namn, startlägen, fyrar) i `src/control/areas.ts`. `InitialConditions.area` och `.sea` väljer område och sjögång. Ljus och sikt (`ConditionsId`) är bara grafik. Ubåtens fasta barlast härleds med områdets vatten.
- **Sessioner:** `main.ts` skapar en ny `Simulation` och `Controller` per spelstart. Indata-bindningarna får kontrollern via en getter som returnerar `null` när inget spel pågår. Bakom menyn kör en demo-session.
- **Scenarier** är data i `src/control/scenarios.ts`: startläge (`InitialConditions`), mål med villkor och hålltid (och `hintSimplified` för förenklat läge), villkor för misslyckande, tidsgräns, boj, tillåtna spellägen (`modes`) och om skyddsnätet är på (`safetyNet`). `ScenarioRunner` kontrollerar dem 10 gånger per sekund mot `Telemetry`. Grundstötning gör alltid att scenariot misslyckas. Varje scenario ska ha ett test som visar att det går att klara och att det misslyckas när det ska (`tests/scenarios.test.ts`, `tests/terrain.test.ts`), i varje spelläge det tillåter (`tests/gameModes.test.ts`).
- **Prestanda:** `Simulation.telemetry()` gör en full kraftberäkning. Använd `kinematics()` när bara läge och hastighet behövs, till exempel i autopiloten.

## Fysikkonventioner
- **Enheter:** SI överallt i `src/sim`. Knop och grader används bara i order, UI och kvitton (`src/sim/units.ts`).
- **Koordinater:** NED i världen och FRD i kroppen, enligt Fossen. Kroppens origo ligger midskepps på skrovets centrumlinje. Orienteringen är en quaternion. Bara `src/render/coords.ts` översätter till Three.js-koordinater (Y uppåt).
- **Modell:** (M_RB + M_A)ν̇ + C_RB(ν)ν = τ, där τ innehåller återförande krafter, dämpning, fenor, propeller och kontakt. C_A tas inte med separat, eftersom de hydrodynamiska koefficienterna redan innehåller Munk-momentet (se docs/fysikmodell.md). RK4 med dt = 0,01 s. Massegenskaperna fryses under ett tidssteg.
- **Tecken:** positivt roder = styrbord (kursen ökar). Positivt djuproder = dyk (fören ned). Negativ stampvinkel = fören ned.
- **Tankar och avdelningar:** beskrivs som data (id, position, form, volym, fyllnadsgrad). Massa och tyngdpunkt härleds från dem. Strukturen används senare av genomskärningsvyn och får inte förenklas bort.
- **Konstruktionsläget:** torrvikt och torr tyngdpunkt härleds så att ubåten är neutral och plan på 25 m med full huvudballast och tankarna på `designFill`. Kompenseringstanken startar 0,6 m³ tyngre (`initialFill`), alltså trimmad tung för dykning.
- **Terräng:** `src/sim/terrain.ts` har deterministiska höjdfunktioner (skärgård, fjord, djuphav) med parametrar i `config/terrain.ts`. `heightFunction(spec)` väljer funktion per område. Simuleringen läser dem via ett cachat rutnät med 4 m upplösning per område (`terrainGrid.ts`). Grundstötning hanteras i `contact.ts`. Renderingen använder samma funktion, så det man ser är det man kan krocka med. Ändras terrängen, måste farlederna i "Genom sundet", "Fjordinloppet" och "Fyrljuset" (scenario och test), startlägena och fyrarnas platser (`tests/areas.test.ts`) kontrolleras igen.
- **Ström och vågor:** hydrodynamiska krafter räknas mot vattnet (ν − ν_c). `kinematics().u` och `Telemetry.u` är fart genom vattnet. Vågorna (`waves.ts`) används av hydrostatiken, vyerna och den ritade ytan.
- **Parametrar:** alla ligger i `src/sim/config/` med kommentar om källa och enhet. Värden som inte är kontrollerade mot källan märks `// APPROX`.
- **3D-modellen:** byggs i separata lager (yttre skrov, tryckskrov, tankar, avdelningar, utrustning) med egna material, så att ett klippningsplan för genomskärningsvyn kan läggas till senare. `renderer.localClippingEnabled` är redan på.

## Kodkonventioner
- Identifierare och kommentarer skrivs på engelska. UI-texter, konsolkommandon och dokumentation på svenska.
- `strict` TypeScript med `noUncheckedIndexedAccess`.
- Ny fysik ska ha Vitest-tester i `tests/`.
- `localStorage` används bara för inställningar (inklusive spelläge), alltid inom try/catch (`src/ui/settings.ts`). Bästa tider sparas inte längre.
- Pekskärm: `body.touch` styr pekknapparna. Konsolens textfält ska ha teckenstorlek ≥ 16 px på iOS, annars zoomar Safari.

## Integritetsregler
- Inga absoluta lokala sökvägar, användarnamn, e-postadresser eller annan personlig information i kod, kommentarer, README, docs eller CLAUDE.md.
- Ingen `author` eller annan personlig information i `package.json`.
- Commits görs med en noreply-adress. Kontrollera `git config user.email` innan commit.
  - Lokalt: GitHub noreply-adressen (`...@users.noreply.github.com`).
  - I Claude Code-molnsessioner: `Claude <noreply@anthropic.com>`. Sessionens kontrollskript kräver den adressen, annars visar GitHub commiten som "Unverified".
- Ingen `Co-Authored-By`-rad i commit-meddelanden.
- `.gitignore` utesluter `node_modules/`, `dist/`, `.env*` och `.claude/settings.local.json`.
- Fråga alltid användaren innan något skapas, pushas eller ändras på GitHub.
