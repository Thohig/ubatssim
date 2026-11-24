# Ubåtssim

En ubåtssimulator i 3D som körs i webbläsaren, på dator och mobil. Fokus ligger på realistisk simulering av en dieselelektrisk ubåt på cirka 60 m: flytkraft, ballast och tryckluft, trim, hydrodynamik, roder, propeller, batteri och dieslar, läckage, passiv sonar, torpeder och grundstötning. Grafiken är medvetet enkel.

**Spela:** https://thohig.github.io/ubatssim/

## Innehåll

- [Spelet](#spelet)
- [Besättningen och du](#besättningen-och-du)
- [Styrning](#styrning)
- [Vyer](#vyer)
- [Stigning, ballast och fart](#stigning-ballast-och-fart)
- [Instrumentpanelen](#instrumentpanelen)
- [Batteri, diesel och snorkling](#batteri-diesel-och-snorkling)
- [Läckage och skador](#läckage-och-skador)
- [Sonar, upptäckt och sjökort](#sonar-upptäckt-och-sjökort)
- [Aktiv sonar och radar](#aktiv-sonar-och-radar)
- [Anfall: mål, lösning och torpeder](#anfall-mål-lösning-och-torpeder)
- [Torpedrummet](#torpedrummet)
- [Korvetter som jagar](#korvetter-som-jagar)
- [Scenarier](#scenarier)
- [Havsområden och väder](#havsområden-och-väder)
- [Livet i havet och på land](#livet-i-havet-och-på-land)
- [Ljud](#ljud)
- [Fysik i korthet](#fysik-i-korthet)
- [Utveckling](#utveckling)
- [Projektstruktur](#projektstruktur)
- [Genväg på Mac](#genväg-på-mac)
- [Publicering](#publicering)

## Spelet

Det finns ett spelläge. Varje spel börjar med att **besättningen sköter ubåten**, och du tar över det du vill sköta själv (se [Besättningen och du](#besättningen-och-du)).

**Startsidan** är utformad som en färdorder, med ordernummer, stämpeln Övning och en fiktiv order som skrivs fram. Bakom menyn glider ubåten förbi på nära håll under vattnet, i dagsljus nära ytan där solstrålarna syns. Lugn, syntetiserad musik spelar (se [Ljud](#ljud)). Fyra val finns:

| Val | Innehåll |
|---|---|
| **Fritt spel** | Välj havsområde (Västerhavet, Östersjön, Fjorden, Atlanten), ljus och sikt (dag, skymning, natt, dimma), sjögång (lugnt, måttlig, grov) och startläge, till exempel ytläge, periskopdjup (13 m, kölen på 16 m) eller djupt vatten. Där en korvett patrullerar (Östersjön) kan du välja **Korvetter: Inga** för ett fredligt spel med bara civil trafik. |
| **Scenarier** | Uppdrag med mål och ledtrådar. |
| **Inställningar** | Tidskomprimering ×1/×2/×4/×8/×16, ljud (volym, maskiner och larm, hav och vind, uppläsning av order, musik på startsidan och musikvolym), svävande partiklar och ljusstrålar under ytan. Inställningarna sparas i webbläsaren. |
| **Hjälp** | Besättningen, kontrollerna, tangenterna, scenarierna, anfallet och tips. |

På iPhone och iPad kan spelet läggas på hemskärmen via Safaris Dela-meny ("Lägg till på hemskärmen"). Då startar det i helskärm med egen ikon.

Under spelet pausar du med ☰-knappen eller Esc. Pausmenyn visar vem som sköter vad och har Fortsätt, Besättning, Loggbok, Starta om, Inställningar, Hjälp och Huvudmeny. Spelet pausas också automatiskt när fliken döljs.

## Besättningen och du

Du väljer **fart** på telegrafen, **kurs** på kompassen och **djup**: Yta, Periskop eller vilket djup som helst. **Besättningen** bestämmer själv hur det ska gå till, utifrån läget: roder, djuproder, ballast, trim, fart, inbromsning och back. **Planraden** ovanför telegrafen säger vad den gör ("Går ned till 100 m.", "Väntar på periskopdjup: korvetten Vakten misstänker."), och ett tryck på den visar varför, med roder, djuproder och varv. Simuleringen är densamma oavsett vem som styr: ballast, pumpar, tryckluft och hydrodynamik fungerar likadant.

### Hur besättningen väljer

Valen görs av vakthavande officer (`src/control/conn.ts`), som ensam ger order till djuproder, roder och propeller. Bara ett läge styr varje del åt gången, och planraden visar vilket.

| Situation | Besättningens val |
|---|---|
| **Djupbyte med fart** | På djuprodren, med en stampvinkel efter djupskillnaden (högst 12°, 10° på väg upp från djupet). Nedåt sjunker ubåten högst ~1 m/s, så fören går mindre ned ju fortare den går (9° i 12 knop), utom i Full fram. Närmare botten än 30 m (eller en halv minuts sjunkande) och djupare än 250 m högst 5° nedåt, också i Full fram. |
| **Djupbyte utan fart** | Stopp eller högst 1 knop: ubåten svävar med kompenseringstanken. Orkar djuprodren inte vid en låg fart, ökar maskinen till 4 knop tills djupet är nått eller du beordrar en ny fart. En dykning från ytan går i minst 6 knop när besättningen sköter farten, och ska ubåten stå still på djupet pumpar besättningen ut kompenseringen redan medan huvudballasten fylls, så att den inte sjunker förbi målet. |
| **Trim före djupbytet** | Trimassistenten pumpar direkt 80 % av det som skrovets hoptryckning och vattnets täthet ändrar på det nya djupet ("Trimmet förbereds för 90 m: lättare där."), så att ubåten inte hänger över eller under ett språngskikt i flera minuter. Resten mäts och kompenseras som förut. |
| **Upp från djupet** | Till 35 m (under de största fartygens köl), lyssna runt med en gir på 60°, och sedan upp. Stark kontakt: väntar på 35 m. |
| **Yta** | Upp på djuprodren, huvudballasten blåses på 15 m. Misstänker, söker eller anfaller en korvett ubåten, stannar besättningen på periskopdjup i stället, eftersom en blåsning hörs långt. Den går upp när ingen jagar längre, eller om du trycker Yta igen. Stiger den från djupet går den då i 4 knop, inte 8. |
| **Periskopdjup** | De sista 25 m upp och med periskopet uppe håller besättningen farten under 6 knop (inte på Full fram): en snabb ubåt skjuter över, och periskopets plym syns. Grundare än 20 m girar den med högst 15° roder, så att tornet inte bryter ytan. |
| **Lägre fart** | Ubåten glider ned i fart utan att propellern backar, vilket är tystare och sparar batteriet. Stopp, och grunt vatten förut, backar för fullt. |
| **Back** | Rodren verkar omvänt, och djupautopiloten vänder tecken. Djupbyten akterut görs med högst 5° stampvinkel. |
| **I ytläge** | Djuprodren ligger i noll och ubåten flyter. Ett djupmål på 5 m eller mer startar dykningen: bryggan utryms och huvudballasten fylls. |

### Expertläge

Under ☰ → **Besättning** kan du slå på **Expertläge**. Då väljer du för varje system om **besättningen** sköter det eller om du gör det **själv**, när som helst, mitt i ett scenario också. Utan expertläge sköter besättningen alltid manövern (djup, kurs, fart, ballast, trim och skyddsnät), och order som skulle ta över den vägras med ett besked. Laddning, eldledning och torpedrum kan du alltid ta över. Scenarier där du ska styra själv, till exempel Trimövning, spelas alltid i expertläge.

| System | Besättningen sköter (från start) | Du sköter själv (djup, kurs, fart, ballast, trim och skyddsnät bara i expertläge) |
|---|---|---|
| **Djup** | **Auto:** djupstyraren håller djupmålet från djupskalan. | **Hand:** du styr djuprodret. |
| **Kurs** | **Auto:** rorsmannen håller kursmålet från kompassen. | **Hand:** du styr rodret. |
| **Fart** | Maskinen följer telegrafen. | Du styr propellervarvet (panelen Fart). |
| **Ballast och brygga** | Yta, Periskop och Djup. Besättningen utrymmer bryggan, ett djupmål på 5 m eller mer i ytläge startar dykningen och ett djupmål grundare än 5 m med fylld huvudballast blåser den. Från djupare än 15 m stiger ubåten först på djuprodren, och huvudballasten blåses på 15 m. **Nödblåsning** (panelen Ballast eller Shift + S), ordern `ytläge` och skyddsnätet blåser på vilket djup som helst. Djupare än 20 m blåses då huvudballasten för först och akter 15 s senare, så att fören kommer upp. | Du fyller, blåser och stänger huvudballasten och klarar bryggan (panelen Ballast). Ett djupmål som inte går att nå med ballasten som den är ger en påminnelse. |
| **Trim** | Trimassistenten kompenserar och trimmar. | Du kompenserar och trimmar (panelen Trim). |
| **Eldledning** | Eldledaren mäter avståndet till målet genom periskopet var 30:e sekund och föreslår kursbyten för målrörelseanalysen. | Du mäter avståndet själv (Avst eller R). Att skjuta är alltid din order. |
| **Torpedrum** | Torpedrummet gör tuberna klara när ett mål är markerat, och säkrar och laddar om tomma tuber. | Du gör tuberna klara, säkrar och laddar om dem (panelen Torped, eller ett tryck på en tub i eldledningspanelen). |
| **Laddning** | Maskinisten startar dieslarna och laddar batteriet när snorkeln är uppe eller ubåten ligger i ytläge, och stoppar dem när batteriet är fullt. | Du startar och stoppar dieslarna (panelen El). Att hissa snorkeln är alltid ditt beslut. |
| **Skyddsnät** | På: nödblåsning nära krossdjupet och när ubåten tagit in mycket vatten, djupgräns över botten och varning för grunt vatten. | Av. |

- **Ta över:** i expertläge, växla djup eller kurs till **Hand**, tryck på en knapp i panelerna Ballast, Trim och El (tryck på planraden), eller tryck **Ta över** i panelen. Panelens översta rad säger vem som sköter systemet, och knappen bredvid lämnar det till besättningen igen. Farten lämnar du också till besättningen med telegrafen, och loggen säger till när farten byter mellan dig och besättningen. ☰ → **Besättning** visar alla system på ett ställe, med skyddsnätet.
- **Order tar över:** en manuell order tar över systemet den gäller. Roder åt sidan sätter kursen på Hand, Trimma i panelen Trim avlöser trimassistenten, Fyll i panelen Ballast ger dig ballasten och Start i panelen El laddningen. Ett djup- eller kursmål och telegrafen lämnar axeln till besättningen igen.
- **Djuprodren behöver fart:** deras kraft växer med farten i kvadrat, så vid 3 knop orkar de knappt ändra djupet. Har djuprodret legat i fullt utslag i 30 s utan att djupet ändrats, mer än 1 m från målet, säger djupstyraren till. Medan huvudballasten fylls vid dykning från ytan räknas det inte, eftersom det då är luften som håller ubåten uppe. Sköter besättningen farten ökar maskinen till 4 knop tills djupet är nått och går sedan tillbaka till din fart. En ny fartorder avslutar ökningen direkt, så Stopp efter Full fram blir full back och inte 4 knop. Orkar rodren inte heller då, till exempel på periskopdjup i 3 knop med periskopet uppe, håller maskinen 4 knop tills du ändrar djup eller fart. Sköter du farten själv får du ett besked att öka till minst 4 knop.
- **Sväva utan fart:** är fartmålet högst 1 knop (Stopp eller tyst) ökar besättningen inte farten. I stället svävar den: gör ubåten några hundra kilo tung eller lätt med kompenseringen, så att den sjunker eller stiger högst ~7 m i minuten, och gör den neutral i god tid före djupmålet, eftersom pumpen bara tar 6 liter i sekunden. 30 m tar ungefär 6–7 minuter. Djupvisningen visar "svävar". Det kräver att besättningen sköter djupet, farten och trimmet. Dyker ubåten från ytan till ett djup där den ska stå still, pumpar besättningen ut det mesta av dyktyngden medan huvudballasten fylls, och ubåten sjunker lugnt till målet. I grov sjö lyfter vågorna en ubåt nära ytan (några tiotal kilo på periskopdjup). Besättningen märker det när ubåten inte sjunker som den ska och gör den tyngre tills den står still på målet. Från ytan behåller den då lite övervikt tills ubåten svävar. Sköter du trimmet får du ett besked om att ändra djupet med In och Ut i panelen Trim. I språngskiktet blir ubåten lättare ju djupare den kommer, och på stort djup tyngre när skrovet trycks ihop: håll koll på Flytkraft.
- **Utan ryck:** tar du över djup eller kurs ligger rodren kvar där autopiloten hade dem. Lämnar du tillbaka dem sätts målen till nuvarande djup och kurs.
- **Instrumentpanelen** följer valen: tar du över kursen visas rodret, trimmet flytkraft och tankar, ballasten HP-luften, laddningen dieslarna, snorkeln och elförbrukningen.
- **Första gången** visas en kort introduktion.
- **Trimassistenten** ger vanliga order, och varje order kvitteras i loggen, till exempel `Kompensera ut 150 liter, ja`. Den är begränsad av pumparnas kapacitet (5–6 l/s), så den hinner inte rädda allt.
  - **Kompensering:** när ubåten är nedsänkt med full huvudballast och har legat stilla på sitt djup en stund, pumpar assistenten bort flytkraftsöverskottet i portioner om högst 200 l (500 l när felet är över ett ton). Små avvikelser (±50 kg) lämnas.
  - **Trim:** behöver djuprodret hela tiden ligga i samma riktning för att hålla djupet, flyttas vatten mellan trimtankarna.
- **Skyddsnätet:**
  - Nödblåsning under 255 m (85 % av krossdjupet 300 m), eller om ubåten sjunker fortare än 2 m/s under 250 m.
  - **Största dykdjup 250 m:** ett djupare mål blir 250 m ("Största dykdjup är 250 m med skyddsnätet på: besättningen går dit."), och djupskalans streckade linje står där. Förut tog besättningen målet och nödblåste sedan själv på 255 m, vilket hörs långt. Utan skyddsnät (expertläge) gäller ditt djup.
  - Djupmålet begränsas så att det är minst 10 m under kölen, under ubåten och så långt fram som ubåten går på en minut (minst 150 m). När vattnet blir djupare igen går besättningen tillbaka till ditt djup ("djupare vatten, tillbaka till 150 m").
  - **Grunt förut:** stiger botten fortare än ubåten hinner upp, eller har ubåten i ytläge mindre än 3 m under kölen förut, varnar besättningen och saktar in till 4 knop. Så länge botten stiger (och 30 s efter) håller den farten under 4 knop vad du än beordrar, också Full fram; telegrafen visar din fart och skälet "grunt förut". I ytläge står det "Gir undan.": besättningen bromsar men styr inte runt grundet.
  - Varning i loggen när det är mindre än 10 m under kölen.
- **Scenarier** kan låsa ett system: i Trimövning sköter du djupet (Hand) och trimmet själv, och i Nödblåsning finns inget skyddsnät. Resultatskärmen visar vad du skötte själv, till exempel "Du skötte själv trimmet och ballasten".

## Styrning

### Skärmkontrollerna

Kontrollerna längst ner visas alltid, på dator och mobil.

| Kontroll | Var | Funktion |
|---|---|---|
| **Yta / Periskop / Djup** | Vänster | Vilket slags djup du vill ha; det som gäller lyser. **Yta** är en vanlig stigning (se [Hur besättningen väljer](#hur-besättningen-väljer)). **Periskop** är 13 m, och i ytläge dyker ubåten dit. **Djup** går tillbaka till ditt senaste djupa djupmål (först 50 m). |
| **Djupskala** | Vänster | Visar djupet (vit linje), djupmålet (blå pil), periskopdjupet, botten (brun) och skyddsnätets gräns (röd streckad). Skalan är kvadratisk, så de grunda metrarna får plats. Tryck eller dra för att välja djup i steg om 5 m. Målet sätts när du släpper. |
| **Kompass** | Höger | Visar 60° åt varje håll från kursen (röd linje), med kursmålet och bojen (gul prick). Tryck eller dra för att välja kurs i steg om 5°. **Mot bojen** styr mot bojen i scenarier som har en. |
| **Planraden** | Mitten, ovanför telegrafen | Vad besättningen gör just nu, till exempel "Går ned till 100 m." eller "Låter farten avta mot 4 knop." Gul text: tyst gång, en korvett är oss på spåren. Ett tryck öppnar detaljerna. |
| **Auto / Hand** (expertläge) | Vid djupskalan och kompassen | Vem som styr djupet och kursen. På mobil en knapp som visar Auto eller Hand (gul) och växlar vid tryck. |
| **Djuproder** (expertläge, Hand) | Vänster | Visar djuprodrets order och utslag. Tryck eller dra för en vinkel. **▲ Upp** / **▼ Ned** ändrar 5°, **Noll** lägger det i noll. |
| **Roder** (expertläge, Hand) | Höger | Visar rodrets order och utslag. Tryck eller dra för en vinkel. **◀ BB** / **SB ▶** ändrar 5°, **Mitt** lägger det midskepps. |
| **Maskintelegraf** | Mitten | Full, Halv och Sakta back, Stopp, och Sakta, Halv, Marsch och Full fram. Sakta och Halv är 2 och 4 knop back och 4 och 8 knop fram, och Marsch (marschfart) är 12 knop. Full back och Full fram är toppfarterna, 7 och 19 knop, så maskinen går för fullt (bakåt når ubåten ~6,8 knop, framåt 18,9, i Östersjöns bräckta vatten ~17). Läget som gäller lyser, och klockan slår vid varje ny order. Den beordrade farten står i instrumentpanelen. När besättningen tillfälligt kör en egen fart, till exempel 8 knop när den stiger från djupet, 4 knop när djuprodren behöver fart eller högst 6 knop nära periskopdjup, står den och skälet ovanför telegrafen ("6 kn · periskopdjup"). Telegrafen dimmas då, men ditt läge har kvar en kontur, och när besättningen är klar går telegrafen tillbaka dit. Du kan ändå ge en ny order, och den gäller direkt. På mobil är telegrafen ett reglage: tryck eller dra längs det, och läget skickas när du släpper. |
| Detaljerna | Tryck på planraden | Öppnar panelen som visades senast, först Manöver. Flikarna Manöver, Ballast, Trim, Fart, El och Torped byter panel. Knapparna som tar över manövern (Fyll, Blås, Kompensera, Trimma, Varv och Ta över i Ballast, Trim och Fart) finns bara i expertläge. |
| Panelen **Manöver** | | Vad besättningen gör och varför, djup, fart och kurs mot målen, stampvinkel, girhastighet, djuproder, roder, varv och axeleffekt. |
| Panelen **Ballast** | | **Nödblåsning** (blåser båda tankarna på vilket djup som helst, full fart och djupmålet ytan; besättningen behåller ballasten), huvudballasttankarna med fyllnadsgrad, Fyll / Blås / Stäng för, akter och båda, bryggan (Klart bryggan, Bemanna) och HP-luften. |
| Panelen **Trim** | | Flytkraft, stampvinkel, pumparna, kompenserings- och trimtankarna. Kompensera in / ut och trimma för / akter, 100 eller 500 liter. |
| Panelen **Fart** | | Fart, varvtal och axeleffekt. Sköter besättningen farten: fartmålet ±1 knop. Sköter du den: varvtalet ±10 rpm och 0 rpm. |
| Panelen **Torped** | | Varje tub med sitt läge (klar, laddad, tom, eller vad den gör och hur länge) och Klar / Säkra / Ladda, och torpederna i stället. |
| Panelen **El** | | Batteriets laddning, elförbrukningen, snorkeln (Upp / Ned), dieslarna (Start / Stopp) och länspumpen, med vattnet i varje avdelning som läcker. |
| **Vyknapparna** | En kolumn mitt i högerkanten (låga fönster: mellan telegrafen och kompassen; mobil: under Vyer ▾) | Ikoner, uppifrån: ögat byter vy, sjökortet och sonarbågarna öppnar sjökortet och sonaren, och under dem hissar och sänker periskopet, snorkeln och radarn masterna (en mast som är uppe lyser). |

En flik eller planraden är gul när du sköter något av systemen själv. Håll in rodrens knappar så upprepas de, och fortare ju längre du håller.

Vyknapparna gör samma sak som V, P, N, K och H, och Zoom och Brg uppe till höger samma sak som Z och B. **Ögat** byter mellan yttre vy, brygga, periskop, manöverrum och genomskärning (C går direkt till snittet). Periskopet och snorkeln visas när ubåten är grundare än 25 m eller en mast är uppe. Ögat visas alltid: djupt byter det mellan yttre vy, manöverrum och snitt. **Sjökortet** (K) och **sonaren** (H) öppnar sjökortet och sonaren (se [Sonar, upptäckt och sjökort](#sonar-upptäckt-och-sjökort)).

**Loggboken** visas alltid, överst i mitten under målrutan, och tar liten plats: högst två rader i ett halvgenomskinligt fönster. En ny rad syns en stund och tonas sedan ut: kvitton efter 2,5 s, information efter 4 s och varningar och fel (röda) efter 6 s, långa rader lite längre. Fönstret tonas ut med den sista raden, så när inget händer ligger ingenting över bilden. Tryck på loggen medan den syns för de senaste raderna, och tryck igen eller Esc för att stänga. Hela loggboken finns under ☰ → **Loggbok**.

### Mobil

På skärmar som är smalare än 840 px (också surfplattor på höjden) eller lägre än 500 px är vyn avskalad, så att 3D-bilden får plats:

- **Statusraden** överst visar tid, fart genom vattnet, vatten under kölen (när det är under 300 m), trim, batteriet och, vid en läcka, vattnet som kommit in. Djup, kurs och beordrad fart syns redan på djupskalan, kompassen och telegrafen. Tryck på statusraden för hela instrumentpanelen och igen för att stänga den.
- **Loggboken** ligger under statusraden och målrutan (liggande: mellan statusraden och Vyer ▾). Varje rad kortas till två textrader, och hela texten finns i historiken.
- **Vyer ▾** uppe till höger fäller ut vyknapparna (ikonerna) och Zoom och Brg. Ett val fäller ihop dem igen.
- Telegrafen är ett reglage. Mellan två lägen visar reglaget den beordrade farten, och medan besättningen kör en egen fart den farten och varför. I expertläge är **Auto / Hand** en knapp per axel.
- **Planraden** visar bara texten (inte lägets namn) och bryts på två rader.
- **Stående telefon:** djupskalan med Yta, Periskop och Djup till vänster, kompassen och planraden till höger och telegrafen över hela bredden längst ner.
- **Liggande telefon:** djupet och planraden under vänster tumme, kompassen och telegrafen under höger, och mitten fri. En panel öppnas i mitten under statusraden.

### Tangentbord

Piltangenterna följer Auto / Hand (Hand bara i expertläge).

| Tangent | Besättningen | Hand (expertläge) |
|---|---|---|
| ← / → | Kurs 10° babord / styrbord | Roder 5° babord / styrbord |
| ↑ / ↓ | Djup 5 m grundare / djupare | Djuproder 5° upp / ned |
| Mellanslag | Håll nuvarande kurs och djup | Roder (eller djuproder) i noll |
| Shift + ↑ / ↓ | Telegrafen ett läge fram / back | Varv ±10 rpm |
| D / S | Dyk (djupmål periskopdjup, 13 m, om inget djupare mål finns) / Yta (stigning, huvudballasten blåses på 15 m) | Samma |
| Shift + S | Nödblåsning: båda huvudballasttankarna blåses på vilket djup som helst, full fart och djupmålet ytan | Samma |
| V | Byt vy (yttre, bryggan, periskopet, manöverrummet, genomskärningen). Besättningen bemannar bryggan i ytläge. | Byt vy (bryggan måste vara bemannad) |
| ← / → i manöverrummet | Nästa eller föregående plats (Shift + ←/→ styr) | Samma |
| P | Periskop upp / ned | Samma |
| Z | Periskopets förstoring, 1,5× / 6× (i genomskärningen: ovanifrån / från sidan) | Samma |
| C | Genomskärning på / av | Samma |
| + / − | Zooma genomskärningen | Samma |
| B | Rapportera bäringen dit periskopet eller blicken pekar | Samma |
| ← / → i periskopet | Vrid periskopet (Shift + ← / → styr) | Samma |
| Esc | Stäng loggens historik, lämna en vy, eller pausa | Samma |
| T / R / F | Markera fartyget i hårkorset / mät avståndet / skjut (periskopet eller bryggan) | Samma |
| N | Snorkel upp / ned | Samma |
| Y | Radarmast upp / ned | Samma |
| X | Radarn sänd / tyst (hissar masten) | Samma |
| A | En ping med den aktiva sonaren | Samma |
| L | Lockmål akterut | Samma |
| G | Dieslarna start / stopp (tar över laddningen) | Samma |
| K / H | Sjökortet / sonaren | Samma |
| M | Ljud av / på | Samma |
| O | Visa / fäll ihop målrutan (scenarier) | Samma |

På mobil ersätts instrumentpanelen av statusraden (se [Mobil](#mobil)).

Mus och finger styr kameran: dra för att vrida och nyp eller scrolla för att zooma. Kameran följer ubåten.

### Back

Ubåten backar med telegrafen (Halv back) eller med Shift + ↓ förbi noll. På Hand går det med negativt varvtal i panelen Fart. Instrumentpanelen visar då **BACK** framför farten, och maskintelegrafens klocka slår vid varje ny fartorder.

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
| **Manöverrummet** | Inne i manöverrummet, vid en av fem platser: periskopet, pulpeten, ballastpanelen, plottbordet och sonarhytten. Dra för att titta runt. | Alltid (Vy) |
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
- **Manöverrummet** är vyn inifrån, den som djupt nere visar hur ubåten mår utan att se ut. Inga människor, samma inredning som i genomskärningen.
  - **Platserna:** ←/→ eller **Plats** (uppe till höger, på mobil under Vyer ▾) går mellan **Periskopet**, **Pulpeten**, **Ballastpanelen**, **Plottbordet** och **Sonarhytten**. Dra för att titta runt. Shift + ←/→ styr som vanligt.
  - **Skärmarna** visar simuleringen: pulpeten djup, fart och kurs med målen, roder och djuproder (beordrat och verkligt) och en krängningsmätare med stampvinkeln; ballastpanelen tankarnas nivåer, lampor för ventiler och blåsning, HP-luften, batteriet och dörrarna; plottbordet sjökortet med kölvattnet, bäringslinjerna och bojen; sonarhytten ett vattenfall med bäringarna. **Tryck på en skärm** så öppnas panelen Manöver eller Ballast, sjökortet eller sonaren.
  - **Ljuset** är vitt, och rött på natten och i skymningen, under tyst gång och med periskopet uppe. **Larmlampan** snurrar vid läcka, grundstötning, nödblåsning och nära krossdjupet. Sjunkbomber och grundstötningar skakar rummet, och läcker manöverrummet syns vattnet på durken. Dörrarna i skotten står öppna eller stängda som i simuleringen, och en lampa hänger alltid rakt ned när ubåten stampar och krängar.
  - Hissas periskopet går vyn till periskopet när det är uppe.
- **Periskopet** tar 8 s att hissa. Vyn öppnas när det är uppe. Huvudet når över vattnet ner till ungefär 14 m djup i stilla sjö. I grov sjö kan vågtopparna skölja över det. Över 6 knop vibrerar bilden, och den våta masten ger motstånd.

## Stigning, ballast och fart

Som på en riktig ubåt är huvudballasten full under vatten. Djupet ändras med fart och djuproder, och kompenseringen finjusterar. Huvudballasten blåses bara vid ytläge (på 15 m) och vid nödblåsning.

- **Upp från djupet** (besättningen sköter djup och fart, målet grundare än 35 m och ubåten djupare än 40 m): besättningen går upp i minst 8 knop med högst 10° stampvinkel, planar ut på **35 m** (under de största fartygens köl) i 4 knop och **lyssnar runt**: en kursändring på 60° i en minut, så att sonaren hör akterut också. Hörs ett fartyg nära (stark kontakt inom ungefär 3 km) stannar den på 35 m och säger till. Den lyssnar igen var 30:e sekund och går upp när fartyget har passerat; en ny djuporder tar ubåten upp direkt. Annars går den upp till målet i 4 knop och sedan tillbaka till din fart. Mot ytan blåses huvudballasten på 15 m. En ny fart framåt ändrar inte stegen: besättningen stiger i den farten om den är högre än 8 knop, lyssnar ändå i 4 knop och går över till din fart när ubåten är uppe. En ny kurs under lyssnandet tar ubåten upp direkt. Stopp, back, Full fram eller att du tar över djup eller fart avbryter, och loggen säger "Stigningen avbruten." Är den nya farten Stopp svävar besättningen upp i stället, mycket tystare men långsammare: från 150 m till periskopdjup ~18 min mot ~9 min.
- **Nödblåsning går alltid till ytan:** en blåsning från djupare än 20 m (Nödblåsning, Ytläge eller skyddsnätets) fullföljs. En djuporder eller Dyk under tiden vägras: "Nödblåsning pågår, ubåten går till ytan. Dyk igen därifrån." Tar du själv över ballasten i panelen Ballast är det ditt beslut.
- **Maskinen stoppas under nödblåsningen** när ubåten stiger fortare än 1 m/s: luften lyfter den. Med fart i en snabb stigning gick fören ned mot fullt djuproder (24° från 250 m i 12 knop) och propellern drev ubåten nedåt och akterut. Planraden säger "Nödblåsning: upp till ytan, maskinen stoppad."
- **Tryckluften räcker till ungefär en nödblåsning från djupet:** från 255 m sjunker flaskorna från 250 till ~15 bar. **Kompressorerna** fyller på dem i ytläge och med snorkeln uppe (från tomt till 250 bar på ~25 min, 60 kW från elen; KOMPR i panelen Ballast), och loggen säger "Luftflaskorna är fulla" när de är klara. Under 100 bar varnar besättningen. Räcker luften inte för att blåsa på det djup ubåten är på (flasktrycket under 1,15 gånger havstrycket, och ubåten stiger inte av sig själv), avbryts nödblåsningen: "Tryckluften räcker inte för att blåsa på 200 m (14 bar). Besättningen går upp på djuprodren." Besättningen stiger då med minst 8 knop som vid en vanlig stigning, och djuporder fungerar igen. Förut låg ubåten kvar på djupet i en kvart med djuporder vägrade.
- **En grund blåsning kan ångras:** beordrar du ett djup under ytan medan huvudballasten blåses på 15 m stoppar besättningen blåsningen, ventilerar och dyker till målet.
- **Utan fart** (du sköter farten och står still, eller batteriet är slut) svävar besättningen med kompenseringen, högst ~7 m i minuten och inte högre än 8 m, och säger "Ingen fart: djuprodren biter inte. Ge fart framåt, eller Nödblåsning." Den blåser aldrig själv.
- **Kompenseringspumpen** orkar mindre mot havstrycket: ut går hälften så fort på 200 m som vid ytan, in fortare.
- **Det hörs och syns:** en blåsning från djupet hörs långt, och korvetterna börjar söka. Luft som ventileras grundare än 30 m kokar upp på ytan och syns för korvetternas utkik.

Besättningen ändrar farten bara när den sköter farten: Stopp (full back tills farten är borta), djuprodren orkar inte (minst 4 knop), stigning från djupet (8 knop, sedan 4 knop från 35 m), grunt förut (under 4 knop så länge botten stiger), grundstötning (Stopp), nödblåsning som stiger fort (maskinen stoppad), luften räcker inte för nödblåsningen (minst 8 knop), mer än 30 ton vatten inne (nödblåsning och 8 knop), fast i en trål (back 3 knop). Nödblåsning-knappen ger full fart fram.

## Instrumentpanelen

Panelen uppe till vänster visar från början bara tid, djup, fart, kurs, vatten under kölen och batteri, och det du sköter själv. Resten ligger under knappen **Mer ▾** längst ned. På mobil visas hela panelen när du trycker på statusraden.

- **Djup, fart och kurs:** med målet (→) när besättningen sköter dem. I ytläge visar djupet "→ yta": ubåten flyter och djuprodret ligger i noll. Farten är farten genom vattnet, som loggen mäter.
- **Stampvinkel och krängning.**
- **Under köl:** ekolodets djup under kölen. Rött under 5 m och vid grundstötning.
- **Roder och djuproder:** verkligt utslag och kommenderat utslag (orange markering). Rodren rör sig med begränsad hastighet, ~4°/s.
- **Trim:** Tung, Neutral eller Lätt (±100 kg), och Ytläge när ubåten inte är helt nedsänkt.
- **Batteri:** laddningen i procent, "↑ laddas" när dieslarna laddar. Gul under 30 %, röd under 10 %.
- **Vatten inne:** visas när ubåten läcker, med inflödet i l/s.
- **Det du sköter själv** visas i huvudpanelen: djuproder och stampvinkel på Hand, roder på Hand, varvtal och effekt för farten, flytkraft och tankar för trimmet, tankar och HP-luft för ballasten, dieslar, snorkel och elförbrukning för laddningen.
- **Under "Mer ▾"** (knappen längst ned i panelen, hopfälld från start; på mobil visas allt): djupändring, fart och kurs över grund, strömmen, varvtal, axeleffekt, elförbrukning, dieslar, snorkel, vatten inne, nivån i varje tank, ventil- och blåsstatus, HP-luftens tryck och flytkraftsöverskott (+ = lätt, − = tung).

## Batteri, diesel och snorkling

Under vattnet går ubåten på batteriet. Det rymmer 6 MWh och är fulladdat när spelet börjar.

- **Förbrukning:** elmotorn (axeleffekten / 92 %), hotellasten (60 kW: ljus, ventilation, elektronik) och länspumpen. Vid 4 knop räcker batteriet i ungefär två dygn, vid 8 knop i 16 timmar och vid full fart under två timmar.
- **Tomt batteri:** motorn får bara det dieslarna ger. Utan dieslar stannar propellern.
- **Laddning:** två dieselgeneratorer ger tillsammans 1,2 MW. De behöver luft: i ytläge, eller på periskopdjup med **snorkeln** uppe (snorkelknappen, N eller `snorkel upp`). Snorkelns huvud når över vattnet till ungefär 14 m djup. Sköljer en våg över huvudet stängs ventilen, och dieslarna går några sekunder på luften i båten innan de stannar. Över 80 % tar cellerna emot allt mindre laddning.
- **Varningar** i loggen vid 30, 15 och 5 % och när batteriet är tomt.
- **Snorkling syns och hörs:** masten och avgaserna syns långt, och dieslarna är högljudda (se [Sonar, upptäckt och sjökort](#sonar-upptäckt-och-sjökort)).

## Läckage och skador

Vatten kan tränga in i tryckskrovets avdelningar genom hål. Inflödet är Q = Cd·A·√(2Δp/ρ), så det växer med djupet.

- **Hål uppstår** vid en hård grundstötning (över ~2 knop: fören, aktern eller kölen efter rörelseriktningen), vid kollision med ett fartyg (manöverrummet under tornet) och under krossdjupet 300 m (maskinrummet, mer ju djupare). På 360 m kollapsar skrovet.
- **Besättningen tätar** varje hål med en tidskonstant på 150 s, utom under krossdjupet. **Länspumpen** tar 20 l/s vid ytan och allt mindre ju djupare. På 250 m orkar den inte alls. Gå alltså grundare, så tätar besättningen fortare än vattnet kommer in.
- **Vattnet väger:** det ligger i avdelningens botten och gör ubåten tyngre där. Över 15 ton varnar loggen, och skyddsnätet blåser huvudballasten.
- **Följder:** ett maskinrum som är vattenfyllt till 30 % stoppar dieslarna, och ett elmotorrum till 30 % stoppar motorn.
- **Vattentäta dörrar:** skotten mellan avdelningarna har dörrar. Vid en läcka stänger besättningen dem (10 s), så att vattnet stannar där det kom in, och öppnar dem igen när allt är tätat och länsat. I panelen El stänger och öppnar du dem själv. Står de öppna rinner vattnet över tröskeln till grannavdelningen där ytan står lägre, Q = Cd·A·√(2g·Δh). Lutar ubåten rinner vattnet alltså till den låga änden, och tyngden där gör lutningen värre.
- **Länsa först:** i panelen El väljer du vilken avdelning länspumpen tar först. Annars tar den den blötaste.
- **Visas** i statusraden (LÄCKA), i instrumentpanelen, i panelen El och i genomskärningen, och hörs som ett väsande och länspumpens surr.

Grundstötning och kollision gör fortfarande att ett scenario misslyckas.

## Sonar, upptäckt och sjökort

**Sonaren** lyssnar passivt med bogens hydrofoner. Varje fartyg vars ljud når fram över bruset blir en kontakt (S1, S2 …) med bäring. Efter 20 s klassar operatören den efter propellern, till exempel "S1 är troligen ett lastfartyg (4 blad, 120 rpm)". En kontakt som inte hörs på 20 s tappas.

- **Sonarekvationen:** källans ljudnivå minus utbredningsförlusten (sfärisk spridning, absorption och 20 dB för varje skikt mellan källa och mottagare) minus bruset. Bruset kommer från havet och från ubåtens egen fart. Fort är alltså både högljutt och dövt.
- **Terrängen skuggar:** när botten eller land reser sig mellan källa och mottagare (en kanjonvägg, ett undervattensberg, en ö) försvinner det raka ljudet, och det som tar sig runt är 35 dB svagare. En ubåt djupt nere i en kanjon hörs inte uppe på sockeln, och den hör inte heller fartygen där. Korvetternas pingar når inte heller fram.
- **Liv i havet:** valar och sillstim hörs också. Operatören klassar dem som biologiska: kaskelotens klick (när den dyker), knölvalens sång, vikvalens låga pulståg, späckhuggarnas visslingar och sillens tickande (bara på natten, när stimmen står grunt). De kan inte bli mål, men de kan förväxlas med fartyg innan de är klassade.
- **Sonarvyn** (Sonar, H) är ett vattenfall: bäringen från fören tvärs över, tiden nedåt, starkare signal ljusare. Under den syns kontakterna, ubåtens egen ljudnivå och risken att bli upptäckt.

**Att bli upptäckt:** en korvett lyssnar med sin skrovsonar och ser med utkik och radar. Den märker ubåten mer ju starkare ubåtens ljud når fram, och när ett periskop (inom 3,5 km), en snorkel (inom 6 km) eller tornet i ytläge (inom 12 km) syns. Annars glömmer den långsamt.

- **Ubåtens ljud** växer med farten (30 log), med kavitation över 6 knop + 1 knop per 10 m djup, och med 24 dB när dieslarna går.
- **Varning** i loggen när en korvett kan ha hört eller sett något, och ett larm när den har upptäckt ubåten. Då börjar den jaga (se [Korvetter som jagar](#korvetter-som-jagar)). I scenariot Smyg förbi misslyckas uppdraget.
- **Så smyger man:** gå sakta, djupt och under språngskiktet, håll masterna nere, och använd terrängen: en kanjon, ett undervattensberg eller en klippig botten. Nära botten drunknar ubåtens eko i bottenekot vid en korvetts ping, mest över berg, minst över lera. På natten stiger det djupa spridningsskiktet (plankton och småfisk) till ~50 m, och en ubåt inne i skiktet är svår att skilja från det.
- **Flyg och kustradar** (i scenarier): ett spaningsplan ser ett periskop på 9 km, en snorkel på 15 km och ubåten i ytläge på 35 km. En kustradar på en höjd ser masterna inom sin radarhorisont, men inte bakom en ö. När de har sett något anropar de korvetterna, som söker där. Radarvarnaren hör deras radar, också i fritt spel.

**Sjökortet** (Karta, K) visar också radarekon (gröna kryss), ekona från den senaste pingen (ringar), bäringen till korvettradar som radarvarnaren hör (röda streck), målen med lösningens position och kurs (romber, färgade efter kvaliteten) och torpederna i vattnet. Det har norr uppåt och ubåten i mitten, med fyra skalor (− / +). Det visar djupet ur samma botten som fysiken använder, spåret, bojen (eller en pil mot den), fyrarna, sonarens bäringar som streckade linjer och fartyg i sikte från periskopet eller bryggan.

## Aktiv sonar och radar

**Aktiv sonar:** **Ping** i sonarvyn (A) sänder en ping med bogsonaren. Ekon kommer också från valar och sillstim ("eko (fiskstim?)"), från vrak på botten ("eko (vrak?)") och som ett diffust eko från spridningsskiktet. Ekot från varje fartyg inom 12 km vars eko når över bruset (källnivå 215 dB minus två gånger utbredningsförlusten plus målstyrkan) ger avstånd (±0,4 %) och bäring. Ett markerat mål får dem som observation, så några pingar ger en bra lösning utan kursbyten. Sjökortet visar ekona i en minut. Men pingen hörs långt: en korvett som hör den vet nästan exakt var ubåten är och börjar söka där. Mellan två pingar går minst 10 s.

**Radar:** radarn sitter på en egen mast (radarknappen eller Y), som ger motstånd i vattnet som de andra. Hissad når antennen ungefär lika högt som periskopet, så på periskopdjup är den 1–2 m över vattnet.

- **Radarvarnaren** lyssnar så fort antennen är över vattnet, också när radarn är tyst. Den säger till när en korvetts radar når ubåten, med bäringen och hur stark den är, och sjökortet ritar den.
- **Radar** på sjökortet (X) sänder. Varje svep (3 s) ger avstånd (±0,3 %) och bäring till fartygen innanför radarhorisonten, 4,12 · (√h₁ + √h₂) km för antennhöjderna i meter, också i dimma och mörker. I grov sjö döljer sjöklottret fiskebåtar närmare än 2,5 km. Ett markerat mål får ekona som observation.
- **Priset:** korvetternas radarvarnare hör radarn 1,6 gånger längre bort än radarhorisonten. Medan den sänder växer korvettens vetskap, och efter ungefär 40 s har den hittat ubåten. Sänd kort.

## Anfall: mål, lösning och torpeder

Periskopet är eldledningens öga. I periskopvyn (och på bryggan) ligger eldledningspanelen vid sidan av periskopbilden, med **Mål**, **Avst**, spridningen, **Fyr** och tuberna. Den visas också medan sjökortet eller sonaren är öppen, utom i genomskärningen.

1. **Mål** (T): sätt hårkorset på ett fartyg och tryck Mål. Det blir ett mål (M1, M2 …) med en exakt bäring. En sonarkontakt blir mål med ett tryck på den i sonarlistan. Med flera mål visar panelen en rad med dem (M1, M2 …), och ett tryck väljer vilket tuberna siktar på. Då följer eldledningen dess bäringar var tionde sekund.
2. **Avst** (R): stadimetern mäter avståndet med fartyget i hårkorset. Felet är ~8 % vid 1,5× och ~3 % vid 6×, och på bryggan ~12 % (ögonmått). Sköter besättningen eldledningen mäter eldledaren själv var 30:e sekund medan målet syns.
3. **Lösningen** är målets position, kurs och fart, räknad med minsta kvadrat ur alla bäringar och avstånd (målrörelseanalys). Kvaliteten är dålig, ok eller bra. Bäringar från sonaren ger avståndet först när ubåten har bytt kurs: två ben med minst 30° emellan. Håll sedan kursen några minuter: eldledaren säger till. Panelen visar avstånd, kurs, fart, kvalitet, skjutkurs och gångtid.
4. **Fyr** (F): torpeden går mot träffpunkten, där den och målet möts. Den går 40 knop, räcker 10 km och söker passivt de sista 600 m inom ±30°, med samma akustik som sonaren. Den träffar under målets vattenlinje, och fartyget sjunker. **Spridning** 2 eller 3 skjuter flera torpeder med 3° emellan, för en sämre lösning.
5. **Tuberna:** fyra förtuber och åtta torpeder i stället (se [Torpedrummet](#torpedrummet)). Fyr skjuter från de klara tuberna (gröna). Ett tryck på en klar tub skjuter från just den, på en laddad tub gör det den klar och på en tom tub laddar det om den.
6. **Tråden:** torpeden är trådstyrd. I eldledningspanelen har varje torped med tråd en rad: **Styr** riktar den mot målets lösning som den är nu (ny gyrokurs från där torpeden är, och sökaren vaknar 600 m före den nya träffpunkten), **Sök** väcker sökaren direkt och **Kapa** kapar tråden. Skjut tidigt på en sämre lösning och styr när den blivit bättre. Tråden går av om ubåten går fortare än 8 knop i mer än 5 s eller svänger mer än 120° från kursen vid avfyrningen. Sjökortet ritar tråden som en tunn streckad linje.

**Motmedel:** **Lock** i eldledningspanelen (L) skjuter ut ett lockmål akterut. Det går rakt i 6 knop på ubåtens djup och sänder ubåtens eget ljud i 5 min, lite starkare än ubåten i låg fart. En korvett som hör lockmålet bättre än ubåten tar det för ubåten, söker där och fäller sina sjunkbomber där. Dess eko vid ping är svagare än skrovets, så på nära håll hittar korvetten ubåten om den är närmare. Ubåten har fyra lockmål, och sjökortet visar dem som små romber.

Avfyrningen hörs långt: en korvett i närheten vet ungefär var du är och börjar söka. Pingen och radarn ger avstånd utan stadimeter, men avslöjar ubåten (se [Aktiv sonar och radar](#aktiv-sonar-och-radar)).

## Torpedrummet

En tub skjuter bara när den är **klar**: torpeden i, tuben vattenfylld och mynningsluckan öppen.

| Steg | Tid | Vad händer |
|---|---|---|
| **Klar** | 15 + 8 s | Tuben vattenfylls från tanken runt tuberna och mynningsluckan öppnas. En korvett inom ett par km kan höra luckan. |
| Avfyrning | | Torpeden går, och havsvatten fyller tuben. Tuben är tom, vattenfylld och öppen. |
| **Säkra** | 6 + 15 s | Mynningsluckan stängs och tuben länsas. |
| **Ladda** | 2 min | Säkrar tuben vid behov och laddar en torped från stället. Laddrälsen tar en torped i taget. |

Sköter torpedrummet tuberna (besättningen) gör det de laddade tuberna klara när ett mål är markerat, och säkrar och laddar om tomma tuber. Sköter du dem själv gör du det i panelen **Torped** eller med ett tryck på en tub i eldledningspanelen. En tub-order tar över torpedrummet.

**Torpederna väger.** En torped väger 1,6 ton. Vattnet runt en torped i tuben kommer från och går tillbaka till tanken runt tuberna och väger lika mycket. En avfyrad torped ersätts av havsvatten, så ubåten blir 150 kg lättare förut per skott, och en omladdning flyttar 1,6 ton från stället till tuben. Skillnaden mot konstruktionsläget går till fysiken som punktmassor (`Simulation.payload`), så trimmet märker en salva.

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
- **Den ger upp** när den inte haft kontakt på fem minuter, eller när sjunkbomberna är slut. Har den hört en avfyrning inom 6 km går den dit först och räknar de fem minuterna därifrån.
- **Så kommer du undan:** gå djupt under skiktet, sakta (4 knop), byt kurs och byt djup när den går över dig. Ett lockmål drar korvetten åt ett annat håll.
- **Två som samarbetar:** korvetter i samma grupp jagar tillsammans. Den som börjar söka eller anfalla ropar på de andra, och ett eko delas av alla. När två anfaller går den ena in och fäller medan den andra står 1,5 km bort i låg fart, lyssnar och pingar, och efter varje mönster byter de plats (krypande anfall). Den som står still hör dig mycket bättre än den som kör: håll avståndet till den.
- **Konvojer:** när ett fartyg i en konvoj träffas ökar de andra farten med 30 % och sicksackar ±30° kring kursen i ett fast mönster, två minuter per ben. Eskorten söker där avfyrningen hördes.

## Scenarier

Scenarierna ligger under fem flikar efter vad de övar på, de lättaste först i varje. Korten visar titeln, svårigheten och förutsättningarna, och beskrivningen visas i genomgången.

**Grunderna:** Lär känna båten.

| Scenario | Svårighet | Mål |
|---|---|---|
| Första dykningen | lätt | Guidad övning: klara bryggan, fyll huvudballasten, dyk till 30 m, trimma neutralt och gå till ytläge igen. |
| Back | lätt | Backa 450 m till en boj rakt akterut och stanna vid den, utan att vända ubåten. |
| Trimövning | medel | Håll 50 m ±2 m i tre minuter utan djupautopilot. |
| Sväva | medel | Från 30 m till 80 m under språngskiktet utan fart (högst 1 knop): bara kompenseringen ändrar djupet. Håll sedan 80 m i två minuter. |
| Snorkling | medel | Atlanten: batteriet är på 25 %. Gå upp på periskopdjup, hissa snorkeln och ladda till 28 % utan att bryta ytan. |

**Vatten och nöd:** Språngskikten, salthalten och när något går fel.

| Scenario | Svårighet | Mål |
|---|---|---|
| Språngskiktet | medel | Dyk genom termoklinen till 90 m och kompensera för att ubåten blir lättare där. |
| Saltsprånget | svår | Östersjön: dyk genom saltsprångskiktet till 90 m och kompensera för de tonnen ubåten blir lättare. |
| Nödblåsning | svår | Ubåten är flera ton för tung på 200 m. Nå ytan innan krossdjupet 300 m. |
| Läckan | svår | Atlanten: maskinrummet läcker på 120 m. Gå upp så att länspumpen hinner med, och vänta tills läckan är tätad och rummet länsat. |

**Navigering:** Terrängen under och omkring dig.

| Scenario | Svårighet | Mål |
|---|---|---|
| Genom sundet | medel | Gå i ytläge genom ett smalt sund i skärgården till en gul boj, utan att gå på grund. |
| Fjordinloppet | svår | Ta dig i undervattensläge över fjordens tröskel (55 m) och in till en boj, utan att gå grundare än 15 m. |
| Fyrljuset | medel | Natt: gå i ytläge mot en röd fyr tills den är 700 m bort. |
| Kanjonen | svår | Eggakanten: två korvetter pingar över sockeln. Ta dig genom undervattenskanjonen till en boj utan att bli hittad. Väggarna skyddar nere i kanjonen. |

**Spaning:** Se och mät utan att själv synas eller höras.

| Scenario | Svårighet | Mål |
|---|---|---|
| Periskopspaning | medel | Ta ut bäringen till en fyr genom periskopet. Periskopet får inte synas mer än 60 s i taget. |
| Fartyget | medel | Ta ut bäringen till ett lastfartyg genom periskopet, utan att bli sedd eller komma i vägen för det. |
| Radar i dimman | medel | Dimma på periskopdjup: gör ett lastfartyg till mål, hissa radarmasten, ta en bra lösning med några svep och gå tyst igen innan en korvett hör radarn. |
| Smyg förbi | svår | Atlanten: hör en patrullerande korvett på sonaren, gå under språngskiktet och smyg fram till en boj 2,5 km bort utan att bli upptäckt. |

**Anfall:** Torpeder, eldledning och korvetter som jagar.

| Scenario | Svårighet | Mål |
|---|---|---|
| Övningsskott | medel | Atlanten: markera ett målfartyg i periskopet, mät avståndet, få en lösning och träffa. |
| Lockmålet | medel | En korvett jagar dig på nära håll. Skjut ut ett lockmål och smyg åt ett annat håll medan korvetten jagar det. |
| Klart för eld | medel | Du sköter torpedrummet: gör tuberna klara, sänk två målfartyg och ladda om. |
| Nattanfall | svår | Natt: gör en sonarkontakt till mål, byt kurs så att bäringarna ger avstånd, och sänk fartyget. |
| Ekot | svår | Ping ger avståndet till ett lastfartyg direkt. Sänk det och ta dig undan korvetten som hörde pingen. |
| Konvojen | svår | Sänk ett lastfartyg med en korvett som eskort, och ta dig sedan undan eskorten. |
| Jagad | svår | En korvett anfaller. Gå djupt och tyst och klara dig tills den tappar dig eller har slut på sjunkbomber. |
| Två jägare | svår | Två korvetter jagar tillsammans: den ena lyssnar på avstånd, den andra fäller. Skaka av dig båda. |
| Stora konvojen | svår | Tre lastfartyg med eskort. Sänk ett, se de andra sicksacka, och ta dig undan eskorten. |

Innan ett scenario börjar visar **genomgången** uppdraget, alla mål i ordning (med hålltid), förhållandena, tidsgränsen och vem som sköter vad. Därifrån kan du ändra besättningen innan du trycker **Till sjöss**. Starta om hoppar över genomgången.

Under spelet är **målrutan** överst i mitten en enda rad: målets nummer, målet, hålltiden och bojens avstånd och bäring. Ett tryck på den, eller O, visar tipset och hela listan med avklarade mål (✓). Rutan öppnas också av sig själv i 6 s när ett nytt mål börjar eller tipset ändras (när du tar över eller lämnar systemet målet gäller), och fälls sedan ihop igen. Öppnad med ett tryck fälls den ihop efter 10 s.

Ett scenario misslyckas om ubåten går på grund, kolliderar med ett fartyg, tar in mer än 120 m³ vatten eller skrovet kollapsar. Ledtrådarna anpassas efter vem som sköter systemet målet gäller. I Trimövning sköter du djupet (Hand) och trimmet själv, i Klart för eld torpedrummet, och i Nödblåsning finns inget skyddsnät. Allt annat väljer du.

## Havsområden och väder

| Område | Terräng | Vatten | Ström |
|---|---|---|---|
| **Västerhavet** | Öppet hav (280–375 m) och Bohusläns skärgård från ~2 km österut: granithällar, kobbar och 20–50 m djupa sund. | Salt (1 025 kg/m³), språngskikt på 40–70 m. | Baltiska strömmen, 0,25 m/s norrut vid ytan. |
| **Östersjön** | Grundare hav (110–130 m) och en låg skärgård från ~3 km österut. | Bräckt (1 005 kg/m³). Saltsprångskikt på 60–80 m, där vattnet blir 2,4 kg/m³ tätare. | Svag, 0,1 m/s. |
| **Fjorden** | En fjord som går norrut mellan 300 m höga berg. Tröskel på 55 m vid mynningen, 380 m djup bassäng innanför. | Sötare ytskikt (1 012 kg/m³) ovanpå atlantvatten under 9 m. | Ytvattnet strömmar ut, 0,4 m/s söderut i de översta metrarna. |
| **Atlanten** | Djuphav, ~1 800 m. Ingen botten inom räckhåll. | Salt och kallt (1 027 kg/m³). | Nordatlantiska strömmen, 0,3 m/s mot nordost, ända ner till djupet. |
| **Eggakanten** | Norska kontinentalsockeln: sockeln på ~150 m med sanddyner, branten ned mot djuphavet (1 600 m), en undervattenskanjon som skär 150–300 m ner i sockeln, tre undervattensberg (ett med flat topp på 190 m), två vrak och en klippig kust 9 km österut. | Atlantvatten (1 027 kg/m³), språngskikt på 25–60 m och kallt djupvatten under 500 m. | Sluttningsströmmen, 0,3 m/s norrut längs kanten. |

- **Trafik:** i fritt spel går fartyg i varje område: lastfartyg, färjor, fiskebåtar, trålare och segelbåtar (nästan tysta, utan propeller), i Östersjön en patrullerande korvett och över Eggakanten ett spaningsplan. De följer sina rutter, har lanternor i mörker och dimma och hörs genom skrovet när de är nära. Kollision med ett fartyg loggas. Torpederna fungerar också i fritt spel, och korvetten i Östersjön jagar den som avslöjar sig.
- **Barlast:** ubåtens fasta barlast är anpassad för området, som när en marin flyttar en ubåt mellan hav. Den är alltså neutral på konstruktionsdjupet i alla områden. Skillnaden märks i skikten, till exempel att ubåten blir flera ton lättare under Östersjöns saltsprångskikt, och att den flyter något djupare i fjordens sötvatten.
- **Ljusstrålar** faller ner från ytan på dagen och tonas ut mot 70 m. De kan stängas av i Inställningar.
- **Under vattnet:** varje område har sitt vatten. Östersjön är grönt och grumligt, fjorden grönbrun och Atlanten klar och blå. Det mörknar med djupet. Underifrån syns himlen bara genom **Snells fönster**, en ljus skiva rakt ovanför inom 48,6° från lodlinjen. Utanför den speglar ytan det mörka vattnet (totalreflektion).
- **Ljus och sikt:** dag (sikt ~15 km), skymning (mörkrött ljus, lanternorna tänds), natt (~5 km) eller dimma (~200 m). På natten syns fyrarna, som blinkar med sin egen karaktär, långt innan land syns.
- **Sjögång:** lugnt, måttlig sjö (Hs 1,25 m) eller grov sjö (Hs 3 m). Vågorna påverkar flytkraften i ytläge, periskopet och bryggan, och på periskopdjup lyfter de ubåten lite. Djupare ner märks de knappt.

Terrängen ingår i fysiken. Ubåten kan gå på grund, och det man ser i 3D är det man kan krocka med, också vraken.

## Livet i havet och på land

- **Valar:** kaskeloter dyker djupt i 40 minuter och vilar vid ytan, knölvalar sjunger, vikvalar och späckhuggare (en flock följer sillen in i fjorden). De simmar sina rutter, dyker och blåser vid ytan, och sonaren hör dem.
- **Sillstim:** står i spridningsskiktet, djupt på dagen och nära ytan på natten. De ger starka ekon vid en ping.
- **Trålar:** trålarna drar en trål 350 m akter om sig, en flyttrål på 20–45 m i Västerhavet och en bottentrål längs Eggakantens sockel. Går ubåten in i trålen fastnar den: den kommer inte framåt, trålaren stannar och anropar korvetterna. Back i 12 s för att komma loss (besättningen gör det själv när den sköter farten). Trålen syns under vattnet bakom trålaren.
- **Måsar** följer fiskebåtarna och flyger kring fyrarna på dagen. De lyfter när ett periskop bryter ytan nära dem.
- **Under ytan:** tång och tare som vajar på grund botten, maneter som pulserar, och mareld på natten där skrovet och propellern rör upp vattnet.
- **Botten:** färgen följer bottentypen: sand och grus på grunt vatten och på sockeln, lera på djupet och berg där det är brant.
- **Land:** röda stugor och sjöbodar i skärgården, vita och röda hus på norska kusten, tallskog på öarna, björk och tall upp till trädgränsen och snö på fjordens toppar. Husen har tända fönster på natten.
- **Farleder och radar:** lysbojar (röda och gröna) i sunden blinkar i mörker, och kustradarstationer med snurrande antenn står på höjderna.

## Ljud

Allt ljud syntetiseras i webbläsaren och följer simuleringen:

- **Ubåten:** elmotorn och propellern följer varvtalet, strömningsbruset farten och kavitationen hörs vid högt varv nära ytan. Rodren surrar när de rör sig, och skrovet knakar när trycket ändras.
- **System:** ventilering, vatten som strömmar in, blåsning, pumpar, masternas motor, lågtrycksblåsaren och dieslarna hörs medan de arbetar. En läcka väser, och länspumpen surrar.
- **Strid:** tubens tryckluft vid avfyrning, en avlägsen smäll vid träff, korvettens aktiva sonar som pingar mot skrovet, ubåtens egen ping med sina ekon och sjunkbomber som smäller nära.
- **Larm och signaler:** grundstötning, läckage, ekolodets pip när det är mindre än 10 m under kölen, krossdjupet, vatten över bryggan, nödblåsning, klara mål och uppdragets resultat.
- **Omgivningen:** vind och vågor efter sjögången, måsar på dagen nära land och mistlur i dimma. Under vattnet låter ljudet utifrån dovt.
- **Livet i havet:** med ubåten under ytan hörs valarna genom skrovet: kaskelotens klickserier, knölvalens långa sång, vikvalens låga pulser och späckhuggarnas visslingar, och nära ett sillstim på natten dess tickande.
- **Röst:** spelarens order, larm och klara mål kan läsas upp med en svensk röst. Det slås på i inställningarna.

- **Startsidan:** lugn musik, syntetiserad och utan loopar: en bottenton, långsamma ackord i moll, avlägsna sonarpingar, en mjuk puls som ett hjärtslag, en lång hornsignal och radio med morse. Musiken slås av och dess volym ändras under Inställningar.

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

Öppna http://localhost:5173/ubatssim/ (sökvägen följer `base` i `vite.config.ts`; http://localhost:5173/ skickas dit).

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
- `npm run update-durations` mäter varje testfil och skriver tiderna till `tests/durations.json`, som publiceringen använder för att dela testerna jämnt på tre maskiner. Kör det när testfiler läggs till eller delas.
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
- trådstyrningen (en torped på fel kurs träffar efter Styr, Sök, Kapa, tråden som går av vid hög fart eller stor sväng), lockmålet (korvetten fäller vid lockmålet), korvetter som samarbetar (ropar, delar ekot, styr och fäller i tur och ordning), konvojens sicksack, skotten (vattnet rinner genom öppna dörrar och till den låga änden, besättningen stänger och öppnar, länsa först) och scenarierna Lockmålet, Två jägare och Stora konvojen
- torpedrummet (klar, säkra, ladda, laddrälsen, besättningen, vikten, luckan som hörs), den aktiva sonaren (ekon, avstånd, korvetten som hör pingen), radarn (horisonten, antennen över vattnet, mastens motstånd, radarvarnaren) och scenarierna Radar i dimman, Ekot och Klart för eld med besättningen och spelaren
- propellern back (svagare dragkraft, varvtalsgräns, kontinuitet genom noll) och att skyddsnätet tittar akterut när ubåten backar
- besättningen: att besättningen dyker till 50 m och trimmar neutralt utan spelarens hjälp, att nödblåsningen löser ut, att övertagande och lämning sker utan ryck, att en order tar över rätt system, att låsningar vägras och att simuleringen fortfarande är deterministisk
- att varje scenario går att klara och att det misslyckas när det ska
- determinismen: "Jagad" körs i 4 minuter med fasta order två gånger och ska ge exakt samma tillstånd, och samma som en sparad referens per plattform
- svävningen: djupbyten utan fart genom språngskiktet, uppåt och på djupt vatten, att djupet hålls efteråt, att svävningen slutar när farten kommer tillbaka och beskedet till en spelare som sköter trimmet
- startsidans musik: partiturets delar, att alla toner ligger i D aeolisk, att det inte finns några sjunkbomber, att pulsen är mjuk och att samma frö ger samma partitur; demon på 16 m i dagsljus utan korvett
- frigörandet på grafikkortet (`disposeTree` och fartygen), felrutan och rutan för förlorad grafik
- genomgången före ett scenario och målrutan (utfälld vid start, ihopfälld efter en stund, öppen vid tryck, nytt mål och nytt tips)
- terrängen, grundstötning och navigering genom sundet
- havsområdena: att trycket är integralen av densiteten, saltsprångskiktet, sötvattnet i fjorden, fjordens tröskel och att alla startlägen och fyrar ligger rätt
- strömmen (drift, fart genom vattnet och över grund) och vågorna (signifikant våghöjd, rörelser i ytläge, lågtrycksblåsaren)
- periskopet, bryggan och vyerna
- genomskärningen: att all inredning ligger inom sin avdelning och tryckskrovet, att vattenytan i en lutande tank fyller rätt volym, att ett tryck hittar rätt utrymme och att informationsrutan har något att säga om varje utrymme
- ljudnivåerna från telemetrin, vilka händelser som ger larm och vad rösten läser upp
- fartygen, världen och kollisioner, att vågshadern ger fysikens yta och att genvägen i kontaktmodellen är exakt
- skärmkontrollerna (djupskala, Yta / Periskop / Djup, kompass, telegraf, planraden och detaljerna med panelen Manöver, expertläget med Auto / Hand, roder och djuproder, vyknapparna som ikoner), att tangenterna följer Auto / Hand och att inget scenariotips nämner en panelknapp
- besättningens val (`tests/conn.test.ts`): att farten glider ned utan back och bromsar med grunt förut, fartgränsen och det mjukare rodret nära periskopdjup, att besättningen väntar på periskopdjup när en korvett jagar, trimmet före ett djupbyte och planraden
- mobilvyn: telegrafreglaget, Auto / Hand-knappen, planraden med flikarna, Vyer ▾ och statusraden
- loggboken: radernas livslängd, högst två rader, uttoning av raderna och fönstret, historiken och ☰ → Loggbok
- eldledningspanelen: att välja mellan mål och att skjuta från en viss tub
- panelen El, sjökortet och sonarvyn, knapparna Karta och Sonar, eldledningspanelen i periskopvyn
- spelflödet (sessioner, omstart, tillåtna övergångar, tidsstegsloopen) och gränssnittet (menyskärmar, instrumentpanel och escaping, med happy-dom)
- i en riktig webbläsare (Playwright, `tests/e2e/`): genomgången och målrutan, paus, att panelerna inte överlappar på dator och mobil, att eldledningspanelen inte täcker hårkorset, manöverrummet (platserna och ett klick på en skärm som öppnar panelen), förlorad och återställd grafik, felrutan och hela startsidans musik med ljudet igång.
- manöverrummet (`tests/controlRoom.test.ts`): att varje plats står fritt i rummet och tittar på sin skärm, att ett tryck träffar rätt skärm, ljuset, larmet, skakningarna och vattnet

## Projektstruktur

```
src/
  sim/        Fysiken. Ren TypeScript utan Three.js eller DOM, deterministisk.
    config/   Parametrar för ubåt, vatten, havsområden, sjögång och terräng (SI-enheter, källa per värde).
    systems/  Ubåtens delsystem: ställdon, huvudballast och tryckluft, kompressorer, pumpar, master (periskop, snorkel och radar),
              el (batteri och dieslar), läckage och trålen (snag).
              world/vessel: världen med ubåten, andra farkoster, torpeder och sjunkbomber. acoustics: sonarekvationen.
              life: valar och sillstim. aircraft: spaningsplan. seabed: bottentyp, bottenekot och terrängens skugga.
    math/     Vektorer, matriser (LU), quaternioner.
  control/    Order, orderkö, svensk kommandoparser, PID-autopilot, controller med orderregistret (orderRegistry) och maskinens händelser (plantWatch), besättningen (crew),
              trimassistent och skyddsnät, sonaren (passiv och aktiv) och upptäckten, radarn och radarvarnaren, flyg och kustradar (lookouts),
              eldledningen (målrörelseanalys), torpedrummet (tubernas steg och torpedernas vikt),
              korvetternas jakt, havsområdenas startlägen och fyrar, scenarier.
  render/     Three.js: ubåtsmodell i lager, genomskärning med inredningen som data, manöverrummet inifrån
              (egen scen, skärmar på canvas), terräng, vågor,
              fyrar, ljus och dimma, vattnet per område, bubblor, kölvatten, plym, avgaser och mareld, kameravyer,
              valar, stim, flyg och måsar (life), tång och maneter (seaLife), hus och skog, bojar, kustradar och vrak.
  audio/      Syntetiserat ljud (Web Audio) och uppläsning: nivåer från telemetrin, ljudmotor, röst.
  ui/         Meny, instrumentpanel, statusrad (mobil), logg, tangentbord, skärmkontroller (helm/) och knappar, inställningar,
              vyer och deras overlay (kompassband, periskop), sjökort och sonar. HTML byggs med mallar som escapar.
  game/       Spelsessioner, spelflödet (meny, spel, paus, slut), tidsstegsloopen, vad manöverrummet visar
              (controlRoomFeed) och kopplingen till webbläsaren.
  main.ts     Uppstart.
tests/        Vitest. tests/long/ de långa, tests/e2e/ Playwright i en riktig webbläsare. sequencer.ts och
              durations.json delar testerna efter tid på CI-maskinerna.
docs/         Fördjupande dokumentation: fysikmodellen, grafiken, ljudet, prestandan och idéer (ideer.md).
public/       Ikoner (SVG, PNG för iOS och Android, favicon.ico och en PNG på 32 px för Safaris flik) och webbmanifest.
scripts/      make-mac-launcher.sh – bygger en Mac-genväg till spelet. update-durations.mjs – mäter testfilernas tider.
assets/       Källfil för ikonen utan rundade hörn (används för att rendera PNG-filerna).
```

## Genväg på Mac

`scripts/make-mac-launcher.sh` bygger `Ubåtssim.app`, ett litet macOS-program med spelets ikon som öppnar https://thohig.github.io/ubatssim/ i standardwebbläsaren. Programmet kan läggas i Dock.

```bash
scripts/make-mac-launcher.sh
```

Utan argument hamnar appen i `~/Applications` (mappen skapas om den saknas). Ange en annan mapp som argument om du vill ha den någon annanstans:

```bash
scripts/make-mac-launcher.sh ~/Desktop
```

Skriptet använder bara verktyg som följer med macOS:
- `qlmanage` renderar ikonen från `assets/icon-square.svg`.
- `iconutil` bygger `.icns`-filen.
- `osacompile` bygger appen av en enrads-AppleScript.
- `codesign` signerar appen ad hoc.

Kör skriptet igen om ikonen eller adressen ändras. Det ersätter då den gamla appen.

## Publicering

En push till `main` kör `.github/workflows/deploy.yml`, som kör lint, alla tester (på tre maskiner), bygget och e2e-testerna (på två maskiner, mot bygget) parallellt och publicerar `dist/` till GitHub Pages när allt gått igenom. En push som bara ändrar dokumentationen (`*.md`, `docs/`) publicerar inget; kör då arbetsflödet för hand under Actions om det behövs. Playwrights webbläsare cachas mellan körningarna. En publicering tar 3,5–4,5 min (se `docs/prestanda.md`). Pages-källan är "GitHub Actions".
