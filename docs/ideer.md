# Idéer

Förslag på vad som skulle förbättra spelet, med läge och en rekommenderad ordning. Det som är gjort beskrivs i README och de andra dokumenten. Här står bara det som återstår och varför.

Spelet har nu detaljerad fysik, ballast, trim, terräng (med kanjon och undervattensberg), liv i havet och på land, fartyg, flyg, ljud, väder, besättningen, genomskärningen, manöverrummet inifrån, batteri och dieslar, läckage, passiv och aktiv sonar, radar och radarvarnare, sjökort, målrörelseanalys, torpeder och torpedrum, korvetter som jagar och samarbetar, lockmål, trådstyrda torpeder, skott och länsning, svävning utan fart och en startsida med egen musik.

## Rekommenderad ordning

1. **Manöverrummet: ljud och fler skärmar** (se Grafik): rummets egna ljud och vapenpulpetens skärm. Litet, och vyn känns mer levande.
2. **Fler rum inifrån** (se Grafik): torpedrummet först, där tubernas steg och omladdningen redan finns i simuleringen.

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
| **Besättningen sköter manövern** | Klar | Spelaren väljer fart, kurs och djup (Yta, Periskop, Djup), och vakthavande officer (`conn.ts`) väljer hur: inbromsning utan back, fartgräns och mjukare roder nära periskopdjup, tyst gång när en korvett jagar, trim före djupbytet. Planraden och detaljerna på tavlan, handstyrning i expertläge. Se README (Besättningen och du). |

## Grafik

| Förslag | Läge | Innehåll |
|---|---|---|
| **Genomskärning** | Klar | Se README (Vyer) och `docs/grafik.md`. |
| **Livet under ytan** | Klar | Bubblor från huvudballasten, kölvatten, plym efter masterna och avgaser från snorkeln (`render/effects.ts`). |
| **Sikt under vattnet** | Klar | Mörker efter djupet, vattnets färg och klarhet per havsområde, och ljusstrålar nära ytan. |
| **Genomskärningen: etapp 4** | Klar | Vatten i läckande avdelningar, batterierna, dieslarna, torpedtuberna och reservtorpederna. |
| **Startsidan** | Klar | Ubåten glider förbi under vattnet i dagsljus, lugn musik, menyn som en färdorder. Se `docs/ljud.md` och `docs/grafik.md`. |
| **Skärmkontrollerna** | Klar | Yta / Periskop / Djup, planraden med detaljerna och expertläget. Vyknapparna med ikoner står i en kolumn mitt i högerkanten på dator. |
| **Manöverrummet** | Klar | Vyn inifrån med fem platser, skärmar som visar simuleringen, rött ljus, larmlampa, skakningar och vatten. Se README (Vyer) och `docs/grafik.md`. |
| **Manöverrummet: ljud och fler skärmar** | Förslag | Ljuden inne i rummet (fläktar, reläer, rodermaskinen när rodren slår, klickande ekolod) styrda av samma telemetri. Vapenpulpeten på styrbordssidan visar eldledningens mål och tuberna, och ett tryck öppnar panelen Torped. Kortare övergång (en snabb tonad växling) mellan platserna. |
| **Fler rum inifrån** | Förslag | Torpedrummet (tuberna, laddrälsen, reservtorpederna) och maskinrummet (dieslarna som skakar vid snorkling) som egna vyer, byggda på samma sätt som manöverrummet ur `interior.ts`. Dörrarna i skotten blir vägen mellan dem. |
| **Scenariolistan** | Klar | Fem flikar efter vad scenariot övar på och kompakta kort. Se README (Scenarier). |
| **Ytan underifrån** | Klar | Snells fönster i havsytans shader. Se `docs/grafik.md`. |

## Liv i världen

| Förslag | Läge | Innehåll |
|---|---|---|
| **Eggakanten** | Klar | Nytt havsområde: sockel, brant, kanjon, undervattensberg, vrak och kust. Scenariot Kanjonen. |
| **Terrängens skugga** | Klar | Botten och land skuggar ljudet; kanjoner och berg gömmer ubåten. |
| **Bottentyper och bottenekot** | Klar | Lera, sand, grus och berg; nära en klippig botten drunknar ekot. |
| **Valar och sillstim** | Klar | Biologiska kontakter, ekon och ljud genom skrovet. |
| **Spridningsskiktet** | Klar | Djupt på dagen, grunt på natten; döljer en ubåt inne i skiktet. |
| **Civil trafik och trålar** | Klar | Segelbåtar, trålare med trål att fastna i. |
| **Flyg och kustradar** | Klar | Ser masterna och anropar korvetterna (i scenarier). |
| **Land och liv i bild** | Klar | Hus, skog, snö, lysbojar, kustradar, vrak, måsar, tång, maneter, mareld. |

Knäppande räkor, som i förslaget skulle ge biologiskt brus på grunt vatten, lever inte i nordiska vatten. Sillens tickande på natten fick ta den platsen.

**Kvar att pröva:** ett scenario med spaningsplanet och snorkling, valar som kan förväxlas med en ubåt av korvetterna, och fler vrak i de andra områdena.

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
- **Publiceringen:** testdelarna och e2e-delarna tar 1,5–3 min var på CI och varierar mycket mellan körningar. Fyra testdelar eller tre e2e-delar sparar troligen bara någon halv minut; större maskiner (betalda) mer.
- **Fysiken i en Web Worker:** frigör huvudtråden, men lönar sig först när fler fartyg och torpeder spräcker fysikbudgeten i `docs/prestanda.md`. Gränssnittet läser i dag `sim` direkt på många ställen och skulle i stället få en tunn kopia av tillståndet per bild.

## Stigning och dykning

Gjort: en ny fart framåt behåller den stegvisa stigningen, och stampvinkeln nedåt begränsas efter fart, botten och djup (README, `docs/fysikmodell.md`). `hold` släpper av sig själv när fartyget passerat (stark kontakt räknas bara inom 3 km). Kvar:

- **Yta via periskopdjup:** från djupare än 15 m planar besättningen ut på periskopdjup, hissar periskopet och tittar runt ~30 s innan den blåser; ett fartyg nära håller den där, Yta igen hoppar över. Ersätter specialfallet `surfaceHeld`. Ändrar troligen determinismens referens.
- **En tröskel:** stigningen startar i dag först djupare än 40 m men planar ut på 35 m, så från 36–40 m lyssnar ingen. `startBelow` 37 m.
- **Planraden:** säg hur länge besättningens fart gäller ("6 kn tills 16 m") och vilket mål knappen Djup går till.
- **`STILL_HINT` på alla djup:** i dag bara djupare än 40 m; på 20 m med varvtal 0 och Yta säger ingen något förrän stoppvakten efter 30 s.
- **Nödblåsningen från stort djup:** ett mål på 320 m får skyddsnätet att nödblåsa på ~260 m, och på väg upp tippar fören till −15° (8 knop) eller −30° (Full fram) och farten faller nästan till noll.

Från ett provspel av djupbyten från alla startlägen (djupmål 0–250 m, standardfart, Stopp och Marsch, lugn till grov sjö), rättat: Stopp med nytt djupmål gick först åt fel håll, svävningen sköt över korta djupbyten, skyddsnätets djupgräns gav aldrig tillbaka djupmålet, `hold` på 35 m utlöstes av fartyg 6–12 km bort och spärrade för alltid, "… är länsat." upprepades varje tidssteg efter en grundstötning, land förut ledde till yta i stället för stopp, en ubåt utan fart sjönk med en läcka till botten, nödblåsning från 50 m gav 31–36° fören upp, stora djupbyten i Sakta tog över 20 minuter, Full fram före djupordern gav ändå lyssnandet och trimmet förbereddes bara efter start och mål. Kvar:

- **Drivning i trånga sund:** drivvakten går rakt fram eller back, utan att gira (en gir mot strömmen svepte ubåten mot andra stranden). Med strömmen tvärs kursen hjälper det inte; då återstår varningen.
- **Svävning på djupet:** uppåt går nu fortare (200 → 100 m ~13 min), men nedåt begränsar pumpen mot havstrycket fortfarande till 0,12 m/s; en bromssträcka efter pumpens fart åt bromshållet provades, men underskattade hur länge ubåten glider när den väl är neutral (7–17 m översläng). Planraden säger tiden och att Sakta fram går fortare.
- **Saltsprångskiktet i Östersjön:** 13 → 90 m blir ~2,5 ton lätt under skiktet, mer än pumpen hinner med på vägen; ubåten hänger 1,5 m ovanför målet i några minuter.

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
