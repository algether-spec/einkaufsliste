/* ======================
   APP.JS
   Einstiegspunkt – führt alle Module zusammen und startet die App.
====================== */

modusSetzen(MODUS_ERFASSEN);
if (versionBadge) versionBadge.textContent = "v" + APP_VERSION;
syncDebugAktualisieren();

if (btnMic && !SpeechRecognitionCtor) {
    btnMic.disabled = true;
    btnMic.title = "Spracherkennung wird hier nicht unterstuetzt";
    mikStatusSetzen("Spracherkennung wird in diesem Browser nicht unterstuetzt.");
}

// URL-Code VOR syncCodeUiEinrichten auswerten: syncCodeLaden() würde sonst einen eigenen
// Code generieren und async dagegen konkurrieren (Race Condition → falscher Code aktiv).
const _preExistingCode = syncCodeNormalisieren(localStorage.getItem(SYNC_CODE_KEY) || "");
const _rawUrlCode = new URLSearchParams(location.search).get("code");
const _normalizedUrlCode = _rawUrlCode ? syncCodeNormalisieren(_rawUrlCode) : "";
const _hatVorherigenCode = istGueltigerSyncCode(_preExistingCode) && !istReservierterSyncCode(_preExistingCode);
const _urlCodeGueltig = istGueltigerSyncCode(_normalizedUrlCode);
const _urlCodeAutoAnwenden = _urlCodeGueltig && (!_hatVorherigenCode || _preExistingCode === _normalizedUrlCode);

if (_urlCodeAutoAnwenden) {
    // localStorage + IDB speichern – IDB als Backup falls PWA-localStorage leer ist
    syncCodeSpeichern(_normalizedUrlCode);
    // ?code= NICHT aus der URL entfernen: iOS speichert die aktuelle URL als PWA-Start-URL.
    // Bleibt ?code= erhalten, übernimmt die PWA beim ersten Start automatisch den richtigen Code.
}

if (_rawUrlCode) {
    const _cleanUrl = new URL(location.href);
    if (!_urlCodeAutoAnwenden) {
        // Konflikt-Fall: Code im Editor anzeigen, URL bereinigen
        _cleanUrl.searchParams.delete("code");
    }
    _cleanUrl.searchParams.delete("u");
    history.replaceState(null, "", _cleanUrl.toString());
}

const _initPromise = syncCodeUiEinrichten();

// Bestehender Code weicht vom URL-Code ab → Editor zeigen, Nutzer bestätigt
// Nach dem async warten, damit syncCodeAnwenden den Input nicht überschreibt.
if (_urlCodeGueltig && _hatVorherigenCode && _preExistingCode !== _normalizedUrlCode) {
    Promise.resolve(_initPromise).then(() => {
        if (syncCodeInput) syncCodeInput.value = _normalizedUrlCode;
        syncBearbeitungsmodusSetzen(true);
        authStatusSetzen(`Geteilter Code: ${_normalizedUrlCode} – Verbinden zum Beitreten.`);
    });
}

if (btnForceUpdate) btnForceUpdate.onclick = () => void updateErzwingen();
autoUpdateEinrichten();

if (supabaseClient) {
    hintergrundSyncStarten();
    void laden().catch(err => {
        console.warn("Initiales Laden fehlgeschlagen:", err);
        syncStatusSetzen("Ladefehler – App neu laden", "offline");
    });
} else {
    syncStatusSetzen("Sync: Lokal", "offline");
    syncDebugAktualisieren();
    void ladenLokal().then(daten => {
        datenInListeSchreiben(daten);
        modusSortierungAnwenden();
    }).catch(err => console.warn("Lokales Laden fehlgeschlagen:", err));
}

// SW-Registrierung (ermöglicht CSP ohne 'unsafe-inline')
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js?v=" + APP_VERSION, { updateViaCache: "none" });
}
