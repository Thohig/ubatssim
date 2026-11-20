# Prestanda

## Mätverktyg

- **`npm run bench`:** fysikens tid per tidssteg (100 Hz) i typiska lägen, och tiden för en full telemetri. Körs i Node, utan grafik.
- **`?perf` i adressen**, till exempel `http://localhost:5173/ubatssim/?perf`: en rad nederst i spelet med bilder per sekund och tiden per bild för fysik (alla tidssteg i bilden, och µs per steg), grafik (medel och längsta bild under sekunden) och gränssnitt och ljud.
- **Mobil:** i Chrome kan processorn strypas fyra gånger (Utvecklarverktyg → Performance → CPU: 4× slowdown), vilket ungefär motsvarar en mellanklasstelefon.

## Budget

En bild får ta 16,7 ms vid 60 bilder per sekund. Fördelningen på en mellanklasstelefon, med tidskomprimering ×1:

| Del | Budget per bild | Mätt (dator med 4× strypt processor) |
|---|---|---|
| Fysik | ≤ 4 ms (≈ 0,6 ms per tidssteg × 1,67 steg per bild) | 0,4–0,9 ms per tidssteg |
| Grafik (JavaScript) | ≤ 6 ms | 3–5 ms, längsta bild ≤ 8 ms |
| Gränssnitt och ljud | ≤ 1 ms i snitt | ~1–2 ms var 100:e ms |

`npm run bench` på en vanlig dator ska ge högst ~200 µs per tidssteg i alla lägen. Med tidskomprimering ×4 körs fyra gånger fler tidssteg. Blir det för mycket, begränsar `maxStepsPerFrame` i `FixedStepLoop` (`src/game/loop.ts`) antalet steg per bild: simuleringen går då långsammare än vald komprimering i stället för att hacka.

## Mätningar och åtgärder

| Läge (dator, `npm run bench`) | Före | Efter |
|---|---|---|
| Ytläge, lugnt | 153 µs/steg | 130 µs/steg |
| Ytläge, grov sjö | 249 µs/steg | 152 µs/steg |
| 100 m, 8 knop | 110 µs/steg | 113 µs/steg |

| Skärmkontroller i förenklat läge (4× strypt processor, per uppdatering var 100:e ms) | Före | Efter |
|---|---|---|
| Djupskala och kompassband | 1,9 ms | 0,27 ms |

Åtgärderna var tre: storleken på de två canvasytorna hålls av en `ResizeObserver` i stället för att läsas med `clientWidth`, vilket tvingade fram en layout efter instrumentpanelens textändringar. Färgerna läses en gång i stället för med `getComputedStyle` vid varje ritning. Canvasytorna ritas bara om när något ändrats med minst ungefär en pixel. Gränssnittstiden blev då densamma som i realistiskt läge.

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
