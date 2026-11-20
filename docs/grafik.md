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
- **Färg** efter höjd och lutning:
  - dy på djupet och sand och silt på grunt vatten
  - berg i branta sluttningar under vattnet
  - ett svart lavbälte vid vattenlinjen
  - rosagrå granit med fläckar av ljung högre upp.
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
- **Fartygen** (`vessels.ts`) är enkla modeller med skrov, överbyggnad och lastluckor. De följer vågytan i höjd och har lanternor i mörker och dimma: topplanterna, babord rött, styrbord grönt och akterlanterna.

## Bubblor, kölvatten, plym och avgaser (`effects.ts`)

Tre partikelsystem (`THREE.Points`) med fasta pooler: bubblor (1 600), stänk (500) och rök (240). De drivs av ett `EffectsInput` som `src/game/wiring.ts` bygger varje bild ur simuleringen, utan kraftberäkning. Effekterna går på simuleringstid och står still i paus. Slumptal är tillåtna här, eftersom grafiken inte påverkar simuleringen.

- **Huvudballasten:** luft bubblar upp ur ventilerna ovanpå en tank som fylls, eller sprutar upp i ytläge. En tank som blåses torr läcker luft ur bottenluckorna.
- **Kölvattnet:** bubblor blir kvar efter propellern, fler vid högt varvtal och nära ytan.
- **Masterna:** ett periskop eller en snorkel som skär genom ytan i fart kastar upp en plym av stänk. Snorkeln ryker när dieslarna går.
- **Bubblorna** försvinner vid ytan, stänket när det faller tillbaka och röken när den har levt ut.

Snorkelmasten ritas i ubåtsmodellen som periskopet, med ett lådformat huvud med ventilen.

- **Torpederna** är mörka cylindrar (533 mm × 6 m) ur en liten pool, placerade efter sitt läge och sin kurs. De lämnar en ström av bubblor.
- **Explosioner** (torpedträffar och sjunkbomber) kommer som `Controller.blasts` med ökande id. Var och en ger en gång en bubbelsky under vattnet och en plym av stänk vid ytan. En träff ger också rök.
- **Ett torpederat fartyg** sätter sig med aktern, sjunker allt fortare under 90 s och försvinner (`VesselState.sunk`).

## Sjökortet och sonaren (`src/ui/navPanel.ts`)

En panel med två flikar, ritad på en 2D-canvas ungefär 10 gånger i sekunden medan den är öppen. Storleken hålls av en `ResizeObserver`.

- **Sjökortet:** norr uppåt och ubåten i mitten, med fyra skalor (750 m, 2, 5 och 12 km till kanten). Djupet ritas från samma botten som fysiken använder (`sim.ground`), 72 × 72 prov i en bild som byggs om när ubåten flyttat en tiondel av skalan. Ovanpå ritas spåret (en punkt per 25 m), fyrarna, bojen eller en pil mot den vid kanten, sonarens bäringar som streckade linjer och fartyg i sikte från periskopet eller bryggan (inom 8 km).
- **Sonaren:** ett vattenfall med bäringen från fören (−180…180°) tvärs över och en rad per sekund nedåt, 180 s historik. Ljusare för starkare signal. Under det står kontakterna, ubåtens ljudnivå och risken att bli upptäckt.
- **På mobil** ligger panelen under statusraden, och målrutan och loggboken döljs medan den är öppen.

## Eldledningspanelen (`src/ui/firePanel.ts`)

En HTML-panel som visas i periskopvyn, på bryggan och medan sjökortet eller sonaren är öppen. Den ligger vid sidan av periskopbilden, så att hårkorset och horisonten är fria: på datorn som en smal kolumn till höger ovanför skärmkontrollerna, på mobil i stående läge som en låg list ovanför skärmkontrollerna (knappar och tuber på en rad) och i liggande läge i hörnet till höger under Vyer ▾. Med sjökortet öppet ligger den under kortet. Den har lösningsraden (avstånd, kurs, fart, kvalitet, skjutkurs, gångtid, färgad efter kvaliteten), knapparna Mål, Avst, spridningen och Fyr, och tuberna (laddad, nedräkning eller tom). Mål och Avst använder periskopets bäring (`viewBearing`) och förstoring. Från sjökortet och sonaren väljs målet i stället genom att trycka på en kontakt i sonarlistan. Sjökortet ritar målens lösningar som romber med två minuters kursvektor och torpederna med sin kurs.

## Loggboken (`src/ui/log.ts`)

Målrutan och loggboken ligger i `#top-center`, överst i mitten (på mobil under statusraden, liggande mellan statusraden och Vyer ▾). Loggen har ingen bakgrund, bara text med skugga. Målrutan (`src/ui/objective.ts`, en komponent) är en rad som fälls ut med tipset och listan över målen vid ett tryck eller O (10 s) och av sig själv när målet eller tipset ändras (6 s). Tiden räknas bara medan spelet går, så den fälls inte ihop bakom en meny.

- **En ny rad** får klassen `live` och lever enligt `lineLife(kind, text)`: kvitton 4 s, information 6 s, varningar och fel 10 s, plus lästid för långa rader (25 tecken per sekund över 60). Då får den `fading`, och opaciteten går till 0 med en CSS-övergång (1 s, fel 2 s). Därefter tas `live` bort och raden döljs. Högst `LIVE_LINES` (3) rader är levande: en ny skjuter ut den äldsta. Tiderna går på väggklockan, eftersom loggen är gränssnitt.
- **Historiken och konsolen** är en ruta: ett tryck på loggen, på **›_ Logg** eller Enter öppnar konsolen (`#console` ligger i `#top-center` direkt under `#log`), och då visas historiken (`#log.expanded`, de 14 senaste raderna, rullad till den nyaste) med skrivraden under. Esc eller ett tryck utanför stänger.
- **Dold loggbok** (inställningen `showLog`, knappen Logg och L) sätter `body.log-hidden`. Då visas bara levande felrader.

## Kameran och vyerna (`scene.ts`, `src/ui/views.ts`)

| Vy | Kamera |
|---|---|
| **Yttre** | `OrbitControls` följer ubåten. Du vrider och zoomar med mus eller finger. Avståndet sparas när du byter vy. |
| **Bryggan** | Fast vid bryggans ögonpunkt och följer ubåtens stamp och krängning. Du drar för att titta runt (±160° åt sidorna, ±40° upp och ner). Synfält 70°. |
| **Periskopet** | I periskophuvudet. Vrids med ←/→ eller genom att dra. Förstoring 1,5× (synfält 32°) eller 6× (8°). Över 6 knop skakar bilden. |
| **Genomskärning** | Utanför ubåten, från styrbord eller ovanifrån, på ett avstånd som får plats med hela ubåten (synfält 40°). Dra för att vrida (±60° åt sidorna, ±45° upp och ner), zooma 1–6×. Ett tryck centrerar på det valda utrymmet. |

- **Vyval:** vyn är spelarens tillstånd, inte simuleringens. `ViewState` håller vy, blickriktning, periskopets riktning och förstoring.
- **Automatiskt byte:** `src/game/app.ts` öppnar periskopvyn när masten är uppe och lämnar en vy som inte längre finns, till exempel när bryggan utryms.
- **Overlay** (`viewOverlay.ts`): hårkors, periskopmask, bäringsskala och bryggans kompassband ritas i 2D på en egen canvas ovanpå 3D-bilden och under panelerna. Bojens riktning visas som en gul markering på bandet.

## Genomskärningen (`cutaway.ts`, `interior.ts`, `tankLevel.ts`)

Etapp 4 (vad som lever i snittet): vattnet i läckande avdelningar ritas som avdelningens cylinder klippt vid en vågrät yta (samma `waterLevel` som tankarna). Batteriernas material lyser efter laddningen (grönt pulserande vid laddning, gult under 30 %, rött och blinkande under 15 %). Dieslarnas material skakar och glöder när de går. Torpedtubernas luckor lyser efter tubens läge (grönt laddad, gult under omladdning, släckt tom), och reservtorpederna på de åtta ställningarna visas så många som finns kvar.

- **Inredningen är data** (`interior.ts`, utan Three.js): varje utrymme (avdelningarna med däck från `config/submarine.ts`, tankarna och de fritt flödande utrymmena sonardom, torn och akterpik) och utrustningen i dem som lådor och cylindrar med läge och material. Upprepade saker (kojer, battericeller, torpeder) genereras. Inga människor. Testerna i `tests/cutaway.test.ts` kontrollerar att allt ligger inom sin avdelning och innanför tryckskrovet, och att möbler står på sitt däck.
- **Bygget** (`cutaway.ts`) sker första gången vyn öppnas. Utrustningen slås ihop till ett nät per material. Skotten är skivor med en dörr på babordssidan, och tryckskrovets insida är ljus.
- **Snittet:** ett klippningsplan i världen, genom mittlinjen (styrbordshalvan tas bort) eller vågrätt genom övre däck. Det läggs på skrov, torn, tankar och inredning. Allt är dubbelsidigt, så ett uppskuret föremål visar sin insida i stället för ett hål.
- **Vattnet i tankarna:** tankens form med ett andra klippningsplan vid vattenytan. Höjden räknas av `waterLevel` (`tankLevel.ts`): tanken provtas med punkter, och ytan läggs där andelen punkter under den är lika med fyllnadsgraden, längs den sanna lodlinjen. Ytan blir därmed vågrät och volymen rätt vid alla lutningar (testat). Den räknas om bara när fyllnaden ändrats med 1 % eller lutningen märkbart.
- **Rörliga delar:** bubblor (punkter) i huvudballasten när den ventileras eller blåses, pilar för trim- och kompenseringspumparna, HP-flaskornas sken efter trycket och axeln som snurrar med propellern. Telemetrin för snittet läses 10 gånger per sekund.
- **Kameran** står utanför ubåten och ramar in den i den fria delen av skärmen mellan panelerna (`setSafeArea`, `setViewOffset`). Ett tryck pekas mot snittplanet och översätts till kroppskoordinater, och `spaceAt` säger vilket utrymme punkten ligger i. Informationsrutan (`src/ui/cutawayInfo.ts`) är en ren funktion av utrymmet och telemetrin.

## Gränssnittet

Instrumentpanel, logg, konsol, menyer och skärmkontroller är vanlig HTML och CSS ovanpå 3D-bilden (`src/ui/`, `style.css`). HTML byggs med mallen `html` i `src/ui/dom.ts`, som escapar allt som infogas. Varje instrument är en liten komponent, och vilka instrument som visas i huvudpanelen följer vem som sköter vad (`instrumentLayout` i `instruments.ts`): panelen byggs om när det ändras. Menyskärmarna är en funktion var i `menuScreens.ts`.

Skärmkontrollerna (`src/ui/helm/`) är knappar, de utfällbara panelerna Ballast, Trim och Fart, och fyra små 2D-canvas: djupskalan, kompassbandet och, på Hand, mätarna för djuproder och roder. Bara två av dem syns åt gången. De ritas om bara när något som syns har ändrats, ungefär en pixel, och storleken hålls av en `ResizeObserver`. Läser man `clientWidth` under uppdateringen tvingas webbläsaren göra om layouten direkt efter att instrumentpanelen bytt text. Färgerna läses från CSS-variablerna en gång. Loggen och instrumentpanelen hålls ovanför kontrollerna med CSS-variabeln `--helm-h`. En panel öppnas ovanför kontrollerna, högst så hög att ☰ syns. Panelens flikar byter mellan Ballast, Trim och Fart.

### Mobilvyn

Smalare än 760 px eller lägre än 500 px gäller den kompakta layouten. Samma mediefråga finns i `style.css` och i `src/ui/compact.ts` (`isCompact()`), som beteendet använder. Målet är att 3D-bilden får det mesta av skärmen och att inget värde visas två gånger:

- **Statusraden** (`src/ui/statusBar.ts`, `#status`) ersätter instrumentpanelen. Den visar bara det som kontrollerna inte visar: tid, fart genom vattnet, vatten under kölen och trim (`statusFields()` är ren och testad). Ett tryck sätter `body.inst-open` och visar hela instrumentpanelen under raden.
- **Loggboken** kortar varje rad till två textrader.
- **Vyknapparna** fälls ihop bakom **Vyer ▾** (`#view-btns.open`). Lägesindikatorn döljs, eftersom vyn syns på bilden.
- **Skärmkontrollerna** har båda varianterna i DOM:en och CSS väljer: en Auto / Hand-knapp (`.helm-chip`) i stället för omkopplaren, **System ▾** i stället för tre panelknappar, och telegrafen som ett reglage. Reglaget är raden `.helm-bells`. Klockorna tar inte emot pekaren där, utan raden läser läget med `bindDrag` och `telegraphIndex()` och skickar ordern när fingret släpper. På bred skärm är draget avstängt, så en knapp ger fortfarande en order.
- **Stående:** djupskalan till vänster, kompassen och Dyk / Håll / System till höger, och telegrafen över hela bredden. **Liggande:** en grupp per tumme (djup och knappar till vänster, kompass och telegraf till höger), mitten fri, och en panel öppnas i mitten under statusraden.
- Kompassbandet skriver bara väderstrecken när det är smalt (mindre än 40 px per 30°), så att siffrorna inte flyter ihop.
- Tipsen i scenarierna nämner panelerna, inte knapparna ("i panelen Trim"), eftersom knapparna skiljer sig mellan mobil och dator (test i `tests/helm.test.ts`).
