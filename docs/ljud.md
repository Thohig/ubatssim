# Ljudet

Allt ljud syntetiseras i webbläsaren med Web Audio API: oscillatorer, brus och filter. Det finns inga ljudfiler. Ljudet finns i `src/audio/` och följer samma princip som grafiken: det läser simuleringens tillstånd men skriver aldrig till det. Lint och `tests/architecture.test.ts` kontrollerar att fysiken inte importerar ljudet, och att ljudet inte importerar grafik, gränssnitt eller styrning.

## Delar

| Fil | Uppgift |
|---|---|
| `levels.ts` | En ren funktion från telemetrin till ljudnivåer: volym, tonhöjd, filter och hur ofta återkommande ljud spelas. Testas utan ljudkort (`tests/audio.test.ts`). |
| `engine.ts` | Ljudgrafen i Web Audio: en kanal per ljudkälla och engångsljud för larm och signaler. |
| `voice.ts` | Uppläsning av kvitton med webbläsarens talsyntes på svenska. |
| `director.ts` | Kopplar ihop spelet och ljudet: nivåer tio gånger i sekunden, engångsljud från loggen och händelser, och rösten. |

```
källor ─┬─ inne (ubåtens maskiner) ───────────────────────┐
        └─ ute (strömning, hav, vind, måsar) → lågpass ───┴→ huvudvolym → högtalare
```

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
| Periskopet | Masten rör sig | Ett elmotorljud, och ett klonk vid ändläget |
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
| Huvudballasten full | Ett klonk när ventilerna stängs |
| Mål klart | Två stigande toner |
| Uppdraget slutfört / misslyckat | Ett stigande ackord / tre fallande toner |

## Omgivningen

Ljud från omgivningen hörs bara när kameran är ovanför vattnet.

- **Vind:** på bryggan och i den yttre vyn. Starkare med sjögång och fart.
- **Vågor:** starkare med sjögången.
- **Måsar:** på dagen i områden med kust, inte på Atlanten.
- **Mistlur:** i dimma, var 30:e sekund.

## Rösten

Rösten läser upp spelarens egna order ("Djup 32, ja"), larm och misslyckanden (första meningen) och "Mål klart". Assistentens kompenseringar, felskrivna kommandon och hjälptexter läses inte upp. En ny uppläsning avbryter den förra, så den senaste ordern hörs alltid. Saknar enheten en svensk röst är rösten tyst.

## Inställningar och regler

- **Inställningar:** volym, maskiner och larm, hav, vind och måsar, och uppläsning av order. Ljudet är på från början med volymen 60 %, och rösten är avstängd. M stänger av och sätter på ljudet under spelet.
- **Start:** webbläsare startar ljud först efter ett tryck eller en tangent. Ljudkontexten skapas därför vid första tryck.
- **Paus:** ljudet går bara när spelet pågår. I menyer, paus och dold flik är det tyst, och demon bakom menyn är tyst.
- **Determinism:** ljudet får använda slump, till exempel för knakningar och måsar, eftersom det inte påverkar simuleringen.
