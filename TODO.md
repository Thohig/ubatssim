# Att göra

## Determinismreferensen för Mac (darwin-arm64)

Simuleringen ändrades i november 2026 (besättningens djupstyrning, stegvis blåsning och stampmomentet), så referensen för `darwin-arm64` i `tests/long/determinism.long.test.ts` stämmer inte längre. Tills den är uppdaterad misslyckas `npm run test:all` på en Mac på testet "the state matches the reference for darwin-arm64". CI (linux-x64) är inte påverkat.

Gör så här på Macen, i projektmappen:

1. Hämta den senaste versionen:
   ```bash
   git pull
   ```
2. Låt testet skriva in de nya värdena själv (inget att kopiera):
   ```bash
   npm run update-determinism
   ```
   Det skriver "Determinism reference for darwin-arm64 updated: …".
3. Kontrollera att testet nu går igenom:
   ```bash
   npm run test:all
   ```
4. Spara ändringen:
   ```bash
   git commit -am "Determinismreferensen för darwin-arm64"
   ```
   ```bash
   git push
   ```

Ta sedan bort det här avsnittet (och filen, om den är tom).
