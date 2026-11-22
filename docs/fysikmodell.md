# Fysikmodellen

Det här dokumentet beskriver hur simuleringen i `src/sim/` fungerar: ekvationer, data, källor och vilka förenklingar som gjorts. Alla parametrar finns i `src/sim/config/` med kommentar om källa och enhet. Värden som inte är kontrollerade mot den angivna källan är märkta `// APPROX`.

## Källor

| Kortnamn | Källa |
|---|---|
| [F21] | T. I. Fossen, *Handbook of Marine Craft Hydrodynamics and Motion Control*, 2:a uppl., Wiley 2021. Rörelseekvationer, Coriolis, medsvängande massa för sfäroider, tvärströmsmotstånd. |
| [R90] | R. F. Roddy, *Investigation of the Stability and Control Characteristics of Several Configurations of the DARPA SUBOFF Model*, DTRC/SHD-1298-08, 1990. Storleksordningen på de linjära manöverkoefficienterna. |
| [P01] | T. Prestero, *Verification of a Six-Degree of Freedom Simulation Model for the REMUS AUV*, MIT 2001. Upplägget av fen- och propellermodellen. |
| [WB] | Wageningen B-serien, öppenvattendiagram. Linjäriserade K_T och K_Q. |
| [C12] | J. Carlton, *Marine Propellers and Propulsion*, 3:e uppl., Butterworth-Heinemann 2012, kap. 6. Propellern back (fyrkvadrantdata). |
| EOS-80 | UNESCO:s tillståndsekvation för havsvatten. Densitet och kompressibilitet. |
| [U83] | R. J. Urick, *Principles of Underwater Sound*, 3:e uppl., 1983. Sonarekvationen, sfärisk spridning, omgivningsbrus efter sjögång. |
| [R04] | D. Ross, *Mechanics of Underwater Noise*, 1987/2004. Fartygs utstrålade buller och hur det växer med farten. |

## Koordinatsystem och tillstånd

- **Världen:** NED (x norr, y öster, z nedåt).
- **Kroppen:** FRD (x föröver, y styrbord, z nedåt). Origo ligger midskepps på skrovets centrumlinje.
- **Tillstånd:** 14 element.
  - position η₁ = (x, y, z)
  - quaternion q = (w, x, y, z), kropp → värld
  - kroppshastigheter ν = (u, v, w, p, q, r)
  - propelleraxelns varvtal n [varv/s].
- **Övrigt tillstånd** uppdateras explicit en gång per tidssteg: rodrens och djuprodrens utslag, masternas läge, tankarnas vatten- och luftinnehåll, HP-luften, kvarvarande pumpmängder, vattnet och hålen i avdelningarna, batteriets laddning och generatorernas effekt. Ordningen är fast: ställdon, huvudballast, pumpar, läckage, el.

## Rörelseekvationer

Enligt [F21] kap. 3 och 6:

```
η̇₁ = R(q) ν₁
q̇  = ½ q ⊗ (0, ν₂)
(M_RB + M_A) ν̇ + C_RB(ν) ν = τ
τ  = g(η) + τ_dämpning + τ_fenor + τ_propeller + τ_kontakt
```

- **M_RB** byggs från total massa, tyngdpunkt r_g och tröghet kring tyngdpunkten, med Steiners sats ([F21] ekv. 3.44).
- **C_RB(ν)ν** räknas med Kirchhoffs form ([F21] sats 3.2), som är skevsymmetrisk och därför varken tillför eller tar bort energi.
- **C_A** tas inte med separat. De linjära manöverkoefficienterna kommer från försök med fasthållen modell och innehåller redan den medsvängande massans Coriolis- och Munk-bidrag. Att lägga till C_A skulle räkna dem två gånger.
- **Integration:** klassisk RK4 med dt = 0,01 s (100 Hz). Quaternionen normaliseras efter varje steg. Massegenskaperna fryses under steget. Simuleringen är deterministisk.

## Skrov och massa

- **Skrovet** är en rotationskropp, 60 m lång med radien 3,1 m: elliptisk för (9 m), cylindrisk mittdel och parabolisk akter (16 m). Volymen blir ~1 496 m³, alltså ~1 530 t deplacement i undervattensläge.
- **Tankar** är data (`TankDef`): id, typ, position, form, volym och fyllnadsgrad.

  | Tank | Volym | Läge (x) |
  |---|---|---|
  | Huvudballast för | 110 m³ | +24 m |
  | Huvudballast akter | 110 m³ | −23,5 m |
  | Trimtank för | 7,5 m³ | +18 m |
  | Trimtank akter | 7,5 m³ | −17 m |
  | Kompenseringstank | 20 m³ | midskepps |

  Vattnets tyngdpunkt i en tank flyttas med fyllnadsgraden (tanken fylls nerifrån).
- **Avdelningar** (torpedrum, manöverrum, bostäder och batterier, maskinrum, elmotorrum) finns som data för den framtida genomskärningsvyn.
- **Torrvikt och torr tyngdpunkt** härleds ur konstruktionsläget. Ubåten ska vara neutral och plan på 25 m med full huvudballast och övriga tankar på konstruktionsfyllnaden, med tyngdpunkten BG = 0,35 m under flytcentrum. Det ger ~1 290 t torrvikt och ~14 % reservdeplacement i ytläge.
- **Massegenskaper** räknas om varje tidssteg: massa, tyngdpunkt och tröghet (tankvattnet som punktmassor, med Steiners sats).

## Hydrostatik

- **Skivmodell:** skrovet delas i 80 skivor. För varje skiva beräknas den nedsänkta arean av cirkeln och dess tyngdpunkt exakt, för en rak vattenlinje i skivans plan som tar hänsyn till krängning och stamp. Summan ger flytkraft, flytcentrum och rätande moment i alla lägen, från ytläge till helt nedsänkt.
- **Tornet** är fritt vattenfyllt och ger ingen flytkraft.
- **Vattnets densitet:** ρ(z) = ρ₀(1 + κ_w ρ₀ g z) + Σ Δρᵢ·s((z − topᵢ)/(bottenᵢ − topᵢ)), där s är en mjuk steg­funktion (smoothstep) och κ_w = 4,4·10⁻¹⁰ Pa⁻¹. Ytdensiteten ρ₀ och skikten beror på havsområdet (`config/waters.ts`, EOS-80):

  | Område | ρ₀ (kg/m³) | Skikt |
  |---|---|---|
  | Västerhavet | 1 025,0 | +0,8 kg/m³ på 40–70 m (termoklin) |
  | Östersjön | 1 005,4 | +0,6 på 20–40 m (termoklin), +2,4 på 60–80 m (haloklin) |
  | Fjorden | 1 012,0 | +14,5 på 3–9 m (botten av sötvattenskiktet) |
  | Atlanten | 1 026,6 | +0,6 på 50–150 m |

- **Trycket** är den exakta integralen av densitetsprofilen: p(z) = p_atm + g[ρ₀z + ρ₀²κ_w g z²/2 + Σ Δρᵢ·Iᵢ(z)], där Iᵢ är integralen av smoothstep (t³ − t⁴/2 inom skiktet).
- **Fast barlast per område:** torrvikten härleds med områdets vattenprofil, som när en marin justerar barlasten i hamn inför ett nytt hav. Ubåten är därför neutral på konstruktionsdjupet i alla områden, och skillnaderna märks i skikten. Kompenseringstanken (20 m³) skulle inte räcka för skillnaden mellan Västerhavets och Östersjöns ytvatten (~30 t).
- **Neutral start:** startläget `neutral` justerar kompenseringstanken så att flytkraften är lika med vikten på startdjupet.
- **Skrovets kompression:** V = V₀(1 − κ_h Δp) med κ_h = 6·10⁻¹⁰ Pa⁻¹ (APPROX). Eftersom κ_h > κ_w blir ubåten långsamt tyngre ju djupare den går, som riktiga stålskrov.
- **Tyngdkraften** angriper i tyngdpunkten.

## Ström och sjögång

- **Ström:** varje område har en ytström v_c = U·e^(−d/d₀) i en fast riktning: Västerhavet 0,25 m/s norrut (d₀ = 20 m), Östersjön 0,1 m/s (15 m), fjorden 0,4 m/s söderut (6 m) och Atlanten 0,3 m/s mot nordost (150 m). APPROX.
- **Relativ hastighet:** dämpning, fenor, propeller (anströmningen V_a) och periskopmasten räknas på ν_r = ν − ν_c [F21 §10.3]. Rörelsen mot botten ges av ν. För en ström som är konstant i NED är ν̇_c = −ω × v_c i kroppsaxlar, och (M_RB + M_A)ν̇ får tillägget M_A·ν̇_c.
- **Loggen** visar farten genom vattnet, och autopiloten reglerar på den. Fart och kurs över grund visas separat. Startfarten gäller genom vattnet, så ubåten driver med strömmen från början.
- **Vågor:** en deterministisk summa av sju reguljära djupvattenvågor (ω² = gk) med amplituder från ett Pierson–Moskowitz-spektrum, spridda ±0,5 rad i riktning och 0,75–1,7·ω_p i frekvens. Σa² = Hs²/8 ger rätt signifikant våghöjd. Faserna är fasta.

  | Sjögång | Hs | Tp |
  |---|---|---|
  | Lugnt | 0 | – |
  | Måttlig sjö | 1,25 m | 6 s |
  | Grov sjö | 3 m | 8,5 s |

- **Vågorna i fysiken:**
  - Varje skiva i hydrostatiken räknas mot den lokala vattenytan η(x, y, t) (Froude–Krylov i hydrostatisk form).
  - Vågornas banhastighet (linjär teori, avtar som e^(−kd)) läggs till strömmen i den relativa hastigheten.
  - Periskophuvudets och bryggans djup räknas mot vågytan.
- **Nedsänkt andel** (`submergedFraction`, ytläge i instrumenten och trimassistenten) räknas från skrovets form utan kompressibiliteten. Med den inräknad sjönk andelen under 0,999 vid ~166 m, och djupt vatten visades som ytläge.
- **Ytläget:**
  - **Strålningsdämpning:** där skrovet skär vattenlinjen verkar en vertikal kraft −c·b·dx·w per skiva, där b är vattenlinjens bredd och w skivans vertikalfart mot vattnet. c = 4 000 N s/m³ ger ζ ≈ 0,2 i hiv vid fart noll. APPROX. Utan den saknade det dämpning i hiv, och hivresonansen (~6 s) gav orimliga rörelser i grov sjö.
  - **Lågtrycksblåsare:** när bryggan är bemannad blåser den in 1,5 m³/s luft (fri luft) i huvudballasten, upp till 0,7 bar övertryck. Annars pumpar vågorna ut luften genom bottenöppningarna. APPROX.

## Huvudballast och tryckluft

- **Ideal gas vid konstant temperatur (Boyles lag):** p·V är proportionellt mot luftmängden, och tillståndet är p·V för luften i varje tank.
- **Jämvikt:** tanken är öppen mot havet i botten, så luftens tryck är det hydrostatiska trycket vid den inre vattenytan:

  ```
  p_luft = p(z_botten) − ρ g H f,    V_luft = (1 − f) V_tank,    p_luft · V_luft = PV
  ```

  Fyllnadsgraden f löses ur en andragradsekvation. Luften trycks ihop när ubåten dyker och expanderar när den stiger. Luft som inte får plats bubblar ut genom bottenöppningarna.
- **Ventilering:** när ventilen är öppen strömmar luft ut genom en öppning med C_d A √(2Δp/ρ_luft), högst ljudhastigheten. Det ger en fyllningstid på ~50 s från ytläge.
- **Blåsning:** PV-flödet är k·√(p_flaska² − p_tank²). Flaskorna rymmer 6 m³ vid 250 bar, och flasktrycket sjunker enligt Boyle. En nivåvakt stänger blåsningen när tanken är tom.
- **Trim- och kompenseringstank:** pumpas med 5 respektive 6 l/s. Trimtankarna pumpas mellan för och akter, kompenseringstanken mot havet.

## Hydrodynamik

**Medsvängande massa:** diagonal, från en prolat sfäroid med samma längd och bredd, med Lambs k-faktorer ([F21] §6.3), skalad till verkligt deplacement:
- X_u̇ = −k₁ m_f
- Y_v̇ = Z_ẇ = −k₂ m_f
- M_q̇ = N_ṙ = −k′ I_f
- K_ṗ = 10 % av rulltrögheten (APPROX).

**Dämpning** i prime-systemet [F21], skalad med L = 60 m. Linjära termer skalas med U = |ν₁|:
```
X = ½ρL² X′uu u|u|
Y = ½ρL² Y′v U v + ½ρL³ Y′r U r        N = ½ρL³ N′v U v + ½ρL⁴ N′r U r
Z = ½ρL² Z′w U w + ½ρL³ Z′q U q        M = ½ρL³ M′w u w + ½ρL⁴ M′q U q
K = ½ρL⁴ K′p U p + K_pp p|p|
```
- **Stampmomentet från anfallsvinkeln** (M′w, mest Munk-momentet) räknas med u·w och inte U·w: det försvinner när ubåten stiger rakt upp utan fart och byter tecken akterut. Med U·w fick en ubåt som blåste med lite fart ett moment fören ned hur den än rörde sig.
- **Tillägg:**
  - tvärströmsmotstånd integrerat längs skrovet (C_D = 0,8)
  - små linjära termer i fysikaliska enheter, så att rörelser dämpas även vid fart noll. I sid- och höjdled är de 1·10⁴ N/(m/s) utan fart och 4·10⁴ med fart (`hydro.way`: tillägget 3·10⁴ växer som (u/1 m/s)² och är fullt från 1 m/s fram eller back). Med fart står de för en del av skrovets normalkraft, och autopiloterna är inställda med dem. Utan fart var 4·10⁴ fyra gånger tvärströmsmotståndet vid svävningens farter (~1,3·10⁵·w² N) och halverade dem. Från 1 m/s räknas det exakt som förut.
- **Koefficienterna** är storleksmässigt hämtade från SUBOFF [R90] men är märkta APPROX. Testerna kontrollerar att de ger:
  - rak-kurs-stabilitet i horisontal- och vertikalplanet (C_H > 0, C_V > 0)
  - passivitet (den symmetriska delen av den linjära dämpningen är positivt definit).

## Roder, djuproder och torn

Lyftkraften är ½ρU²·A·C_L(α) med en linjär lyftkurva, överstegring vid ~22° och en platå på 70 % efter överstegringen. Inducerat motstånd är C_L²/(πΛ).

| Yta | Area | Läge |
|---|---|---|
| Roder (vertikalt) | 10 m² | −27 m |
| Djuproder (horisontellt) | 10 m² | −26,5 m |
| Tornet | 30 m² | +8 m, 5,4 m över centrumlinjen |

- **Lokal anströmning:** fenans hastighet är ν₁ + ν₂ × r_fena, vilket ger den lokala anfallsvinkeln.
- **Rörliga fenor:** skrovkoefficienterna innehåller redan fasta fenors bidrag, så bara ökningen från utslaget läggs till: ΔC_L = C_L(δ + α_f) − C_L(α_f).
- **Tornet** finns inte i skrovkoefficienterna och bidrar med hela sin lyftkraft. Det ger den typiska krängningen in i svängen.
- **Back:** när vattnet kommer bakifrån räknas utslaget med omvänt tecken (−δ), eftersom fenans bakkant då möter vattnet först. Ett roderutslag åt styrbord vrider då fören åt babord, och djuproder ned lyfter fören.
- **Utslagen** följer börvärdet med högst 4°/s, och max är ±30°.
- **Tecken:** positivt roder = styrbord, positivt djuproder = dyk.

## Propeller

```
2π J_axel ṅ = Q_motor − Q_prop
T = ρD⁴(a n|n| − b V_a|n|/D),   Q = ρD⁵(c n|n| − d V_a|n|/D),   V_a = u(1 − w)
```
- **Propellern:** D = 3,0 m, w = 0,25 och t = 0,15. Formen ovan är linjära K_T(J) och K_Q(J) [WB] skrivna så att de är jämna genom n = 0.
- **Back (n < 0):** alla fyra koefficienterna multipliceras med 0,6. Bladen möter vattnet med baksidan, och en fast propeller ger ungefär 55–70 % av dragkraften framåt vid samma varvtal [C12] (APPROX). Båda termerna är noll vid n = 0, så kraft och moment är kontinuerliga. Formen gäller också när axeln går mot fartriktningen, alltså vid inbromsning.
- **Motorn:** varvtalsreglerad, med momentframkoppling och P-återkoppling, begränsad till 160 kNm och 2,9 MW. Back tillåter drivningen högst 1,8 varv/s (108 rpm) (APPROX). Ubåten är kursinstabil med aktern först, och back används bara för att manövrera.
- **Reaktionsmomentet** −Q verkar på skrovet och ger en liten krängning.
- **Inbromsning:** medan ubåten går framåt genom vattnet (u > 0,3 m/s) tillåter drivningen backvarv till 3,0 varv/s (180 rpm), eftersom stabilitetsskälet bakom 108 rpm gäller gång med aktern först. Motorns moment och effekt begränsar. Stopp (fartmål 0) backar för fullt tills u < 0,5 m/s och lämnar sedan till fartautopiloten, som nollställs. Från 8 knop: stilla efter ~58 s och 156 m (tidigare 205 s och 293 m).
- **Resultat:** ~19 knop vid 240 rpm framåt och ~6,8 knop vid 108 rpm back.
- **Skrovet back:** samma koefficienter som framåt. Termerna som beror på u byter tecken med farten, och fenorna får vattnet bakifrån (se Roder, djuproder och torn). Hur väl en fartygsmodell för framåtfart beskriver gång med aktern först är inte kontrollerat (APPROX).

## Periskop, snorkel och brygga

- **Snorkeln** är en grövre mast (D = 0,5 m) bredvid periskopet, med foten på x = 6,4 m. Den hissas 7,2 m på 10 s, och huvudet når över stilla vatten ner till ~14 m djup. Masten ger motstånd på samma sätt som periskopet (`systems/masts.ts`, en klass för båda). Huvudventilen är öppen så länge huvudet ligger minst 0,15 m över den lokala vågytan.
- **Periskopet** är en teleskopmast med foten överst i tornet (x = 8,6 m, 7,7 m över centrumlinjen). Den hissas 7,5 m på 8 s. Uppe sitter huvudet 15,2 m över centrumlinjen, så det når över stilla vatten ner till ~14 m djup (CO), med kölen på ~17 m. Periskopdjupet i spelet är 13 m.
- **Mastens motstånd:** den våta delen av masten ger tvärströmsmotstånd ½ρC_D·D·L·u|u| (C_D = 1,0, D = 0,35 m) i fram- och sidled, med moment kring dess mitt. Vid 8 knop blir det några kN.
- **Bryggan:** ögonpunkten sitter 8,6 m över centrumlinjen, durken på 7,4 m och brygglisten 1,1 m över durken. Når vattnet över listan utryms bryggan.

## Batteri och dieslar (`systems/electrics.ts`)

Ett delsystem som uppdateras en gång per tidssteg, efter läckaget.

```
last        = P_axel / η + P_hotell + P_läns          η = 0,92,  P_hotell = 60 kW,  P_läns = 25 kW
generatorer = min(P_gen, last + P_gen · a(SoC))        P_gen = 1,2 MW (två dieslar), rampar upp 80 kW/s
batteri     = last − generatorer                       (positivt = urladdning)
SoC        ← SoC − batteri · dt / E                    E = 6 MWh (21,6 GJ)
a(SoC)      = 1 under 80 %, sedan linjärt ned till 0,1 vid 100 %   (blybatteriets laddningsacceptans)
```

- **Axeleffekten** är motorns moment gånger axelns vinkelhastighet i det aktuella tillståndet (`propellerForces`). En motor som bromsar återvinner inget.
- **Dieslarna** går när de är beordrade och får luft: i ytläge (bryggdurken minst 0,3 m över vattnet) eller med snorkelns huvud över vattnet. Dieslar som redan går klarar 4 s utan luft, när en våg sköljer över huvudet. Sedan stannar de. Stillastående dieslar startar bara med luft.
- **Motorns effektgräns** är 2,9 MW så länge batteriet har mer än 2 %. Under det minskar gränsen linjärt mot det generatorerna ger utöver hotellasten och länspumpen (gånger η). Ett tomt batteri utan dieslar ger ingen effekt alls. Gränsen går in i `propellerForces` och i telemetrins cache.
- **Ett vattenfyllt maskinrum** (över 30 %) stoppar dieslarna, och ett vattenfyllt elmotorrum stoppar motorn.
- **Värdena** (APPROX) är typiska för klassen: 4–8 MWh blyceller och två generatorer på 0,5–0,8 MW. Batteriet räcker ~50 h vid 4 knop, ~16 h vid 8 knop och under 2 h vid full fart. Snorkling laddar ~1,1 MW.
- **Besättningen** (src/control) startar dieslarna under 95 % och stoppar dem vid 99 %, men bara spelaren hissar snorkeln.

## Läckage (`systems/flooding.ts`)

Tryckskrovets fem avdelningar kan ta in vatten genom hål.

```
Q = C_d · A · √(2 Δp / ρ)        C_d = 0,6,  Δp = trycket vid avdelningens mitt − atmosfärstrycket
A ← A · e^(−dt/τ)                τ = 150 s (besättningen tätar), utom under krossdjupet
länspump = 20 l/s · max(0, 1 − djup/250 m)    den blötaste avdelningen först
```

- **Volymen** som kan fyllas är 75 % av π·R²·L för avdelningen (maskiner och däck tar resten, APPROX).
- **Massan:** vattnet är en punktmassa mitt i avdelningen, på höjden R·(1 − f), där f är fyllnadsgraden. Det läggs till massegenskaperna (`computeMassProperties`, `extra`). Flytkraften ändras inte, eftersom skrovets volym är densamma. Fri vätskeyta försummas.
- **Hål:**
  - Hård grundstötning, över 1 m/s: A = 4 cm² · (v / 1 m/s)². I fören om ubåten gick framåt, i aktern om den backade, under bostäderna om den sjönk rakare än den gick.
  - Kollision med ett fartyg: 15 cm² i manöverrummet (från `World`).
  - Under krossdjupet 300 m växer ett hål i maskinrummet med 10⁻⁵ m² per sekund och meter under krossdjupet.
  - På 360 m kollapsar skrovet: alla avdelningar får stora hål, och ett scenario misslyckas.
- **Händelser** (läcka, tätad, länsad, kollaps) samlas i delsystemet och skrivs i loggen av kontrollern. Skyddsnätet blåser huvudballasten när det kommit in mer än 15 m³.

## Akustik (`acoustics.ts`, `config/acoustics.ts`, src/control/sonar.ts)

Sonarekvationen för bredbandsljud, i dB re 1 µPa [U83]:

```
SE = SL − TL − NL + AG − DT          (> 0: hörs)
TL = 20·log₁₀ r + α·r + 20 dB per skikt mellan källa och mottagare        α = 1 dB/km
```

- **Fartygens källnivå** (SL): lastfartyg 172, färja 168, fiskebåt 150 och korvett 158 dB vid 12 knop, plus 50·log₁₀(v/v₀) [R04] (APPROX).
- **Ubåtens källnivå:** 112 dB vid 4 knop, plus 30·log₁₀(v/4 knop). Över 6 knop + 1 knop per 10 m djup kaviterar propellern (+18 dB). Dieslarna ger +24 dB (APPROX).
- **Skikten:** varje skikt i vattenprofilen (termoklin, haloklin, sötvattnets botten) vars mitt ligger mellan källans och mottagarens djup ger 20 dB extra förlust (för ett eko alltså två gånger). Det är en grov bild av hur skiktet böjer av ljudet.
- **Brus:** havet 55 dB + 4 dB per meter våghöjd, och ubåtens eget strömningsbrus 48 dB vid 4 knop, plus 40·log₁₀(v/4 knop), adderat som effekter. Ubåtens bogsonar har AG = 18 och DT = 6 dB. En korvetts skrovsonar har NL = 66 dB upp till 10 knop och sedan + 60·log₁₀(v/10 knop) (strömningsbrus över domen: fort är den döv), AG = 15 och DT = 5 dB.
- **Segelbåtar** har ingen propeller: 118 dB vid 12 knop, målstyrka 5 dB, masthöjd 14 m för radarn (APPROX).
- **Terrängens skugga** (`seabed.ts`, `terrainBlocks`): ljudet mellan två punkter är skuggat när marken på en rak linje mellan dem når mer än 2 m ovanför linjen. Linjen provas var 60:e meter mot ett grovt rutnät med 50 m rutor (`areaAcousticGround`, eftersom kontaktmodellens 4 m-rutnät skulle fylla tusentals rutor längs en ljudväg), och sökningen hoppas över när det grundaste i rutorna ligger djupare än båda ändarna. En skuggad väg får 35 dB extra förlust (det som tar sig runt genom diffraktion och bottenstudsar, APPROX [U83]), ett eko två gånger. Det gäller den passiva sonaren åt båda håll, pingarna och ljud från ubåten som korvetterna hör. Djuphavet skuggar aldrig, så Atlantens scenarier räknar exakt som förut.
- **Bottentyp** (`seabed.ts`, `bottomType`): berg där lutningen är över 0,3 (1 − n_upp) eller ovan vattnet, berg eller grus mellan 0,12 och 0,3, och annars efter terrängen: i skärgården sand och grus till 18 m och lera djupare, i fjorden grus och sand till 90 m, på sockeln sand och grus till 260 m (sanddyner) och lera djupare, i djuphavet lera (slam).
- **Bottenekot:** en ping mot något som är mindre än 50 m över botten drunknar i bottnens efterklang. Ekot minskar med (S_b + 45)·(1 − h/50) dB, där S_b är bottnens spridningsstyrka: lera −40, sand −31, grus −27 och berg −21 dB (Lamberts lag vid 10–20° infallsvinkel, APPROX [U83 kap. 8]). Över berg nära botten blir det 24 dB, över lera 5 dB. Högre upp är det exakt 0.
- **Spridningsskiktet** (DSL): djurplankton och småfisk i ett skikt som står på 400 m på dagen och 50 m på natten (natt och skymning), ±35 m, där vattnet är djupare än 300 m. En ubåt inne i skiktet ger ett eko som är 14 dB svårare att skilja ut. Ubåtens egen ping får ett diffust eko från skiktet. Ljuset (natt, skymning) påverkar alltså simuleringen här och i sillens djup och ljud: `World.night` sätts av sessionen och av `ScenarioRunner`.
- **Liv** (`sim/life.ts`): valar och sillstim är kinematiska som fartygen och följer en rutt i slinga. En val dyker till sitt djup (kaskelot 500 m, knölval 60 m, vikval 40 m, späckhuggare 30 m) med 1,5 m/s, stannar och kommer upp i tid till att andas vid ytan (kaskelot 40 min nere, 8 min uppe). Ett stim står på sitt dagdjup eller nattdjup och håller sig minst halva sin storlek + 5 m över botten. Källnivåer medan de låter (APPROX): kaskelotens klick 175 dB (bara nere), knölvalens sång 168, vikvalens pulståg 158, späckhuggarnas visslingar 160 och sillens tickande (FRT) 118 dB, bara på natten [Møhl 2003, Wilson 2004]. Valarna låter en del av varje period. Målstyrka: val 12 dB, stim 22 dB. Sonaren klassar dem som biologiska efter 20 s. De kan inte bli mål.
- **Vrak** ligger i terrängen (`SHELF_TERRAIN.wrecks`): skrovets form läggs på höjdfunktionen, så att ubåten kan gå på grund mot det. Målstyrka 20 dB vid en ping.
- **Upptäckt** (src/control/sonar.ts, en gång per sekund): korvettens vetskap växer med 0,04·(1 + SE/5) per sekund när SE > 0, och med 0,03, 0,06 och 0,3 per sekund när ett periskop (3,5 km), en snorkel (6 km) eller tornet i ytläge (12 km) syns. Annars minskar den med 0,005 per sekund. Vid 1 är ubåten upptäckt.

## Torpeder, sjunkbomber och jakten (`torpedo.ts`, `depthCharge.ts`, `config/weapons.ts`, src/control)

- **Torpeden** är kinematisk: 20,6 m/s (40 knop), 10 km räckvidd, 8°/s girhastighet och 2 m/s djupändring. Den skjuts från fören på ubåtens kurs och svänger till sin gyrokurs. Efter 300 m är den armerad. Den går rakt till `seekAfter` (träffpunkten minus 600 m) och lyssnar sedan inom ±30°: hörs ett fartyg med SE = SL − TL − 82 + 10 − 6 > 0 styr den rakt mot det (ren förföljning). Den träffar när den är inne i fartygets skrov och grundare än kölen + 0,5 m. Gångdjupet ställs till 60 % av målets djupgående, högst 4 m.
- **Träffpunkten** är den minsta positiva roten till |p + v·t − s| = v_t·t, där p och v kommer ur lösningen.
- **Målrörelseanalysen** (`fireControl.ts`) är en viktad minsta kvadrat-anpassning av en rät kurs (n₀, e₀, v_n, v_e) till observationerna. En bäring b ger raden (n − n_ubåt)·sin b − (e − e_ubåt)·cos b = 0, som är linjär i de okända (pseudolinjär skattning). Felet räknas om till meter vid det skattade avståndet (iterativt). Ett avstånd ger två rader. Svaga apriorivärden (farten ±8 m/s, och med bara bäringar avståndet 5 ± 6 km) gör systemet lösbart före ett andra ben. Kovariansens diagonal ger positions- och fartfel, och kvaliteten är bra (positionsfel < max(150 m, 10 % av avståndet) och fartfel < 1 m/s), ok (< max(400 m, 25 %) och < 2,5 m/s) eller dålig. Mätfelen är fasta funktioner av tiden: inga slumptal. Högst 60 observationer sparas per mål. Blir de fler tas den bäring bort som ligger tätast i tid mellan sina grannar (aldrig den första, den sista eller ett avstånd), så att det första benet finns kvar. När den äldsta togs bort försvann första benet ~10 min efter kursbytet, och lösningen blev dålig igen. Eldledaren ber om ett kursbyte bara om ubåten inte redan bytt kurs minst 25° under observationerna, annars om att hålla kursen.
- **Sjunkbomben** sjunker 3,5 m/s och smäller på inställt djup. Avståndet till skrovets yta ger hålet: 0,03 m² inom 8 m, och 4·10⁻³·(1 − (d − 8)/32)² m² ut till 40 m, i avdelningen närmast explosionen.
- **Korvettens jakt** (`hunter.ts`, en gång per sekund) har lägena patrull, misstanke, sök och anfall, och styr fartygets `goal` och `goalSpeed`. Den tror att ubåten ligger i rätt bäring men med ett avståndsfel på 10–50 %. Aktiv sonar: SE = 210 − 2·TL + 10 − NL(v) + 15 − 10, högst 3 km och inte i akterns ±45°. Den fäller ett mönster om fyra sjunkbomber (30 m isär) inom 150 m från den tänkta positionen, högst var 45:e sekund och 24 bomber totalt. Den ger upp efter 300 s utan kontakt. Söker den en plats inom 6 km (till exempel efter en hörd avfyrning) räknas tiden först från att den kommit fram, så att en eskort några kilometer bort hinner leta. Med alla bomber fällda bryter den anfallet för gott, och i scenarierna räknas den då som avskakad, liksom när den är sänkt.
- **Bäringen** till en kontakt avviker med 4/(1 + SE/4) grader gånger en deterministisk sinus. Inget slumptal används.
- **Ljud från ubåten** som korvetterna kan höra (`Hunter.heard`): avfyrningen (165 dB) ger vetskap +0,5 och sök, en mynningslucka som öppnas (135 dB, ett par km) +0,1, och ubåtens egen ping (215 dB) +0,6, en nästan exakt position och sök. De hörs om SL − TL − NL(v) + 15 − 5 > 0.

## Flyg, kustradar och trålar

- **Spaningsplan** (`sim/aircraft.ts`, src/control/lookouts.ts, `config/lookouts.ts`): kinematiskt, en rutt i slinga på 300 m höjd med 85 m/s. Det ser ett periskop inom 9 km (vetskapen +0,04/s), en snorkel inom 15 km (+0,08/s) och ubåten i ytläge inom 35 km (+0,3/s), och dess radarvarnare hör ubåtens radar inom 60 km (+0,04/s). Annars −0,005/s. Ubåtens radarvarnare hör planets radar inom radarhorisonten och 70 km (APPROX).
- **Kustradar:** en antenn på en höjd (40–90 m över havet) ser det som sticker upp (periskop 1,5 m, snorkel 2 m, tornet 7 m) inom radarhorisonten och 40 km, om inte land skymmer (`terrainBlocks` med höjder i stället för djup, var 100:e meter). +0,02, +0,05 och +0,25 per sekund.
- **Rapporten:** vid vetskapen 0,5 anropar planet eller stationen korvetterna en gång. Varje korvett får +0,45 och söker vid positionen ±600 m (`Hunter.cue`). Vid 1 är ubåten upptäckt. I fritt spel spanar de inte (`Lookouts.watching`), men radarvarnaren hör dem.
- **Spärr:** en korvett med `activeSonar` pingar var 12:e s också på patrull (scenariot Kanjonen).
- **Trålen** (`systems/snag.ts`, `config/hazards.ts`): en trålare drar sin trål `distance` m akter om sig, `width` bred, mellan `top` och `bottom` m djup. Är en punkt på ubåtens axel (var 4:e meter, plus skrovradien) inne i trålens 40 m långa öppning fastnar ubåten. Då verkar F = 4·10⁵·u² + 1,5·10⁵·u N mot fart framåt (u > 0 genom vattnet), och trålaren stannar och anropar korvetterna (+0,4). Back fortare än 0,2 m/s i 12 s får trålen att släppa, och samma trål kan inte fånga ubåten igen på 600 s. Kraften är med i telemetrins cache (`snag`).

## Aktiv sonar och radar (src/control/sonar.ts, src/control/radar.ts, `config/weapons.ts`)

- **Pingen:** ekot från ett fartyg hörs om SE = 215 − 2·TL + TS − NL + 18 − 10 > 0, med TL mellan ubåtens djup och fartygets halva djupgående och NL ubåtens eget brus. Målstyrkan TS är 25 dB för lastfartyg och färjor, 15 för korvetter och 10 för fiskebåtar (APPROX [U83]). Ekon kommer från högst 12 km. Avståndet har felet 0,4 % och bäringen 1° (fasta funktioner av tiden). Ett markerat mål får ekot som en observation med avstånd. Mellan två pingar går minst 10 s.
- **Radarhorisonten:** d = 4,12·(√h₁ + √h₂) km för antennhöjderna i meter (standardrefraktion, k = 4/3). Antennen sitter på radarmasten (`config/submarine.ts`, `radar`, 7,0 m utskjutning), och dess höjd över den lokala vågytan är `−Simulation.bodyPointDepth(radarHead())`. Fartygens masthöjd är 25 m (lastfartyg), 28 m (färja), 15 m (korvett) och 6 m (fiskebåt). Radarn visar högst 24 km. I sjö med Hs > 1,5 m döljer sjöklottret fiskebåtar inom 2,5 km. Ett svep var 3:e s ger avstånd (0,3 %) och bäring (0,5°).
- **Radarvarnare (ESM):** en radar hörs inom 1,6 gånger radarhorisonten mellan antennerna (korvettens antenn 18 m). Medan ubåtens radar sänder växer en korvetts vetskap med 0,025 per sekund (efter ~40 s är ubåten upptäckt). Ubåtens radarvarnare varnar för en korvetts radar när antennen är över vattnet.
- **Radarmasten** ger motstånd i vattnet som periskopet och snorkeln (`systems/masts.ts`): en cylinder med diametern 0,4 m och Cd = 1,0.

## Skott, tråd, lockmål och samarbete

- **Vattentäta dörrar** (`systems/flooding.ts`): en per skott, 0,6 m², 10 s att stänga eller öppna, tröskel 0,4 m. Vattenytan i en avdelning tas som vågrät, på höjden 2R·fyllnad över avdelningens botten mitt i den. Genom en öppen dörr rinner Q = Cd·A·(1 − stängd)·√(2g·Δh) från den avdelning där ytan står högre, över tröskeln, till grannen (Δh till grannens yta eller tröskeln, det som är högst). Det räknas bara när någon avdelning har vatten. Länspumpen tar `drainTarget` först om den är blöt, annars den blötaste.
- **Tråden** (src/control/wire.ts): en trådstyrd torped får ny gyrokurs, sökpunkt eller kurs genom sina `orders`. Styr räknar träffpunkten från torpedens position med lösningen nu och väcker sökaren 600 m före den. Tråden går av över 4,1 m/s (8 knop) i mer än 5 s eller vid en kursändring över 120° från avfyrningen.
- **Lockmål** (`World.decoys`, `config/weapons.ts`, `decoy`): 300 s, 3,1 m/s rakt på sin kurs, sjunker 0,05 m/s, källnivå 120 dB (ubåten vid ~7 knop) och målstyrka 4 dB (skrovets 10). En korvett lyssnar på det som ger störst signalöverskott (ubåten eller ett lockmål) och pingar på det som ger störst eko. Ett eko från ett lockmål ger anfall men räknas inte som upptäckt.
- **Korvetter i grupp** (src/control/hunter.ts): samma `VesselDef.group` delar vetskapen (+0,85, sök från samma position) och varje eko. När två anfaller fäller en (`strikers`) och de andra står 1 500 m från den tänkta positionen i lyssningsfart och pingar. Efter varje mönster byter de.
- **Konvojens sicksack** (`sim/vessel.ts`): ett fartyg i en larmad grupp går 30 % fortare (högst +3 m/s) och lägger +30°, −30°, +30°, 0°, −30°, +30°, −30°, 0° till kursen mot nästa punkt, 120 s per ben, utom närmare än 500 m från punkten.

## Torpedrummet (src/control/torpedoRoom.ts)

- **Tubens steg:** vattenfyll (15 s), öppna mynningsluckan (8 s), stäng (6 s), länsa (15 s) och ladda (120 s). Laddrälsen tar en torped i taget. En tub skjuter bara när torpeden är i, tuben vattenfylld och luckan öppen.
- **Vikten:** konstruktionsläget har alla fyra tuber laddade och torra och åtta torpeder i stället, och den torra massan härleds med dem. Det som skiljer går till fysiken som punktmassor (`Simulation.payload`, med i `computeMassProperties` som vattnet vid en läcka): −1600 kg för varje tom tub (x = 17,9 m), (reserv − 8)·1600 kg vid stället (x = 16,6 m) och havsvattnet som fyllt tuberna efter skotten, 1450 kg per skott, i tanken runt tuberna (x = 17 m). Vattnet som fyller tuben runt en torped kommer från den tanken och ändrar inte vikten. En salva gör alltså ubåten 150 kg lättare per torped, förut. Utan skillnad är listan tom, och massan räknas exakt som förut.

## Grundstötning

- **Terrängen** är en deterministisk höjdfunktion (`terrain.ts`, parametrar i `config/terrain.ts`). Den beskriver övergången från öppet hav (280–375 m) till en skärgård i Bohusläns stil, med rundade granithällar, kobbar och sund längs nord–sydliga sprickdalar. Simuleringen läser den via ett cachat rutnät med 4 m upplösning och bilinjär interpolation.
- **Kontaktpunkter:** ~80 punkter runt skrovet, plus tornets topp, för och akter.
- **Kontaktkraft:** en punkt under markytan får en kraft längs markens normal, beräknad ur höjdfältets gradient, plus Coulombfriktion:

  ```
  F_n = max(0, k·inträngning − c·v_n),   k = 2·10⁷ N/m,   c = 2·10⁶ Ns/m,   μ = 0,4
  ```

  Friktionen är utjämnad med tanh vid låg glidhastighet.
- **Ekolodet** visar bottendjup minus kölens djup.

## Autopilot (src/control)

- **Djup:** kaskad. En djup-PID ger ett börvärde för stampvinkeln (högst ±12°), och en stamp-PID styr djuprodren. Djupslingan har kp = 0,02 rad/m, ki = 0,0001 rad/(m·s) och kd = 0,3 rad/(m/s): 40 → 13 m vid 4 knop tar ~4,5 min med under 1 m överskjutning. Integralen arbetar inom 1,5 m från målet, och utanför det bara när djupet står stilla (under 0,005 m/s), annars blir en ubåt som vilar 2 m från målet kvar där. Med en zon på 8 m samlade den ett börvärde med fören uppåt under inflygningen, och en stigning från 40 m till periskopdjup vid 4 knop svängde över ~6 m och bröt ytan. Med de tidigare värdena (kp 0,012, ki 0,0004, kd 0,45, stilla under 0,02 m/s) tog de sista 5 m 2–3 minuter, och integralen, snabbare än slingan, fick ubåten att pendla ±2–3 m kring periskopdjupet efter en stigning, så att snorkeln doppades. Integralen står still medan djuprodret ligger i (nästan) fullt utslag, så att den inte vrids upp.
- **Kurs:** PID med kortaste vägen runt 360°.
- **Fart:** PI på varvtalet, med framkoppling från jämviktsvarvtalet (också back). Korrektionen får nå fullt varvtal, så att propellern bromsar vid stopp och vid byte mellan framåt och back. Varvtalet begränsas till axelns gränser inne i regulatorn, så integralen slutar växa där. Ett mål som inte går att nå, som Full fram (19 knop, strax över toppfarten), lämnar då inget kvar som stör nästa, lägre mål.
- **Back:** med vattnet bakifrån vänder ett roderutslag ubåten åt andra hållet, och en ubåt med fören nedåt stiger. Djup- och kursregulatorn vänder därför tecknet på sina utslag och på stampvinkelns börvärde, som begränsas till ±5°. Riktningen byts med hysteres när farten genom vattnet passerat ±0,2 m/s, och regulatorerna nollställs vid bytet, eftersom integralerna håller utslag för den gamla riktningen.
- **Djuprodren behöver fart:** när djupautopiloten har haft djuprodret i (nästan) fullt utslag (minst 85 % av 25°; djupintegralen stannar vid 90 %, så en ubåt som fastnat vilar där) i 30 s, mer än 1 m från målet och med en djupändring under 0,05 m/s, ökar besättningen farten till minst 4 knop (om den sköter farten) tills djupet har legat inom 0,5 m i 30 s eller spelaren beordrar en ny fart (en ny fartorder gäller i stället, så att Stopp efter Full fram blir full back). Orkar rodren inte heller därefter, på samma djupmål och fart, behåller besättningen 4 knop tills spelaren ändrar djup eller fart. Ett exempel är periskopdjup vid 3 knop med periskopet uppe, där mastens motstånd lyfter fören. Spelarens fartmål ändras inte. Djup- och stampintegralerna nollställs när farten ändras, och trimassistenten trimmar inte under fartökningen eller de första 120 s efter den, eftersom rodervinkeln då beror på farten och inte på trimmet. Om besättningen inte sköter farten skrivs ett besked i loggen, högst varannan minut. Stopps inbromsning (full back över 0,5 m/s) gäller inte under fartökningen.
- **Stigning från djupet** (src/control/ascent.ts): mot ett mål grundare än 35 m från djupare än 40 m kör besättningen minst 8 knop med högst 10° stampvinkel (~0,6 m/s stigning), planar ut på 35 m i 4 knop, svänger 60° och lyssnar i 60 s (stannar vid en kontakt med SE > 25 dB) och går upp sista biten i 4 knop. Huvudballasten blåses bara vid ytläge, på 15 m. Från 200 m till periskopdjup tar det ~11 min. En fartorder under stigningen avbryter den, och loggen säger "Stigningen avbruten." Med Stopp på 150 m svävar besättningen sedan upp till 13 m på ~18 min.
- **Blåsning:** en blåsning djupare än 20 m fullföljs till ytan (djuporder vägras), och den hörs med 165 dB (APPROX). En grund blåsning stoppas och ventileras vid en djuporder. Luft som ventileras grundare än 30 m syns för utkiken (+0,08/s inom 3,5 km).
- **Kompenseringspumpen:** 6 l/s vid ytan; ut gånger max(0,25, 1 − d/400), in gånger min(1,5, 1 + d/400) (APPROX, centrifugalpumpens flöde faller med uppfordringshöjden). Svävningen sänker sin önskade sjunkfart i samma proportion, så att pumpen hinner stoppa ubåten.
- **Sväva utan fart** (`src/control/hover.ts`): med fartmål högst 1 knop ökar besättningen inte farten. Den ändrar i stället djupet med kompenseringstanken. Utan fart bestäms den vertikala farten av skrovets motstånd tvärs strömmen. Uppmätt i modellen ger 500 kg övervikt ungefär 0,13 m/s och 700 kg 0,17 m/s, alltså tyngd ≈ 3,3·10^4 kg·s²/m² · w·|w| kring svävningens farter. Det stämmer med tvärströmsmotståndet för ett 60 m långt skrov med 6,2 m diameter (C_D 0,8). Regleringen har två loopar. Djupfelet delat med 100 s ger önskad vertikal fart (högst 0,12 m/s, ~7 m i minuten), och den önskade farten ger önskad tyngd (motståndet plus 6000 kg per m/s fartfel). Skillnaden mot den uppmätta flytkraften pumpas in eller ut. Pumpen tar 6 l/s, så ubåten görs neutral medan den fortfarande rör sig, och den yttre loopen ber om mindre fart de sista metrarna. Vattnets skikt (tätare under språngskiktet, där en tung ubåt blir neutral efter ~10 m) och skrovets kompression (tyngre på djupet) behöver ingen egen modell, eftersom båda looparna arbetar på den uppmätta flytkraften och farten. Djuprodret hålls i noll medan ubåten svävar. Stampvinkeln håller sig under 0,3°, så trimmet behöver inte ändras.
- **Ytläge:** med tom huvudballast, djupmål grundare än 5 m och centrumlinjen grundare än 6 m flyter ubåten. Djupautopiloten håller då djuprodret i noll i stället för att försöka trycka ner ~200 t reservflytkraft.
- **Vakthavande officer** (`src/control/conn.ts`): ensam om att ge djuprodret, rodret och varvtalet sina kommandon, och väljer mellan lägena ovan. Utöver dem:
  - **Inbromsning utan back:** till ett lägre fartmål framåt glider ubåten ned i fart med propellern som lägst stilla (fartregulatorns undre gräns 0) medan den går mer än 0,5 m/s för fort. Från 12 till 4 knop på 60 m tar det runt en minut till under 9 knop. Stopp backar fortfarande för fullt, och med grunt förut (skyddsnätets varning) får propellern backa också vid ett lägre fartmål.
  - **Nära periskopdjup:** med periskopdjupet (5–16 m) som djupmål, de sista 25 m upp och med periskopet uppe, kör besättningen högst 6 knop (inte på Full fram). Grundare än 20 m, neddykt, får rodret högst 15° (regulatorns egen gräns, så integralen stannar där).
  - **Tyst gång:** när en korvett misstänker, söker eller anfaller ubåten (och har sjunkbomber kvar) stiger besättningen från djupet i 4 knop i stället för 8, och Yta stannar på periskopdjup i stället för att blåsa huvudballasten, tills ingen jagar eller spelaren trycker Yta igen.
  - **Trim före djupbytet:** vid en djuporder från under 8 m, med fart, full huvudballast och besättningen på trimmet, räknas hur mycket tyngre ubåten blir på det nya djupet (`Simulation.heavinessChange`: skillnaden i hydrostatisk flytkraft med skrovets kompression och vattnets täthet, minus huvudballastens vatten med tätheten där). 80 % av det pumpas direkt (högst 2 000 l, inte under 150 kg). Från 40 till 90 m i Östersjön blir ubåten flera ton lättare under saltsprångskiktet: besättningen tar in vattnet medan den dyker i stället för att hänga över skiktet. Resten kompenseras som förut när djupet är stilla.
- **Gemensamt:** alla regulatorer har villkorlig integration (anti-windup) och en integrationszon. Förstärkningen för roder och djuproder skalas med 1/U², eftersom fenornas lyftkraft växer med U².

## Trimassistent och skyddsnät (besättningen, src/control)

Båda arbetar bara medan besättningen sköter trimmet respektive skyddsnätet (se `crew.ts` och README, Besättningen och du).

Assistenten ändrar inget i fysiken. Den ger samma order som spelaren kan ge, och pumparnas kapacitet begränsar den.

- **Kompensering:** när ubåten är helt nedsänkt under 8 m, huvudballasten är full och djupet har varit stilla i 15 s (vertikalfart under 0,15 m/s), filtreras flytkraftsöverskottet med tidskonstanten 10 s. Avviker det mer än 50 kg, pumpas skillnaden i portioner om högst 200 l, och 500 l när felet är över 1 000 kg (under saltsprångskiktet tog flera ton annars många minuter). Assistenten väntar 10 s efter varje pumpning. Kravet på stilla djup finns eftersom luftresten i huvudballasten och skrovet trycks ihop medan ubåten byter djup. En ubåt som hänger stilla ovanför sitt djupmål, för att den är för lätt för djuprodren, räknas som stilla. Det är just då den behöver vatten.
- **Trim:** djuprodrets medelutslag över 20 s, medan djupautopiloten håller djupet (inom 1 m och med en vertikalfart under 0,05 m/s; medan djupet svänger följer rodret svängningen och inte trimmet), ger det stampmoment som rodret står för: ½ρU²·A·C_Lα·δ·|x_fena|. Halva den vattenmängd som ger samma moment flyttas mellan trimtankarna, högst 200 l per gång.
- **Ytläge och nödblåsning:** djupare än 20 m blåser besättningen huvudballasten för först och akter 15 s senare. Blåstes båda samtidigt tömdes den akterliga fortare när fören väl dök (den låg då grundare), skrovets lyftkraft framför tyngdpunkten förstärkte det, och ubåten tippade fören ned 40–60° och steg aktern först. För först ger den stigning med fören upp (+10…+25°) som en verklig nödblåsning har, och ytläge efter ~1 min från 100 m i 4–19 knop. En egen order på huvudballasten eller Dyk avbryter den stegvisa blåsningen. Spelaren som sköter ballasten själv blåser som den vill.
- **Skyddsnät:** nödblåsning när ubåten tagit in mer än 15 m³ vatten (läckage), och under 255 m, eller om ubåten sjunker fortare än 2 m/s under 250 m. Djupbörvärdet begränsas till bottendjupet minus skrovradien minus 10 m, under ubåten och upp till 150 m i färdriktningen (akterut när ubåten backar).

## Förenklingar och kända begränsningar

- **Hydrodynamiska koefficienter:** skrovkoefficienterna, rulldämpningen, fenornas lyftlutning och motorns data är uppskattningar (APPROX). De är inte kontrollerade mot publicerade tabeller.
- **Tankarna:** fri vätskeyta i tankarna och impulsflödet från in- och utströmmande vatten försummas.
- **Tryckluften** behandlas som isoterm. En verklig blåsning är närmare adiabatisk och kyler luften.
- **Ytläget och vågorna:**
  - Vågorna verkar hydrostatiskt (skiva för skiva) och genom banhastigheten. Det dynamiska trycket som avtar med djupet, diffraktion, vågmotstånd och sugeffekten mot ytan på periskopdjup modelleras inte.
  - Strålningsdämpningen är en enkel linjär modell. Vågornas tröghetskraft (M_A-delen av vågkraften) saknas.
  - De hydrodynamiska koefficienterna minskas inte när ubåten går i ytläge.
- **Strömmen** är konstant i tiden och har samma riktning överallt. Den följer inte sunden och fjordens form.
- **Medsvängande massa** är konstant och diagonal och beror inte på djup eller närhet till ytan eller botten.
- **Batteriet** har ingen inre resistans, temperatur eller spänningskurva, och laddningen följer bara en enkel acceptanskurva. Dieslarnas bränsle tar inte slut.
- **Läckaget** har inga skott som kan stängas mellan avdelningarna, och vattnet flyttar sig inte när ubåten lutar.
- **Akustiken** är bredbandig och utan frekvenser, riktverkan, bottenstuds eller ytkanaler. Skikten ger en fast förlust i stället för strålgång.
- **Djuproder:** bara akterdjuproder. Ubåten har inga för- eller tornroder.
- **Inte modellerat:** batteri, diesel, läckage, sonar och vapen.
- **Grundstötning:** kontaktmodellen är en straffmetod. Den är avsedd för att ubåten ska stanna och vila realistiskt, inte för att beräkna skador.
