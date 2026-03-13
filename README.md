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

De Google Maps en Supabase instellingen zijn geconfigureerd via Next.js runtime env:

- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIzaSyB5NCPpj4QeNbyie8ZIPa5aA6cS4mcYLEk`
- `SUPABASE_URL={{SUPABASE_URL}}`
- `SUPABASE_ANON_KEY={{SUPABASE_ANON_KEY}}`

> `SUPABASE_URL` en `SUPABASE_ANON_KEY` worden automatisch doorgezet naar de publieke varianten die de browser gebruikt.

### Supabase database schema

Voer `supabase-schema.sql` uit in de Supabase SQL editor om de tabellen aan te maken:

- `meetings`
- `meeting_participants`
- `votes`
- `comments`

De API-routes onder `src/pages/api/meetings/**` slaan meetingdata op in deze tabellen en halen data op via `meetingId`.  
Waar beschikbaar wordt de ingelogde gebruiker (`auth.users.id`) gekoppeld aan meetings, stemmen en reacties.

## Auth + meetings

- Eenvoudige login via e-mail (Supabase magic link) beschikbaar in de app.
- Alleen ingelogde gebruikers kunnen meetings opslaan.
- Pagina `/meetings` toont per gebruiker opgeslagen meetings (datum, deelnemers, locaties) en bevat een knop om een meeting te herhalen.

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
