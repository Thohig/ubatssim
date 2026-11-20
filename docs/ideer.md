# Idéer

Förslag på vad som skulle förbättra spelet, med läge och en rekommenderad ordning. Det som är gjort beskrivs i README och de andra dokumenten. Här står bara det som återstår och varför.

Spelet har nu detaljerad fysik, ballast, trim, terräng, fartyg, ljud, väder, besättningen, genomskärningen, batteri och dieslar, läckage, passiv sonar och sjökort. Det som saknas är framför allt ett **motstånd som reagerar** (fartyg som jagar ubåten) och **mer att göra med sonaren**.

## Rekommenderad ordning

1. **Korvetter som jagar.** En korvett som har upptäckt ubåten ändrar i dag inte kurs. Den borde gå mot den senaste kända positionen, sakta in för att höra bättre och söka i ett mönster. Det ger smygandet en följd och bygger på `Sonar.awareness` och `Vessel`.
2. **Mer sonar:** målrörelseanalys (avstånd, kurs och fart ur flera bäringar, som en plott i sjökortet) och ett mål att "lösa" en kontakt i ett scenario.
3. **Läckaget i genomskärningen:** vattnet i avdelningarna och tätningsarbetet syns i snittet, som vattnet i tankarna.
4. **Ljusstrålar** nära ytan under vattnet.

## System

| Förslag | Läge | Innehåll |
|---|---|---|
| **Batteri, diesel och snorkling** | Klar | Se README och `docs/fysikmodell.md`. |
| **Passiv sonar och upptäckt** | Klar | Se README och `docs/fysikmodell.md` (Akustik). |
| **Sjökort och plott** | Klar | Se README och `docs/grafik.md`. |
| **Läckage och skador** | Klar | Se README och `docs/fysikmodell.md`. |
| **Korvetter som jagar** | Återstår | Upptäckt ger i dag bara larm och, i Smyg förbi, ett misslyckat uppdrag. Se ovan. |
| **Målrörelseanalys** | Återstår | Bäringar över tid ger avstånd, kurs och fart till en kontakt. En plott i sjökortet och ett kvitto när lösningen är bra nog. |
| **Skott och länsning** | Återstår | Vattentäta dörrar som besättningen stänger, så att en läcka hålls i en avdelning, och vatten som flyttar sig när ubåten lutar. |
| **Besättningens reaktionstid** | Återstår | Order verkställs efter några sekunder (deterministiskt), och kvittot kommer då. Ger realism när spelaren sköter ett system själv. |

## Grafik

| Förslag | Läge | Innehåll |
|---|---|---|
| **Genomskärning** | Klar | Se README (Vyer) och `docs/grafik.md`. |
| **Livet under ytan** | Klar | Bubblor från huvudballasten, kölvatten, plym efter masterna och avgaser från snorkeln (`render/effects.ts`). |
| **Sikt under vattnet** | Delvis | Mörker efter djupet och vattnets färg och klarhet per havsområde finns. Ljusstrålar nära ytan återstår. |
| **Genomskärningen: etapp 4** | Delvis | Informationsrutan visar batteriet, dieslarna, snorkeln och vattnet i en läckande avdelning. Vattnet i avdelningarna ritas inte ännu. |

## Mindre idéer

- **Djupstyraren nära ytan:** sedan integralzonen minskades till 1,5 m svänger den över högst ~1,5 m vid stigning till periskopdjup. Vid 3 knop orkar djuprodren ändå inte lyfta ubåten från 40 m. Ett tips eller en lägsta fart för djupstyraren på periskopdjup vore bra.
- **Ljud i ljudlöst läge på iPhone:** Web Audio tystnar när ljudlös-knappen är på. Från iOS 17 kan `navigator.audioSession.type = 'playback'` låta ljudet höras ändå.
- **Prova mobilvyn på en riktig telefon:** den är bara provad i webbläsarens telefonläge.
- **Telegrafen:** steget från Halv fram (8 knop) till Full fram (19 knop) är stort. Halv fram kan höjas till 10–12 knop, eller så kan ett läge till läggas in.
- **Stopp:** fartautopiloten lättar på backen mot slutet, så de sista knopen tar lång tid (från 8 knop: stilla efter 217 s med Stopp mot 95 s med Full back). Stopp kan göra som en besättning: full back och sedan stopp vid ungefär 1 knop.
- **Back vid inbromsning:** motorn tillåter högst 108 rpm back (APPROX), vilket begränsar farten bakåt men också inbromsningen. Fullt varvtal bakåt medan ubåten fortfarande går framåt skulle ge ett kortare stopp, utan att ändra toppfarten bakåt.
- **Prestanda i genomskärningen:** mät med `?perf` på en telefon med riktigt grafikkort (testmiljön ritar i mjukvara). Om det behövs: färre genomskinliga ytor och enklare cylindrar (se `docs/prestanda.md`).
- **Ubåtens storlek:** 60 m räcker för alla avdelningar, eftersom verkliga ubåtar av samma storlek har samma indelning. Blir det trångt kan tryckskrovet förlängas något (41 → ~45 m) utan att den yttre formen ändras. En större ubåtsklass är ett eget arbete: fysikens värden, testerna och farlederna i scenarierna måste ses över.
