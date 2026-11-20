# Einkaufsliste (PWA)

Offline-fähige Einkaufsliste als Progressive Web App mit Sync zwischen Geräten über Supabase.

## Funktionen

- Mehrzeilen-Eingabe und Spracheingabe (🎤)
- Fotos als Einträge
- Modi „Erfassen“ und „Einkaufen“ (sortiert nach Ladengruppen)
- Offline nutzbar, installierbar als App
- Sync über einen gemeinsamen 8-stelligen Code (Format `AAAA1234`)
- Export (Teilen / Zwischenablage)

Kurzanleitung: `KURZANLEITUNG.md`

## Live

| Umgebung | URL | Branch |
|---|---|---|
| Produktion | https://algether-spec.github.io/einkaufsliste/ | `main` (Root) |
| Test | https://algether-spec.github.io/einkaufsliste/dev/ | `dev` → wird automatisch nach `main/dev/` gespiegelt |

GitHub Pages liefert direkt aus `main` aus. Der Workflow `.github/workflows/deploy-dev.yml`
kopiert bei jedem Push auf `dev` den Stand nach `main/dev/`.

## Entwicklung

```bash
npm start          # lokaler Server auf Port 8080
npm run check      # Syntax, Smoke-Test, Sync- und Utils-Tests
./version-patch.sh            # Patch +1 als -dev Version
./version-patch.sh --release  # -dev Suffix entfernen (vor Merge zu main)
```

Regeln zu Branches, Versionen und Commits: `CLAUDE.md`

## Supabase

- `supabase/SETUP.md` – Einrichtung
- `supabase/schema.sql` – Tabellen, RLS-Policies, RPCs
- `supabase/SYNC_STRATEGIE.md` – Sync-Konzept
- `config.example.js` – Vorlage für `config.js`

Die App nutzt anonyme Auth. In `config.js` steht nur der öffentliche Publishable Key –
der Schutz der Daten liegt in den RLS-Policies.

Mitgeliefert: `supabase-lib.js` = supabase-js v2.98.0 (UMD-Build, lokal wegen CSP/Offline).
