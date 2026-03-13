# meedle-nl

Nieuwe Next.js applicatie met TypeScript ondersteuning.

## Projectstructuur

```text
src/
  components/   # Herbruikbare UI componenten
  lib/          # Configuratie en utility code
  pages/        # Next.js pagina's (Pages Router)
```

## Configuratie

De Google Maps API key is ingesteld via Next.js runtime env:

- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIzaSyB5NCPpj4QeNbyie8ZIPa5aA6cS4mcYLEk`

## Scripts

- `npm run dev` — start lokale development server
- `npm run build` — maak productie build
- `npm run start` — start productie server
- `npm run lint` — voer linting uit

## Snel starten

```bash
npm install
npm run dev
```
