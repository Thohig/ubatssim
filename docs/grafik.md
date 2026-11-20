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

## Koordinater

Fysiken räknar i NED (norr, öster, nedåt) och FRD i kroppen. Three.js har Y uppåt. Bara `src/render/coords.ts` översätter: norr → −Z, öster → +X och nedåt → −Y. Ubåtsmodellen byggs i ett eget lokalt system med samma avbildning, och orienteringen blir C·R·Cᵀ.

## Ubåten (`submarineModel.ts`)

- **Mått:** modellen byggs av samma mått som fysiken använder (`src/sim/config/submarine.ts`).
  - Skrovet roteras fram ur skrovets radieprofil (`LatheGeometry`).
  - Tornet, rodren, djuprodren och propellern placeras på sina positioner i kroppen.
- **Lager:** yttre skrov, tryckskrov, tankar, avdelningar och utrustning ligger i separata grupper med egna material. På så sätt kan ett klippningsplan för en genomskärningsvy läggas till senare. `renderer.localClippingEnabled` är redan på.
- **Rörliga delar:** roder, djuproder, propeller och periskopmast följer simuleringens värden varje bild.

## Terrängen (`terrain.ts`)

- **Två rutnät:**
  - ett detaljerat på 1,6 km med 8 m rutor runt ubåten
  - ett grövre på 9 km med 60 m rutor ut till horisonten, sänkt under det detaljerade där de överlappar.
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
  - Utanför nätet når en plan ram ut till horisonten.
  - Ytan är halvgenomskinlig och syns både ovanifrån och underifrån.
- **Under vattnet:**
  - Dimma och bakgrundsfärg beror på kamerans djup under den lokala vågytan och blir mörkare och tätare ner till 250 m.
  - Svävande partiklar ("havssnö") runt kameran visar rörelsen. De kan stängas av i inställningarna.
- **Ljus och sikt:** dag, natt och dimma byter himmelsfärg, vattenfärg, ljusens styrka och dimmans täthet. Sikten i luft är ungefär 2 / täthet: ~3 km på dagen och ~200 m i dimma.
- **Fyrarna:**
  - Ett vitt torn med rött band står på marken.
  - Lampan blinkar efter simuleringstiden, med fyrens period.
  - Skenet ritas som en glödande sprite utan dimma, så att det syns långt innan land syns på natten.
- **Bojen** i scenarierna är en gul spirboj med toppmärke.
- **Fartygen** (`vessels.ts`) är enkla modeller med skrov, överbyggnad och lastluckor. De följer vågytan i höjd och har lanternor i mörker och dimma: topplanterna, babord rött, styrbord grönt och akterlanterna.

## Kameran och vyerna (`scene.ts`, `src/ui/views.ts`)

| Vy | Kamera |
|---|---|
| **Yttre** | `OrbitControls` följer ubåten. Du vrider och zoomar med mus eller finger. Avståndet sparas när du byter vy. |
| **Bryggan** | Fast vid bryggans ögonpunkt och följer ubåtens stamp och krängning. Du drar för att titta runt (±160° åt sidorna, ±40° upp och ner). Synfält 70°. |
| **Periskopet** | I periskophuvudet. Vrids med ←/→ eller genom att dra. Förstoring 1,5× (synfält 32°) eller 6× (8°). Över 6 knop skakar bilden. |

- **Vyval:** vyn är spelarens tillstånd, inte simuleringens. `ViewState` håller vy, blickriktning, periskopets riktning och förstoring.
- **Automatiskt byte:** `src/game/app.ts` öppnar periskopvyn när masten är uppe och lämnar en vy som inte längre finns, till exempel när bryggan utryms.
- **Overlay** (`viewOverlay.ts`): hårkors, periskopmask, bäringsskala och bryggans kompassband ritas i 2D på en egen canvas ovanpå 3D-bilden och under panelerna. Bojens riktning visas som en gul markering på bandet.

## Gränssnittet

Instrumentpanel, logg, konsol, menyer och pekknappar är vanlig HTML och CSS ovanpå 3D-bilden (`src/ui/`, `style.css`). HTML byggs med mallen `html` i `src/ui/dom.ts`, som escapar allt som infogas. Varje instrument är en liten komponent, och vilka instrument som visas i varje spelläge står som data i `LAYOUT`. Menyskärmarna är en funktion var i `menuScreens.ts`. På smala skärmar blir panelen kompakt, och i vyerna ombord krymper loggen så att bilden syns.
