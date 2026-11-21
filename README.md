# Ubåtssim

En ubåtssimulator i 3D som körs i webbläsaren, på dator och mobil. Fokus ligger på realistisk simulering av en dieselelektrisk ubåt på cirka 60 m: flytkraft, ballast och tryckluft, trim, hydrodynamik, roder, propeller, batteri och dieslar, läckage, passiv sonar, torpeder och grundstötning. Grafiken är medvetet enkel.

**Spela:** https://thohig.github.io/ubatssim/

## Innehåll

- [Spelet](#spelet)
- [Besättningen och du](#besättningen-och-du)
- [Styrning](#styrning)
- [Vyer](#vyer)
- [Kommandokonsolen](#kommandokonsolen)
- [Instrumentpanelen](#instrumentpanelen)
- [Batteri, diesel och snorkling](#batteri-diesel-och-snorkling)
- [Läckage och skador](#läckage-och-skador)
- [Sonar, upptäckt och sjökort](#sonar-upptäckt-och-sjökort)
- [Anfall: mål, lösning och torpeder](#anfall-mål-lösning-och-torpeder)
- [Korvetter som jagar](#korvetter-som-jagar)
- [Scenarier](#scenarier)
- [Havsområden och väder](#havsområden-och-väder)
- [Ljud](#ljud)
- [Fysik i korthet](#fysik-i-korthet)
- [Utveckling](#utveckling)
- [Projektstruktur](#projektstruktur)
- [Genväg på Mac](#genväg-på-mac)
- [Publicering](#publicering)

## Spelet

Det finns ett spelläge. Varje spel börjar med att **besättningen sköter ubåten**, och du tar över det du vill sköta själv (se [Besättningen och du](#besättningen-och-du)).

**Startsidan** är utformad som en hemlig order, med ordernummer, stämpeln Hemligt och en fiktiv order som skrivs fram. Bakom menyn går ubåten i ytläge i skymning med en korvett vid sidan, och i fjärran faller sjunkbomber. Mörk, syntetiserad musik spelar (se [Ljud](#ljud)). Fyra val finns:

| Val | Innehåll |
|---|---|
| **Fritt spel** | Välj havsområde (Västerhavet, Östersjön, Fjorden, Atlanten), ljus och sikt (dag, skymning, natt, dimma), sjögång (lugnt, måttlig, grov) och startläge, till exempel ytläge, periskopdjup (13 m, kölen på 16 m) eller djupt vatten. |
| **Scenarier** | Uppdrag med mål och ledtrådar. |
| **Inställningar** | Tidskomprimering ×1/×2/×4, ljud (volym, maskiner och larm, hav och vind, uppläsning av order, musik på startsidan och musikvolym), loggboken, svävande partiklar och ljusstrålar under ytan. Inställningarna sparas i webbläsaren. |
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
| **Eldledning** | Eldledaren mäter avståndet till målet genom periskopet var 30:e sekund och föreslår kursbyten för målrörelseanalysen. | Du mäter avståndet själv (Avst eller R). Att skjuta är alltid din order. |
| **Laddning** | Maskinisten startar dieslarna och laddar batteriet när snorkeln är uppe eller ubåten ligger i ytläge, och stoppar dem när batteriet är fullt. | Du startar och stoppar dieslarna (El ▾). Att hissa snorkeln är alltid ditt beslut. |
| **Skyddsnät** | På: nödblåsning nära krossdjupet och när ubåten tagit in mycket vatten, djupgräns över botten och varning för grunt vatten. | Av. |

- **Ta över:** växla djup eller kurs till **Hand**, eller tryck på en knapp i panelerna **Ballast ▾**, **Trim ▾**, **Fart ▾** och **El ▾** (på mobil under **System ▾**). Panelens övre knapp lämnar systemet till besättningen igen. ☰ → **Besättning** visar alla system på ett ställe, med skyddsnätet.
- **Order tar över:** en manuell order tar över systemet den gäller, också i konsolen. `roder sb 10` sätter kursen på Hand, `trimma för 200` avlöser trimassistenten, `fyll hb` ger dig ballasten och `diesel start` laddningen. Ett djup- eller kursmål och telegrafen lämnar axeln till besättningen igen.
- **Djuprodren behöver fart:** deras kraft växer med farten i kvadrat, så vid 3 knop orkar de knappt ändra djupet. Har djuprodret legat i fullt utslag i 30 s utan att djupet ändrats, mer än 1 m från målet, säger djupstyraren till. Sköter besättningen farten ökar maskinen till 4 knop tills djupet är nått och går sedan tillbaka till din fart. Orkar rodren inte heller då, till exempel på periskopdjup i 3 knop med periskopet uppe, håller maskinen 4 knop tills du ändrar djup eller fart. Sköter du farten själv får du ett besked att öka till minst 4 knop.
- **Sväva utan fart:** är fartmålet högst 1 knop (Stopp eller tyst) ökar besättningen inte farten. I stället svävar den: gör ubåten några hundra kilo tung eller lätt med kompenseringen, så att den sjunker eller stiger 4–5 m i minuten, och gör den neutral i god tid före djupmålet, eftersom pumpen bara tar 6 liter i sekunden. 30 m tar ungefär 8–12 minuter. Djupvisningen visar "svävar". Det kräver att besättningen sköter djupet, farten och trimmet. Sköter du trimmet får du ett besked om att ändra djupet med In och Ut i panelen Trim. I språngskiktet blir ubåten lättare ju djupare den kommer, och på stort djup tyngre när skrovet trycks ihop: håll koll på Flytkraft.
- **Utan ryck:** tar du över djup eller kurs ligger rodren kvar där autopiloten hade dem. Lämnar du tillbaka dem sätts målen till nuvarande djup och kurs.
- **Instrumentpanelen** följer valen: tar du över kursen visas rodret, trimmet flytkraft och tankar, ballasten HP-luften, laddningen dieslarna, snorkeln och elförbrukningen.
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
| **Auto / Hand** | Vid djupskalan och kompassen | Vem som styr djupet och kursen. På mobil en knapp som visar Auto eller Hand (gul) och växlar vid tryck. |
| **Maskintelegraf** | Mitten | Full, Halv och Sakta back, Stopp, och Sakta, Halv och Full fram. Sakta och Halv är 2 och 4 knop back och 4 och 8 knop fram. Full back och Full fram är toppfarterna, 7 och 19 knop, så maskinen går för fullt (bakåt når ubåten ~6,8 knop, framåt 18,9, i Östersjöns bräckta vatten ~17). Läget som gäller lyser, och klockan slår vid varje ny order. På mobil är telegrafen ett reglage: tryck eller dra längs det, och läget skickas när du släpper. |
| **Dyk / Yta** | Mitten | En knapp som följer ballasten: Dyk när huvudballasten är tom, Yta när den fylls eller är full. |
| **Håll** | Mitten | Behåller nuvarande kurs och djup på Auto. |
| **Ballast ▾** | Mitten | Huvudballasttankarna med fyllnadsgrad, Fyll / Blås / Stäng för, akter och båda, bryggan (Klart bryggan, Bemanna) och HP-luften. |
| **Trim ▾** | Mitten | Flytkraft, stampvinkel, pumparna, kompenserings- och trimtankarna. Kompensera in / ut och trimma för / akter, 100 eller 500 liter. |
| **Fart ▾** | Mitten | Fart, varvtal och axeleffekt. Fartmålet ±1 knop, varvtalet ±10 rpm och Stopp. |
| **El ▾** | Mitten | Batteriets laddning, elförbrukningen, snorkeln (Upp / Ned), dieslarna (Start / Stopp) och länspumpen, med vattnet i varje avdelning som läcker. |
| **System ▾** | Mitten (bara mobil) | Öppnar panelen som visades senast. Flikarna Ballast, Trim, Fart och El byter panel. |

En panelknapp eller flik som du sköter själv är gul. Panelens flikar byter mellan de tre panelerna också på dator. Håll in ▲ ▼ ◀ ▶ och rodrens knappar så upprepas de, och fortare ju längre du håller.

Knapparna Vy, Per, Snork, Zoom och Brg uppe till höger gör samma sak som V, P, N, Z och B. **Vy** byter mellan yttre vy, brygga, periskop och genomskärning (C går direkt till snittet). Per och Snork visas när ubåten är grundare än 25 m eller en mast är uppe. Vy visas alltid: djupt byter den mellan yttre vy och snitt. **Karta** (K) och **Sonar** (H) öppnar sjökortet och sonaren (se [Sonar, upptäckt och sjökort](#sonar-upptäckt-och-sjökort)). Konsolen öppnas från loggboken (se [Kommandokonsolen](#kommandokonsolen)).

**Loggboken och konsolen** är ett: loggboken ligger överst i mitten, under målrutan, utan bakgrund. En ny rad syns en stund och tonas sedan ut och försvinner: kvitton efter 4 s, information efter 6 s och varningar och fel (röda) efter 10 s, långa rader lite längre. Högst tre rader syns samtidigt. När inget har hänt på en stund ligger ingenting över bilden. Tryck på loggen (eller på **›_ Logg** under den, eller Enter) för att öppna historiken (de senaste 100 raderna, som går att rulla) med konsolens skrivrad under, så att svaret på det du skriver syns ovanför. Esc eller ett tryck utanför stänger den.

**Logg** (eller L) döljer loggboken och visar den igen. Knappen lyser när loggen visas. Dold loggbok visar bara ett nytt felmeddelande, till exempel en vägrad order, i några sekunder. Loggen förs ändå och finns kvar när du visar den igen. Valet sparas och finns också under Inställningar ("Visa loggboken").

### Mobil

På skärmar som är smalare än 760 px eller lägre än 500 px är vyn avskalad, så att 3D-bilden får plats:

- **Statusraden** överst visar tid, fart genom vattnet, vatten under kölen (när det är under 300 m), trim, batteriet och, vid en läcka, vattnet som kommit in. Djup, kurs och beordrad fart syns redan på djupskalan, kompassen och telegrafen. Tryck på statusraden för hela instrumentpanelen och igen för att stänga den.
- **Loggboken** ligger under statusraden och målrutan (liggande: mellan statusraden och Vyer ▾). Varje rad kortas till två textrader, och hela texten finns i historiken.
- **Vyer ▾** uppe till höger fäller ut Vy, Per, Snork, Zoom, Brg, Karta, Sonar och Logg. Ett val fäller ihop dem igen.
- **Auto / Hand** är en knapp per axel, panelerna ligger under **System ▾** och telegrafen är ett reglage.
- **Stående telefon:** djupskalan till vänster, kompassen, Dyk / Håll / System till höger och telegrafen över hela bredden längst ner.
- **Liggande telefon:** djupet och knapparna under vänster tumme, kompassen och telegrafen under höger, och mitten fri. En panel öppnas i mitten under statusraden.

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
| Z | Periskopets förstoring, 1,5× / 6× (i genomskärningen: ovanifrån / från sidan) | Samma |
| C | Genomskärning på / av | Samma |
| + / − | Zooma genomskärningen | Samma |
| B | Rapportera bäringen dit periskopet eller blicken pekar | Samma |
| ← / → i periskopet | Vrid periskopet (Shift + ← / → styr) | Samma |
| Enter eller / | Öppna kommandokonsolen | Samma |
| Esc | Lämna konsolen eller en vy, eller pausa | Samma |
| T / R / F | Markera fartyget i hårkorset / mät avståndet / skjut (periskopet eller bryggan) | Samma |
| N | Snorkel upp / ned | Samma |
| G | Dieslarna start / stopp (tar över laddningen) | Samma |
| K / H | Sjökortet / sonaren | Samma |
| M | Ljud av / på | Samma |
| L | Visa / dölj loggboken | Samma |
| O | Visa / fäll ihop målrutan (scenarier) | Samma |

När konsolen är öppen visar lägesindikatorn överst **KONSOL**, och ↑/↓ bläddrar i kommandohistoriken. På mobil ersätts instrumentpanelen av statusraden (se [Mobil](#mobil)).

Mus och finger styr kameran: dra för att vrida och nyp eller scrolla för att zooma. Kameran följer ubåten.

### Back

Ubåten backar med telegrafen (Halv back), med Shift + ↓ förbi noll eller med `back halv` i konsolen. På Hand går det med negativt varvtal i panelen Fart. Instrumentpanelen visar då **BACK** framför farten, och maskintelegrafens klocka slår vid varje ny fartorder.

- **Stopp** gör som en besättning: maskinen backar för fullt tills farten är under ungefär 1 knop och går sedan till noll, utan att ubåten börjar gå bakåt. Från 8 knop står den still efter ~58 s och 156 m (från 19 knop ~90 s och 475 m).
- **Inbromsning:** medan ubåten fortfarande går framåt får drivningen backa med upp till 180 rpm, begränsad av motorns moment och effekt. Gränsen på 108 rpm gäller när ubåten går med aktern först.
- **Propellern** ger ungefär 60 % av dragkraften bakåt, och motorn tillåter högst 108 rpm back. Toppfarten bakåt blir ~6,8 knop (Full back), och det tar några minuter att komma upp i fart.
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
| **Genomskärning** | Utanför ubåten, som är uppskuren längs mittlinjen (från styrbord) eller genom övre däck (ovanifrån). | Alltid (Vy eller C) |

- **Bryggan** är bemannad i ytläge. Den måste utrymmas innan ubåten dyker:
  - Sköter besättningen ballasten utryms bryggan automatiskt när du trycker Dyk (D).
  - Sköter du ballasten själv trycker du Klart bryggan i panelen Ballast (eller `klart bryggan`). Annars vägrar ubåten att fylla huvudballasten.
  - Når vattnet över brygglisten utryms bryggan, och vyn byter till den yttre.
- **Lågtrycksblåsaren** går när bryggan är bemannad och håller huvudballasten torr i sjögång.
- **Genomskärningen** visar alla avdelningar utan människor: torpedrummet, manöverrummet (två däck: manövercentral med sonar och radio, pumprum och HP-luft), bostäder och batterirum (två däck), maskinrummet med två dieselgeneratorer och elmotorrummet med huvudmotorn. Utanför tryckskrovet syns sonardomen, huvudballasttankarna, tornet med masterna och bryggan, och akterpiken med styrmaskinerna.
  - **Det som rör sig:** vattnet i tankarna har en vågrät yta också när ubåten lutar. Bubblor syns när huvudballasten ventileras eller blåses, pilar när pumparna går, och HP-flaskorna lyser efter trycket. Axeln snurrar med propellern, och periskopmasten, rodren och djuprodren rör sig.
  - **Så används den:** dra för att vrida, och scrolla, nyp eller tryck + / − för att zooma. **Ovan** (Z) byter till snittet ovanifrån och **Hela** visar hela ubåten igen. Tryck på ett rum, en tank eller tornet, så markeras det, vyn zoomar dit och en ruta visar vad som finns där och läget just nu, till exempel tanknivå, pumpar, tryck på skrovet, HP-luft och motorvarv.
  - **Det som lever:** vatten i en läckande avdelning (med vågrät yta), batterierna som lyser grönt när de laddas och gult och rött när de tar slut, dieslarna som skakar när de går, torpedtubernas luckor (grönt laddad, gult under omladdning) och reservtorpederna på ställningarna.
  - **På små skärmar** döljs kontrollerna och instrumentpanelen medan snittet visas. Vy, C eller Esc går tillbaka.
- **Periskopet** tar 8 s att hissa. Vyn öppnas när det är uppe. Huvudet når över vattnet ner till ungefär 14 m djup i stilla sjö. I grov sjö kan vågtopparna skölja över det. Över 6 knop vibrerar bilden, och den våta masten ger motstånd.

## Kommandokonsolen

Konsolen öppnas med ett tryck på loggboken (eller **›_ Logg** under den), eller med Enter eller `/`. Den visar loggens historik med en skrivrad under. Den är ett annat sätt att ge order, för den som vill skriva exakta värden, och inget kräver den. En order tar över systemet den gäller, precis som en knapp (se [Besättningen och du](#besättningen-och-du)). Alla kommandon kvitteras i loggen med simuleringstid, till exempel `[00:03:12] Djup 120, ja`. Felaktiga kommandon ger ett felmeddelande som pekar ut fel ord och föreslår rätt form ("Menade du styrbord?").

| Kommando | Exempel | Funktion |
|---|---|---|
| `djup <m>` | `djup 120` | Djupautopilot |
| `kurs <grader>` | `kurs 270` | Kursautopilot |
| `fart <knop> [knop]` | `fart 8 knop`, `fart stopp` | Fartautopilot |
| `back <knop>\|sakta\|halv\|full` | `back 3`, `back halv` | Fartautopiloten back: sakta 2, halv 4 och full 7 knop (toppfarten bakåt). Samma som `fart -4`. |
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
| `snorkel upp\|ned` | `snorkla` | Hissa eller sänk snorkeln |
| `mål <grader>\|S<n>\|M<n>` | `mål 245`, `mål S1`, `mål M2` | Markera fartyget i en bäring (periskopet eller bryggan), gör en sonarkontakt till mål, eller välj ett mål |
| `avstånd [<m>]` | `avstånd`, `avstånd 1800` | Mät avståndet till målet med stadimetern, eller ange det |
| `skjut [<tub>]` | `skjut`, `skjut 2` | Skjut mot målet (en salva enligt spridningen) |
| `spridning 1\|2\|3` | `spridning 2` | Torpeder per salva |
| `diesel start\|stopp` | `ladda`, `diesel stopp` | Starta eller stoppa dieslarna. De går bara med luft: i ytläge eller med snorkeln uppe. |
| `bäring <grader>` | `bäring 63` | Rapportera bäringen till något du ser genom periskopet eller från bryggan |
| `trimma för\|akter <liter>` | `trimma för 200` | Pumpa vatten mellan trimtankarna |
| `kompensera in\|ut <liter>` | `kompensera ut 300` | Ta in vatten eller pumpa ut det |
| `autopilot på\|av [djup\|kurs\|fart]` | `autopilot av`, `ap på djup` | Slå på eller av autopilot (samma som Auto / Hand) |
| `besättning <system>\|allt` | `besättning trim` | Lämna djup, kurs, fart, ballast, trim, laddning, eldledning eller skyddsnät till besättningen |
| `själv <system>\|allt` | `själv ballast`, `själv skyddsnät` | Ta över systemet själv (skyddsnät: stäng av det) |
| `hjälp` | | Visa listan |

Kommandona tolererar alias (`sb`, `bb`, `hb`, `kn`, `ap`), decimalkomma (`djup 45,5`), enheter (`120 m`, `10°`) och ett inledande `/`.

## Instrumentpanelen

- **Djup, fart och kurs:** med målet (→) när besättningen sköter dem. I ytläge visar djupet "→ yta": ubåten flyter och djuprodret ligger i noll. Farten är farten genom vattnet, som loggen mäter.
- **Stampvinkel och krängning.**
- **Under köl:** ekolodets djup under kölen. Rött under 5 m och vid grundstötning.
- **Roder och djuproder:** verkligt utslag och kommenderat utslag (orange markering). Rodren rör sig med begränsad hastighet, ~4°/s.
- **Trim:** Tung, Neutral eller Lätt (±100 kg), och Ytläge när ubåten inte är helt nedsänkt.
- **Batteri:** laddningen i procent, "↑ laddas" när dieslarna laddar. Gul under 30 %, röd under 10 %.
- **Vatten inne:** visas när ubåten läcker, med inflödet i l/s.
- **Det du sköter själv** visas i huvudpanelen: djuproder och stampvinkel på Hand, roder på Hand, varvtal och effekt för farten, flytkraft och tankar för trimmet, tankar och HP-luft för ballasten, dieslar, snorkel och elförbrukning för laddningen.
- **Under "Mer":** djupändring, fart och kurs över grund, strömmen, varvtal, axeleffekt, elförbrukning, dieslar, snorkel, vatten inne, nivån i varje tank, ventil- och blåsstatus, HP-luftens tryck och flytkraftsöverskott (+ = lätt, − = tung).

## Batteri, diesel och snorkling

Under vattnet går ubåten på batteriet. Det rymmer 6 MWh och är fulladdat när spelet börjar.

- **Förbrukning:** elmotorn (axeleffekten / 92 %), hotellasten (60 kW: ljus, ventilation, elektronik) och länspumpen. Vid 4 knop räcker batteriet i ungefär två dygn, vid 8 knop i 16 timmar och vid full fart under två timmar.
- **Tomt batteri:** motorn får bara det dieslarna ger. Utan dieslar stannar propellern.
- **Laddning:** två dieselgeneratorer ger tillsammans 1,2 MW. De behöver luft: i ytläge, eller på periskopdjup med **snorkeln** uppe (Snork, N eller `snorkel upp`). Snorkelns huvud når över vattnet till ungefär 14 m djup. Sköljer en våg över huvudet stängs ventilen, och dieslarna går några sekunder på luften i båten innan de stannar. Över 80 % tar cellerna emot allt mindre laddning.
- **Varningar** i loggen vid 30, 15 och 5 % och när batteriet är tomt.
- **Snorkling syns och hörs:** masten och avgaserna syns långt, och dieslarna är högljudda (se [Sonar, upptäckt och sjökort](#sonar-upptäckt-och-sjökort)).

## Läckage och skador

Vatten kan tränga in i tryckskrovets avdelningar genom hål. Inflödet är Q = Cd·A·√(2Δp/ρ), så det växer med djupet.

- **Hål uppstår** vid en hård grundstötning (över ~2 knop: fören, aktern eller kölen efter rörelseriktningen), vid kollision med ett fartyg (manöverrummet under tornet) och under krossdjupet 300 m (maskinrummet, mer ju djupare). På 360 m kollapsar skrovet.
- **Besättningen tätar** varje hål med en tidskonstant på 150 s, utom under krossdjupet. **Länspumpen** tar 20 l/s vid ytan och allt mindre ju djupare. På 250 m orkar den inte alls. Gå alltså grundare, så tätar besättningen fortare än vattnet kommer in.
- **Vattnet väger:** det ligger i avdelningens botten och gör ubåten tyngre där. Över 15 ton varnar loggen, och skyddsnätet blåser huvudballasten.
- **Följder:** ett maskinrum som är vattenfyllt till 30 % stoppar dieslarna, och ett elmotorrum till 30 % stoppar motorn.
- **Visas** i statusraden (LÄCKA), i instrumentpanelen, i panelen El ▾ och i genomskärningen, och hörs som ett väsande och länspumpens surr.

Grundstötning och kollision gör fortfarande att ett scenario misslyckas.

## Sonar, upptäckt och sjökort

**Sonaren** lyssnar passivt med bogens hydrofoner. Varje fartyg vars ljud når fram över bruset blir en kontakt (S1, S2 …) med bäring. Efter 20 s klassar operatören den efter propellern, till exempel "S1 är troligen ett lastfartyg (4 blad, 120 rpm)". En kontakt som inte hörs på 20 s tappas.

- **Sonarekvationen:** källans ljudnivå minus utbredningsförlusten (sfärisk spridning, absorption och 20 dB för varje skikt mellan källa och mottagare) minus bruset. Bruset kommer från havet och från ubåtens egen fart. Fort är alltså både högljutt och dövt.
- **Sonarvyn** (Sonar, H) är ett vattenfall: bäringen från fören tvärs över, tiden nedåt, starkare signal ljusare. Under den syns kontakterna, ubåtens egen ljudnivå och risken att bli upptäckt.

**Att bli upptäckt:** en korvett lyssnar med sin skrovsonar och ser med utkik och radar. Den märker ubåten mer ju starkare ubåtens ljud når fram, och när ett periskop (inom 3,5 km), en snorkel (inom 6 km) eller tornet i ytläge (inom 12 km) syns. Annars glömmer den långsamt.

- **Ubåtens ljud** växer med farten (30 log), med kavitation över 6 knop + 1 knop per 10 m djup, och med 24 dB när dieslarna går.
- **Varning** i loggen när en korvett kan ha hört eller sett något, och ett larm när den har upptäckt ubåten. Då börjar den jaga (se [Korvetter som jagar](#korvetter-som-jagar)). I scenariot Smyg förbi misslyckas uppdraget.
- **Så smyger man:** gå sakta, djupt och under språngskiktet, och håll masterna nere.

**Sjökortet** (Karta, K) visar också målen med lösningens position och kurs (romber, färgade efter kvaliteten) och torpederna i vattnet. Det har norr uppåt och ubåten i mitten, med fyra skalor (− / +). Det visar djupet ur samma botten som fysiken använder, spåret, bojen (eller en pil mot den), fyrarna, sonarens bäringar som streckade linjer och fartyg i sikte från periskopet eller bryggan.

## Anfall: mål, lösning och torpeder

Periskopet är eldledningens öga. I periskopvyn (och på bryggan) ligger eldledningspanelen vid sidan av periskopbilden, med **Mål**, **Avst**, spridningen, **Fyr** och tuberna. Den visas också medan sjökortet eller sonaren är öppen.

1. **Mål** (T): sätt hårkorset på ett fartyg och tryck Mål. Det blir ett mål (M1, M2 …) med en exakt bäring. En sonarkontakt blir mål med ett tryck på den i sonarlistan (eller `mål S1`). Då följer eldledningen dess bäringar var tionde sekund.
2. **Avst** (R): stadimetern mäter avståndet med fartyget i hårkorset. Felet är ~8 % vid 1,5× och ~3 % vid 6×, och på bryggan ~12 % (ögonmått). Sköter besättningen eldledningen mäter eldledaren själv var 30:e sekund medan målet syns.
3. **Lösningen** är målets position, kurs och fart, räknad med minsta kvadrat ur alla bäringar och avstånd (målrörelseanalys). Kvaliteten är dålig, ok eller bra. Bäringar från sonaren ger avståndet först när ubåten har bytt kurs: två ben med minst 30° emellan. Panelen visar avstånd, kurs, fart, kvalitet, skjutkurs och gångtid.
4. **Fyr** (F): torpeden går mot träffpunkten, där den och målet möts. Den går 40 knop, räcker 10 km och söker passivt de sista 600 m inom ±30°, med samma akustik som sonaren. Den träffar under målets vattenlinje, och fartyget sjunker. **Spridning** 2 eller 3 skjuter flera torpeder med 3° emellan, för en sämre lösning.
5. **Tuberna:** fyra förtuber, och åtta torpeder i stället. Omladdningen tar 2 minuter per tub, en i taget.

Avfyrningen hörs långt: en korvett i närheten vet ungefär var du är och börjar söka.

## Korvetter som jagar

En korvett har fyra lägen, som loggen och sonarvyn berättar om:

| Läge | När | Vad den gör |
|---|---|---|
| **Patrull** | Från start | Följer sin rutt |
| **Misstanke** | Har hört eller sett något (vetskap 0,5) | Saktar in för att höra bättre och svänger mot bäringen |
| **Sök** | Vetskap 0,8, eller en torpedavfyrning hörd | Går till där den tror att du är och söker i en växande fyrkant med **aktiv sonar** (pingar var 12:e sekund, som hörs i skrovet). Ett eko ger din position och ditt djup. |
| **Anfall** | Ekot, eller full vetskap | Går över positionen och fäller fyra **sjunkbomber**, inställda på djupet den mätte. Vänder och pingar igen. |

- **Passivt hör den bäringen men inte avståndet**, så positionen den tror på har ett fel på 10–50 % av avståndet.
- **Aktiv sonar** når 3 km, men skiktet dämpar ekot kraftigt (20 dB per väg), och den egna farten gör korvetten döv. Under skiktet hittar en sökande korvett dig inom några hundra meter. Akterut ser sonaren inget.
- **Sjunkbomberna** ger ett stort hål inom 8 m och ett mindre ut till 40 m, i avdelningen närmast explosionen (se [Läckage och skador](#läckage-och-skador)). Korvetten har 24.
- **Den ger upp** när den inte haft kontakt på fem minuter, eller när sjunkbomberna är slut.
- **Så kommer du undan:** gå djupt under skiktet, sakta (4 knop), byt kurs och byt djup när den går över dig.

## Scenarier

| Scenario | Svårighet | Mål |
|---|---|---|
| Första dykningen | lätt | Guidad övning: klara bryggan, fyll huvudballasten, dyk till 30 m, trimma neutralt och gå till ytläge igen. |
| Trimövning | medel | Håll 50 m ±2 m i tre minuter utan djupautopilot. |
| Språngskiktet | medel | Dyk genom termoklinen till 90 m och kompensera för att ubåten blir lättare där. |
| Sväva | medel | Från 30 m till 80 m under språngskiktet utan fart (högst 1 knop): bara kompenseringen ändrar djupet. Håll sedan 80 m i två minuter. |
| Back | lätt | Backa 450 m till en boj rakt akterut och stanna vid den, utan att vända ubåten. |
| Genom sundet | medel | Gå i ytläge genom ett smalt sund i skärgården till en gul boj, utan att gå på grund. |
| Nödblåsning | svår | Ubåten är flera ton för tung på 200 m. Nå ytan innan krossdjupet 300 m. |
| Periskopspaning | medel | Ta ut bäringen till en fyr genom periskopet. Periskopet får inte synas mer än 60 s i taget. |
| Fyrljuset | medel | Natt: gå i ytläge mot en röd fyr tills den är 700 m bort. |
| Saltsprånget | svår | Östersjön: dyk genom saltsprångskiktet till 90 m och kompensera för de tonnen ubåten blir lättare. |
| Fjordinloppet | svår | Ta dig i undervattensläge över fjordens tröskel (55 m) och in till en boj, utan att gå grundare än 15 m. |
| Fartyget | medel | Ta ut bäringen till ett lastfartyg genom periskopet, utan att bli sedd eller komma i vägen för det. |
| Snorkling | medel | Atlanten: batteriet är på 25 %. Gå upp på periskopdjup, hissa snorkeln och ladda till 30 % utan att bryta ytan. |
| Smyg förbi | svår | Atlanten: hör en patrullerande korvett på sonaren, gå under språngskiktet och smyg fram till en boj 2,5 km bort utan att bli upptäckt. |
| Läckan | svår | Atlanten: maskinrummet läcker på 120 m. Gå upp så att länspumpen hinner med, och vänta tills läckan är tätad och rummet länsat. |
| Övningsskott | medel | Atlanten: markera ett målfartyg i periskopet, mät avståndet, få en lösning och träffa. |
| Nattanfall | svår | Natt: gör en sonarkontakt till mål, byt kurs så att bäringarna ger avstånd, och sänk fartyget. |
| Jagad | svår | En korvett anfaller. Gå djupt och tyst och klara dig tills den tappar dig eller har slut på sjunkbomber. |
| Konvojen | svår | Sänk ett lastfartyg med en korvett som eskort, och ta dig sedan undan eskorten. |

Innan ett scenario börjar visar **genomgången** uppdraget, alla mål i ordning (med hålltid), förhållandena, tidsgränsen och vem som sköter vad. Därifrån kan du ändra besättningen innan du trycker **Till sjöss**. Starta om hoppar över genomgången.

Under spelet är **målrutan** överst i mitten en enda rad: målets nummer, målet, hålltiden och bojens avstånd och bäring. Ett tryck på den, eller O, visar tipset och hela listan med avklarade mål (✓). Rutan öppnas också av sig själv i 6 s när ett nytt mål börjar eller tipset ändras (när du tar över eller lämnar systemet målet gäller), och fälls sedan ihop igen. Öppnad med ett tryck fälls den ihop efter 10 s.

Ett scenario misslyckas om ubåten går på grund, kolliderar med ett fartyg, tar in mer än 120 m³ vatten eller skrovet kollapsar. Ledtrådarna anpassas efter vem som sköter systemet målet gäller. I Trimövning sköter du djupet (Hand) och trimmet själv, och i Nödblåsning finns inget skyddsnät. Allt annat väljer du.

## Havsområden och väder

| Område | Terräng | Vatten | Ström |
|---|---|---|---|
| **Västerhavet** | Öppet hav (280–375 m) och Bohusläns skärgård från ~2 km österut: granithällar, kobbar och 20–50 m djupa sund. | Salt (1 025 kg/m³), språngskikt på 40–70 m. | Baltiska strömmen, 0,25 m/s norrut vid ytan. |
| **Östersjön** | Grundare hav (110–130 m) och en låg skärgård från ~3 km österut. | Bräckt (1 005 kg/m³). Saltsprångskikt på 60–80 m, där vattnet blir 2,4 kg/m³ tätare. | Svag, 0,1 m/s. |
| **Fjorden** | En fjord som går norrut mellan 300 m höga berg. Tröskel på 55 m vid mynningen, 380 m djup bassäng innanför. | Sötare ytskikt (1 012 kg/m³) ovanpå atlantvatten under 9 m. | Ytvattnet strömmar ut, 0,4 m/s söderut i de översta metrarna. |
| **Atlanten** | Djuphav, ~1 800 m. Ingen botten inom räckhåll. | Salt och kallt (1 027 kg/m³). | Nordatlantiska strömmen, 0,3 m/s mot nordost, ända ner till djupet. |

- **Trafik:** i fritt spel går fartyg i varje område: lastfartyg, färjor och fiskebåtar, och i Östersjön en patrullerande korvett. De följer sina rutter, har lanternor i mörker och dimma och hörs genom skrovet när de är nära. Kollision med ett fartyg loggas. Torpederna fungerar också i fritt spel, och korvetten i Östersjön jagar den som avslöjar sig.
- **Barlast:** ubåtens fasta barlast är anpassad för området, som när en marin flyttar en ubåt mellan hav. Den är alltså neutral på konstruktionsdjupet i alla områden. Skillnaden märks i skikten, till exempel att ubåten blir flera ton lättare under Östersjöns saltsprångskikt, och att den flyter något djupare i fjordens sötvatten.
- **Ljusstrålar** faller ner från ytan på dagen och tonas ut mot 70 m. De kan stängas av i Inställningar.
- **Under vattnet:** varje område har sitt vatten. Östersjön är grönt och grumligt, fjorden grönbrun och Atlanten klar och blå. Det mörknar med djupet.
- **Ljus och sikt:** dag (sikt ~15 km), skymning (mörkrött ljus, lanternorna tänds), natt (~5 km) eller dimma (~200 m). På natten syns fyrarna, som blinkar med sin egen karaktär, långt innan land syns.
- **Sjögång:** lugnt, måttlig sjö (Hs 1,25 m) eller grov sjö (Hs 3 m). Vågorna påverkar flytkraften i ytläge, periskopet och bryggan. Djupare ner märks de inte.

Terrängen ingår i fysiken. Ubåten kan gå på grund, och det man ser i 3D är det man kan krocka med.

## Ljud

Allt ljud syntetiseras i webbläsaren och följer simuleringen:

- **Ubåten:** elmotorn och propellern följer varvtalet, strömningsbruset farten och kavitationen hörs vid högt varv nära ytan. Rodren surrar när de rör sig, och skrovet knakar när trycket ändras.
- **System:** ventilering, vatten som strömmar in, blåsning, pumpar, masternas motor, lågtrycksblåsaren och dieslarna hörs medan de arbetar. En läcka väser, och länspumpen surrar.
- **Strid:** tubens tryckluft vid avfyrning, en avlägsen smäll vid träff, korvettens aktiva sonar som pingar mot skrovet och sjunkbomber som smäller nära.
- **Larm och signaler:** grundstötning, läckage, ekolodets pip när det är mindre än 10 m under kölen, krossdjupet, vatten över bryggan, nödblåsning, klara mål och uppdragets resultat.
- **Omgivningen:** vind och vågor efter sjögången, måsar på dagen nära land och mistlur i dimma. Under vattnet låter ljudet utifrån dovt.
- **Röst:** spelarens order, larm och klara mål kan läsas upp med en svensk röst. Det slås på i inställningarna.

- **Startsidan:** mörk och hotfull musik, syntetiserad och utan loopar: en bottenton, långsamma ackord i moll, avlägsna sonarpingar, en trumpuls som växer, hornsignaler, radio med morse och sjunkbomber i serier. Bakom menyn går ubåten i skymning med en korvett vid sidan, och sjunkbomberna slår upp vattenpelare. Musiken slås av och dess volym ändras under Inställningar.

Ljudet startar vid första tryck, eftersom webbläsare kräver det, och är tyst i paus. Musiken hörs på startsidan och under ett scenarios genomgång. Mer om ljudet finns i [docs/ljud.md](docs/ljud.md).

## Fysik i korthet

- **Rörelser:** 6 frihetsgrader enligt Fossens rörelseekvationer för undervattensfarkoster. Orienteringen är en quaternion, och integrationen sker med RK4 och ett fast tidssteg på 100 Hz. Simuleringen är deterministisk.
- **Flytkraft:** skrovet är uppdelat i 80 cirkulära skivor, och den nedsänkta delen av varje skiva räknas exakt. Samma modell ger flytkraft, flytcentrum och rätande moment i ytläge, halvt nedsänkt och helt nedsänkt läge.
- **Vatten och skrov:** vattnets densitet beror på havsområdet, djupet och skikten. Trycket är den exakta integralen av densiteten. Skrovet trycks ihop med djupet.
- **Ström och vågor:** de hydrodynamiska krafterna räknas mot vattnet, inte mot botten. Vågorna är en summa av sju reguljära vågor, och varje skiva av skrovet räknas mot den lokala vattenytan. I ytläge dämpas hiv och stamp av de vågor skrovet själv strålar ut.
- **Tankar som data:** två huvudballasttankar, två trimtankar och en kompenseringstank. Massa, tyngdpunkt och tröghet räknas om från tankarnas innehåll varje tidssteg.
- **Tryckluft:** HP-luften följer Boyles lag. Luften i huvudballasten expanderar när ubåten stiger och trycks ihop när den dyker.
- **Periskop och snorkel:** masterna hissas på 8 och 10 s och ger motstånd i vattnet.
- **Batteri och dieslar:** batteriets laddning följer motorns, hotellastens och länspumpens förbrukning och dieselgeneratorernas laddning. Dieslarna behöver luft. Med tomt batteri får motorn bara det generatorerna ger.
- **Läckage:** vatten genom hål i tryckskrovets avdelningar efter trycket, länspumpen och besättningens tätning. Vattnet är punktmassor i avdelningarna.
- **Akustik:** sonarekvationen med källnivåer, spridning, absorption, skikten i vattnet och brus. Den styr både sonaren och korvetternas lyssnande.
- **Torpeder och sjunkbomber:** kinematiska och deterministiska, som fartygen. Torpeden svänger till sin kurs, går rakt och söker passivt på slutet. Sjunkbomberna sjunker 3,5 m/s och ger hål efter avståndet.
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

- `npm test` kör de snabba testerna med Vitest (~30 s). `npm run test:all` kör också de långa scenario- och simuleringstesterna i `tests/long/` (~2,5 min på 4 kärnor), som publiceringen alltid kör. Testerna är processorbundna och körs med en arbetare per kärna (`maxWorkers: '100%'`). Fysiken testas utan grafik.
- `npm run lint` kör ESLint och kontrollerar bland annat att fysiklagret inte importerar Three.js eller DOM.
- `npm run build` gör typkontroll och produktionsbygge till `dist/`.
- `npm run test:e2e` bygger och kör spelet i Chromium med Playwright (`tests/e2e/`, ~1 min): genomgången och målrutan, paus, att panelerna inte överlappar på dator och mobil, att eldledningspanelen inte täcker hårkorset, förlorad grafik och felrutan. Första gången: `npx playwright install chromium-headless-shell`.
- `npm run bench` mäter fysikens tid per tidssteg. Lägg till `?perf` i adressen för att se tiden per bild i spelet. Budgeten finns i [docs/prestanda.md](docs/prestanda.md).

**Om något går fel** pausas spelet och en ruta visar felet med en felrapport (meddelandet, läget, simuleringstiden och webbläsaren, inget personligt) som kan kopieras. Därifrån går det att starta om, ladda om sidan eller gå till huvudmenyn. Tar webbläsaren tillbaka grafikkortet, till exempel när en flik på mobilen legat i bakgrunden, pausas spelet tills grafiken är tillbaka.

Testerna täcker bland annat:
- RK4:s konvergensordning, bevarad energi och rörelsemängdsmoment och determinism
- att en neutralt trimmad ubåt håller djupet, att en ubåt med tom huvudballast stiger och att energin inte växer utan drivkraft
- Boyles lag vid blåsning, toppfart, gir och roderhastighet
- kommandoparsern, orderkön och kvittona
- autopiloten (djup 120 m och kurs 270° utan stor översläng, stigning till periskopdjup vid 4 knop utan att bryta ytan), också back: kurs- och djupändring, omslag mellan framåt och back
- batteriet (förbrukning efter fart, energibalans, tomt batteri), dieslarna och snorkeln (luft, en våg över huvudet, laddning och avtagande laddning nära fullt)
- läckage (inflöde efter trycket, vattnets massa, länspumpen, tätning, grundstötning, kollision, krossdjup och kollaps)
- akustiken och sonaren (spridning och skikt, ubåtens ljud, kontakter, bäring och klassning) och att en korvett upptäcker en högljudd ubåt men inte en tyst under skiktet
- målrörelseanalysen (ett ben ger ingen lösning, två ben ger kurs, fart och avstånd, avståndsmätningar), träffpunkten, anfallet genom periskopet (markera, mät, skjut, träffa, ladda om), spridning, en torped som går under en grund båt, sjunkbomber och korvettens lägen
- propellern back (svagare dragkraft, varvtalsgräns, kontinuitet genom noll) och att skyddsnätet tittar akterut när ubåten backar
- besättningen: att besättningen dyker till 50 m och trimmar neutralt utan spelarens hjälp, att nödblåsningen löser ut, att övertagande och lämning sker utan ryck, att en order tar över rätt system, att låsningar vägras och att simuleringen fortfarande är deterministisk
- att varje scenario går att klara och att det misslyckas när det ska
- determinismen: "Jagad" körs i 4 minuter med fasta order två gånger och ska ge exakt samma tillstånd, och samma som en sparad referens per plattform
- svävningen: djupbyten utan fart genom språngskiktet, uppåt och på djupt vatten, att djupet hålls efteråt, att svävningen slutar när farten kommer tillbaka och beskedet till en spelare som sköter trimmet
- startsidans musik: partiturets delar, att alla toner ligger i D frygisk, att sjunkbomberna bara kommer i anfallet och att samma frö ger samma partitur; demons korvett och vattenpelare
- frigörandet på grafikkortet (`disposeTree` och fartygen), felrutan och rutan för förlorad grafik
- genomgången före ett scenario och målrutan (utfälld vid start, ihopfälld efter en stund, öppen vid tryck, nytt mål och nytt tips)
- terrängen, grundstötning och navigering genom sundet
- havsområdena: att trycket är integralen av densiteten, saltsprångskiktet, sötvattnet i fjorden, fjordens tröskel och att alla startlägen och fyrar ligger rätt
- strömmen (drift, fart genom vattnet och över grund) och vågorna (signifikant våghöjd, rörelser i ytläge, lågtrycksblåsaren)
- periskopet, bryggan och vyerna
- genomskärningen: att all inredning ligger inom sin avdelning och tryckskrovet, att vattenytan i en lutande tank fyller rätt volym, att ett tryck hittar rätt utrymme och att informationsrutan har något att säga om varje utrymme
- ljudnivåerna från telemetrin, vilka händelser som ger larm och vad rösten läser upp
- fartygen, världen och kollisioner, att vågshadern ger fysikens yta och att genvägen i kontaktmodellen är exakt
- skärmkontrollerna (djupskala, kompass, Auto / Hand med roder och djuproder, telegraf, Dyk/Yta, panelerna Ballast, Trim och Fart), att tangenterna följer Auto / Hand och att inget scenariotips kräver konsolen eller nämner en panelknapp
- mobilvyn: telegrafreglaget, Auto / Hand-knappen, System ▾ med flikarna, Vyer ▾ och statusraden
- loggboken: radernas livslängd, högst tre rader, uttoning och historiken
- panelen El, sjökortet och sonarvyn, knapparna Karta och Sonar, eldledningspanelen i periskopvyn
- spelflödet (sessioner, omstart, tillåtna övergångar, tidsstegsloopen) och gränssnittet (menyskärmar, instrumentpanel och escaping, med happy-dom)
- i en riktig webbläsare (Playwright, `tests/e2e/`): genomgången och målrutan, paus, att panelerna inte överlappar på dator och mobil, att eldledningspanelen inte täcker hårkorset, förlorad och återställd grafik, felrutan och hela startsidans musik med ljudet igång.

## Projektstruktur

```
src/
  sim/        Fysiken. Ren TypeScript utan Three.js eller DOM, deterministisk.
    config/   Parametrar för ubåt, vatten, havsområden, sjögång och terräng (SI-enheter, källa per värde).
    systems/  Ubåtens delsystem: ställdon, huvudballast och tryckluft, pumpar, master (periskop och snorkel),
              el (batteri och dieslar) och läckage.
              world/vessel: världen med ubåten, andra farkoster, torpeder och sjunkbomber. acoustics: sonarekvationen.
    math/     Vektorer, matriser (LU), quaternioner.
  control/    Order, orderkö, svensk kommandoparser, PID-autopilot, controller med orderregistret (orderRegistry) och maskinens händelser (plantWatch), besättningen (crew),
              trimassistent och skyddsnät, sonaren och upptäckten, eldledningen (målrörelseanalys, tuber),
              korvetternas jakt, havsområdenas startlägen och fyrar, scenarier.
  render/     Three.js: ubåtsmodell i lager, genomskärning med inredningen som data, terräng, vågor,
              fyrar, ljus och dimma, vattnet per område, bubblor, kölvatten, plym och avgaser, kameravyer.
  audio/      Syntetiserat ljud (Web Audio) och uppläsning: nivåer från telemetrin, ljudmotor, röst.
  ui/         Meny, instrumentpanel, statusrad (mobil), konsol, logg, tangentbord, skärmkontroller (helm/) och knappar, inställningar,
              vyer och deras overlay (kompassband, periskop), sjökort och sonar. HTML byggs med mallar som escapar.
  game/       Spelsessioner, spelflödet (meny, spel, paus, slut), tidsstegsloopen och kopplingen till webbläsaren.
  main.ts     Uppstart.
tests/        Vitest. tests/long/ de långa, tests/e2e/ Playwright i en riktig webbläsare.
docs/         Fördjupande dokumentation: fysikmodellen, grafiken, ljudet, prestandan och idéer (ideer.md).
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
