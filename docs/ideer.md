# Idéer

Förslag på vad som skulle förbättra spelet, med läge och en rekommenderad ordning. Det som är gjort beskrivs i README och de andra dokumenten. Här står bara det som återstår och varför.

Spelet har nu detaljerad fysik, ballast, trim, terräng, fartyg, ljud, väder, besättningen, genomskärningen, batteri och dieslar, läckage, passiv och aktiv sonar, radar och radarvarnare, sjökort, målrörelseanalys, torpeder och torpedrum, korvetter som jagar och samarbetar, lockmål, trådstyrda torpeder, skott och länsning, svävning utan fart och en startsida med egen musik.

## Rekommenderad ordning

Inget av förslagen återstår just nu. Nya idéer läggs till här.

## System

| Förslag | Läge | Innehåll |
|---|---|---|
| **Batteri, diesel och snorkling** | Klar | Se README och `docs/fysikmodell.md`. |
| **Passiv sonar och upptäckt** | Klar | Se README och `docs/fysikmodell.md` (Akustik). |
| **Sjökort och plott** | Klar | Se README och `docs/grafik.md`. |
| **Läckage och skador** | Klar | Se README och `docs/fysikmodell.md`. |
| **Korvetter som jagar** | Klar | Se README och `docs/fysikmodell.md`. |
| **Målrörelseanalys och torpeder** | Klar | Se README (Anfall) och `docs/fysikmodell.md`. |
| **Sväva utan fart** | Klar | Se README (Besättningen och du) och `docs/fysikmodell.md`. |
| **Välja mål och tub** | Klar | Målraden och tubknapparna i eldledningspanelen. Se README (Anfall). |
| **Genomgång och målruta** | Klar | Se README (Scenarier) och `docs/grafik.md`. |
| **Trådstyrda torpeder** | Klar | Styr, Sök och Kapa i eldledningspanelen. Se README (Anfall). |
| **Motmedel** | Klar | Fyra lockmål som låter som ubåten. Se README (Anfall). |
| **Fartyg som samarbetar** | Klar | Korvetter i par (en lyssnar, en fäller) och konvojer som sicksackar. Se README (Korvetter som jagar). |
| **Telegrafen** | Klar | Läget Marsch, 12 knop, mellan Halv och Full fram. |
| **Aktiv sonar på ubåten** | Klar | En ping ger avstånd direkt men hörs långt. Se README (Aktiv sonar och radar). |
| **Radar och radarvarnare** | Klar | En egen mast, radarhorisonten, svep var 3:e s och korvetternas radarvarnare. Se README. |
| **Torpedrummet** | Klar | Tubernas steg (klar, säkra, ladda), laddrälsen, besättningen och torpedernas vikt. Se README (Torpedrummet). |
| **Bäringen utanför periskopet** | Klar | Bäringsbandet under eller ovanför okularet. Se `docs/grafik.md`. |
| **Skott och länsning** | Klar | Vattentäta dörrar, vatten som rinner till den låga änden och länsa först. Se README (Läckage och skador). |

## Grafik

| Förslag | Läge | Innehåll |
|---|---|---|
| **Genomskärning** | Klar | Se README (Vyer) och `docs/grafik.md`. |
| **Livet under ytan** | Klar | Bubblor från huvudballasten, kölvatten, plym efter masterna och avgaser från snorkeln (`render/effects.ts`). |
| **Sikt under vattnet** | Klar | Mörker efter djupet, vattnets färg och klarhet per havsområde, och ljusstrålar nära ytan. |
| **Genomskärningen: etapp 4** | Klar | Vatten i läckande avdelningar, batterierna, dieslarna, torpedtuberna och reservtorpederna. |
| **Startsidan** | Klar | Ubåten glider förbi under vattnet i dagsljus, lugn musik, menyn som en färdorder. Se `docs/ljud.md` och `docs/grafik.md`. |
| **Skärmkontrollerna** | Klar | Yta som vanlig stigning, Per.djup, System ▾ på alla skärmar och vyknappar med ikoner mellan telegrafen och kompassen. |
| **Scenariolistan** | Klar | Fem flikar efter vad scenariot övar på och kompakta kort. Se README (Scenarier). |
| **Ytan underifrån** | Klar | Snells fönster i havsytans shader. Se `docs/grafik.md`. |

## Tekniskt

| Förslag | Läge | Innehåll |
|---|---|---|
| **Robusthet** | Klar | Minnet på grafikkortet, förlorad grafik och felrutan. Se `docs/grafik.md`. |
| **Determinismtest** | Klar | Referens per plattform. Se CLAUDE.md (Simulering). |
| **Tester i webbläsaren** | Klar | Playwright i `tests/e2e/`, också i publiceringen. |
| **Uppdelning** | Klar | `src/ui/helm/`, `orderRegistry.ts` och `plantWatch.ts`. |
| **Ingen konsol** | Klar | Allt går med skärmkontrollerna och tangenterna. Loggen visas alltid men kortfattat, och historiken finns under ☰ → Loggbok. Parsern finns kvar för testerna. |

## Mindre idéer

- **Kortare långa tester:** testerna av tidsgränser körs med en kopia av scenariot med kortare `timeLimit`. Resten kan gå fortare med mål närmare starten.
- **Fysiken i en Web Worker:** frigör huvudtråden, men lönar sig först när fler fartyg och torpeder spräcker fysikbudgeten i `docs/prestanda.md`. Gränssnittet läser i dag `sim` direkt på många ställen och skulle i stället få en tunn kopia av tillståndet per bild.

## Från provspelningen (november 2026)

Allt som provspelningen hittade är rättat:

- **Djup:** pendlingen kring periskopdjupet efter en stigning (djupslingan och trimassistenten).
- **Ytläge och nödblåsning:** fören ned 40–60° från djupet; nu blåses för först. Stampmomentet från anfallsvinkeln räknas med u·w.
- **Eldledning:** råden, och bäringarna som försvann efter tio minuter.
- **Korvetter:** den som växlade fram och tillbaka utan bomber, den som gav upp på väg till en hörd avfyrning (Konvojen var för lätt), och att en korvett utan bomber eller sänkt räknas som avskakad (Jagad, Konvojen).
- **Skyddsnät:** "grunt förut" efter farten, besättningen saktar in och slår Stopp efter en grundstötning, ingen fartökning nära botten, och "Grundstötning!" högst var 20:e s.
- **Trim:** större kompenseringar vid fel över ett ton, och en påminnelse när luft i huvudballasten håller ubåten i ytan.
- **Scenarier:** Snorkling till 28 %, tydligare tips i Första dykningen.
- **Gränssnitt:** surfplattor på höjden får mobillayouten, mellanstora skärmar och liggande telefon utan överlapp, eldledningspanelen inte i genomskärningen, inget larm när snorkeln sänks.

Simuleringen fortsätter bakom resultatskärmen med avsikt (`GameFlow.simRunning`).
