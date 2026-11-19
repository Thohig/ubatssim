# CLAUDE.md – Ubåtssim

En realistisk ubåtssimulator i 3D som körs i webbläsaren. Realismen ligger i simuleringen och grafiken hålls enkel. Projektet använder TypeScript, Vite, Three.js och Vitest och publiceras på GitHub Pages (repo `ubatssim`, `base: '/ubatssim/'`).

## Kommandon
- `npm run dev`: utvecklingsserver.
- `npm test`: Vitest. Fysiktesterna körs utan grafik.
- `npm run lint`: ESLint. Kontrollerar bland annat lagergränserna.
- `npm run build`: `tsc --noEmit` och Vite-bygge till `dist/`.
- **Publicering:** en push till `main` kör `.github/workflows/deploy.yml` (lint → test → build → GitHub Pages). Pages-källan är "GitHub Actions".

## Arkitektur
```
src/sim/      Ren fysik. Inga beroenden på Three.js, DOM eller andra lager.
src/control/  Order (typad union), orderkö, svensk kommandoparser, autopilot (PID), controller.
src/render/   Three.js. Läser bara simuleringens tillstånd och skriver aldrig till det.
src/ui/       Instrumentpanel, kommandokonsol, tangentbord, pekkontroller (touch.ts), inmatningsläge, logg.
src/main.ts   Fast tidsstegsloop: ackumulator, 100 Hz, tak på antal steg per bildruta.
```
- **Simulering:** deterministisk. Samma starttillstånd och samma order ger exakt samma resultat. Använd aldrig `Math.random()` eller väggklocka i `src/sim`.
- **Order:** alla styrkommandon, från tangentbord, pekknappar och konsol, blir `Order`-objekt i `OrderQueue`. Kön verkställs i början av nästa tidssteg, och varje order kvitteras i loggen med simuleringstid.
- **Manuell styrning:** ett manuellt utslag kopplar ur autopiloten för den axeln.

## Fysikkonventioner
- **Enheter:** SI överallt i `src/sim`. Konvertering till knop och grader sker bara i UI-lagret (`src/sim/units.ts`).
- **Koordinater:** NED i världen och FRD i kroppen, enligt Fossen. Orienteringen är en quaternion. Bara `src/render/coords.ts` översätter till Three.js-koordinater (Y uppåt).
- **Modell:** Fossens rörelseekvation (M_RB + M_A)ν̇ + C(ν)ν + D(ν)ν + g(η) = τ, löst med RK4 och dt = 0,01 s.
- **Tankar och avdelningar:** beskrivs som data (id, position, form, volym, fyllnadsgrad). Massa och tyngdpunkt härleds från dem. Strukturen används senare av genomskärningsvyn och får inte förenklas bort.
- **Terräng:** `src/sim/terrain.ts` är en deterministisk höjdfunktion (hav i väster, skärgård i öster) med parametrar i `config/terrain.ts`. Simuleringen läser den via ett cachat rutnät (`terrainGrid.ts`), och grundstötning hanteras i `contact.ts`. Renderingen använder samma funktion, så det man ser är det man kan krocka med.
- **Parametrar:** alla ligger i `src/sim/config/` med kommentar om källa och enhet. Värden som inte är kontrollerade mot källan märks `// APPROX`.
- **3D-modellen:** byggs i separata lager (yttre skrov, tryckskrov, tankar, roder) så att ett klippningsplan kan läggas till senare.

## Kodkonventioner
- Identifierare och kommentarer skrivs på engelska. UI-texter, konsolkommandon och dokumentation på svenska.
- `strict` TypeScript med `noUncheckedIndexedAccess`.
- Ny fysik ska ha Vitest-tester i `tests/`.

## Integritetsregler
- Inga absoluta lokala sökvägar, användarnamn, e-postadresser eller annan personlig information i kod, kommentarer, README eller CLAUDE.md.
- Ingen `author` eller annan personlig information i `package.json`.
- Commits görs med GitHub noreply-adressen (`...@users.noreply.github.com`). Kontrollera `git config user.email` innan commit.
- Ingen `Co-Authored-By`-rad i commit-meddelanden.
- `.gitignore` utesluter `node_modules/`, `dist/`, `.env*` och `.claude/settings.local.json`.
- Fråga alltid användaren innan något skapas, pushas eller ändras på GitHub.
