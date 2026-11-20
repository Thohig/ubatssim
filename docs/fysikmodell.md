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
Z = ½ρL² Z′w U w + ½ρL³ Z′q U q        M = ½ρL³ M′w U w + ½ρL⁴ M′q U q
K = ½ρL⁴ K′p U p + K_pp p|p|
```
- **Tillägg:**
  - tvärströmsmotstånd integrerat längs skrovet (C_D = 0,8)
  - små linjära termer i fysikaliska enheter, så att rörelser dämpas även vid fart noll.
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
TL = 20·log₁₀ r + α·r + 14 dB per skikt mellan källa och mottagare        α = 1 dB/km
```

- **Fartygens källnivå** (SL): lastfartyg 172, färja 168, fiskebåt 150 och korvett 158 dB vid 12 knop, plus 50·log₁₀(v/v₀) [R04] (APPROX).
- **Ubåtens källnivå:** 112 dB vid 4 knop, plus 30·log₁₀(v/4 knop). Över 6 knop + 1 knop per 10 m djup kaviterar propellern (+18 dB). Dieslarna ger +24 dB (APPROX).
- **Skikten:** varje skikt i vattenprofilen (termoklin, haloklin, sötvattnets botten) vars mitt ligger mellan källans och mottagarens djup ger 14 dB extra förlust. Det är en grov bild av hur skiktet böjer av ljudet.
- **Brus:** havet 55 dB + 4 dB per meter våghöjd, och ubåtens eget strömningsbrus 48 dB vid 4 knop, plus 40·log₁₀(v/4 knop), adderat som effekter. Ubåtens bogsonar har AG = 18 och DT = 6 dB. En korvetts skrovsonar har NL = 66, AG = 15 och DT = 5 dB.
- **Upptäckt** (src/control/sonar.ts, en gång per sekund): korvettens vetskap växer med 0,04·(1 + SE/5) per sekund när SE > 0, och med 0,03, 0,06 och 0,3 per sekund när ett periskop (3,5 km), en snorkel (6 km) eller tornet i ytläge (12 km) syns. Annars minskar den med 0,005 per sekund. Vid 1 är ubåten upptäckt.
- **Bäringen** till en kontakt avviker med 4/(1 + SE/4) grader gånger en deterministisk sinus. Inget slumptal används.

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

- **Djup:** kaskad. En djup-PID ger ett börvärde för stampvinkeln (högst ±12°), och en stamp-PID styr djuprodren. Djupslingans integral arbetar bara inom 1,5 m från målet. Med en zon på 8 m samlade den ett börvärde med fören uppåt under inflygningen, och en stigning från 40 m till periskopdjup vid 4 knop svängde över ~6 m och bröt ytan.
- **Kurs:** PID med kortaste vägen runt 360°.
- **Fart:** PI på varvtalet, med framkoppling från jämviktsvarvtalet (också back). Korrektionen får nå fullt varvtal, så att propellern bromsar vid stopp och vid byte mellan framåt och back. Varvtalet begränsas till axelns gränser inne i regulatorn, så integralen slutar växa där. Ett mål som inte går att nå, som Full fram (19 knop, strax över toppfarten), lämnar då inget kvar som stör nästa, lägre mål.
- **Back:** med vattnet bakifrån vänder ett roderutslag ubåten åt andra hållet, och en ubåt med fören nedåt stiger. Djup- och kursregulatorn vänder därför tecknet på sina utslag och på stampvinkelns börvärde, som begränsas till ±5°. Riktningen byts med hysteres när farten genom vattnet passerat ±0,2 m/s, och regulatorerna nollställs vid bytet, eftersom integralerna håller utslag för den gamla riktningen.
- **Ytläge:** med tom huvudballast, djupmål grundare än 5 m och centrumlinjen grundare än 6 m flyter ubåten. Djupautopiloten håller då djuprodret i noll i stället för att försöka trycka ner ~200 t reservflytkraft.
- **Gemensamt:** alla regulatorer har villkorlig integration (anti-windup) och en integrationszon. Förstärkningen för roder och djuproder skalas med 1/U², eftersom fenornas lyftkraft växer med U².

## Trimassistent och skyddsnät (besättningen, src/control)

Båda arbetar bara medan besättningen sköter trimmet respektive skyddsnätet (se `crew.ts` och README, Besättningen och du).

Assistenten ändrar inget i fysiken. Den ger samma order som spelaren kan ge, och pumparnas kapacitet begränsar den.

- **Kompensering:** när ubåten är helt nedsänkt under 8 m, huvudballasten är full och djupet har varit stilla i 15 s (vertikalfart under 0,15 m/s), filtreras flytkraftsöverskottet med tidskonstanten 10 s. Avviker det mer än 50 kg, pumpas skillnaden i portioner om högst 200 l. Assistenten väntar 10 s efter varje pumpning. Kravet på stilla djup finns eftersom luftresten i huvudballasten och skrovet trycks ihop medan ubåten byter djup. En ubåt som hänger stilla ovanför sitt djupmål, för att den är för lätt för djuprodren, räknas som stilla. Det är just då den behöver vatten.
- **Trim:** djuprodrets medelutslag över 20 s, medan djupautopiloten håller djupet, ger det stampmoment som rodret står för: ½ρU²·A·C_Lα·δ·|x_fena|. Halva den vattenmängd som ger samma moment flyttas mellan trimtankarna, högst 200 l per gång.
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
