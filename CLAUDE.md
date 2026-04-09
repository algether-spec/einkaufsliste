# Entwicklungsregeln

Diese Regeln gelten verbindlich für **Einkaufsliste** und **Erinnerungen**.

---

## Branch-Strategie

- Alle Änderungen werden auf **dev** gepusht — NIEMALS auf **main**
- Push auf **main** NUR wenn der Prompt explizit **"merge to main"** oder **"push to main"** enthält
- Patch-Version bei dev-Commits mit `-dev` Suffix — Beispiel: `v1.0.164-dev`
- Vor jedem Push prüfen: `git branch` — sicherstellen dass **dev** aktiv ist
- Merge zu main: Version ohne `-dev` Suffix, dann `git checkout main && git merge dev && git push && git checkout dev`

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

## Qualität und Sicherheit

- Eingaben prüfen
- Leere Einträge verhindern
- Fehler verständlich anzeigen
- Keine Secrets im Frontend speichern
- Löschen nur gezielt ausführen
- Datenverlust vermeiden

## Arbeitsweise

- Arbeite Schritt für Schritt
- Ändere nur, was für die aktuelle Aufgabe nötig ist
- Zerstöre keine bestehenden Funktionen
- Vermeide unnötige Komplett-Umbauten
- Halte die Lösung einfach und robust
- Baue zuerst die Grundfunktionen, danach Erweiterungen

## Merge zu main

1. Preview-URL auf dem Handy testen
2. Erst danach Merge zu main erlaubt
3. Nach dem Merge automatisch deployen (CI/CD läuft automatisch)
