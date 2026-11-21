# Prestanda

## Mätverktyg

- **`npm run bench`:** fysikens tid per tidssteg (100 Hz) i typiska lägen, och tiden för en full telemetri. Körs i Node, utan grafik.
- **`?perf` i adressen**, till exempel `http://localhost:5173/ubatssim/?perf`: en rad nederst i spelet med bilder per sekund och tiden per bild för fysik (alla tidssteg i bilden, och µs per steg), grafik (medel och längsta bild under sekunden) och gränssnitt och ljud, och vad grafikkortet håller (geometrier, texturer och shaderprogram från `renderer.info`).
- **Mobil:** i Chrome kan processorn strypas fyra gånger (Utvecklarverktyg → Performance → CPU: 4× slowdown), vilket ungefär motsvarar en mellanklasstelefon.

## Budget

En bild får ta 16,7 ms vid 60 bilder per sekund. Fördelningen på en mellanklasstelefon, med tidskomprimering ×1:

| Del | Budget per bild | Mätt (dator med 4× strypt processor) |
|---|---|---|
| Fysik | ≤ 4 ms (≈ 0,6 ms per tidssteg × 1,67 steg per bild) | 0,4–0,9 ms per tidssteg |
| Grafik (JavaScript) | ≤ 6 ms | 3–5 ms, längsta bild ≤ 8 ms |
| Gränssnitt och ljud | ≤ 1 ms i snitt | ~1–2 ms var 100:e ms |

`npm run bench` på en vanlig dator ska ge högst ~200 µs per tidssteg i alla lägen. Med tidskomprimering ×4 körs fyra gånger fler tidssteg, med ×16 sexton gånger (~1 600 steg per sekund, ~0,1 s räknetid per sekund på en dator). Blir det för mycket, begränsar `maxStepsPerFrame` i `FixedStepLoop` (`src/game/loop.ts`) antalet steg per bild, högst 25 × min(komprimering, 4) = 100: simuleringen går då långsammare än vald komprimering i stället för att hacka. Detsamma gäller när bildtakten är lägre än ~4 bilder per sekund: ett bildavstånd räknas som högst 0,25 s (`MAX_FRAME_GAP`), så speltiden går långsammare än verklig tid. Det händer i e2e-testerna på CI, där 3D-vyn ritas i mjukvara, och deras tidsgränser har marginal för det.

## Mätningar och åtgärder

| Läge (dator, `npm run bench`) | Före | Efter |
|---|---|---|
| Ytläge, lugnt | 153 µs/steg | 130 µs/steg |
| Ytläge, grov sjö | 249 µs/steg | 152 µs/steg |
| 100 m, 8 knop | 110 µs/steg | 113 µs/steg |

Batteriet, dieslarna, läckaget, snorkelmasten och sonaren (en gång per sekund) kostar nästan inget. Sonarens terrängskugga (`terrainBlocks` mot ett 50 m-rutnät) tar ~0,03 ms per sekund i skärgården och ~0,005 ms på Atlanten, där rutornas grundaste djup gör att sökningen hoppas över. Träd och hus placeras i terrängens worker (~5 ms extra per ombyggnad av det detaljerade rutnätet), tången på huvudtråden när kameran flyttat 30 m (~2 500 höjdvärden). Elsystemet räknar propellerns moment en gång per steg, och läckaget lägger vattnet som punktmassor i massberäkningen. Mätt med `npm run bench` före och efter:

| Läge | Före | Efter |
|---|---|---|
| Ytläge, lugnt | 138 µs/steg | 133 µs/steg |
| Ytläge, grov sjö | 156 µs/steg | 173 µs/steg |
| Periskopdjup, måttlig sjö | 136 µs/steg | 132 µs/steg |
| 100 m, 8 knop | 119 µs/steg | 114 µs/steg |
| Fjorden, 30 m | 100 µs/steg | 83 µs/steg |

Skillnaderna ligger inom mätbruset. Partikeleffekterna (`render/effects.ts`) flyttar högst ~2 300 punkter per bild.

| Skärmkontroller (4× strypt processor, per uppdatering var 100:e ms) | Före | Efter |
|---|---|---|
| Djupskala och kompassband | 1,9 ms | 0,27 ms |

Åtgärderna var tre: storleken på de två canvasytorna hålls av en `ResizeObserver` i stället för att läsas med `clientWidth`, vilket tvingade fram en layout efter instrumentpanelens textändringar. Färgerna läses en gång i stället för med `getComputedStyle` vid varje ritning. Canvasytorna ritas bara om när något ändrats med minst ungefär en pixel. Gränssnittstiden blev då densamma som utan skärmkontroller. Med kursen på Hand och en öppen panel är den ~2,4 ms per bild med 4× strypt processor (1,6 ms med besättningen på allt), med mjukvarugrafik i testmiljön.

| Grafik (4× strypt processor) | Före | Efter |
|---|---|---|
| Grov sjö, tid per bild | 25–30 ms | 3–5 ms |
| Ombyggnad av terrängen, längsta bild | 523 ms | 7 ms |

Åtgärderna:

- **Vågytan per skiva** räknas en gång per kraftberäkning och delas av hydrostatiken och ytdämpningen.
- **Kontakt med botten:** terrängrutnätet sparar varje rutas grundaste djup. Är botten inom räckhåll djupare än skrovets djupaste punkt, hoppas de ~80 kontaktpunkterna över. Det är exakt, eftersom interpolationen aldrig ger ett grundare värde än rutans hörn, och ett test jämför med den fullständiga beräkningen.
- **Vågorna på grafikkortet:** vågnätet förskjuts i en vertexshader med samma vågsumma som fysiken (`src/render/waveShader.ts`). Fasen vid nätets mitt räknas i dubbel precision varje bild. Ett test visar att shaderns formel ger fysikens yta inom några millimeter, även 15 km bort och efter två timmar.
- **Terrängen i en bakgrundstråd:** höjder, normaler och färger för terrängens rutnät byggs i en Web Worker (`terrainWorker.ts`, med samma kod i `terrainBuild.ts` som reserv). Det första rutnätet i ett område byggs direkt.
- **Three.js i en egen fil:** webbläsaren kan behålla den mellan uppdateringar av spelet.

## Genomskärningen

Snittvyns JavaScript är litet: en profil med 4× strypt processor visar vattenytans beräkning på 0,1 % och resten som i den yttre vyn. I testmiljön (SwiftShader, grafik i mjukvara) blir "grafik" i `?perf` ändå ~11 ms mot ~5 ms i den yttre vyn, men nästan allt är rastrering av de genomskinliga och dubbelsidiga ytorna, som ett riktigt grafikkort gör. Mät med `?perf` på en telefon innan inredningen byggs ut. Om det behövs: färre genomskinliga ytor (tankarnas skal) och enklare cylindrar.

## Testerna

`npm run test:all` är processorbunden: med Vitests standard (en arbetare mindre än antalet kärnor) tog den 182 s på 4 kärnor, med användartid ~550 s. Med en arbetare per kärna (`maxWorkers: '100%'` i vite.config.ts) tar den 142 s, nära golvet 550 s / 4. Att dela upp de långa filerna per `describe` provades och gav inget (195 s), eftersom alla kärnor redan var upptagna och varje fil kostar uppstart. De snabba testerna tar ~30 s.

På CI går `test:all` på tre maskiner (`--shard`). Vitests egen delning går efter en hash av sökvägen och gav 14, 55 och 78 s lokalt, och 3 min 38 s för den långsammaste delen på CI. Där är golvet inte summan / kärnorna utan också den längsta filen, eftersom en fil inte kan delas: `attack.long` tog 102 s och `crew.long` 83 s. De delades (`attack`, `hunted`, `convoy` och `crewScenarios`), och `DurationSequencer` (`tests/sequencer.ts`) fördelar filerna efter uppmätta tider i `tests/durations.json` (längst först till den maskin som har minst). Det gav 45, 46 och 44 s lokalt. Tiderna mäts med `npm run update-durations`.
