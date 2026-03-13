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
- `GOOGLE_MAPS_API_KEY=AIzaSyB5NCPpj4QeNbyie8ZIPa5aA6cS4mcYLEk`
- `GOOGLE_CALENDAR_CLIENT_ID={{GOOGLE_CALENDAR_CLIENT_ID}}`
- `GOOGLE_CALENDAR_CLIENT_SECRET={{GOOGLE_CALENDAR_CLIENT_SECRET}}`
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
- Bij een definitieve afspraak kan de ingelogde organisator via **Naar Google Calendar** direct een event aanmaken.

## Google Calendar koppeling (OAuth)

Voor de knop **Naar Google Calendar** zijn bovenstaande `GOOGLE_CALENDAR_CLIENT_ID` en
`GOOGLE_CALENDAR_CLIENT_SECRET` nodig.

### Vereiste scope

- `https://www.googleapis.com/auth/calendar.events`
  - Nodig om events te maken en bij te werken in de primaire agenda van de ingelogde Google gebruiker.
  - De app gebruikt deze scope om een meeting-event te maken met:
    - starttijd + eindtijd (op basis van gekozen start en duur),
    - locatie (geselecteerde meetinglocatie),
    - deelnemersinformatie (namen + vertreklocaties in de eventbeschrijving).

Er worden geen extra Google scopes aangevraagd buiten deze Calendar-scope.

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
