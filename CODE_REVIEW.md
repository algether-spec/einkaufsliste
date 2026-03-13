# Code Review – Einkausliste

Datum: 2026-03-04

---

## Zusammenfassung

| Schweregrad | Kategorie         | Anzahl |
|-------------|-------------------|--------|
| Kritisch    | Sicherheit        | 1      |
| Hoch        | Sicherheit        | 2      |
| Hoch        | Bugs              | 3      |
| Hoch        | Fehlerbehandlung  | 1      |
| Hoch        | Async-Probleme    | 2      |
| Hoch        | Validierung       | 1      |
| Mittel      | Sicherheit        | 1      |
| Mittel      | Performance       | 4      |
| Mittel      | Fehlerbehandlung  | 2      |
| Mittel      | Async-Probleme    | 1      |
| Mittel      | Bad Practices     | 4      |
| Mittel      | Validierung       | 4      |
| Niedrig     | Sonstiges         | 4      |

**Kritisch/Hoch gesamt: 12 · Mittel: 19 · Niedrig: 4**

---

## 1. Sicherheit

### [KRITISCH] S1 – API-Credentials im Klartext

**Datei:** `config.js:2-3`

Supabase-URL und Anon-Key sind hartcodiert und landen im Repository. Auch „public" Anon-Keys sollten nie in der Versionskontrolle stehen.

**Fix:** Über GitHub Actions Secret zur Build-Zeit in `config.js` einsetzen (bereits als Deployment-Step vorhanden – sicherstellen, dass kein Plaintext-Commit möglich ist).

---

### [HOCH] S2 – Schwacher Zufallsgenerator für Sync-Codes

**Datei:** `app.js:191-203`

```javascript
letters += LETTERS[Math.floor(Math.random() * LETTERS.length)];
```

`Math.random()` ist kryptografisch unsicher. Sync-Codes können theoretisch vorhergesagt werden.

**Fix:** `crypto.getRandomValues()` verwenden:

```javascript
const arr = new Uint8Array(4);
crypto.getRandomValues(arr);
letters = Array.from(arr).map(b => LETTERS[b % LETTERS.length]).join("");
```

---

### [HOCH] S3 – URL-Parameter `?code=` wird ohne Nutzerbestätigung angewendet

**Datei:** `app.js:1852-1858`

```javascript
const _urlCode = new URLSearchParams(location.search).get("code");
if (_urlCode) {
    void syncCodeAnwenden(_urlCode, true, { allowOccupied: true, userInitiated: true });
}
```

Ein präparierter Link verbindet den Nutzer ohne Rückfrage mit einer fremden Liste.

**Fix:** Vor dem automatischen Verbinden einen Bestätigungsdialog (eigene UI, nicht `window.confirm`) zeigen.

---

### [MITTEL] S4 – Unvollständige Validierung von Bild-Data-URLs

**Datei:** `app.js:1262-1265`

```javascript
const imageSrc = String(rawImageSrc || "").startsWith("data:image/") ? rawImageSrc : "";
```

Nur das Präfix wird geprüft, nicht das eigentliche Format. Fehlerhafte Data-URLs können zu Rendering-Problemen oder Speicherüberlastung führen.

**Fix:** MIME-Typ und Base64-Anteil vollständig prüfen, z. B. mit einem Regex gegen `data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*`.

---

## 2. Bugs und Logikfehler

### [HOCH] B1 – Race Condition beim Upload: `pending` zu früh zurückgesetzt

**Datei:** `app.js:1102-1129`

```javascript
syncState.lock = syncState.lock.then(async () => {
    syncState.pending = false;  // ← wird sofort false, Upload läuft noch
    while (await ausstehendHochladen()) { }
})
```

Änderungen, die zwischen dem Reset und dem Ende des Uploads einlaufen, können verloren gehen.

**Fix:** `syncState.pending = false` erst nach der `while`-Schleife setzen.

---

### [HOCH] B2 – Foto-IDB-Referenz wird ersetzt, bevor der Schreibvorgang abgeschlossen ist

**Datei:** `app.js:957-965`

```javascript
fotoInIdbSpeichern(item.itemId, parsed.imageSrc)
    .catch(err => console.warn("Foto-IDB Schreibfehler:", err));
const ref = IMAGE_IDB_REF_PREFIX + item.itemId + ...;
```

Die Data-URL wird durch eine IDB-Referenz ersetzt, noch bevor das `await` der Speicheroperation ausgewertet wurde. Schlägt der IDB-Write fehl, ist das Foto verloren.

**Fix:** `await fotoInIdbSpeichern(...)` und erst danach die Referenz setzen; Fehler als kritisch behandeln, nicht nur `console.warn`.

---

### [HOCH] B3 – Concurrent Sync: `pullInFlight`-Flag wird zu spät gesetzt

**Datei:** `app.js:1131-1159`

`vonRemoteAktualisieren()` prüft `syncState.pullInFlight`, setzt es aber erst nach weiteren asynchronen Checks. Zwei parallele Aufrufe können beide die Prüfung passieren.

**Fix:** `pullInFlight = true` als allererste Aktion im kritischen Abschnitt setzen.

---

## 3. Fehlerbehandlung

### [HOCH] F1 – Stille Fehler bei lokalen JSON-Daten

**Datei:** `app.js:974`

```javascript
} catch (err) {
    console.warn("Fehler beim lokalen Laden:", err);
    return [];
}
```

Bei korruptem localStorage-Inhalt wird die gesamte Liste kommentarlos verworfen. Der Nutzer bemerkt den Datenverlust nicht.

**Fix:** Den Nutzer über den Ladefehler informieren und – wenn möglich – einen Wiederherstellungsversuch anbieten.

---

### [MITTEL] F2 – Unbehandelte Promise-Rejections mit `void`

**Datei:** `app.js:1866, 1873`

Mehrere `void somePromise().catch(...)` haben zwar catch-Handler, aber der initiale Ladefehler wird nur geloggt, nicht angezeigt.

**Fix:** Kritische Ladefehler in der UI sichtbar machen.

---

### [MITTEL] F3 – Generische catch-Blöcke ohne Kontext

**Datei:** `app.js:483, 988`

```javascript
} catch { return leereSyncMetaErstellen(); }
```

Kein Logging, kein Kontext. Fehler bleiben unsichtbar.

**Fix:** Mindestens `console.warn` mit Beschreibung und dem gefangenen Fehler.

---

## 4. Performance

### [MITTEL] P1 – DOM-Suche bei jedem Einzeleintrag (O(n²))

**Datei:** `app.js:1375-1378`

```javascript
const firstText = liste.querySelector("li:not(.foto-eintrag)");
const firstPhoto = liste.querySelector("li.foto-eintrag");
```

Bei jedem Einfügen wird die gesamte Liste durchsucht. Bei großen Listen und mehrfachen Einfügungen entsteht quadratische Komplexität.

**Fix:** Position einmalig ermitteln oder Batch-Einfügung nutzen.

---

### [MITTEL] P2 – Gruppen-Index-Cache wird bei Konfigurationsänderung nicht invalidiert

**Datei:** `utils.js:77-96`

`_groupIndexCache` (globale Map) cached Gruppen-Indizes, aber es gibt keine Invalidierung bei Änderung von `storeGroupOrder`.

**Fix:** Cache leeren, sobald sich `GROUP_ORDER` ändert.

---

### [MITTEL] P3 – Unnötige Event-Listener werden bei jedem `hintergrundSyncStarten()` neu registriert

**Datei:** `app.js:1185-1190`

```javascript
window.removeEventListener("focus", _onSyncFocus);
window.addEventListener("focus", _onSyncFocus);
```

Listener sollten einmalig bei der Initialisierung registriert werden.

---

### [MITTEL] P4 – Exzessive `String(value || "")`-Konvertierungen in Schleifen

**Datei:** `app.js:169, 177, 184, 445` u. a.

Mehrfache temporäre String-Objekte in Hot Paths.

**Fix:** Konvertierung in Helper auslagern oder direkte Typprüfung nutzen.

---

## 5. Async / Race Conditions

### [HOCH] A1 – Snapshot-Anwendung ignoriert Änderungen während des Schreibens

**Datei:** `app.js:505-550`

```javascript
function aenderungenEinstellen(currentData) {
    if (snapshotWirdAngewendet) return false;  // Änderungen werden still verworfen
```

Nutzeränderungen, die während `aenderungenEinstellen()` einlaufen, gehen verloren.

**Fix:** Änderungen puffern und nach Ende des Snapshots anwenden.

---

### [HOCH] A2 – Snapshot-Flag `snapshotWirdAngewendet` wird nicht in allen Codepfaden überprüft

**Datei:** `app.js:146` (Deklaration), diverse Verwendungsstellen

Das Flag schützt nicht alle relevanten Pfade; manche Sync-Trigger prüfen es nicht.

**Fix:** Alle Eintrittspunkte für Dateiänderungen absichern.

---

### [MITTEL] A3 – Mikrofon-Session-Timer wird bei Spracherkennungsfehlern nicht immer gecleared

**Datei:** `app.js:1419, 1633-1638`

Wenn `onerror` des SpeechRecognition-Objekts auslöst, bleibt `micSessionTimer` in bestimmten Zweigen aktiv.

**Fix:** `clearTimeout(micSessionTimer)` in den `onerror`-Handler aufnehmen.

---

## 6. Validierung

### [HOCH] V1 – Remote-Daten werden ohne Typprüfung übernommen

**Datei:** `app.js:1014-1041`

`remoteZeilenAnwenden()` übernimmt alle Felder aus der Datenbank ohne Typ- oder Schemaprüfung. Fehlerhafte oder manipulierte Daten können die App zum Absturz bringen.

**Fix:** Jedes Feld explizit prüfen (Typ, erlaubte Werte, Länge) bevor es verarbeitet wird.

---

### [MITTEL] V2 – Keine Längenvalidierung bei Mehrfacheingabe

**Datei:** `app.js:1401-1404`

```javascript
text.split("\n").map(l => l.trim()).filter(Boolean).forEach(item => eintragAnlegen(item));
```

Nutzer können beliebig viel Text einfügen; kein Limit für Zeilen oder Gesamtlänge.

**Fix:** Maximale Anzahl Zeilen und maximale Zeichenlänge pro Eintrag begrenzen.

---

### [MITTEL] V3 – Keine Größenvalidierung vor Canvas-Operationen

**Datei:** `app.js:1509-1537`

Sehr große Bilder (z. B. 50 MP) können vor dem Skalieren den Browser-Speicher überlasten.

**Fix:** Vor dem Zeichnen auf Canvas eine Obergrenze für `image.width * image.height` prüfen.

---

### [MITTEL] V4 – Foto-Metadaten ohne Validierung

**Datei:** `app.js:1260`

Für `isPhotoEntryText()` wird kein Rückgabewert auf Gültigkeit geprüft; fehlerhafte Einträge können das UI brechen.

**Fix:** Rückgabewert defensiv behandeln, Pflichtfelder explizit prüfen.

---

## 7. Bad Practices

### [MITTEL] BP1 – Globaler Zustand mit 20+ Variablen

**Datei:** `app.js` (viele Stellen)

Variablen wie `modus`, `isListening`, `finalTranscript`, `syncState` etc. sind alle global und werden aus zahlreichen Funktionen heraus mutiert. Das erschwert Debugging und Testing erheblich.

**Fix:** Verwandten Zustand in Objekte kapseln; keine unnötigen globalen Schreibzugriffe.

---

### [MITTEL] BP2 – `window.prompt()` und `window.alert()` als UI

**Datei:** `app.js:419, 1324, 1828, 1830`

Blockierende Browser-Dialoge sind schlechte UX, können auf langsamen Geräten timeouten und sind nicht gestalterisch anpassbar.

**Fix:** Eigene modale Dialoge implementieren.

---

### [MITTEL] BP3 – Secure-Context-Prüfung nur für Localhost

**Datei:** `app.js:1729-1731`

```javascript
if (!window.isSecureContext && !istLokalhost()) { ... }
```

Auf Nicht-Localhost-Hosts ohne HTTPS könnte Spracherkennung trotzdem versucht werden.

**Fix:** Prüfung vereinfachen: `if (!window.isSecureContext) { ... }` ohne Localhost-Ausnahme für Produktion.

---

### [MITTEL] BP4 – `liste.innerHTML = ""` statt `replaceChildren()`

**Datei:** `app.js:943`

Ineffizient; `replaceChildren(fragment)` ist semantisch klarer und atomarer.

---

## 8. Niedrig / Sonstiges

### [NIEDRIG] N1 – Service Worker: HTML-Fallback für API-Anfragen

**Datei:** `service-worker.js:68-82`

Mehrere Fallbacks auf `./index.html` – API-Aufrufe, die scheitern, erhalten eine HTML-Antwort, was zu schwer debugbaren Fehlern führt.

**Fix:** Fallback nur für Navigations-Requests (`request.mode === 'navigate'`) anwenden.

---

### [NIEDRIG] N2 – Fehlgeschlagene Syncs werden nicht automatisch wiederholt

**Datei:** `app.js:1094-1129`

Netzwerkfehler während des Syncs bleiben dauerhaft im `pending`-Zustand ohne Retry-Mechanismus.

**Fix:** Exponentielles Backoff mit maximalem Retry-Limit implementieren.

---

### [NIEDRIG] N3 – Fehlende Null-Checks für DOM-Elemente

**Datei:** `app.js:19` u. a.

```javascript
const liste = document.getElementById("liste");
```

Wenn das Element fehlt (z. B. durch Template-Fehler), crasht die gesamte App.

**Fix:** Kritische DOM-Elemente beim Start prüfen und bei Fehlen eine verständliche Fehlermeldung ausgeben.

---

### [NIEDRIG] N4 – Ungenutzte Variablen

**Datei:** `app.js:122, 146`

- `micSessionTimer` – nur für Cleanup, nie gelesen
- `snapshotWirdAngewendet` – wird in kritischen Pfaden nicht konsistent geprüft (siehe A2)

**Fix:** Entweder konsequent einsetzen oder entfernen.

---

## Priorisierung

| Priorität | Issues                           |
|-----------|----------------------------------|
| Sofort    | B2, A1, V1, S3                   |
| Kurzfristig | B1, B3, A2, F1, S2             |
| Mittelfristig | P1, V2, BP1, F2, F3          |
| Backlog   | P2, P3, P4, V3, V4, BP2–4, N1–4 |
