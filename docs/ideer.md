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
