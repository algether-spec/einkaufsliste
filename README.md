# Einkaufsliste (PWA)

Einfache Offline-fähige Einkaufsliste als Progressive Web App.

## Funktionen

- Mehrzeilen-Eingabe
- Offline nutzbar
- Installierbar als App
- Export (Teilen / Zwischenablage)

## Live

https://DEINNAME.github.io/einkaufsliste/

## Checks

```bash
npm run check
```

Enthaelt:
- JS-Syntaxcheck fuer `app.js` und `service-worker.js`
- Smoke-Test mit lokalem HTTP-Server (HTML/Manifest/Service-Worker)

## Supabase (optional)

Setup siehe:
- `supabase/SETUP.md`
- `supabase/schema.sql`
- `config.example.js`

Hinweis:
- Supabase Sync nutzt anonyme Auth + RLS (jeder User nur eigene Daten).
- Für Gerätekopplung in der App denselben 4-stelligen `Geräte-Code` auf beiden Geräten setzen.
