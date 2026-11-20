# Ubåtssim

En ubåtssimulator i 3D som körs i webbläsaren, på dator och mobil. Fokus ligger på realistisk simulering av en dieselelektrisk ubåt på cirka 60 m: flytkraft, ballast och tryckluft, trim, hydrodynamik, roder, propeller och grundstötning. Grafiken är medvetet enkel.

**Spela:** https://thohig.github.io/ubatssim/

## Innehåll

- [Spelet](#spelet)
- [Besättningen och du](#besättningen-och-du)
- [Styrning](#styrning)
- [Vyer](#vyer)
- [Kommandokonsolen](#kommandokonsolen)
- [Instrumentpanelen](#instrumentpanelen)
- [Scenarier](#scenarier)
- [Havsområden och väder](#havsområden-och-väder)
- [Ljud](#ljud)
- [Fysik i korthet](#fysik-i-korthet)
- [Utveckling](#utveckling)
- [Projektstruktur](#projektstruktur)
- [Genväg på Mac](#genväg-på-mac)
- [Publicering](#publicering)

## Spelet

Det finns ett spelläge. Varje spel börjar med att **besättningen sköter ubåten**, och du tar över det du vill sköta själv (se [Besättningen och du](#besättningen-och-du)). På startsidan finns fyra val:

| Val | Innehåll |
|---|---|
| **Fritt spel** | Välj havsområde (Västerhavet, Östersjön, Fjorden, Atlanten), ljus och sikt (dag, natt, dimma), sjögång (lugnt, måttlig, grov) och startläge, till exempel ytläge, periskopdjup (13 m, kölen på 16 m) eller djupt vatten. |
| **Scenarier** | Uppdrag med mål och ledtrådar. |
| **Inställningar** | Tidskomprimering ×1/×2/×4, ljud (volym, maskiner och larm, hav och vind, uppläsning av order) och svävande partiklar. Inställningarna sparas i webbläsaren. |
| **Hjälp** | Besättningen, kontrollerna, tangenterna, alla konsolkommandon och tips. |

På iPhone och iPad kan spelet läggas på hemskärmen via Safaris Dela-meny ("Lägg till på hemskärmen"). Då startar det i helskärm med egen ikon.

Under spelet pausar du med ☰-knappen eller Esc. Pausmenyn visar vem som sköter vad och har Fortsätt, Besättning, Starta om, Inställningar, Hjälp och Huvudmeny. Spelet pausas också automatiskt när fliken döljs.

## Besättningen och du

Det finns ett spel och en ubåt. För varje system väljer du om **besättningen** sköter det eller om du gör det **själv**. Varje spel börjar med att besättningen sköter allt, och det går att ändra när som helst, mitt i ett scenario också. Simuleringen är densamma oavsett val: ballast, pumpar, tryckluft och hydrodynamik fungerar likadant.

| System | Besättningen sköter (från start) | Du sköter själv |
|---|---|---|
| **Djup** | **Auto:** djupstyraren håller djupmålet från djupskalan. | **Hand:** du styr djuprodret. |
| **Kurs** | **Auto:** rorsmannen håller kursmålet från kompassen. | **Hand:** du styr rodret. |
| **Fart** | Maskinen följer telegrafen. | Du styr propellervarvet (Fart ▾). |
| **Ballast och brygga** | Dyk / Yta. Besättningen utrymmer bryggan, ett djupmål på 5 m eller mer i ytläge startar dykningen och ett djupmål grundare än 5 m med fylld huvudballast blåser den. | Du fyller, blåser och stänger huvudballasten och klarar bryggan (Ballast ▾). Ett djupmål som inte går att nå med ballasten som den är ger en påminnelse. |
| **Trim** | Trimassistenten kompenserar och trimmar. | Du kompenserar och trimmar (Trim ▾). |
| **Skyddsnät** | På: nödblåsning nära krossdjupet, djupgräns över botten och varning för grunt vatten. | Av. |

- **Ta över:** växla djup eller kurs till **Hand**, eller tryck på en knapp i panelerna **Ballast ▾**, **Trim ▾** och **Fart ▾**. Panelens övre knapp lämnar systemet till besättningen igen. ☰ → **Besättning** visar alla system på ett ställe, med skyddsnätet.
- **Order tar över:** en manuell order tar över systemet den gäller, också i konsolen. `roder sb 10` sätter kursen på Hand, `trimma för 200` avlöser trimassistenten och `fyll hb` ger dig ballasten. Ett djup- eller kursmål och telegrafen lämnar axeln till besättningen igen.
- **Utan ryck:** tar du över djup eller kurs ligger rodren kvar där autopiloten hade dem. Lämnar du tillbaka dem sätts målen till nuvarande djup och kurs.
- **Instrumentpanelen** följer valen: tar du över kursen visas rodret, trimmet flytkraft och tankar, ballasten HP-luften.
- **Första gången** visas en kort introduktion.
- **Trimassistenten** ger vanliga order, och varje order kvitteras i loggen, till exempel `Kompensera ut 150 liter, ja`. Den är begränsad av pumparnas kapacitet (5–6 l/s), så den hinner inte rädda allt.
  - **Kompensering:** när ubåten är nedsänkt med full huvudballast och har legat stilla på sitt djup en stund, pumpar assistenten bort flytkraftsöverskottet i portioner om högst 200 l. Små avvikelser (±50 kg) lämnas.
  - **Trim:** behöver djuprodret hela tiden ligga i samma riktning för att hålla djupet, flyttas vatten mellan trimtankarna.
- **Skyddsnätet:**
  - Nödblåsning under 255 m (85 % av krossdjupet 300 m), eller om ubåten sjunker fortare än 2 m/s under 250 m.
  - Djupmålet begränsas så att det är minst 10 m under kölen, under ubåten och upp till 150 m i färdriktningen.
  - Varning i loggen när det är mindre än 10 m under kölen.
- **Scenarier** kan låsa ett system: i Trimövning sköter du djupet (Hand) och trimmet själv, och i Nödblåsning finns inget skyddsnät. Resultatskärmen visar vad du skötte själv, till exempel "Du skötte själv trimmet och ballasten".

## Styrning

### Skärmkontrollerna

Kontrollerna längst ner visas alltid, på dator och mobil.

| Kontroll | Var | Funktion |
|---|---|---|
| **Djupskala** (Auto) | Vänster | Visar djupet (vit linje), djupmålet (blå pil), periskopdjupet, botten (brun) och skyddsnätets gräns (röd streckad). Skalan är kvadratisk, så de grunda metrarna får plats. Tryck eller dra för att välja djup i steg om 5 m. Målet sätts när du släpper. ▲ / ▼ ändrar 5 m, och **13 m** går till periskopdjup. |
| **Djuproder** (Hand) | Vänster | Visar djuprodrets order och utslag. Tryck eller dra för en vinkel. **▲ Upp** / **▼ Ned** ändrar 5°, **Noll** lägger det i noll. |
| **Kompass** (Auto) | Höger | Visar 60° åt varje håll från kursen (röd linje), med kursmålet och bojen (gul prick). Tryck eller dra för att välja kurs i steg om 5°. ◀ / ▶ ändrar 10°. **Mot bojen** styr mot bojen i scenarier som har en. |
| **Roder** (Hand) | Höger | Visar rodrets order och utslag. Tryck eller dra för en vinkel. **◀ BB** / **SB ▶** ändrar 5°, **Mitt** lägger det midskepps. |
| **Auto / Hand** | Vid djupskalan och kompassen | Vem som styr djupet och kursen. |
| **Maskintelegraf** | Mitten | Full, Halv och Sakta back (6, 4 och 2 knop), Stopp, och Sakta, Halv och Full fram (4 och 8 knop, och Full fram är toppfarten: 19 knop, i Östersjöns bräckta vatten ~17). Läget som gäller lyser, och klockan slår vid varje ny order. |
| **Dyk / Yta** | Mitten | En knapp som följer ballasten: Dyk när huvudballasten är tom, Yta när den fylls eller är full. |
| **Håll** | Mitten | Behåller nuvarande kurs och djup på Auto. |
| **Ballast ▾** | Mitten | Huvudballasttankarna med fyllnadsgrad, Fyll / Blås / Stäng för, akter och båda, bryggan (Klart bryggan, Bemanna) och HP-luften. |
| **Trim ▾** | Mitten | Flytkraft, stampvinkel, pumparna, kompenserings- och trimtankarna. Kompensera in / ut och trimma för / akter, 100 eller 500 liter. |
| **Fart ▾** | Mitten | Fart, varvtal och axeleffekt. Fartmålet ±1 knop, varvtalet ±10 rpm och Stopp. |

En panelknapp som du sköter själv är gul. På stående telefon ligger djupskalan till vänster, kompassen och knapparna till höger och telegrafen över hela bredden längst ner. På liggande telefon ligger allt i en rad. Håll in ▲ ▼ ◀ ▶ och rodrens knappar så upprepas de, och fortare ju längre du håller.

Knapparna Vy, Per, Zoom och Brg uppe till höger gör samma sak som V, P, Z och B. Per och Vy visas när ubåten är grundare än 25 m eller periskopet är uppe. **>_** öppnar konsolen.

### Tangentbord

Piltangenterna följer Auto / Hand.

| Tangent | Auto / besättningen | Hand / du |
|---|---|---|
| ← / → | Kurs 10° babord / styrbord | Roder 5° babord / styrbord |
| ↑ / ↓ | Djup 5 m grundare / djupare | Djuproder 5° upp / ned |
| Mellanslag | Håll nuvarande kurs och djup | Roder (eller djuproder) i noll |
| Shift + ↑ / ↓ | Telegrafen ett läge fram / back | Varv ±10 rpm |
| D / S | Dyk (djupmål periskopdjup, 13 m, om inget djupare mål finns) / ytläge | Samma |
| V | Byt vy (yttre, bryggan, periskopet). Besättningen bemannar bryggan i ytläge. | Byt vy (bryggan måste vara bemannad) |
| P | Periskop upp / ned | Samma |
| Z | Periskopets förstoring, 1,5× / 6× | Samma |
| B | Rapportera bäringen dit periskopet eller blicken pekar | Samma |
| ← / → i periskopet | Vrid periskopet (Shift + ← / → styr) | Samma |
| Enter eller / | Öppna kommandokonsolen | Samma |
| Esc | Lämna konsolen eller en vy, eller pausa | Samma |
| M | Ljud av / på | Samma |

När konsolen är öppen visar lägesindikatorn överst **KONSOL**, och ↑/↓ bläddrar i kommandohistoriken. Instrumentpanelen är kompakt på smala skärmar, och "Mer ▾" visar resten.

Mus och finger styr kameran: dra för att vrida och nyp eller scrolla för att zooma. Kameran följer ubåten.

### Back

Ubåten backar med telegrafen (Halv back), med Shift + ↓ förbi noll eller med `back halv` i konsolen. På Hand går det med negativt varvtal under Fart ▾. Instrumentpanelen visar då **BACK** framför farten, och maskintelegrafens klocka slår vid varje ny fartorder.

- **Propellern** ger ungefär 60 % av dragkraften bakåt, och motorn tillåter högst 108 rpm back. Toppfarten bakåt blir ~6,8 knop, och det tar några minuter att komma upp i fart.
- **Rodren verkar omvänt**, eftersom vattnet kommer bakifrån. Roder styrbord vrider fören åt babord, och djuproder ned lyfter fören. På Hand får du styra omvänt.
- **Djupstyraren och rorsmannen** (Auto) vet om att ubåten backar och vänder sina utslag själv. Den byter riktning när farten genom vattnet har passerat ±0,2 m/s och börjar då om från noll. Vid back tillåter den högst 5° stampvinkel, så djupändringar går långsamt.
- **Skyddsnätet** tittar efter grunt vatten åt det håll ubåten rör sig, alltså akterut vid back. Trimassistenten flyttar inget trimvatten medan ubåten backar.
- **Stoppa i god tid.** Ubåten glider länge. Fartautopiloten bromsar med propellern, men stoppet från 4 knop back tar ändå omkring en minut.

## Vyer

| Vy | Var du står | När den finns |
|---|---|---|
| **Yttre** | Bakom och ovanför ubåten. Dra för att vrida, nyp eller scrolla för att zooma. | Alltid |
| **Bryggan** | Överst i tornet. Dra för att titta runt. Kompassband med bäring och bojens riktning. | När bryggan är bemannad, i ytläge |
| **Periskopet** | I periskophuvudet: hårkors, bäringsskala och förstoring 1,5× eller 6×. Vrid med ←/→ eller genom att dra. | När periskopet är uppe |

- **Bryggan** är bemannad i ytläge. Den måste utrymmas innan ubåten dyker:
  - Sköter besättningen ballasten utryms bryggan automatiskt när du trycker Dyk (D).
  - Sköter du ballasten själv trycker du Klart bryggan under Ballast ▾ (eller `klart bryggan`). Annars vägrar ubåten att fylla huvudballasten.
  - Når vattnet över brygglisten utryms bryggan, och vyn byter till den yttre.
- **Lågtrycksblåsaren** går när bryggan är bemannad och håller huvudballasten torr i sjögång.
- **Periskopet** tar 8 s att hissa. Vyn öppnas när det är uppe. Huvudet når över vattnet ner till ungefär 14 m djup i stilla sjö. I grov sjö kan vågtopparna skölja över det. Över 6 knop vibrerar bilden, och den våta masten ger motstånd.

## Kommandokonsolen

Konsolen öppnas med **>_** eller Enter. Den är ett annat sätt att ge order, för den som vill skriva exakta värden, och inget kräver den. En order tar över systemet den gäller, precis som en knapp (se [Besättningen och du](#besättningen-och-du)). Alla kommandon kvitteras i loggen med simuleringstid, till exempel `[00:03:12] Djup 120, ja`. Felaktiga kommandon ger ett felmeddelande som pekar ut fel ord och föreslår rätt form ("Menade du styrbord?").

| Kommando | Exempel | Funktion |
|---|---|---|
| `djup <m>` | `djup 120` | Djupautopilot |
| `kurs <grader>` | `kurs 270` | Kursautopilot |
| `fart <knop> [knop]` | `fart 8 knop`, `fart stopp` | Fartautopilot |
| `back <knop>\|sakta\|halv\|full` | `back 3`, `back halv` | Fartautopiloten back: sakta 2, halv 4 och full 6 knop. Samma som `fart -4`. |
| `varv <rpm>` | `varv 120`, `varv -60` | Propellervarv direkt (fartautopiloten kopplas ur). Back högst 108 rpm. |
| `roder sb\|bb <grader>` | `roder styrbord 15`, `roder midskepps` | Roder |
| `djuproder ned\|upp <grader>` | `djuproder ned 10`, `djuproder noll` | Djuproder |
| `fyll huvudballast [för\|akter]` | `fyll hb` | Öppna ventilerna, så att tanken vattenfylls |
| `blås huvudballast [för\|akter]` | `blås huvudballast` | Blås tanken tom med tryckluft |
| `stäng huvudballast [för\|akter]` | | Stäng ventiler och blåsning |
| `dyk` | | Fyll huvudballasten. Ventilerna stängs när tankarna är fulla. |
| `ytläge` | `yta` | Blås huvudballasten. En inkopplad djupautopilot får målet 0 m. |
| `klart bryggan` | | Utrym bryggan inför dykning |
| `bemanna bryggan` | | Gå upp på bryggan (bara i ytläge) |
| `periskop upp\|ned` | `per upp` | Hissa eller sänk periskopet |
| `bäring <grader>` | `bäring 63` | Rapportera bäringen till något du ser genom periskopet eller från bryggan |
| `trimma för\|akter <liter>` | `trimma för 200` | Pumpa vatten mellan trimtankarna |
| `kompensera in\|ut <liter>` | `kompensera ut 300` | Ta in vatten eller pumpa ut det |
| `autopilot på\|av [djup\|kurs\|fart]` | `autopilot av`, `ap på djup` | Slå på eller av autopilot (samma som Auto / Hand) |
| `besättning <system>\|allt` | `besättning trim` | Lämna djup, kurs, fart, ballast, trim eller skyddsnät till besättningen |
| `själv <system>\|allt` | `själv ballast`, `själv skyddsnät` | Ta över systemet själv (skyddsnät: stäng av det) |
| `hjälp` | | Visa listan |

Kommandona tolererar alias (`sb`, `bb`, `hb`, `kn`, `ap`), decimalkomma (`djup 45,5`), enheter (`120 m`, `10°`) och ett inledande `/`.

## Instrumentpanelen

- **Djup, fart och kurs:** med målet (→) när besättningen sköter dem. I ytläge visar djupet "→ yta": ubåten flyter och djuprodret ligger i noll. Farten är farten genom vattnet, som loggen mäter.
- **Stampvinkel och krängning.**
- **Under köl:** ekolodets djup under kölen. Rött under 5 m och vid grundstötning.
- **Roder och djuproder:** verkligt utslag och kommenderat utslag (orange markering). Rodren rör sig med begränsad hastighet, ~4°/s.
- **Trim:** Tung, Neutral eller Lätt (±100 kg), och Ytläge när ubåten inte är helt nedsänkt.
- **Det du sköter själv** visas i huvudpanelen: djuproder och stampvinkel på Hand, roder på Hand, varvtal och effekt för farten, flytkraft och tankar för trimmet, tankar och HP-luft för ballasten.
- **Under "Mer":** djupändring, fart och kurs över grund, strömmen, varvtal, axeleffekt, nivån i varje tank, ventil- och blåsstatus, HP-luftens tryck och flytkraftsöverskott (+ = lätt, − = tung).

## Scenarier

| Scenario | Svårighet | Mål |
|---|---|---|
| Första dykningen | lätt | Guidad övning: klara bryggan, fyll huvudballasten, dyk till 30 m, trimma neutralt och gå till ytläge igen. |
| Trimövning | medel | Håll 50 m ±2 m i tre minuter utan djupautopilot. |
| Språngskiktet | medel | Dyk genom termoklinen till 90 m och kompensera för att ubåten blir lättare där. |
| Back | lätt | Backa 450 m till en boj rakt akterut och stanna vid den, utan att vända ubåten. |
| Genom sundet | medel | Gå i ytläge genom ett smalt sund i skärgården till en gul boj, utan att gå på grund. |
| Nödblåsning | svår | Ubåten är flera ton för tung på 200 m. Nå ytan innan krossdjupet 300 m. |
| Periskopspaning | medel | Ta ut bäringen till en fyr genom periskopet. Periskopet får inte synas mer än 60 s i taget. |
| Fyrljuset | medel | Natt: gå i ytläge mot en röd fyr tills den är 700 m bort. |
| Saltsprånget | svår | Östersjön: dyk genom saltsprångskiktet till 90 m och kompensera för de tonnen ubåten blir lättare. |
| Fjordinloppet | svår | Ta dig i undervattensläge över fjordens tröskel (55 m) och in till en boj, utan att gå grundare än 15 m. |
| Fartyget | medel | Ta ut bäringen till ett lastfartyg genom periskopet, utan att bli sedd eller komma i vägen för det. |

Ett scenario misslyckas om ubåten går på grund eller kolliderar med ett fartyg. Ledtrådarna anpassas efter vem som sköter systemet målet gäller. I Trimövning sköter du djupet (Hand) och trimmet själv, och i Nödblåsning finns inget skyddsnät. Allt annat väljer du.

## Havsområden och väder

| Område | Terräng | Vatten | Ström |
|---|---|---|---|
| **Västerhavet** | Öppet hav (280–375 m) och Bohusläns skärgård från ~2 km österut: granithällar, kobbar och 20–50 m djupa sund. | Salt (1 025 kg/m³), språngskikt på 40–70 m. | Baltiska strömmen, 0,25 m/s norrut vid ytan. |
| **Östersjön** | Grundare hav (110–130 m) och en låg skärgård från ~3 km österut. | Bräckt (1 005 kg/m³). Saltsprångskikt på 60–80 m, där vattnet blir 2,4 kg/m³ tätare. | Svag, 0,1 m/s. |
| **Fjorden** | En fjord som går norrut mellan 300 m höga berg. Tröskel på 55 m vid mynningen, 380 m djup bassäng innanför. | Sötare ytskikt (1 012 kg/m³) ovanpå atlantvatten under 9 m. | Ytvattnet strömmar ut, 0,4 m/s söderut i de översta metrarna. |
| **Atlanten** | Djuphav, ~1 800 m. Ingen botten inom räckhåll. | Salt och kallt (1 027 kg/m³). | Nordatlantiska strömmen, 0,3 m/s mot nordost, ända ner till djupet. |

- **Trafik:** i fritt spel går fartyg i varje område: lastfartyg, färjor och fiskebåtar. De följer sina rutter, har lanternor i mörker och dimma och hörs genom skrovet när de är nära. Kollision med ett fartyg loggas.
- **Barlast:** ubåtens fasta barlast är anpassad för området, som när en marin flyttar en ubåt mellan hav. Den är alltså neutral på konstruktionsdjupet i alla områden. Skillnaden märks i skikten, till exempel att ubåten blir flera ton lättare under Östersjöns saltsprångskikt, och att den flyter något djupare i fjordens sötvatten.
- **Ljus och sikt:** dag, natt eller dimma (sikt ~200 m). På natten syns fyrarna, som blinkar med sin egen karaktär, långt innan land syns.
- **Sjögång:** lugnt, måttlig sjö (Hs 1,25 m) eller grov sjö (Hs 3 m). Vågorna påverkar flytkraften i ytläge, periskopet och bryggan. Djupare ner märks de inte.

Terrängen ingår i fysiken. Ubåten kan gå på grund, och det man ser i 3D är det man kan krocka med.

## Ljud

Allt ljud syntetiseras i webbläsaren och följer simuleringen:

- **Ubåten:** elmotorn och propellern följer varvtalet, strömningsbruset farten och kavitationen hörs vid högt varv nära ytan. Rodren surrar när de rör sig, och skrovet knakar när trycket ändras.
- **System:** ventilering, vatten som strömmar in, blåsning, pumpar, periskopets motor och lågtrycksblåsaren hörs medan de arbetar.
- **Larm och signaler:** grundstötning, ekolodets pip när det är mindre än 10 m under kölen, krossdjupet, vatten över bryggan, nödblåsning, klara mål och uppdragets resultat.
- **Omgivningen:** vind och vågor efter sjögången, måsar på dagen nära land och mistlur i dimma. Under vattnet låter ljudet utifrån dovt.
- **Röst:** spelarens order, larm och klara mål kan läsas upp med en svensk röst. Det slås på i inställningarna.

Ljudet startar vid första tryck, eftersom webbläsare kräver det, och är tyst i menyer och paus. Mer om ljudet finns i [docs/ljud.md](docs/ljud.md).

## Fysik i korthet

- **Rörelser:** 6 frihetsgrader enligt Fossens rörelseekvationer för undervattensfarkoster. Orienteringen är en quaternion, och integrationen sker med RK4 och ett fast tidssteg på 100 Hz. Simuleringen är deterministisk.
- **Flytkraft:** skrovet är uppdelat i 80 cirkulära skivor, och den nedsänkta delen av varje skiva räknas exakt. Samma modell ger flytkraft, flytcentrum och rätande moment i ytläge, halvt nedsänkt och helt nedsänkt läge.
- **Vatten och skrov:** vattnets densitet beror på havsområdet, djupet och skikten. Trycket är den exakta integralen av densiteten. Skrovet trycks ihop med djupet.
- **Ström och vågor:** de hydrodynamiska krafterna räknas mot vattnet, inte mot botten. Vågorna är en summa av sju reguljära vågor, och varje skiva av skrovet räknas mot den lokala vattenytan. I ytläge dämpas hiv och stamp av de vågor skrovet själv strålar ut.
- **Tankar som data:** två huvudballasttankar, två trimtankar och en kompenseringstank. Massa, tyngdpunkt och tröghet räknas om från tankarnas innehåll varje tidssteg.
- **Tryckluft:** HP-luften följer Boyles lag. Luften i huvudballasten expanderar när ubåten stiger och trycks ihop när den dyker.
- **Periskop:** masten hissas på 8 s och ger motstånd i vattnet.
- **Hydrodynamik:** medsvängande vattenmassa, linjär och kvadratisk dämpning, tvärströmsmotstånd, roder och djuproder med överstegring, tornets lyftkraft (ubåten krängar in i svängar) och en propeller med axeltröghet.
- **Grundstötning:** kontaktkrafter med fjäder, dämpare och friktion mot terrängen.

Ubåten är en generisk modern dieselelektrisk ubåt: 60 m lång, 6,2 m bred, ~1 530 t i undervattensläge. Den gör ~19 knop vid 2,9 MW och 240 rpm.

En utförlig beskrivning med ekvationer, källor och förenklingar finns i [docs/fysikmodell.md](docs/fysikmodell.md). Hur grafiken fungerar beskrivs i [docs/grafik.md](docs/grafik.md) och ljudet i [docs/ljud.md](docs/ljud.md). Alla parametrar finns samlade, med källa och enhet, i `src/sim/config/`.

## Utveckling

Projektet kräver Node.js 22 eller senare.

```bash
npm install
```

```bash
npm run dev
```

Öppna http://localhost:5173/ubatssim/ (sökvägen följer `base` i `vite.config.ts`).

```bash
npm test
```

```bash
npm run test:all
```

```bash
npm run lint
```

```bash
npm run build
```

```bash
npm run bench
```

- `npm test` kör de snabba testerna med Vitest (~20 s). `npm run test:all` kör också de långa scenario- och simuleringstesterna i `tests/long/` (~2 min), som publiceringen alltid kör. Fysiken testas utan grafik.
- `npm run lint` kör ESLint och kontrollerar bland annat att fysiklagret inte importerar Three.js eller DOM.
- `npm run build` gör typkontroll och produktionsbygge till `dist/`.
- `npm run bench` mäter fysikens tid per tidssteg. Lägg till `?perf` i adressen för att se tiden per bild i spelet. Budgeten finns i [docs/prestanda.md](docs/prestanda.md).

Testerna täcker bland annat:
- RK4:s konvergensordning, bevarad energi och rörelsemängdsmoment och determinism
- att en neutralt trimmad ubåt håller djupet, att en ubåt med tom huvudballast stiger och att energin inte växer utan drivkraft
- Boyles lag vid blåsning, toppfart, gir och roderhastighet
- kommandoparsern, orderkön och kvittona
- autopiloten (djup 120 m och kurs 270° utan stor översläng), också back: kurs- och djupändring, omslag mellan framåt och back
- propellern back (svagare dragkraft, varvtalsgräns, kontinuitet genom noll) och att skyddsnätet tittar akterut när ubåten backar
- besättningen: att besättningen dyker till 50 m och trimmar neutralt utan spelarens hjälp, att nödblåsningen löser ut, att övertagande och lämning sker utan ryck, att en order tar över rätt system, att låsningar vägras och att simuleringen fortfarande är deterministisk
- att varje scenario går att klara och att det misslyckas när det ska
- terrängen, grundstötning och navigering genom sundet
- havsområdena: att trycket är integralen av densiteten, saltsprångskiktet, sötvattnet i fjorden, fjordens tröskel och att alla startlägen och fyrar ligger rätt
- strömmen (drift, fart genom vattnet och över grund) och vågorna (signifikant våghöjd, rörelser i ytläge, lågtrycksblåsaren)
- periskopet, bryggan och vyerna
- ljudnivåerna från telemetrin, vilka händelser som ger larm och vad rösten läser upp
- fartygen, världen och kollisioner, att vågshadern ger fysikens yta och att genvägen i kontaktmodellen är exakt
- skärmkontrollerna (djupskala, kompass, Auto / Hand med roder och djuproder, telegraf, Dyk/Yta, panelerna Ballast, Trim och Fart), att tangenterna följer Auto / Hand och att inget scenariotips kräver konsolen
- spelflödet (sessioner, omstart, tillåtna övergångar, tidsstegsloopen) och gränssnittet (menyskärmar, instrumentpanel och escaping, med happy-dom).

## Projektstruktur

```
src/
  sim/        Fysiken. Ren TypeScript utan Three.js eller DOM, deterministisk.
    config/   Parametrar för ubåt, vatten, havsområden, sjögång och terräng (SI-enheter, källa per värde).
    systems/  Ubåtens delsystem: ställdon, huvudballast och tryckluft, pumpar, periskopmast.
              world/vessel: världen med ubåten och andra farkoster.
    math/     Vektorer, matriser (LU), quaternioner.
  control/    Order, orderkö, svensk kommandoparser, PID-autopilot, controller, besättningen (crew),
              trimassistent och skyddsnät, havsområdenas startlägen och fyrar, scenarier.
  render/     Three.js: ubåtsmodell i lager, terräng, vågor, fyrar, ljus och dimma, kameravyer.
  audio/      Syntetiserat ljud (Web Audio) och uppläsning: nivåer från telemetrin, ljudmotor, röst.
  ui/         Meny, instrumentpanel, konsol, logg, tangentbord, skärmkontroller (helm) och knappar, inställningar,
              vyer och deras overlay (kompassband, periskop). HTML byggs med mallar som escapar.
  game/       Spelsessioner, spelflödet (meny, spel, paus, slut), tidsstegsloopen och kopplingen till webbläsaren.
  main.ts     Uppstart.
tests/        Vitest.
docs/         Fördjupande dokumentation: fysikmodellen, grafiken, ljudet och prestandan.
public/       Ikoner (SVG, PNG för iOS och Android) och webbmanifest.
scripts/      make-mac-launcher.sh – bygger en Mac-genväg till spelet.
assets/       Källfil för ikonen utan rundade hörn (används för att rendera PNG-filerna).
```

## Genväg på Mac

`scripts/make-mac-launcher.sh` bygger `Ubåtssim.app`, ett litet macOS-program med spelets ikon som öppnar https://thohig.github.io/ubatssim/ i standardwebbläsaren. Programmet kan läggas i Dock.

```bash
scripts/make-mac-launcher.sh
```

Utan argument hamnar appen i `~/Projekt/Github Pages`. Ange en annan mapp som argument om du vill ha den någon annanstans:

```bash
scripts/make-mac-launcher.sh ~/Applications
```

Skriptet använder bara verktyg som följer med macOS:
- `qlmanage` renderar ikonen från `assets/icon-square.svg`.
- `iconutil` bygger `.icns`-filen.
- `osacompile` bygger appen av en enrads-AppleScript.
- `codesign` signerar appen ad hoc.

Kör skriptet igen om ikonen eller adressen ändras. Det ersätter då den gamla appen.

## Publicering

En push till `main` kör `.github/workflows/deploy.yml`, som kör lint, test och bygge och publicerar `dist/` till GitHub Pages. Pages-källan är "GitHub Actions".
