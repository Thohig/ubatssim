# Ubåtssim

En ubåtssimulator i 3D som körs i webbläsaren. Fokus ligger på realistisk simulering av ubåtens fysik: flytkraft, ballast, trim, hydrodynamik, roder och propeller. Grafiken är medvetet enkel.

**Spela:** https://thohig.github.io/ubatssim/

## Kom igång

```bash
npm install
npm run dev      # utvecklingsserver
npm test         # enhetstester (Vitest)
npm run build    # typkontroll och produktionsbygge
```

## Styrning

| Tangent | Funktion |
|---|---|
| ← / → | Roder ±5° |
| ↑ / ↓ | Djuproder ±5° |
| Shift + ↑ / ↓ | Fart ±1 knop |
| Mellanslag | Roder midskepps |
| Enter eller / | Öppna kommandokonsolen |
| Esc | Tillbaka till styrning |

Exempel på konsolkommandon: `djup 120`, `kurs 270`, `fart 8 knop`, `roder sb 15`, `djuproder ned 10`, `fyll huvudballast`, `blås huvudballast`, `trimma för 200`, `autopilot av`.

## Fysik

Rörelseekvationerna följer Fossens modell för undervattensfarkoster med 6 frihetsgrader. De integreras med RK4 och ett fast tidssteg på 100 Hz. Alla parametrar finns samlade, med källa och enhet, i `src/sim/config/`.
