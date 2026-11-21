# Ljudet

Allt ljud syntetiseras i webbläsaren med Web Audio API: oscillatorer, brus och filter. Det finns inga ljudfiler. Ljudet finns i `src/audio/` och följer samma princip som grafiken: det läser simuleringens tillstånd men skriver aldrig till det. Lint och `tests/architecture.test.ts` kontrollerar att fysiken inte importerar ljudet, och att ljudet inte importerar grafik, gränssnitt eller styrning.

## Delar

| Fil | Uppgift |
|---|---|
| `levels.ts` | En ren funktion från telemetrin till ljudnivåer: volym, tonhöjd, filter och hur ofta återkommande ljud spelas. Testas utan ljudkort (`tests/audio.test.ts`). |
| `engine.ts` | Ljudgrafen i Web Audio: en kanal per ljudkälla och engångsljud för larm och signaler. |
| `voice.ts` | Uppläsning av kvitton med webbläsarens talsyntes på svenska. |
| `director.ts` | Kopplar ihop spelet och ljudet: nivåer tio gånger i sekunden, engångsljud från loggen och händelser, och rösten. |
| `score.ts` | Startsidans musik som partitur: en ren, generativ tidslinje med delar och händelser, utan ljud. Testas med ett fast frö (`tests/score.test.ts`). |
| `menuMusic.ts` | Spelar partituret med Web Audio. |

```
källor ─┬─ inne (ubåtens maskiner) ───────────────────────┐
        └─ ute (strömning, hav, vind, måsar) → lågpass ───┴→ spelet ─┬→ huvudvolym → högtalare
startsidans musik ───────────────────────────────────────────────────┘
```

Spelets ljud hörs medan ett spel pågår, och musiken på startsidan och under ett scenarios genomgång och introduktionen. Annars stängs ljudkontexten av. `<html data-audio>` visar kontextens läge (`running`, `suspended`) för webbläsartesterna.

Ljud utifrån går genom ett lågpassfilter (700 Hz) när kameran är under vattnet, så att det låter instängt.

## Ljudkällorna

| Ljud | Styrs av | Hur det låter |
|---|---|---|
| Elmotor | Varvtal och axeleffekt | Lågt surr, 45 Hz + 30 Hz per varv/s, starkare med effekten |
| Propeller | Varvtal | Ett brusband som pulserar med bladfrekvensen (7 blad × varv/s) |
| Kavitation | Varvtal över 2,6 varv/s och djup under 40 m | Sprakande högfrekvent brus, starkast nära ytan |
| Strömning | Fart genom vattnet | Brus som växer med farten i kvadrat och blir ljusare med farten |
| Hydraulik | Roder eller djuproder som rör sig | Ett gnällande surr |
| Ventilering | Öppen ventil på en tank som ännu har luft | Kraftigt väsande som avtar när tanken fylls |
| Vatten in | Samma | Ett bubblande, vobblande brusband |
| Blåsning | Öppen blåsventil | Dånande brus, svagare när HP-luften tar slut |
| Pumpar | Pågående trimning eller kompensering | Jämnt mekaniskt brummande |
| Periskopet och snorkeln | En mast rör sig | Ett elmotorljud, och ett klonk vid periskopets ändläge |
| Dieslarna | Går (snorkling eller ytläge) | En tung dunk i tändfrekvensen, 33–50 Hz efter lasten, med ett mullrande brus |
| Läcka | Vatten strömmar in genom ett hål | Ett hårt väsande, starkare med inflödet |
| Länspumpen | Går när det finns vatten i en avdelning | Ett lågt surr |
| Lågtrycksblåsaren | Går när bryggan är bemannad | Ett fläktljud |
| Andra fartyg | Närmaste fartygets avstånd och bladfrekvens | Ett lågt brus som pulserar i fartygets bladtakt. Hörs inom 4 km, starkast nära och när ubåten är under vattnet |
| Skrovet | Djupändring, djup och krossdjup | Knakningar och dova smällar. De kommer tätare ju fortare och djupare ubåten går, och oavbrutet under 250 m |

## Larm och signaler

| Händelse | Ljud |
|---|---|
| Grundstötning | En skrapande smäll, en dov duns och en larmsignal |
| Under 10 m under kölen | Ekolodets pip, tätare ju grundare det är |
| Djupare än 250 m | En larmsignal när gränsen passeras |
| Vatten över bryggan | Ett plask och en larmsignal |
| Nödblåsning | En larmsignal |
| Läckage, skrovet kollapsar | En larmsignal |
| Torped avfyrad (`Torped n gick från tub …`) | Tryckluft som rusar och en duns |
| Träff | En låg, rullande smäll långt bort |
| Sjunkbomb inom 120 m | Ett hårt knäpp, en tung smäll och skrovet som klingar |
| Korvettens aktiva sonar | En klingande ping och dess eko genom skrovet, vid varje ping |
| Ubåtens egen ping | En kraftig ping genom skrovet (2,4 kHz) och två svagare ekon utifrån, vid varje ping (`ownPing`) |
| Huvudballasten full | Ett klonk när ventilerna stängs |
| Ny fartorder (telegrafen, `fart`, `back`) | Maskintelegrafens klocka, två slag |
| Mål klart | Två stigande toner |
| Uppdraget slutfört / misslyckat | Ett stigande ackord / tre fallande toner |

## Omgivningen

Ljud från omgivningen hörs bara när kameran är ovanför vattnet.

- **Vind:** på bryggan och i den yttre vyn. Starkare med sjögång och fart.
- **Vågor:** starkare med sjögången.
- **Måsar:** på dagen i områden med kust, inte på Atlanten.
- **Mistlur:** i dimma, var 30:e sekund.

**Livet i havet** hörs genom skrovet när ubåten är under ytan, oavsett kamera, från det närmaste djur som låter just då (`AudioInput.bio`, `call` i `engine.ts`). Starkare ju närmare, ut till 8 km (knölval), 6 km (kaskelot), 4 km (vikval, späckhuggare) och 600 m (sill).

| Djur | Ljud |
|---|---|
| Kaskelot | Klickserier, tre skarpa klick (bandpass 3,5 kHz) ungefär en gång i sekunden |
| Knölval | Långa toner, 180–430 Hz, som glider upp eller ned under 2,5–4,5 s, med vibrato |
| Vikval | Låga pulståg, sex korta toner runt 110 Hz |
| Späckhuggare | Visslingar, 1,8–4,3 kHz, som glider |
| Sill | Ett snabbt tickande (FRT), bara på natten |

## Rösten

Rösten läser upp spelarens egna order ("Djup 32, ja"), larm och misslyckanden (första meningen) och "Mål klart". Assistentens kompenseringar, felskrivna kommandon och hjälptexter läses inte upp. En ny uppläsning avbryter den förra, så den senaste ordern hörs alltid. Saknar enheten en svensk röst är rösten tyst.

## Inställningar och regler

- **Inställningar:** volym, maskiner och larm, hav, vind och måsar, och uppläsning av order. Ljudet är på från början med volymen 60 %, och rösten är avstängd. M stänger av och sätter på ljudet under spelet.
- **Start:** webbläsare startar ljud först efter ett tryck eller en tangent. Ljudkontexten skapas därför vid första tryck.
- **Paus:** ljudet går bara när spelet pågår. I menyer, paus och dold flik är det tyst, och demon bakom menyn är tyst.
- **Determinism:** ljudet får använda slump, till exempel för knakningar och måsar, eftersom det inte påverkar simuleringen.

## Musiken på startsidan

Lugn och djup, havet snarare än kriget, i D aeolisk (naturlig moll: D E F G A B♭ C). Allt syntetiseras, och inget upprepas som en loop. `score.ts` skriver partituret, `menuMusic.ts` spelar det.

**Delar** (glider över i varandra, ungefär 2 minuter per varv):

| Del | Längd | Innehåll |
|---|---|---|
| Lugn | 60–85 s | Bottenton, långsamma ackord (Dm, B♭, F, C), avlägsna sonarpingar, skrovet som stönar, radio med morse |
| Djup | 45–65 s | En mjuk puls som ett hjärtslag (50 bpm) som växer lite men aldrig blir stark, en lång hornsignal, ackorden Dm, Gm, B♭, C |

Det finns inga sjunkbomber, ingen virvel och inget anfall.

**Lagren:**

- **Bottenton:** två lätt förstämda sågtänder och en sinus på D1 (37 Hz) och en kvint, genom ett lågpass som andas (LFO 0,045 Hz). Subbassvällningar var 8–12 s.
- **Ackord:** tre röster (två förstämda sågtänder och en sinus en oktav ned) med 5 s in och 5 s ut, genom ett mjukt lågpass, med filtrerat brus som andning.
- **Ping:** en sinus på A5 eller D6 med kort svävning och ett eko 1,7 s senare, nästan bara i efterklangen.
- **Skrovet:** ett resonant brusband som sveper nedåt och ibland en dov knack.
- **Puls:** en trumma med fallande tonhöjd och ett mjukt klick, accent var fjärde slag.
- **Horn:** mässingslika sågtänder genom ett lågpass som öppnar sig för varje ton. Motiven är egna, fallande och i skalan.
- **Radio:** bandpassat brus kring 1,7 kHz och morsegrupper om 3–5 bokstäver.

Allt går genom en efterklang från en genererad impulsrespons (4,5 s brus som klingar av och blir mörkare, som i vatten). Det som är långt bort (pingar, horn) går mest genom efterklangen.

Partituret har en egen klocka och går så fort startsidan visas, också innan webbläsaren tillåter ljud. Musiken tonas in på 3 s efter första trycket och ut när ett spel startar. Inställningarna har **Musik på startsidan** och **Musikvolym**, och M stänger av allt ljud, också på startsidan.

