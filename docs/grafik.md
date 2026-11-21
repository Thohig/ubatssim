# Grafiken

Grafiken ritas med Three.js i WebGL och finns i `src/render/`, med overlay och vyer i `src/ui/`. Den läser simuleringens tillstånd men skriver aldrig till det. Ett test (`tests/architecture.test.ts`) och ESLint kontrollerar att fysiken i `src/sim/` inte är beroende av grafiken.

Grafiken är medvetet enkel. Realismen ligger i simuleringen. Det finns inga texturer, skuggor eller efterbehandling, bara färgade ytor, dimma och två ljuskällor: himmel (hemisfärljus) och sol (riktat ljus).

## Två takter

- **Fysiken** räknar i fasta steg om 0,01 s (100 Hz).
- **Grafiken** ritas en gång per skärmuppdatering, normalt 60 gånger i sekunden.
- **Loopen** (`FixedStepLoop` i `src/game/loop.ts`, anropad från `src/game/app.ts`):
  1. lägger verklig tid × tidskomprimering i en ackumulator,
  2. kör de hela fysiksteg som har hunnit bli aktuella,
  3. skickar ett `RenderState` till renderingen: läge, orientering, roder- och djuproderutslag, propellervinkel och periskopets höjd.
- **Instrumentpanelen** uppdateras tio gånger i sekunden.
- **Fel i en bild:** `frame` ber om nästa bild först och fångar fel i resten. Det första felet (också från `window.onerror` och `unhandledrejection`) pausar spelet och visar menyskärmen `error` med en felrapport. Senare fel går bara till konsolen, högst fem, tills spelet startas om.
- **Förlorad grafik:** webbläsaren kan ta tillbaka WebGL-kontexten (`webglcontextlost`). Spelet pausas och menyskärmen `graphics` visas. Three.js bygger upp buffertar, texturer och shaders igen vid `webglcontextrestored`, och då kan spelaren fortsätta. Esc gör ingenting medan grafiken är borta.
- **Minnet på grafikkortet:** att ta bort ett objekt ur scenen frigör inte dess buffertar. Grupper som byggs om (fartygen, fyrarna) töms med `disposeTree` (`dispose.ts`), som lämnar delade material och texturer och spritarnas gemensamma geometri. Terrängen skriver nya normaler och färger i de befintliga buffertarna. `?perf` visar antalet geometrier, texturer och shaderprogram, som inte ska växa när ett spel startas om.

## Koordinater

Fysiken räknar i NED (norr, öster, nedåt) och FRD i kroppen. Three.js har Y uppåt. Bara `src/render/coords.ts` översätter: norr → −Z, öster → +X och nedåt → −Y. Ubåtsmodellen byggs i ett eget lokalt system med samma avbildning, och orienteringen blir C·R·Cᵀ.

## Ubåten (`submarineModel.ts`)

- **Mått:** modellen byggs av samma mått som fysiken använder (`src/sim/config/submarine.ts`).
  - Skrovet roteras fram ur skrovets radieprofil (`LatheGeometry`).
  - Tornet, rodren, djuprodren och propellern placeras på sina positioner i kroppen.
- **Lager:** yttre skrov, tryckskrov, tankar, avdelningar och utrustning ligger i separata grupper med egna material. Genomskärningen lägger sitt klippningsplan på dem (`renderer.localClippingEnabled`).
- **Rörliga delar:** roder, djuproder, propeller och periskopmast följer simuleringens värden varje bild.

## Terrängen (`terrain.ts`)

- **Två rutnät:**
  - ett detaljerat på 1,6 km med 8 m rutor runt ubåten
  - ett grövre på 24 km med 120 m rutor ut till där diset döljer land, sänkt under det detaljerade där de överlappar.
- **Höjd:** höjden kommer från samma höjdfunktion som fysiken använder, för det aktuella havsområdet (`heightFunction`). Det man ser är det man kan gå på grund mot.
- **Färg** efter höjd, lutning och terrängens sort (`colourFor`):
  - under vattnet efter bottentypen i fysiken (`sim/seabed.ts`): sand och grus på grunt vatten och på sockeln, silt och dy på djupet, berg där det är brant
  - ett svart lavbälte vid vattenlinjen
  - i skärgårdarna rosagrå granit med fläckar av ljung och tallskog
  - på norska kusten (fjorden, Eggakanten) gräs, björk och tall upp till trädgränsen (~180 m), kalt berg ovanför och snö över ~260 m.
- **Träd och hus** placeras i samma Web Worker ur det detaljerade rutnätets höjder (`scatter` i `terrainBuild.ts`): träd var tredje ruta där skogen växer (`forestAt`, samma regel som färgen), hus var femte ruta på flack mark nära vattnet i byar (brus), sjöbodar vid vattnet. Platserna följer världens rutnät med en hashfunktion, så att de står kvar när rutnätet flyttas. De ritas som `InstancedMesh` (kägla för träden; stomme, tak och fönster för husen). Fönstren lyser i skymning och natt.
- **Flytt:** rutnäten flyttas i hela rutor och byggs om först när ubåten har rört sig en bit (250 m respektive 1 200 m), så att ytan inte "simmar".
- **Bakgrundstråd:** höjder, normaler och färger byggs i en Web Worker (`terrainWorker.ts`, koden i `terrainBuild.ts`), så att ombyggnaden inte ger ett ryck. Den gamla terrängen visas tills den nya är klar. Det första rutnätet i ett område byggs direkt.

## Vatten, ljus och väder (`environment.ts`)

- **Vattenytan:**
  - Ett vågnät på 560 m (160 × 160 rutor) följer kameran. Grafikkortet förskjuter det i en vertexshader med samma vågsumma som fysiken (`src/render/waveShader.ts`, `src/sim/waves.ts`) och räknar normalerna från vågornas lutning. Fasen vid nätets mitt räknas i dubbel precision varje bild, så att 32-bitarsprecisionen räcker även långt bort. Vågorna tonar ut mot nätets kant.
  - Utanför nätet når en plan ram (40 km) ut till horisonten.
  - Ytan är halvgenomskinlig och syns både ovanifrån och underifrån.
- **Under vattnet:**
  - **Ljusstrålar** på dagen: 22 långa plan som hänger från ytan runt kameran, med en textur som är ljus upptill och tonar nedåt, additivt blandade, vända mot kameran och svajande. De syns bara med kameran under ytan och tonas ut mot 70 m djup, svagare i grumligt vatten (Östersjön). Inställningen "Ljusstrålar under ytan".
  - Dimma och bakgrundsfärg beror på kamerans djup under den lokala vågytan. Färgen går mot djupets färg med 1 − e^(−djup/90 m), och dimman tätnar med den.
  - Varje havsområde har sitt vatten (`WATER_LOOK`): en ton som blandas med ljusets vattenfärg och en extra dimma. Östersjön är grön och grumlig, fjorden grönbrun, Västerhavet blågrönt och Atlanten klar och blå.
  - Svävande partiklar ("havssnö") runt kameran visar rörelsen. De kan stängas av i inställningarna.
- **Ljus och sikt:** dag, natt och dimma byter himmelsfärg, vattenfärg, ljusens styrka och dimmans täthet. Sikten i luft är ungefär 2 / täthet: ~15 km på dagen, ~5 km på natten och ~200 m i dimma. Kameran ritar ut till 20 km, så ett fartyg 5–6 km bort syns tydligt i periskopet (djupbuffertens precision beror på det nära planet, 0,5 m, inte på det bortre).
- **Fyrarna:**
  - Ett vitt torn med rött band står på marken.
  - Lampan blinkar efter simuleringstiden, med fyrens period.
  - Skenet ritas som en glödande sprite utan dimma, så att det syns långt innan land syns på natten.
- **Bojen** i scenarierna är en gul spirboj med toppmärke.
- **Lysbojar** (`AreaInfo.buoys`) är röda och gröna pricker med lampor som blinkar var 4:e s i mörker. **Kustradarstationer** (`AreaInfo.stations`, eller scenariots) är ett hus, en mast med snurrande antenn och en radom. **Vrak** (`SHELF_TERRAIN.wrecks`) ligger på botten med slagsida, med skrov, överbyggnad och en knäckt mast, där fysiken har dem.
- **Fartygen** (`vessels.ts`) är enkla modeller med skrov, överbyggnad och lastluckor. De följer vågytan i höjd och har lanternor i mörker och dimma: topplanterna, babord rött, styrbord grönt och akterlanterna.

## Livet i havet och på land (`life.ts`, `seaLife.ts`)

- **Valar** följer simuleringens läge och djup. Kroppen är en utdragen ellipsoid med fena och stjärtfena som slår, kaskeloten med sitt fyrkantiga huvud, späckhuggarna fyra i bredd med vit fläck. De lutar nosen ned när de dyker och upp när de stiger, och blåser en kaskad vid ytan.
- **Sillstim:** 140 fiskar per stim (`InstancedMesh`) som simmar i cirkel runt stimmets läge, bara inom 350 m från kameran.
- **Spaningsplanet** har fyra motorer och lanternor (rött, grönt och en vit blixt).
- **Måsar:** flockar om tolv följer fiskebåtarna (akter om dem) och flyger kring fyrarna, på dagen. När periskopet är uppe nära ytan inom 450 m lyfter de, flyger bort och kommer tillbaka efter 90 s. Grafik med slumptal, påverkar inget.
- **Tång och tare** (`seaLife.ts`) står på botten där det är 1,5–22 m djupt, inom 110 m från kameran på ett rutnät på 4 m (höjdfunktionen, inte workern; byggs om när kameran flyttat 30 m). Bladen böjs i vertexshadern, mer mot toppen. Mängden beror på området (inget på Atlanten).
- **Maneter:** 36 halvklot som pulserar runt kameran på 1–35 m djup, med områdets färg, svagt självlysande på natten.
- **Mareld:** på natten och i skymning tänds blågröna gnistor (additiva punkter, 900) längs skrovet, mest vid fören, och i propellerns svall, fler ju fortare ubåten går.
- **Trålen** ritas bakom trålaren: två varpar ned till en strut av nät (trådram).
- **Segelbåtar** har mast, storsegel och fock och kränger lite.

Tång, maneter och mareld stängs av med partiklarna.

## Bubblor, kölvatten, plym och avgaser (`effects.ts`)

Tre partikelsystem (`THREE.Points`) med fasta pooler: bubblor (1 600), stänk (500) och rök (240). De drivs av ett `EffectsInput` som `src/game/wiring.ts` bygger varje bild ur simuleringen, utan kraftberäkning. Effekterna går på simuleringstid och står still i paus. Slumptal är tillåtna här, eftersom grafiken inte påverkar simuleringen.

- **Huvudballasten:** luft bubblar upp ur ventilerna ovanpå en tank som fylls, eller sprutar upp i ytläge. En tank som blåses torr läcker luft ur bottenluckorna.
- **Kölvattnet:** bubblor blir kvar efter propellern, fler vid högt varvtal och nära ytan.
- **Ventilering grunt:** luft som ventileras ur huvudballasten grundare än 30 m kokar upp på ytan ovanför tanken (stänk).
- **Masterna:** ett periskop eller en snorkel som skär genom ytan i fart kastar upp en plym av stänk. Snorkeln ryker när dieslarna går.
- **Bubblorna** försvinner vid ytan, stänket när det faller tillbaka och röken när den har levt ut.
- **Ljuset:** partiklarna är obelysta, så deras färg skalas med dagerns styrka (`ambientLight` i environment.ts: himmelsljuset mot en klar dag, minst 0,12). I skymning blir de ungefär en tredjedel så ljusa, i natt en åttondel. Marelden är additiv och läggs ihop där gnistorna är täta, så den hålls svag (färre gnistor i propellerströmmen) och är något svagare i skymning än i natt.

Snorkelmasten ritas i ubåtsmodellen som periskopet, med ett lådformat huvud med ventilen. Radarmasten står mellan dem, med en platt antenn tvärs över båten.

- **Torpederna** är mörka cylindrar (533 mm × 6 m) ur en liten pool, placerade efter sitt läge och sin kurs. De lämnar en ström av bubblor.
- **Explosioner** (torpedträffar och sjunkbomber) kommer som `Controller.blasts` med ökande id. Var och en ger en gång en bubbelsky under vattnet och en plym av stänk vid ytan. En träff ger också rök.
- **Ett torpederat fartyg** sätter sig med aktern, sjunker allt fortare under 90 s och försvinner (`VesselState.sunk`).

## Sjökortet och sonaren (`src/ui/navPanel.ts`)

En panel med två flikar, ritad på en 2D-canvas ungefär 10 gånger i sekunden medan den är öppen. Storleken hålls av en `ResizeObserver`.

- **Sjökortet:** norr uppåt och ubåten i mitten, med fyra skalor (750 m, 2, 5 och 12 km till kanten). Djupet ritas från samma botten som fysiken använder (`sim.ground`), 72 × 72 prov i en bild som byggs om när ubåten flyttat en tiondel av skalan. Ovanpå ritas spåret (en punkt per 25 m), fyrarna, bojen eller en pil mot den vid kanten, sonarens bäringar som streckade linjer, fartyg i sikte från periskopet eller bryggan (inom 8 km), radarekon som gröna kryss, lockmålen som små romber med kurs, trådarna till trådstyrda torpeder som tunna streckade linjer, ekona från den senaste pingen som ringar (tonas bort på en minut) och bäringen till korvettradar som radarvarnaren hör som röda streck från ubåten. **Radar** i panelens huvud sänder eller tystnar (lyser och heter "Radar sänder" medan den sänder).
- **Sonaren:** ett vattenfall med bäringen från fören (−180…180°) tvärs över och en rad per sekund nedåt, 180 s historik. Ljusare för starkare signal. Under det står kontakterna, ubåtens ljudnivå, risken att bli upptäckt och ekona från den senaste pingen. **Ping** i panelens huvud sänder en ping.
- **På mobil** ligger panelen under statusraden, och målrutan och loggboken döljs medan den är öppen.

## Eldledningspanelen (`src/ui/firePanel.ts`)

En HTML-panel som visas i periskopvyn, på bryggan och medan sjökortet eller sonaren är öppen (utom i genomskärningen, där rumsinformationen har den platsen). Den ligger vid sidan av periskopbilden, så att hårkorset och horisonten är fria: på datorn som en smal kolumn till höger ovanför skärmkontrollerna, på mobil i stående läge som en låg list ovanför skärmkontrollerna (knappar och tuber på en rad) och i liggande läge i hörnet till höger under Vyer ▾. Med sjökortet öppet ligger den under kortet. Den har lösningsraden (avstånd, kurs, fart, kvalitet, skjutkurs, gångtid, färgad efter kvaliteten), knapparna Mål, Avst, spridningen och Fyr, och tuberna: klar (grön), i arbete (gul, med tiden kvar), laddad men inte klar (numret) eller tom (–). Ett tryck på en klar tub skjuter från den, på en laddad tub gör det den klar och på en tom tub laddar det om den. Mål och Avst använder periskopets bäring (`viewBearing`) och förstoring. Från sjökortet och sonaren väljs målet i stället genom att trycka på en kontakt i sonarlistan. Sjökortet ritar målens lösningar som romber med två minuters kursvektor och torpederna med sin kurs.

Panelen har lösningsraden, en rad med målen (M1, M2 …, bara när det finns fler än ett; det aktuella är markerat och ett tryck väljer ett annat), knapparna Mål, Avst, spridningen och Fyr, och tuberna. En laddad tub är en knapp som skjuter från just den tuben, och den är avstängd tills målet har en lösning. Målraden byggs om bara när målen eller det aktuella målet ändras.

## Startsidan

Bakom menyn går ubåten neddykt på 16 m norrut i 4 knop i dagsljus (`demoSession()`, `DEMO_DEPTH`), så att ljusstrålarna från ytan syns runt den. Kameran (`flyby` i `scene.ts`) står still i vattnet 75 m förut och 30 m om babord, 5 m djupare än ubåten, och ubåten glider förbi. När den är 70 m förbi flyttas kameran fram igen. Området har bara sin fredliga trafik, ingen korvett. Menyn är utformad som en färdorder: ordernummer, stämpeln Övning, en stram rubrik med blå linje och en fiktiv, fredlig order som skrivs fram som på en skrivmaskin (utan rörelse med `prefers-reduced-motion`).

## Loggboken (`src/ui/log.ts`)

Målrutan och loggboken ligger i `#top-center`, överst i mitten (på mobil under statusraden, liggande mellan statusraden och Vyer ▾). Loggen är ett halvgenomskinligt fönster som bara syns medan någon rad lever. Målrutan (`src/ui/objective.ts`, en komponent) är en rad som fälls ut med tipset och listan över målen vid ett tryck eller O (10 s) och av sig själv när målet eller tipset ändras (6 s). Tiden räknas bara medan spelet går, så den fälls inte ihop bakom en meny. På en liggande telefon med eldledningspanelen framme fälls den inte ut av sig själv (den skulle täcka panelen), utan raden pulserar i stället. På mellanstora skärmar (841–1179 px) ligger `#top-center` mellan instrumentpanelen och vyknapparna, och med sjökortet öppet mellan instrumentpanelen och sjökortet, vars bredd (`--nav-w`) krymper till minst 260 px. Vyns namnrad (`.mode`) står på en rad och kortas med … i stället för att löpa in under panelerna.

- **En ny rad** får klassen `live` och lever enligt `lineLife(kind, text)`: kvitton 2,5 s, information 4 s, varningar och fel 6 s, plus lästid för långa rader (25 tecken per sekund över 60). Då får den `fading`, och opaciteten går till 0 med en CSS-övergång (0,8 s, fel 1,5 s). Därefter tas `live` bort och raden döljs. Högst `LIVE_LINES` (2) rader är levande: en ny skjuter ut den äldsta. När alla levande rader tonas ut får `#log` klassen `idle`: fönstret tonas ut (0,6 s) och tar inga tryck. Tiderna går på väggklockan, eftersom loggen är gränssnitt.
- **Historiken:** ett tryck på loggen medan den syns visar `#log.expanded` (de senaste raderna, rullad till den nyaste). Ett tryck till eller Esc stänger. ☰ → Loggbok (menyskärmen `logbook`) visar de 100 senaste raderna också när loggen är tom.

## Kameran och vyerna (`scene.ts`, `src/ui/views.ts`)

| Vy | Kamera |
|---|---|
| **Yttre** | `OrbitControls` följer ubåten. Du vrider och zoomar med mus eller finger. Avståndet sparas när du byter vy. |
| **Bryggan** | Fast vid bryggans ögonpunkt och följer ubåtens stamp och krängning. Du drar för att titta runt (±160° åt sidorna, ±40° upp och ner). Synfält 70°. |
| **Periskopet** | I periskophuvudet. Vrids med ←/→ eller genom att dra. Förstoring 1,5× (synfält 32°) eller 6× (8°). Över 6 knop skakar bilden. |
| **Manöverrum** | Inne i manöverrummet vid en av fem platser (`controlStations`), i ögonhöjd 1,62 m över övre däck. Dra för att titta runt (±150° åt sidorna, ±57° upp och ner). Synfält 68°, bredare på en stående telefon (`controlFov`: minst ~60° i sidled, högst 100°). Skakar efter sjunkbomber. |
| **Genomskärning** | Utanför ubåten, från styrbord eller ovanifrån, på ett avstånd som får plats med hela ubåten (synfält 40°). Dra för att vrida (±60° åt sidorna, ±45° upp och ner), zooma 1–6×. Ett tryck centrerar på det valda utrymmet. |

- **Vyval:** vyn är spelarens tillstånd, inte simuleringens. `ViewState` håller vy, blickriktning, periskopets riktning och förstoring.
- **Automatiskt byte:** `src/game/app.ts` öppnar periskopvyn när masten är uppe och lämnar en vy som inte längre finns, till exempel när bryggan utryms.
- **Overlay** (`viewOverlay.ts`): hårkors, periskopmask, bäringsskala och bryggans kompassband ritas i 2D på en egen canvas ovanpå 3D-bilden och under panelerna. Bojens riktning visas som en gul markering på bandet. I periskopet ligger bäringsbandet utanför okularet (`periscopeLayout`, testad): under det om en cirkel på minst 30 % av skärmen ryms ovanför skärmkontrollerna, annars ovanför det, under målrutan och loggen (på en låg skärm ända uppe). Okularet står kvar mitt på skärmen, där kameran tittar, och krymper hellre än att bandet hamnar i bilden.
- **Snells fönster** (`environment.ts`): havsytans vågshader färgar baksidan (sedd underifrån) efter vinkeln mellan synlinjen och ytans normal. Inom 48,6° från normalen (asin(1/1,333)) syns himlen, ljusare, och utanför speglas det mörka vattnet, med en mjuk kant (`SNELL_COS`). Vågornas normaler gör kanten levande. Dimman läggs på efter.

## Genomskärningen (`cutaway.ts`, `interior.ts`, `tankLevel.ts`)

Etapp 4 (vad som lever i snittet): vattnet i läckande avdelningar ritas som avdelningens cylinder klippt vid en vågrät yta (samma `waterLevel` som tankarna). Batteriernas material lyser efter laddningen (grönt pulserande vid laddning, gult under 30 %, rött och blinkande under 15 %). Dieslarnas material skakar och glöder när de går. Torpedtubernas luckor lyser efter tubens läge (grönt laddad, gult under omladdning, släckt tom), och reservtorpederna på de åtta ställningarna visas så många som finns kvar.

- **Inredningen är data** (`interior.ts`, utan Three.js): varje utrymme (avdelningarna med däck från `config/submarine.ts`, tankarna och de fritt flödande utrymmena sonardom, torn och akterpik) och utrustningen i dem som lådor och cylindrar med läge och material. Upprepade saker (kojer, battericeller, torpeder) genereras. Inga människor. Testerna i `tests/cutaway.test.ts` kontrollerar att allt ligger inom sin avdelning och innanför tryckskrovet, och att möbler står på sitt däck.
- **Bygget** (`cutaway.ts`) sker första gången vyn öppnas. Utrustningen slås ihop till ett nät per material. Skotten är skivor med en dörr på babordssidan, och tryckskrovets insida är ljus.
- **Snittet:** ett klippningsplan i världen, genom mittlinjen (styrbordshalvan tas bort) eller vågrätt genom övre däck. Det läggs på skrov, torn, tankar och inredning. Allt är dubbelsidigt, så ett uppskuret föremål visar sin insida i stället för ett hål.
- **Vattnet i tankarna:** tankens form med ett andra klippningsplan vid vattenytan. Höjden räknas av `waterLevel` (`tankLevel.ts`): tanken provtas med punkter, och ytan läggs där andelen punkter under den är lika med fyllnadsgraden, längs den sanna lodlinjen. Ytan blir därmed vågrät och volymen rätt vid alla lutningar (testat). Den räknas om bara när fyllnaden ändrats med 1 % eller lutningen märkbart.
- **Rörliga delar:** bubblor (punkter) i huvudballasten när den ventileras eller blåses, pilar för trim- och kompenseringspumparna, HP-flaskornas sken efter trycket och axeln som snurrar med propellern. Telemetrin för snittet läses 10 gånger per sekund.
- **Kameran** står utanför ubåten och ramar in den i den fria delen av skärmen mellan panelerna (`setSafeArea`, `setViewOffset`). Ett tryck pekas mot snittplanet och översätts till kroppskoordinater, och `spaceAt` säger vilket utrymme punkten ligger i. Informationsrutan (`src/ui/cutawayInfo.ts`) är en ren funktion av utrymmet och telemetrin.

## Manöverrummet (`controlRoom.ts`, `controlRoom.data.ts`, `controlScreens.ts`)

- **En egen scen:** rummet byggs i modellens lokala koordinater och ritas i stället för världen. Varken havsytan, dimman, partiklarna eller ljusstrålarna kommer in, och ingenting utanför skrovet ritas, så vyn är billig. Kameran sitter fast i rummet, och ubåtens lutning syns på instrumenten och på lampan som hänger mot den sanna lodlinjen.
- **Inredningen** är manöverrummets övre däck ur `interior.ts` (samma data som snittet, och vapenpulpeten och radiostället på styrbordssidan, som också syns ovanifrån), med tryckskrovets insida, skotten med dörrarna (öppna eller stängda efter `Telemetry.doors`; bakom en öppen dörr är det mörkt), rör, kabelstegar och lampor i taket. Byggs första gången vyn öppnas och slås ihop till ett nät per material.
- **Inga ljus:** materialen är obelysta (`MeshBasicMaterial`), och skuggningen är bakad i hörnfärgerna från en lampa i taket (ovansidor ljusa, undersidor mörka, ljusare högt upp). Ljusets färg är materialens färg: vitt, eller rött på natten och i skymningen, under tyst gång och med periskopet uppe. Larmlampan snurrar och färgar ljuset rött i takt.
- **Skärmarna** (`controlScreens.ts`) ritas på canvasar som blir texturer, fem gånger per sekund ur telemetrin (`src/game/controlRoomFeed.ts`): pulpeten, ballastpanelen, sonarns vattenfall (en rad per sekund, 80 s, för i mitten) och plottbordet (norr upp, 4 km, kölvattnet var tionde sekund). Var de sitter står i `screenFaces`, och testerna kräver att varje plats tittar på sin skärm och att den vänder sig mot ögat. Ett tryck pekas mot skärmarna (`pickControl`).
- **Vattnet** på durken är ett stort plan vinkelrätt mot den sanna lodlinjen, på höjden ur `waterLevel` för rummet. Väggarna, skotten och durken skymmer det där det inte ska synas.
- **Händelserna** kommer från loggraderna (`shakeFor`, `alarmFor`): en sjunkbomb skakar efter avståndet och dör ut (`SHAKE_DECAY`), en grundstötning hårt, och larmraderna tänder larmlampan i 8 s. Lampan snurrar också så länge skrovet läcker eller ubåten är nära krossdjupet.

## Gränssnittet

Instrumentpanel, logg, menyer och skärmkontroller är vanlig HTML och CSS ovanpå 3D-bilden (`src/ui/`, `style.css`). HTML byggs med mallen `html` i `src/ui/dom.ts`, som escapar allt som infogas. Varje instrument är en liten komponent, och vilka instrument som visas i huvudpanelen följer vem som sköter vad (`instrumentLayout` i `instruments.ts`): panelen byggs om när det ändras. Resten ligger under knappen "Mer ▾" (klassen `expanded` på `#instruments`, hopfälld från start och kvar vid ombyggnaden); på mobil visas allt och knappen döljs. Menyskärmarna är en funktion var i `menuScreens.ts`.

Skärmkontrollerna (`src/ui/helm/`) har två nivåer. Grundnivån är det spelaren vill: Yta / Periskop / Djup och djupskalan, kompassbandet, telegrafen och planraden (`.helm-plan`), en rad med vad besättningen gör (`Conn.plan()`). Ett tryck på planraden fäller ut detaljerna: panelerna Manöver, Ballast, Trim, Fart, El och Torped. I expertläge (`.helm.expert`, `.helm-panel.expert`) tillkommer Auto / Hand och knapparna som tar över manövern (`.helm-hand`). Fyra små 2D-canvas: djupskalan, kompassbandet och, på Hand, mätarna för djuproder och roder. Bara två av dem syns åt gången. De ritas om bara när något som syns har ändrats, ungefär en pixel, och storleken hålls av en `ResizeObserver`. Läser man `clientWidth` under uppdateringen tvingas webbläsaren göra om layouten direkt efter att instrumentpanelen bytt text. Färgerna läses från CSS-variablerna en gång. Loggen och instrumentpanelen hålls ovanför kontrollerna med CSS-variabeln `--helm-h`. En panel öppnas ovanför kontrollerna, högst så hög att ☰ syns. Panelens flikar byter mellan Manöver, Ballast, Trim, Fart, El och Torped.

### Mobilvyn

Smalare än 840 px (också surfplattor på höjden) eller lägre än 500 px gäller den kompakta layouten. Samma mediefråga finns i `style.css` och i `src/ui/compact.ts` (`isCompact()`), som beteendet använder. Målet är att 3D-bilden får det mesta av skärmen och att inget värde visas två gånger:

- **Statusraden** (`src/ui/statusBar.ts`, `#status`) ersätter instrumentpanelen. Den visar bara det som kontrollerna inte visar: tid, fart genom vattnet, vatten under kölen och trim (`statusFields()` är ren och testad). Ett tryck sätter `body.inst-open` och visar hela instrumentpanelen under raden.
- **Loggboken** kortar varje rad till två textrader.
- **Vyknapparna** fälls ihop bakom **Vyer ▾** (`#view-btns.open`). På dator ligger Vy, Karta, Sonar, Per, Snork och radarmasten i stället som ikoner i en kolumn mitt i högerkanten, mellan knapparna under ☰ och skärmkontrollerna (`.helm-views`, `position: fixed`; `bindViewButtons` flyttar dem när mediefrågan ändras). Kolumnen står i de 64 px som sjökortet, eldledningen och `#top-center` håller fria, så den krockar inte med dem. En dold mastknapp behåller sin plats (`visibility: hidden`), så att de andra inte flyttar sig. Under 720 px höjd är knapparna 38 px, och under 640 px, där kolumnen inte ryms, ligger de i skärmkontrollerna mellan telegrafen och kompassen, i två kolumner: vyerna och masterna. Lägesindikatorn döljs, eftersom vyn syns på bilden. Under ☰ står de knappar som hör till vyn: Zoom och Brg i periskopet (Brg också på bryggan), Ovan/Sida och Hela i genomskärningen och Plats i manöverrummet.
- **Skärmkontrollerna** har båda varianterna i DOM:en och CSS väljer: i expertläge en Auto / Hand-knapp (`.helm-chip`) i stället för omkopplaren, och telegrafen som ett reglage. Planraden visar bara texten, på högst två rader. Telegrafens rad med farten visas på mobil mellan två lägen, och överallt medan besättningen kör en egen fart (klassen `crew` på telegrafen, som också dimmar klockorna och gör det beordrade läget till en kontur); annars står farten i instrumentpanelen. Reglaget är raden `.helm-bells`. Klockorna tar inte emot pekaren där, utan raden läser läget med `bindDrag` och `telegraphIndex()` och skickar ordern när fingret släpper. På bred skärm är draget avstängt, så en knapp ger fortfarande en order.
- **Stående:** djupskalan med Yta / Periskop / Djup till vänster, kompassen och planraden till höger, och telegrafen över hela bredden. **Liggande:** en grupp per tumme (djup och planraden till vänster, kompass och telegraf till höger), mitten fri, och en panel öppnas i mitten under statusraden.
- Kompassbandet skriver bara väderstrecken när det är smalt (mindre än 40 px per 30°), så att siffrorna inte flyter ihop.
- Tipsen i scenarierna nämner panelerna, inte knapparna ("i panelen Trim"), eftersom knapparna skiljer sig mellan mobil och dator (test i `tests/helm.test.ts`).
