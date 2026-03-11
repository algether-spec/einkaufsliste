# Entwicklungsregeln

Diese Regeln gelten verbindlich für **Einkaufsliste** und **Erinnerungen**.

---

## Branch-Strategie

- Immer auf einem Feature-Branch entwickeln, **nie direkt auf main**
- Branch-Name: `feature/<beschreibung>`
- Vor dem Merge immer die Preview-URL auf dem Handy testen

## Push-Regeln

- Immer ohne Rückfrage pushen
- Vor jedem Push prüfen ob die Änderungen fehlerfrei sind
- Bei Fehler: **nicht pushen**, erst beheben

## Versionsnummer

- Bei jedem Commit den **Patch automatisch erhöhen** (z. B. v1.0.143 → v1.0.144)
- Versionsnummer aktualisieren in: `config.js` und `service-worker.js`

## Commit-Nachrichten

- Immer auf **Deutsch**
- Format: `typ(bereich): beschreibung + vVersion`
- Typen: `feat`, `fix`, `refactor`, `test`, `docs`
- Beispiel: `fix(sync): Polling läuft immer als Fallback + v1.0.144`

## Code-Qualität

- Funktionsnamen auf Englisch
- Code einfach und gut lesbar halten
- Kurze Funktionen bevorzugen (max. 20–30 Zeilen)
- Wiederholungen vermeiden (DRY-Prinzip)
- Kommentare nur dort wo nötig
- HTML, CSS und JavaScript sauber trennen

## Merge zu main

1. Preview-URL auf dem Handy testen
2. Erst danach Merge zu main erlaubt
3. Nach dem Merge automatisch deployen (CI/CD läuft automatisch)
