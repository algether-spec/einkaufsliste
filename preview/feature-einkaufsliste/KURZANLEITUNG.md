# Erinnerungen App – Kurzanleitung

## 1) App starten
- App als PWA auf dem Handy installieren und als App starten (wichtig für die Mikrofonfunktion).
- Unten sollte eine Version stehen (z. B. `v1.0.46`).

## 2) Zwei Handys koppeln
- Auf beiden Handys denselben 8-stelligen `Code` setzen.
- Achtung: `HELP0000` ist reserviert und nicht nutzbar.
- Nach dem Setzen sollten beide Geräte dieselbe Liste sehen.

## 3) Erinnerungen hinzufügen (Text)
- In das Feld `Jede Zeile = eine Erinnerung` schreiben.
- Mehrere Zeilen = mehrere Erinnerungen.
- Mit `Übernehmen` speichern.

## 4) Erinnerungen hinzufügen (Sprache)
- Auf `🎤` tippen und sprechen.
- Erkannter Text landet im Eingabefeld.
- Mit `Übernehmen` speichern.
- Hinweis: HTTPS und Mikrofonfreigabe sind erforderlich.

## 5) Erinnerungen hinzufügen (Bild/Foto)
- Auf `Foto` tippen und ein Bild auswählen.
- Das Foto wird sofort als eigener Listeneintrag gespeichert.
- Optional kannst du danach zusätzlich Text eingeben und mit `Übernehmen` speichern.

## 6) Kombinationen (Text + Sprache + Bild)
- Du kannst die Eingabearten mischen: erst Foto, dann sprechen oder schreiben.
- Fotos werden sofort gespeichert.
- Text/Sprache wird mit `Übernehmen` gespeichert.

## 7) Erledigte abhaken
- Unten auf `Erledigt` wechseln.
- Eintrag antippen = erledigt.
- Beim Wechsel zurück zu `Erfassen` werden erledigte Einträge entfernt.

## 8) Weitere Buttons
- `Löschen` leert das Eingabefeld.
- `Export` teilt/kopiert die Liste.
- `Update` lädt die neueste App-Version.

## 9) Wenn Sync nicht läuft
- Prüfen, ob auf beiden Geräten derselbe Code gesetzt ist.
- Internetverbindung prüfen.
- Einmal `Update` drücken und App neu laden.

## 10) Versions- und Dateinamen (wichtig gegen Verwechslungen)
- Projektordner immer gleich lassen: `Einkausliste`
- Backup-Ordner mit Version + Datum benennen: `Einkaufsliste_Backup_V01_2026-02-26`
- Export-Dateien mit Version benennen: `Einkaufsliste_V01.json`
- Optional Export mit Datum: `Einkaufsliste_V02_2026-02-26.json`
- Git-Tags für feste Stände verwenden: `v0.1.0`, `v0.2.0`, `v0.2.1`
- Versionen (`V01`, `V02`, `V03`) nur bewusst hochzählen
- Datum immer im Format `YYYY-MM-DD` verwenden

### Beispiel (aktueller Stand)
- Arbeitsordner: `Einkausliste`
- Nächste Sicherung: `Einkaufsliste_Backup_V01_2026-02-26`
- Export-Datei: `Einkaufsliste_V01_2026-02-26.json`

## 11) Rücksicherung (zu einer Sicherung zurückgehen)
- Vor dem Zurückgehen immer zuerst den aktuellen Stand als neues Backup sichern (z. B. `Einkaufsliste_Backup_V02_2026-02-26`).
- Danach den gewünschten Sicherungsordner auswählen (z. B. `Einkaufsliste_Backup_V01_2026-02-26`).
- Entweder nur einzelne Dateien zurückkopieren (`index.html`, `app.js`, `service-worker.js`) oder den ganzen Projektordner ersetzen.
- Nach einer Rücksicherung die App neu laden und mit `Update` den neuesten Stand auf dem Gerät aktivieren.
- Wenn unsicher: nicht überschreiben, sondern erst vergleichen.
