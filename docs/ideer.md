# Idéer

Förslag på vad som skulle förbättra spelet, med läge och en rekommenderad ordning. Det som är gjort beskrivs i README och de andra dokumenten. Här står bara det som återstår och varför.

Spelet har nu detaljerad fysik, ballast, trim, terräng, fartyg, ljud, väder, besättningen, genomskärningen, batteri och dieslar, läckage, passiv sonar, sjökort, målrörelseanalys, torpeder och korvetter som jagar. Det som saknas är framför allt **mer variation i motståndet** och **en kampanj** som binder ihop uppdragen.

## Rekommenderad ordning

1. **Flera fartyg som samarbetar:** två korvetter som söker tillsammans, och en konvoj som sprider ut sig eller vänder när ett fartyg träffas.
2. **Motmedel:** ett lockmål (decoy) som låter som ubåten och drar korvettens ping och sjunkbomber, i ett begränsat antal.
3. **Läckaget i genomskärningen:** vattnet i avdelningarna och tätningsarbetet syns i snittet, som vattnet i tankarna.
4. **En kampanj:** uppdragen i ordning, där batteri, torpeder och skador följer med mellan dem.

## System

| Förslag | Läge | Innehåll |
|---|---|---|
| **Batteri, diesel och snorkling** | Klar | Se README och `docs/fysikmodell.md`. |
| **Passiv sonar och upptäckt** | Klar | Se README och `docs/fysikmodell.md` (Akustik). |
| **Sjökort och plott** | Klar | Se README och `docs/grafik.md`. |
| **Läckage och skador** | Klar | Se README och `docs/fysikmodell.md`. |
| **Korvetter som jagar** | Klar | Se README och `docs/fysikmodell.md`. |
| **Målrörelseanalys och torpeder** | Klar | Se README (Anfall) och `docs/fysikmodell.md`. |
| **Trådstyrda torpeder** | Återstår | Styr om en torped efter avfyrningen via tråden, när lösningen blivit bättre. |
| **Aktiv sonar på ubåten** | Återstår | En ping som ger avstånd direkt, men som hörs långt och avslöjar ubåten. |
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

- **Torpedernas egen fara:** en torped som söker kan i dag inte vända mot ubåten själv. En verklig torped har skydd mot det (ett förbjudet område runt ubåten), men en runt-gående torped vore spännande.
- **Långa tester:** `npm run test:all` tar nu ~5 min. Scenariotesterna kan köras parallellt i fler trådar, eller kortas med mindre avstånd.
- **Djupstyraren nära ytan:** sedan integralzonen minskades till 1,5 m svänger den över högst ~1,5 m vid stigning till periskopdjup. Vid 3 knop orkar djuprodren ändå inte lyfta ubåten från 40 m. Ett tips eller en lägsta fart för djupstyraren på periskopdjup vore bra.
- **Ljud i ljudlöst läge på iPhone:** Web Audio tystnar när ljudlös-knappen är på. Från iOS 17 kan `navigator.audioSession.type = 'playback'` låta ljudet höras ändå.
- **Prova mobilvyn på en riktig telefon:** den är bara provad i webbläsarens telefonläge.
- **Telegrafen:** steget från Halv fram (8 knop) till Full fram (19 knop) är stort. Halv fram kan höjas till 10–12 knop, eller så kan ett läge till läggas in.
- **Stopp:** fartautopiloten lättar på backen mot slutet, så de sista knopen tar lång tid (från 8 knop: stilla efter 217 s med Stopp mot 95 s med Full back). Stopp kan göra som en besättning: full back och sedan stopp vid ungefär 1 knop.
- **Back vid inbromsning:** motorn tillåter högst 108 rpm back (APPROX), vilket begränsar farten bakåt men också inbromsningen. Fullt varvtal bakåt medan ubåten fortfarande går framåt skulle ge ett kortare stopp, utan att ändra toppfarten bakåt.
- **Prestanda i genomskärningen:** mät med `?perf` på en telefon med riktigt grafikkort (testmiljön ritar i mjukvara). Om det behövs: färre genomskinliga ytor och enklare cylindrar (se `docs/prestanda.md`).
- **Ubåtens storlek:** 60 m räcker för alla avdelningar, eftersom verkliga ubåtar av samma storlek har samma indelning. Blir det trångt kan tryckskrovet förlängas något (41 → ~45 m) utan att den yttre formen ändras. En större ubåtsklass är ett eget arbete: fysikens värden, testerna och farlederna i scenarierna måste ses över.
