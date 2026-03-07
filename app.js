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

// URL-Code VOR syncCodeUiEinrichten auswerten.
// Hash (#code=...) hat Vorrang – iOS Safari überträgt den Hash bei "Zum Home-Bildschirm
// hinzufügen" zuverlässig in die PWA-Start-URL. Query-Param (?code=) bleibt als Fallback
// für ältere geteilte Links.
const _hashParams = new URLSearchParams(location.hash.slice(1));
const _rawHashCode = _hashParams.get("code");
const _rawQueryCode = new URLSearchParams(location.search).get("code");
const _rawUrlCode = _rawHashCode || _rawQueryCode;
const _normalizedUrlCode = _rawUrlCode ? syncCodeNormalisieren(_rawUrlCode) : "";

// Permanent-Slot zuerst prüfen: wurde der Code je bewusst gesetzt, gilt er als vorhandener Code.
const _preExistingCode = syncCodeNormalisieren(
    localStorage.getItem(SYNC_CODE_PERMANENT_KEY) ||
    localStorage.getItem(SYNC_CODE_KEY) || ""
);
const _hatVorherigenCode = istGueltigerSyncCode(_preExistingCode) && !istReservierterSyncCode(_preExistingCode);
const _urlCodeGueltig = istGueltigerSyncCode(_normalizedUrlCode);
const _urlCodeAutoAnwenden = _urlCodeGueltig && (!_hatVorherigenCode || _preExistingCode === _normalizedUrlCode);

if (_urlCodeAutoAnwenden) {
    syncCodePermanentSpeichern(_normalizedUrlCode);
}

// Hash NIEMALS entfernen – iOS überträgt ihn in die PWA-Start-URL beim Homescreen-Install.
// Nur Query-Params bereinigen (?code= im Konfliktfall, ?u= immer).
const _hasQueryToClean = _rawQueryCode || new URLSearchParams(location.search).get("u");
if (_hasQueryToClean) {
    const _cleanUrl = new URL(location.href);
    if (_rawQueryCode && !_urlCodeAutoAnwenden) {
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
