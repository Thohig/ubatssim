# Fysikmodellen

Det här dokumentet beskriver hur simuleringen i `src/sim/` fungerar: ekvationer, data, källor och vilka förenklingar som gjorts. Alla parametrar finns i `src/sim/config/` med kommentar om källa och enhet. Värden som inte är kontrollerade mot den angivna källan är märkta `// APPROX`.

## Källor

| Kortnamn | Källa |
|---|---|
| [F21] | T. I. Fossen, *Handbook of Marine Craft Hydrodynamics and Motion Control*, 2:a uppl., Wiley 2021. Rörelseekvationer, Coriolis, medsvängande massa för sfäroider, tvärströmsmotstånd. |
| [R90] | R. F. Roddy, *Investigation of the Stability and Control Characteristics of Several Configurations of the DARPA SUBOFF Model*, DTRC/SHD-1298-08, 1990. Storleksordningen på de linjära manöverkoefficienterna. |
| [P01] | T. Prestero, *Verification of a Six-Degree of Freedom Simulation Model for the REMUS AUV*, MIT 2001. Upplägget av fen- och propellermodellen. |
| [WB] | Wageningen B-serien, öppenvattendiagram. Linjäriserade K_T och K_Q. |
| EOS-80 | UNESCO:s tillståndsekvation för havsvatten. Densitet och kompressibilitet. |

## Koordinatsystem och tillstånd

- **Världen:** NED (x norr, y öster, z nedåt).
- **Kroppen:** FRD (x föröver, y styrbord, z nedåt). Origo ligger midskepps på skrovets centrumlinje.
- **Tillstånd:** 14 element.
  - position η₁ = (x, y, z)
  - quaternion q = (w, x, y, z), kropp → värld
  - kroppshastigheter ν = (u, v, w, p, q, r)
  - propelleraxelns varvtal n [varv/s].
- **Övrigt tillstånd** uppdateras explicit en gång per tidssteg: rodrens och djuprodrens utslag, tankarnas vatten- och luftinnehåll, HP-luften och kvarvarande pumpmängder.

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
- **Vattnets densitet:** ρ(z) = ρ₀(1 + κ_w ρ₀ g z) + Δρ_termoklin(z). ρ₀ = 1 025 kg/m³ och κ_w = 4,4·10⁻¹⁰ Pa⁻¹. Termoklinen ger +0,8 kg/m³ mellan 40 och 70 m.
- **Skrovets kompression:** V = V₀(1 − κ_h Δp) med κ_h = 6·10⁻¹⁰ Pa⁻¹ (APPROX). Eftersom κ_h > κ_w blir ubåten långsamt tyngre ju djupare den går, som riktiga stålskrov.
- **Tyngdkraften** angriper i tyngdpunkten.

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
- **Utslagen** följer börvärdet med högst 4°/s, och max är ±30°.
- **Tecken:** positivt roder = styrbord, positivt djuproder = dyk.

## Propeller

```
2π J_axel ṅ = Q_motor − Q_prop
T = ρD⁴(a n|n| − b V_a|n|/D),   Q = ρD⁵(c n|n| − d V_a|n|/D),   V_a = u(1 − w)
```
- **Propellern:** D = 3,0 m, w = 0,25 och t = 0,15. Formen ovan är linjära K_T(J) och K_Q(J) [WB] skrivna så att de är jämna genom n = 0.
- **Motorn:** varvtalsreglerad, med momentframkoppling och P-återkoppling, begränsad till 160 kNm och 2,9 MW.
- **Reaktionsmomentet** −Q verkar på skrovet och ger en liten krängning.
- **Resultat:** ~19 knop vid 240 rpm.

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

- **Djup:** kaskad. En djup-PID ger ett börvärde för stampvinkeln (högst ±12°), och en stamp-PID styr djuprodren.
- **Kurs:** PID med kortaste vägen runt 360°.
- **Fart:** PI på varvtalet, med framkoppling från jämviktsvarvtalet.
- **Gemensamt:** alla regulatorer har villkorlig integration (anti-windup) och en integrationszon. Förstärkningen för roder och djuproder skalas med 1/U², eftersom fenornas lyftkraft växer med U².

## Förenklingar och kända begränsningar

- **Hydrodynamiska koefficienter:** skrovkoefficienterna, rulldämpningen, fenornas lyftlutning och motorns data är uppskattningar (APPROX). De är inte kontrollerade mot publicerade tabeller.
- **Tankarna:** fri vätskeyta i tankarna och impulsflödet från in- och utströmmande vatten försummas.
- **Tryckluften** behandlas som isoterm. En verklig blåsning är närmare adiabatisk och kyler luften.
- **Ytläget:** vågor och vågmotstånd modelleras inte, och de hydrodynamiska krafterna minskas inte när ubåten går i ytläge.
- **Medsvängande massa** är konstant och diagonal och beror inte på djup eller närhet till ytan eller botten.
- **Djuproder:** bara akterdjuproder. Ubåten har inga för- eller tornroder.
- **Inte modellerat:** batteri, diesel, läckage, sonar och vapen.
- **Grundstötning:** kontaktmodellen är en straffmetod. Den är avsedd för att ubåten ska stanna och vila realistiskt, inte för att beräkna skador.
