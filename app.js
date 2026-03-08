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

const _hashParams = new URLSearchParams(location.hash.slice(1));
// Einladungs-Link: #invite=<device_id> → Code aus Supabase laden (nach Init)
const _inviteDeviceId = _hashParams.get("invite");
// Rückwärtskompatibilität: #code=XXXX oder ?code=XXXX (ältere geteilte Links)
const _rawHashCode = _hashParams.get("code");
const _rawQueryCode = new URLSearchParams(location.search).get("code");
const _rawUrlCode = _rawHashCode || _rawQueryCode;
const _normalizedUrlCode = _rawUrlCode ? syncCodeNormalisieren(_rawUrlCode) : "";

// Permanent-Slot hat IMMER Vorrang – er enthält den zuletzt bewusst gesetzten Code.
// URL-Code (#code=) wird NUR übernommen wenn noch kein permanenter Code existiert.
const _preExistingCode = syncCodeNormalisieren(
    localStorage.getItem(SYNC_CODE_PERMANENT_KEY) ||
    localStorage.getItem(SYNC_CODE_KEY) || ""
);
const _hatVorherigenCode = istGueltigerSyncCode(_preExistingCode) && !istReservierterSyncCode(_preExistingCode);
const _urlCodeGueltig = istGueltigerSyncCode(_normalizedUrlCode);

// #code= Auto-Anwenden nur wenn KEIN permanenter Code vorhanden und Code nicht reserviert
const _urlCodeAutoAnwenden = _urlCodeGueltig && !istReservierterSyncCode(_normalizedUrlCode) && !_hatVorherigenCode && !_inviteDeviceId;

if (_urlCodeAutoAnwenden) {
    syncCodePermanentSpeichern(_normalizedUrlCode);
    localStorage.setItem(SYNC_CODE_INSTALL_URL_KEY, _normalizedUrlCode);
}

// Nur Query-Params bereinigen (?code=, ?u= immer). Hash NIEMALS entfernen.
const _hasQueryToClean = _rawQueryCode || new URLSearchParams(location.search).get("u");
if (_hasQueryToClean) {
    const _cleanUrl = new URL(location.href);
    if (_rawQueryCode && !_urlCodeAutoAnwenden) _cleanUrl.searchParams.delete("code");
    _cleanUrl.searchParams.delete("u");
    history.replaceState(null, "", _cleanUrl.toString());
}

const _initPromise = syncCodeUiEinrichten();

// #invite=<device_id>: Code aus Supabase laden und anwenden / Konflikt-Dialog zeigen.
// Funktioniert unabhängig von localStorage-Isolation zwischen Safari und PWA auf iOS:
// Die device_id bleibt in der URL, der aktuelle Code wird immer frisch aus Supabase gelesen.
if (_inviteDeviceId && supabaseClient) {
    Promise.resolve(_initPromise).then(async () => {
        authStatusSetzen("Einladung wird geladen...");
        const inviteCode = await syncCodeAusEinladungLaden(_inviteDeviceId);
        if (!inviteCode) {
            authStatusSetzen("Einladung nicht gefunden. Bitte direkt einen Code eingeben.");
            return;
        }
        const _normalizedInvite = syncCodeNormalisieren(inviteCode);
        if (!istGueltigerSyncCode(_normalizedInvite) || istReservierterSyncCode(_normalizedInvite)) return;

        // Bereits auf diesem Code → kein Dialog nötig
        if (_normalizedInvite === currentSyncCode) {
            authStatusSetzen(`Geraete-Code: ${currentSyncCode}`);
            return;
        }

        if (!currentSyncCode || !istGueltigerSyncCode(currentSyncCode)) {
            // Kein bestehender Code → direkt übernehmen (Erstinstall / frische PWA)
            localStorage.setItem(SYNC_INVITE_DEVICE_KEY, _inviteDeviceId);
            await syncCodeAnwenden(_normalizedInvite, true, { allowOccupied: true });
        } else {
            // Bestehender Code weicht ab → Konflikt-Dialog anzeigen
            localStorage.setItem(SYNC_INVITE_DEVICE_KEY, _inviteDeviceId);
            if (syncCodeInput) syncCodeInput.value = _normalizedInvite;
            syncBearbeitungsmodusSetzen(true);
            authStatusSetzen(`Einladung: Code ${_normalizedInvite} – Verbinden zum Beitreten.`);
        }
    });
} else if (_urlCodeGueltig && _hatVorherigenCode && _preExistingCode !== _normalizedUrlCode && !_urlCodeAutoAnwenden) {
    // Rückwärtskompatibilität #code=: Konflikt-Dialog für echte neue Links
    const _installUrlCode = syncCodeNormalisieren(localStorage.getItem(SYNC_CODE_INSTALL_URL_KEY) || "");
    if (_installUrlCode !== _normalizedUrlCode) {
        Promise.resolve(_initPromise).then(() => {
            if (syncCodeInput) syncCodeInput.value = _normalizedUrlCode;
            syncBearbeitungsmodusSetzen(true);
            authStatusSetzen(`Geteilter Code: ${_normalizedUrlCode} – Verbinden zum Beitreten.`);
        });
    }
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

// SW-Registrierung + aktuellen Code an den SW übermitteln damit das Manifest
// dynamisch mit start_url ausgeliefert werden kann (für PWA-Install).
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js?v=" + APP_VERSION, { updateViaCache: "none" });
    navigator.serviceWorker.ready.then(reg => {
        const _swCode = localStorage.getItem(SYNC_CODE_PERMANENT_KEY) || localStorage.getItem(SYNC_CODE_KEY);
        if (_swCode && reg.active) {
            reg.active.postMessage({ type: "SET_SYNC_CODE", code: _swCode });
        }
    }).catch(() => {});
}
