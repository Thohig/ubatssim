# Idéer

Förslag på vad som skulle förbättra spelet, med läge och en rekommenderad ordning. Det som är gjort beskrivs i README och de andra dokumenten. Här står bara det som återstår och varför.

Spelet har nu detaljerad fysik, ballast, trim, terräng, fartyg, ljud, väder, besättningen, genomskärningen, batteri och dieslar, läckage, passiv sonar, sjökort, målrörelseanalys, torpeder, korvetter som jagar, svävning utan fart och en startsida med egen musik. Det som saknas är framför allt **mer variation i motståndet** och **en kampanj** som binder ihop uppdragen.

## Rekommenderad ordning

1. **Flera fartyg som samarbetar:** två korvetter som söker tillsammans, och en konvoj som sprider ut sig eller vänder när ett fartyg träffas.
2. **Motmedel:** ett lockmål (decoy) som låter som ubåten och drar korvettens ping och sjunkbomber, i ett begränsat antal.
3. **En kampanj:** uppdragen i ordning, där batteri, torpeder och skador följer med mellan dem.

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
| **Trådstyrda torpeder** | Återstår | Styr om en torped efter avfyrningen via tråden, när lösningen blivit bättre. |
| **Aktiv sonar på ubåten** | Återstår | En ping som ger avstånd direkt, men som hörs långt och avslöjar ubåten. |
| **Skott och länsning** | Återstår | Vattentäta dörrar som besättningen stänger, så att en läcka hålls i en avdelning, och vatten som flyttar sig när ubåten lutar. |
| **Besättningens reaktionstid** | Återstår | Order verkställs efter några sekunder (deterministiskt), och kvittot kommer då. Ger realism när spelaren sköter ett system själv. |

## Grafik

| Förslag | Läge | Innehåll |
|---|---|---|
| **Genomskärning** | Klar | Se README (Vyer) och `docs/grafik.md`. |
| **Livet under ytan** | Klar | Bubblor från huvudballasten, kölvatten, plym efter masterna och avgaser från snorkeln (`render/effects.ts`). |
| **Sikt under vattnet** | Klar | Mörker efter djupet, vattnets färg och klarhet per havsområde, och ljusstrålar nära ytan. |
| **Genomskärningen: etapp 4** | Klar | Vatten i läckande avdelningar, batterierna, dieslarna, torpedtuberna och reservtorpederna. |
| **Startsidan** | Klar | Mörk musik, skymning, korvett och sjunkbomber, menyn som en order. Se `docs/ljud.md` och `docs/grafik.md`. |
| **Ytan underifrån** | Återstår | Ett ljust fönster rakt ovanför och mörkt utanför (totalreflektion), sett från under ytan. |

## Tekniskt

| Förslag | Läge | Innehåll |
|---|---|---|
| **Robusthet** | Klar | Minnet på grafikkortet, förlorad grafik och felrutan. Se `docs/grafik.md`. |
| **Determinismtest** | Klar | Referens per plattform. Se CLAUDE.md (Simulering). |
| **Tester i webbläsaren** | Klar | Playwright i `tests/e2e/`, också i publiceringen. |
| **Uppdelning** | Klar | `src/ui/helm/`, `orderRegistry.ts` och `plantWatch.ts`. |
| **Ingen konsol** | Klar | Allt går med skärmkontrollerna och tangenterna. Loggen visas alltid men kortfattat, och historiken finns under ☰ → Loggbok. Parsern finns kvar för testerna. |

## Mindre idéer

- **Kortare långa tester:** testerna går nu på alla kärnor (~2,5 min). Mer tid går bara att vinna genom att simulera mindre, till exempel med mål närmare starten i testerna.
- **Fysiken i en Web Worker:** frigör huvudtråden, men lönar sig först när en kampanj eller fler fartyg och torpeder spräcker fysikbudgeten i `docs/prestanda.md`. Gränssnittet läser i dag `sim` direkt på många ställen och skulle i stället få en tunn kopia av tillståndet per bild.
- **Telegrafen:** steget från Halv fram (8 knop) till Full fram (19 knop) är stort. Halv fram kan höjas till 10–12 knop, eller så kan ett läge till läggas in.

## Från provspelningen (november 2026)

Rättat: pendlingen kring periskopdjupet efter en stigning (djupslingan och trimassistenten), nödblåsning och ytläge från djupet som tippade fören ned 40–60° (nu för först), eldledningens råd och bäringar som försvann efter tio minuter, upprepad "Grundstötning!", surfplattor på höjden och eldledningspanelen över genomskärningens rumsinformation. Kvar:

| Fynd | Innehåll |
|---|---|
| **Grundstötning i fart** | Skyddsnätet begränsar bara djupmålet. I 8 knop mot en brant strand kom begränsningen 29 m över botten, ubåten steg för långsamt och gick på grund. Efteråt kör besättningen vidare in i land i flera minuter. Förslag: besättningen slår Stopp vid grundstötning, och skyddsnätet varnar för stigande botten i färdriktningen i tid efter farten. |
| **Lätt efter dykning** | Från ytläge i 8 knop är ubåten ~9 t lätt på 15 m och ~3 t lätt på 50–80 m (luft kvar i huvudballasten). Assistenten tar 200 l var ~45:e s, så det tar många minuter. |
| **Snorkling tar tid** | 25 → 30 % tar ~17 min i 4 knop. Rätt fysik, men långt för ett scenario: lägre mål (28 %) eller ett tips om tidskomprimering. |
| **Konvojen är lätt** | Eskorten hörde avfyrningen men tappade ubåten som gick ned i 8 knop, och anföll aldrig. Klart på ~8 min. |
| **Munk-momentet** | `hullDamping` räknar stampmomentet som M′w·U·w. Munk-momentet är ∝ u·w: det försvinner när ubåten stiger rakt upp utan fart och byter tecken akterut. Att byta U mot u ändrade lite vid nödblåsning (stegvis blåsning var det som hjälpte), men är riktigare. Kräver ny determinismreferens och kontroll av Back. |
| **Sjökortet på mellanstora skärmar** | 1024×700: sjökortet täcker målrutan och loggen, och periskopets rubrikrad ligger under instrumentpanelen. På dator täcker sjökortet slutet av periskopets rubrikrad. |
| **Liggande telefon, periskop** | Eldledningspanelen överlappar målrutan när den är utfälld (vid varje nytt mål). |
| **Fast i vattenytan** | En spelare som sköter ballasten och stänger ventilerna vid ~97 % kan bli liggande på ~3 m i 4 knop med 5° djuproder i över 20 minuter: lite luft i tankarna och tornets vattenlinje håller ubåten kvar. Samma insats dyker ibland till 35 m, så läget är bistabilt. Förslag: tipset i Första dykningen säger "stäng vid 100 %" och "10° ned", eller en påminnelse när ubåten ligger kvar i ytan med fart och djuproder ned. |
| **Småsaker** | Skyddsnätet skriver "djupet begränsas till 1 m" i ytläge (Genom sundet). Första dykningen: målet säger 5 knop men tipset Sakta fram ger 4 (kontrollen är 3). Simuleringen fortsätter bakom resultatskärmen. |
