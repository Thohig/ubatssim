# Idéer

Förslag på vad som skulle förbättra spelet, med läge och en rekommenderad ordning. Det som är gjort beskrivs i README och de andra dokumenten. Här står bara det som återstår och varför.

Spelet har redan detaljerad fysik, ballast, trim, terräng, fartyg, ljud, väder, besättningen och genomskärningen. Det som saknas är framför allt **varför** man ska göra något (uppdrag och spänning) och **vad man ser under ytan**.

## Rekommenderad ordning

1. **Batteri, diesel och snorkling.** Fyller genomskärningen med liv, eftersom batterirummet och dieselmotorerna redan finns där och visar "simuleras inte ännu". Ger ett taktiskt dilemma: farten kostar batteri, och snorkling laddar men gör ubåten lättare att upptäcka. Passar arkitekturen: batteri och diesel ska vara delsystem i `src/sim/systems/` (se CLAUDE.md).
2. **Passiv sonar och upptäckt**, tillsammans med **sjökortet.** Gör smygande och navigering till ett spel och bygger på det som redan finns: fartygen, ljudet, terrängen och språngskiktet.
3. **Läckage och skador.**
4. **Livet under ytan** och **bättre sikt under vattnet.**

## System

| Förslag | Läge | Innehåll |
|---|---|---|
| **Batteri, diesel och snorkling** | Återstår | Batteriets laddning som delsystem: urladdning efter axeleffekt och hotelllast, laddning med dieselgeneratorerna vid snorkling (snorkelmast, luftintag som kan sköljas över i sjögång). Instrument, ett system för besättningen ("laddning") och information i genomskärningen. |
| **Passiv sonar och upptäckt** | Återstår | En sonarskärm med bäring till kontakter (fartygen hörs redan i ljudet). Ett mått på hur synlig och hörbar ubåten är, som beror på fart (kavitation), periskop och snorkel, djup och språngskiktet i vattenmodellen. Scenarier där ubåten ska smyga. |
| **Sjökort och plott** | Återstår | En kartvy med ubåtens spår, kontakter, bojar, djupkurvor och farleder. I dag navigerar man bara med kompassen och "Under köl". |
| **Läckage och skador** | Återstår | Grundstötning och krossdjup får följder i stället för att bara misslyckas: vatten tränger in i en avdelning, och pumpar och tryckluft blir avgörande. Avdelningarna finns som data (`compartments`) och syns i genomskärningen. Ett delsystem i `src/sim/systems/`. |
| **Besättningens reaktionstid** | Återstår | Order verkställs efter några sekunder (deterministiskt), och kvittot kommer då. Ger realism när spelaren sköter ett system själv. |

## Grafik

| Förslag | Läge | Innehåll |
|---|---|---|
| **Genomskärning** | Klar | Se README (Vyer) och `docs/grafik.md`. |
| **Livet under ytan** | Delvis | Bubblor finns i genomskärningen. Återstår i den yttre vyn: luftbubblor när huvudballasten blåses eller ventileras, kölvatten och skum vid propellern, och spray och plym efter periskopet. |
| **Bättre sikt under vattnet** | Återstår | Mörker och dimma som beror på djupet, vattnets färg per havsområde och ljusstrålar nära ytan. |
| **Sonar- och kartbilder** | Återstår | 2D-vyer i samma stil som kompassbandet, för sonaren och sjökortet ovan. |
| **Genomskärningen: etapp 4** | Väntar | Koppla in batteriets laddning, dieselmotorernas gång och läckage i genomskärningen när de systemen finns. |

## Mindre idéer

- **Telegrafen:** steget från Halv fram (8 knop) till Full fram (19 knop) är stort. Halv fram kan höjas till 10–12 knop, eller så kan ett läge till läggas in.
- **Stopp:** fartautopiloten lättar på backen mot slutet, så de sista knopen tar lång tid (från 8 knop: stilla efter 217 s med Stopp mot 95 s med Full back). Stopp kan göra som en besättning: full back och sedan stopp vid ungefär 1 knop.
- **Back vid inbromsning:** motorn tillåter högst 108 rpm back (APPROX), vilket begränsar farten bakåt men också inbromsningen. Fullt varvtal bakåt medan ubåten fortfarande går framåt skulle ge ett kortare stopp, utan att ändra toppfarten bakåt.
- **Prestanda i genomskärningen:** mät med `?perf` på en telefon med riktigt grafikkort (testmiljön ritar i mjukvara). Om det behövs: färre genomskinliga ytor och enklare cylindrar (se `docs/prestanda.md`).
- **Ubåtens storlek:** 60 m räcker för alla avdelningar, eftersom verkliga ubåtar av samma storlek har samma indelning. Blir det trångt kan tryckskrovet förlängas något (41 → ~45 m) utan att den yttre formen ändras. En större ubåtsklass är ett eget arbete: fysikens värden, testerna och farlederna i scenarierna måste ses över.
