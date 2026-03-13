/* ======================
   SYNC.JS
   Sync-Logik, Code-Verwaltung, Meta-Daten, Update-Mechanismus.
====================== */

/* --- Sync-Zustand ----------------------------------------------- */

let currentSyncCode = "";
let currentDeviceRole = "";
let currentInstallJoinToken = "";
let currentInstallContextKey = "";
let syncEditMode = false;
let lastSyncAt = "";
let hintergrundTimer = null;
let updatePruefTimer = null;
let snapshotWirdAngewendet = false;
let _aenderungenNachSnapshotAusstehend = false;
let _speichernSyncTimer = null;
let _geraeteAnzahlTimer = null;
let _geraeteAnzahlKanal = null;
let _geraeteAnzahl = 0;

const syncState = {
    lock: Promise.resolve(),
    pending: false,
    pullInFlight: false,
    dirty: false
};


/* --- Sync-Code Validierung & Generierung ------------------------ */

function syncCodeNormalisieren(input) {
    const raw = String(input || "").toUpperCase();
    const letters = raw.replace(/[^A-Z]/g, "").slice(0, 4);
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    return (letters + digits).slice(0, SYNC_CODE_LENGTH);
}

function istGueltigerSyncCode(code) {
    return /^[A-Z]{4}[0-9]{4}$/.test(String(code || ""));
}

function istReservierterSyncCode(code) {
    return code === RESERVED_SYNC_CODE;
}

function istGueltigeGeraeteRolle(rolle) {
    return rolle === "hauptgeraet" || rolle === "gast";
}

function joinTokenErzeugen() {
    const raw = window.crypto?.randomUUID
        ? window.crypto.randomUUID().replace(/-/g, "")
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
    return raw.toLowerCase();
}

function syncCodeErzeugen() {
    const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let nextCode = RESERVED_SYNC_CODE;
    while (istReservierterSyncCode(nextCode)) {
        let letters = "";
        for (let i = 0; i < 4; i += 1) {
            letters += LETTERS[Math.floor(Math.random() * LETTERS.length)];
        }
        const digits = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
        nextCode = letters + digits;
    }
    return nextCode;
}

function syncCodeSpeichern(code) {
    localStorage.setItem(SYNC_CODE_KEY, code);
    syncCodeInIdbSpeichern(code).catch(() => {}); // fire-and-forget
}

// Wie syncCodeSpeichern, aber schreibt ZUSÄTZLICH in den permanenten Slot.
// Der Service Worker erhält den Install-Kontext separat, sobald Rolle und Code
// serverseitig feststehen.
// Nur für bewusst gesetzte Codes (URL-Link, Nutzer-Aktion) aufrufen –
// NIEMALS für auto-generierte Codes.
function syncCodePermanentSpeichern(code) {
    localStorage.setItem(SYNC_CODE_PERMANENT_KEY, code);
    syncCodeSpeichern(code);
    void einladungInDbSpeichern(code); // Einladungs-Eintrag aktuell halten
}

// Schreibt {device_id → sync_code} in sync_invites, damit Einladungs-Links
// immer den aktuellen Code liefern – auch wenn der Code später geändert wird.
async function einladungInDbSpeichern(code) {
    if (!supabaseClient) return;
    if (!istGueltigerSyncCode(code) || istReservierterSyncCode(code)) return;
    try {
        if (!(await authSicherstellen())) return;
        await supabaseClient.from("sync_invites").upsert({
            device_id: geraeteIdLaden(),
            sync_code: code,
            updated_at: new Date().toISOString()
        }, { onConflict: "device_id" });
    } catch (err) {
        console.warn("Einladung in DB speichern fehlgeschlagen:", err);
    }
}

/* --- Geräte-Rolle ----------------------------------------------- */

// "hauptgeraet" = eigener Code, kann teilen
// "gast"        = fremder Code, nur lesen/bearbeiten
// ""            = neu, noch nicht festgelegt

function geraetRolleLesen() {
    return currentDeviceRole || "";
}

function geraetRolleSetzen(rolle) {
    currentDeviceRole = istGueltigeGeraeteRolle(rolle) ? rolle : "";
    geraetRolleUiAktualisieren();
}

// Speichert die Rolle in Supabase – überlebt iOS-PWA-Install (localStorage-Isolation).
async function geraetRolleInSupabaseSpeichern(rolle, syncCode) {
    if (!supabaseClient || !istGueltigeGeraeteRolle(rolle) || !syncCode) return;
    try {
        if (!(await authSicherstellen())) return;
        await supabaseClient.from("device_roles").upsert({
            device_id: geraeteIdLaden(),
            rolle,
            sync_code: syncCode,
            updated_at: new Date().toISOString()
        }, { onConflict: "device_id" });
    } catch (err) {
        console.warn("Geräte-Rolle in Supabase speichern fehlgeschlagen:", err);
    }
}

function geraetRolleUiAktualisieren() {
    const rolle = geraetRolleLesen();
    const hatCode = istGueltigerSyncCode(currentSyncCode) && !istReservierterSyncCode(currentSyncCode);

    // Teilen: nur Hauptgerät mit gültigem Code sichtbar
    if (btnSyncCodeShare) btnSyncCodeShare.hidden = (rolle !== "hauptgeraet" || !hatCode);

    // Verbinden: nur für neue Geräte (Rolle noch leer)
    if (btnSyncConnect) btnSyncConnect.hidden = (rolle !== "");

    // Versions-Badge: Rolle + Geräte-Anzahl anzeigen
    if (versionBadge) {
        const anzahlLabel = (rolle === "hauptgeraet" && _geraeteAnzahl > 0) ? ` · ${_geraeteAnzahl}` : "";
        const rolleLabel = rolle === "hauptgeraet" ? " · Hauptgerät"
                         : rolle === "gast"        ? " · Gast"
                         : "";
        versionBadge.textContent = "v" + APP_VERSION + rolleLabel + anzahlLabel;
    }

    // Geräte-Anzahl: nur Hauptgerät
    if (rolle === "hauptgeraet" && hatCode) {
        if (!_geraeteAnzahlKanal) geraeteAnzahlSyncStarten();
    } else {
        geraeteAnzahlSyncStoppen();
    }
}

async function _geraeteAnzahlAktualisieren() {
    if (geraetRolleLesen() !== "hauptgeraet" || !currentSyncCode) return;
    _geraeteAnzahl = await geraeteAnzahlLaden(currentSyncCode);
    geraetRolleUiAktualisieren();
}

function geraeteAnzahlSyncStarten() {
    geraeteAnzahlSyncStoppen();
    if (!supabaseClient || !currentSyncCode || geraetRolleLesen() !== "hauptgeraet") return;

    void _geraeteAnzahlAktualisieren();
    _geraeteAnzahlTimer = setInterval(() => void _geraeteAnzahlAktualisieren(), 30000);

    _geraeteAnzahlKanal = supabaseClient
        .channel(`device_roles_${currentSyncCode}`)
        .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: "device_roles",
            filter: `sync_code=eq.${currentSyncCode}`
        }, () => void _geraeteAnzahlAktualisieren())
        .subscribe(status => {
            if (status === "CHANNEL_ERROR") {
                console.warn("Geraete-Realtime Fehler, nutze Polling.");
                try { supabaseClient.removeChannel(_geraeteAnzahlKanal); } catch (_) {}
                _geraeteAnzahlKanal = null;
            }
        });
}

function geraeteAnzahlSyncStoppen() {
    if (_geraeteAnzahlTimer) { clearInterval(_geraeteAnzahlTimer); _geraeteAnzahlTimer = null; }
    if (_geraeteAnzahlKanal && supabaseClient) {
        try { supabaseClient.removeChannel(_geraeteAnzahlKanal); } catch (_) {}
        _geraeteAnzahlKanal = null;
    }
    _geraeteAnzahl = 0;
}


function _swInstallKontextSenden(context = {}) {
    if (!("serviceWorker" in navigator)) return;
    const ctrl = navigator.serviceWorker.controller;
    const payload = {
        type: "SET_INSTALL_CONTEXT",
        joinToken: String(context.joinToken || ""),
        inviteDeviceId: String(context.inviteDeviceId || ""),
        code: String(context.code || "")
    };
    if (ctrl) {
        ctrl.postMessage(payload);
        return;
    }
    // Falls SW noch nicht aktiv ist (erster Seitenaufruf): nach Bereitschaft warten
    navigator.serviceWorker.ready.then(reg => {
        if (reg.active) reg.active.postMessage(payload);
    }).catch(() => {});
}

async function installKontextAktualisieren() {
    if (!supabaseClient) return;
    const rolle = geraetRolleLesen();
    if (!istGueltigeGeraeteRolle(rolle) || !istGueltigerSyncCode(currentSyncCode)) return;
    const nextKey = `${rolle}:${currentSyncCode}`;
    if (currentInstallJoinToken && currentInstallContextKey === nextKey) {
        _swInstallKontextSenden({ joinToken: currentInstallJoinToken, code: currentSyncCode });
        return;
    }
    const joinToken = joinTokenErzeugen();
    const saved = await joinTokenInSupabaseSpeichern(joinToken, rolle, currentSyncCode, {
        createdByDeviceId: geraeteIdLaden(),
        expiresInMs: 1000 * 60 * 60 * 24 * 30
    });
    if (saved?.joinToken) {
        currentInstallJoinToken = saved.joinToken;
        currentInstallContextKey = nextKey;
        _swInstallKontextSenden({ joinToken: currentInstallJoinToken, code: currentSyncCode });
    } else {
        // Fallback wenn device_join_tokens Tabelle fehlt oder Netzwerkfehler:
        // Gäste nutzen #invite=<deviceId> (liest sync_invites → keine neuen Tabellen nötig).
        // Hauptgerät nutzt #code=<code> (Rolle wird beim PWA-Start aus Supabase geladen).
        const inviteDeviceId = rolle === "gast" ? geraeteIdLaden() : "";
        _swInstallKontextSenden({ inviteDeviceId, code: currentSyncCode });
    }
}

async function initialenGeraeteStatusErmitteln(options = {}) {
    const deviceId = geraeteIdLaden();
    const joinToken = String(options.joinToken || "").trim();
    const legacyInviteDeviceId = String(options.legacyInviteDeviceId || "").trim();

    if (supabaseClient) {
        const bestehend = await geraetStatusAusSupabaseLaden(deviceId);
        if (bestehend?.rolle && bestehend?.syncCode) return bestehend;

        if (joinToken) {
            const viaJoin = await geraetStatusMitJoinTokenRegistrieren(deviceId, joinToken);
            if (viaJoin?.rolle && viaJoin?.syncCode) return viaJoin;
        }

        if (legacyInviteDeviceId) {
            const legacyStatus = await gastStatusAusLegacyEinladungLaden(legacyInviteDeviceId);
            if (legacyStatus?.syncCode) {
                await geraetRolleInSupabaseSpeichern("gast", legacyStatus.syncCode);
                return legacyStatus;
            }
        }
    }

    return null;
}

function zielRolleFuerCodeAnwenden(options = {}) {
    const explicitRole = istGueltigeGeraeteRolle(options.targetRole) ? options.targetRole : "";
    if (explicitRole) return explicitRole;
    if (istGueltigeGeraeteRolle(currentDeviceRole)) return currentDeviceRole;
    if (options.disableAutoRole) return "";
    return options.userInitiated ? "gast" : "hauptgeraet";
}

function syncCodeLaden() {
    const stored = syncCodeNormalisieren(localStorage.getItem(SYNC_CODE_KEY) || "");
    if (istGueltigerSyncCode(stored) && !istReservierterSyncCode(stored)) return stored;
    const created = syncCodeErzeugen();
    syncCodeSpeichern(created);
    return created;
}

async function syncCodeLadenMitBackup() {
    // 1. Permanenter Slot (nur durch bewusste Nutzer-/Link-Aktion gesetzt)
    const fromPermanent = syncCodeNormalisieren(localStorage.getItem(SYNC_CODE_PERMANENT_KEY) || "");
    if (istGueltigerSyncCode(fromPermanent) && !istReservierterSyncCode(fromPermanent)) {
        // Normalen Slot synchron halten
        localStorage.setItem(SYNC_CODE_KEY, fromPermanent);
        return fromPermanent;
    }

    // 2. Normaler localStorage-Slot
    const fromLs = syncCodeNormalisieren(localStorage.getItem(SYNC_CODE_KEY) || "");
    if (istGueltigerSyncCode(fromLs) && !istReservierterSyncCode(fromLs)) return fromLs;

    // 3. IndexedDB-Backup
    try {
        const fromIdb = syncCodeNormalisieren((await syncCodeAusIdbLaden()) || "");
        if (istGueltigerSyncCode(fromIdb) && !istReservierterSyncCode(fromIdb)) {
            localStorage.setItem(SYNC_CODE_KEY, fromIdb);
            return fromIdb;
        }
    } catch (_) { /* ignore */ }

    // 4. Neuen Code erzeugen – NUR wenn kein permanent-Slot vorhanden
    const created = syncCodeErzeugen();
    syncCodeSpeichern(created); // bewusst KEIN syncCodePermanentSpeichern
    return created;
}

async function verfuegbarenSyncCodeErzeugen(maxAttempts = 25) {
    let last = syncCodeErzeugen();
    for (let i = 0; i < maxAttempts; i += 1) {
        const candidate = syncCodeErzeugen();
        if (candidate !== currentSyncCode && !istReservierterSyncCode(candidate)) return candidate;
        last = candidate;
    }
    return last;
}


/* --- Sync-Code Anwenden ----------------------------------------- */

async function syncCodeAnwenden(code, shouldReload = true, options = {}) {
    const allowOccupied = options.allowOccupied !== false;
    const userInitiated = options.userInitiated === true;
    const normalized = syncCodeNormalisieren(code);
    const zielRolle = zielRolleFuerCodeAnwenden({
        targetRole: options.targetRole,
        userInitiated,
        disableAutoRole: options.disableAutoRole === true
    });
    if (!istGueltigerSyncCode(normalized)) {
        authStatusSetzen("Bitte Code im Format AAAA1234 eingeben.");
        if (userInitiated) syncBearbeitungsmodusSetzen(true);
        return;
    }
    if (istReservierterSyncCode(normalized)) {
        authStatusSetzen("Code HELP0000 ist reserviert und kann nicht verwendet werden.");
        if (syncCodeInput) syncCodeInput.value = currentSyncCode || "";
        if (userInitiated) syncBearbeitungsmodusSetzen(true);
        return;
    }

    // Beim initialen Laden: Code sofort lokal setzen – sichtbar auch ohne Netz/Supabase
    if (!userInitiated) {
        currentSyncCode = normalized;
        syncCodeSpeichern(currentSyncCode);
        if (btnSyncCodeDisplay) btnSyncCodeDisplay.textContent = currentSyncCode;
        if (syncCodeInput) syncCodeInput.value = currentSyncCode;
        syncDebugAktualisieren();
    }

    // Ohne Supabase-Client: nur lokal speichern, kein Netzwerk-Fehler anzeigen
    if (!supabaseClient) {
        eingabeFehlerSetzen("");
        if (userInitiated) {
            currentSyncCode = normalized;
            syncCodePermanentSpeichern(currentSyncCode);
            if (btnSyncCodeDisplay) btnSyncCodeDisplay.textContent = currentSyncCode;
            authStatusSetzen("Sync nicht verfuegbar. Code lokal gespeichert.");
            syncBearbeitungsmodusSetzen(false);
            syncDebugAktualisieren();
        }
        geraetRolleSetzen(zielRolle);
        return;
    }

    try {
        await syncCodeRpcVerwenden(normalized, {
            allowCreate: true,
            requireNew: !allowOccupied && normalized !== currentSyncCode
        });
    } catch (err) {
        console.warn("Code-Verbinden fehlgeschlagen:", err);
        const hint = syncFehlerHinweis(err);
        const istBelegt = String(fehlerFormatieren(err)).includes("SYNC_CODE_ALREADY_EXISTS");

        if (istBelegt) {
            // Code-Konflikt: nicht speichern, Nutzer muss anderen Code wählen
            authStatusSetzen("Code ist bereits belegt. Bitte anderen Code nutzen.");
            if (userInitiated && syncCodeInput) {
                syncBearbeitungsmodusSetzen(true);
                syncCodeInput.value = currentSyncCode || normalized || "";
                syncCodeInput.focus();
                syncCodeInput.select();
            }
        } else {
            // Netzwerk-/Auth-Fehler: Code lokal speichern damit er nach PWA-Neustart erhalten bleibt
            currentSyncCode = normalized;
            syncCodePermanentSpeichern(currentSyncCode);
            if (btnSyncCodeDisplay) btnSyncCodeDisplay.textContent = currentSyncCode;
            authStatusSetzen(hint);
            if (userInitiated) syncBearbeitungsmodusSetzen(false);
            geraetRolleSetzen(zielRolle);
            syncDebugAktualisieren();
        }
        return;
    }

    currentSyncCode = normalized;
    syncCodePermanentSpeichern(currentSyncCode);
    if (syncCodeInput) syncCodeInput.value = currentSyncCode;
    if (btnSyncCodeDisplay) btnSyncCodeDisplay.textContent = currentSyncCode;
    authStatusSetzen(`Geraete-Code: ${currentSyncCode}`);
    eingabeFehlerSetzen("");
    geraetRolleSetzen(zielRolle);
    await geraetRolleInSupabaseSpeichern(zielRolle, currentSyncCode);
    await installKontextAktualisieren();
    if (userInitiated) syncBearbeitungsmodusSetzen(false);
    if (syncCodeInput) syncCodeInput.blur();
    if (supabaseClient) echtzeitSyncStarten();
    syncDebugAktualisieren();
    if (shouldReload) void laden();
}

async function syncCodeTeilen() {
    if (!currentSyncCode || !istGueltigerSyncCode(currentSyncCode)) {
        authStatusSetzen("Kein gültiger Code zum Teilen vorhanden.");
        return;
    }
    const shareUrl = new URL(location.origin + location.pathname);

    // Für neue Geräte wird ein serverseitiger Join-Token erstellt.
    // Rolle und sync_code werden beim Start ausschliesslich aus Supabase geladen.
    if (supabaseClient) {
        try {
            const joinToken = joinTokenErzeugen();
            const gespeichert = await joinTokenInSupabaseSpeichern(joinToken, "gast", currentSyncCode, {
                createdByDeviceId: geraeteIdLaden(),
                expiresInMs: 1000 * 60 * 60 * 24 * 30
            });
            if (!gespeichert?.joinToken) throw new Error("JOIN_TOKEN_SAVE_FAILED");
            shareUrl.hash = "join=" + gespeichert.joinToken;
        } catch (_) {
            await einladungInDbSpeichern(currentSyncCode);
            shareUrl.hash = "invite=" + geraeteIdLaden(); // Legacy-Fallback
        }
    } else {
        shareUrl.hash = "code=" + currentSyncCode; // Offline-Fallback
    }

    const url = shareUrl.toString();

    if (navigator.share) {
        try {
            await navigator.share({
                title: "Einkaufsliste",
                text: `Tritt meiner Einkaufsliste bei! Code: ${currentSyncCode}`,
                url
            });
            return;
        } catch (err) {
            if (err.name === "AbortError") return;
        }
    }

    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        authStatusSetzen("Link kopiert! Zum Einfügen gedrückt halten.");
    } else {
        prompt("Link kopieren:", url);
    }
}

async function autoWiederverbinden() {
    if (!supabaseClient) return;
    if (keinNetzwerk()) return;
    if (syncEditMode) return;

    const candidate = syncCodeNormalisieren(currentSyncCode || localStorage.getItem(SYNC_CODE_KEY) || "");
    if (!istGueltigerSyncCode(candidate) || istReservierterSyncCode(candidate)) return;

    if (currentSyncCode !== candidate) {
        authStatusSetzen("Online erkannt. Verbinde mit gespeichertem Code...");
        await syncCodeAnwenden(candidate, false, { allowOccupied: true });
    }

    if (currentSyncCode === candidate) {
        authStatusSetzen("Online erkannt. Synchronisiere...");
        await syncWennNoetig();
    }
}


/* --- Sync-Meta -------------------------------------------------- */

function syncMetaSchuessel() {
    if (!currentSyncCode) return "";
    return SYNC_META_PREFIX + currentSyncCode;
}

function syncMetaLaden() {
    const key = syncMetaSchuessel();
    if (!key) return leereSyncMetaErstellen();
    const raw = localStorage.getItem(key);
    if (!raw) return leereSyncMetaErstellen();
    try {
        const parsed = JSON.parse(raw);
        const meta = leereSyncMetaErstellen();
        meta.opSeq = Number.isFinite(parsed?.opSeq) ? parsed.opSeq : 0;
        meta.pendingOps = Array.isArray(parsed?.pendingOps) ? parsed.pendingOps : [];
        meta.snapshot = normalizeSnapshotData(parsed?.snapshot || []);
        meta.lastRemoteSyncAt = String(parsed?.lastRemoteSyncAt || "");
        return meta;
    } catch {
        return leereSyncMetaErstellen();
    }
}

function syncMetaSpeichern(meta) {
    const key = syncMetaSchuessel();
    if (!key) return;
    localStorage.setItem(key, JSON.stringify({
        opSeq: Number.isFinite(meta?.opSeq) ? meta.opSeq : 0,
        pendingOps: Array.isArray(meta?.pendingOps) ? meta.pendingOps : [],
        snapshot: normalizeSnapshotData(meta?.snapshot || []),
        lastRemoteSyncAt: String(meta?.lastRemoteSyncAt || "")
    }));
}

function naechsteOpId(meta) {
    const seq = Number.isFinite(meta.opSeq) ? meta.opSeq + 1 : 1;
    meta.opSeq = seq;
    return `${geraeteIdLaden()}-${seq}`;
}


/* --- Änderungen einstellen -------------------------------------- */

function aenderungenEinstellen(currentData) {
    if (snapshotWirdAngewendet) {
        _aenderungenNachSnapshotAusstehend = true;
        return false;
    }
    const meta = syncMetaLaden();
    const previous = normalizeSnapshotData(meta.snapshot);
    const current = normalizeSnapshotData(currentData);
    const previousById = new Map(previous.map(item => [item.itemId, item]));
    const currentById = new Map(current.map(item => [item.itemId, item]));
    let queued = false;

    for (const item of current) {
        const prev = previousById.get(item.itemId);
        const changed = !prev
            || prev.text !== item.text
            || prev.erledigt !== item.erledigt
            || prev.position !== item.position;
        if (!changed) continue;
        meta.pendingOps.push({
            opId: naechsteOpId(meta),
            opType: "upsert",
            itemId: item.itemId,
            text: item.text,
            erledigt: item.erledigt,
            position: item.position,
            clientUpdatedAt: new Date().toISOString()
        });
        queued = true;
    }

    for (const prev of previous) {
        if (currentById.has(prev.itemId)) continue;
        meta.pendingOps.push({
            opId: naechsteOpId(meta),
            opType: "delete",
            itemId: prev.itemId,
            text: prev.text || TOMBSTONE_TEXT,
            erledigt: false,
            position: prev.position,
            clientUpdatedAt: new Date().toISOString()
        });
        queued = true;
    }

    meta.snapshot = current;
    syncMetaSpeichern(meta);
    return queued;
}

function snapshotInUiSchreiben(snapshotData) {
    const base = normalizeSnapshotData(snapshotData)
        .sort((a, b) => a.position - b.position)
        .map((entry, index) => ({ ...entry, position: index }));
    const sorted = modus === MODUS_EINKAUFEN
        ? sortDataByStoreGroups(base)
        : sortDataByCaptureTextFirst(base);
    _aenderungenNachSnapshotAusstehend = false;
    snapshotWirdAngewendet = true;
    try {
        datenInListeSchreiben(sorted);
        void speichernLokal(sorted);
    } finally {
        snapshotWirdAngewendet = false;
        if (_aenderungenNachSnapshotAusstehend) {
            _aenderungenNachSnapshotAusstehend = false;
            setTimeout(speichern, 0);
        }
    }
}


/* --- Sync-Hauptlogik -------------------------------------------- */

function syncWennNoetig() {
    if (!supabaseClient) return Promise.resolve();
    if (keinNetzwerk()) {
        eingabeFehlerSetzen("");
        syncStatusSetzen("Sync: Offline (lokal)", "offline");
        return Promise.resolve();
    }
    if (syncState.pending) return syncState.lock;
    syncState.pending = true;
    syncState.lock = syncState.lock.then(async () => {
        syncState.pending = false;
        syncStatusSetzen("Sync: Synchronisiere...", "warn");
        while (await ausstehendHochladen()) { }
        await remoteAenderungenAnwenden("Liste synchronisiert.");
        lastSyncAt = zeitFormatieren(new Date());
        syncState.dirty = syncMetaLaden().pendingOps.length > 0;
        eingabeFehlerSetzen("");
        syncStatusSetzen("Sync: Verbunden", "ok");
        syncDebugAktualisieren();
    }).catch(err => {
        syncState.pending = false;
        console.warn("Remote-Sync fehlgeschlagen, lokal bleibt aktiv:", err, fehlerFormatieren(err));
        syncStatusSetzen("Sync: Offline (lokal)", "offline");
        const hint = syncFehlerHinweis(err);
        const isNetworkHint = hint.toLowerCase().includes("cloud-sync derzeit nicht erreichbar")
            || hint.toLowerCase().includes("netzwerkfehler");
        eingabeFehlerSetzen(isNetworkHint ? "" : hint);
        syncDebugAktualisieren();
    });
    return syncState.lock;
}

async function vonRemoteAktualisieren() {
    if (!supabaseClient) return;
    if (keinNetzwerk()) {
        eingabeFehlerSetzen("");
        syncStatusSetzen("Sync: Offline (lokal)", "offline");
        return;
    }
    if (syncState.pending || syncState.pullInFlight) return;

    syncState.pullInFlight = true;
    try {
        if (syncMetaLaden().pendingOps.length > 0) return;
        await remoteAenderungenAnwenden("Liste von anderem Geraet aktualisiert.");
        lastSyncAt = zeitFormatieren(new Date());
        eingabeFehlerSetzen("");
        syncStatusSetzen("Sync: Verbunden", "ok");
        syncDebugAktualisieren();
    } catch (err) {
        console.warn("Remote-Refresh fehlgeschlagen:", err, fehlerFormatieren(err));
        syncStatusSetzen("Sync: Offline (lokal)", "offline");
        const hint = syncFehlerHinweis(err);
        const isNetworkHint = hint.toLowerCase().includes("cloud-sync derzeit nicht erreichbar")
            || hint.toLowerCase().includes("netzwerkfehler");
        eingabeFehlerSetzen(isNetworkHint ? "" : hint);
        syncDebugAktualisieren();
    } finally {
        syncState.pullInFlight = false;
    }
}

function speichern() {
    const daten = datenAusListeLesen();
    void speichernLokal(daten);
    const queued = aenderungenEinstellen(daten);
    syncState.dirty = queued || syncMetaLaden().pendingOps.length > 0;
    clearTimeout(_speichernSyncTimer);
    _speichernSyncTimer = setTimeout(() => void syncWennNoetig(), 300);
}

async function laden() {
    const lokaleDaten = await ladenLokal();

    if (!supabaseClient) {
        syncStatusSetzen("Sync: Lokal", "offline");
        syncDebugAktualisieren();
        snapshotInUiSchreiben(lokaleDaten);
        return;
    }

    try {
        const meta = syncMetaLaden();
        if (!meta.snapshot.length && lokaleDaten.length > 0) {
            const localSnapshot = normalizeSnapshotData(lokaleDaten);
            meta.snapshot = localSnapshot;
            if (meta.pendingOps.length === 0) {
                for (const item of localSnapshot) {
                    meta.pendingOps.push({
                        opId: naechsteOpId(meta),
                        opType: "upsert",
                        itemId: item.itemId,
                        text: item.text,
                        erledigt: item.erledigt,
                        position: item.position,
                        clientUpdatedAt: new Date().toISOString()
                    });
                }
            }
            syncMetaSpeichern(meta);
        }

        snapshotInUiSchreiben(meta.snapshot.length ? meta.snapshot : lokaleDaten);
        await syncWennNoetig();
        syncState.dirty = syncMetaLaden().pendingOps.length > 0;
        syncStatusSetzen("Sync: Verbunden", "ok");
        lastSyncAt = zeitFormatieren(new Date());
        syncDebugAktualisieren();
    } catch (err) {
        console.warn("Remote-Laden fehlgeschlagen, nutze lokale Daten:", err, fehlerFormatieren(err));
        syncStatusSetzen("Sync: Offline (lokal)", "offline");
        eingabeFehlerSetzen(syncFehlerHinweis(err));
        syncDebugAktualisieren();
        snapshotInUiSchreiben(lokaleDaten);
        syncState.dirty = syncMetaLaden().pendingOps.length > 0;
    }
}


/* --- Hintergrund-Sync ------------------------------------------- */

function _onSyncFocus() {
    if (keinNetzwerk()) return;
    void vonRemoteAktualisieren();
}
function _onSyncOnline() {
    void autoWiederverbinden().catch(err => console.warn("autoWiederverbinden fehlgeschlagen:", err));
    void vonRemoteAktualisieren();
}
function _onSyncVisibilityChange() {
    if (!document.hidden && !keinNetzwerk()) void vonRemoteAktualisieren();
}

function hintergrundSyncStarten() {
    if (!supabaseClient) return;
    if (hintergrundTimer) clearInterval(hintergrundTimer);

    hintergrundTimer = setInterval(() => {
        if (document.hidden) return;
        if (keinNetzwerk()) return;
        void vonRemoteAktualisieren();
    }, BACKGROUND_SYNC_INTERVAL_MS);

    window.removeEventListener("focus", _onSyncFocus);
    window.addEventListener("focus", _onSyncFocus);
    window.removeEventListener("online", _onSyncOnline);
    window.addEventListener("online", _onSyncOnline);
    document.removeEventListener("visibilitychange", _onSyncVisibilityChange);
    document.addEventListener("visibilitychange", _onSyncVisibilityChange);
}


/* --- Update-Mechanismus ----------------------------------------- */

function hatAktiveBearbeitung() {
    return Boolean(
        isListening
        || (multiInput && multiInput.value.trim().length > 0)
        || syncState.dirty
        || syncState.pending
    );
}


async function updateErzwingen() {
    if (btnForceUpdate) btnForceUpdate.disabled = true;
    updateButtonVerfuegbarSetzen(false);
    syncStatusSetzen("Update: wird angewendet...", "warn");

    try {
        // 1. Alle Caches löschen
        if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(key => caches.delete(key)));
        }

        // 2. Service Worker deregistrieren
        if ("serviceWorker" in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(r => r.unregister()));
        }

        // 3. Seite neu laden – holt alle Dateien frisch vom Server
        window.location.reload(true);
    } catch (err) {
        console.warn("Update fehlgeschlagen:", err);
        syncStatusSetzen("Update fehlgeschlagen", "offline");
        if (btnForceUpdate) btnForceUpdate.disabled = false;
    }
}


function updateButtonVerfuegbarSetzen(verfuegbar) {
    if (!btnForceUpdate) return;
    btnForceUpdate.classList.toggle("update-available", verfuegbar);
}

async function serverVersionLaden() {
    try {
        const res = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return null;
        const data = await res.json();
        return String(data.version || "").trim();
    } catch {
        return null;
    }
}

async function autoUpdatePruefen() {
    try {
        const serverVersion = await serverVersionLaden();
        if (!serverVersion) return;
        const hasUpdate = serverVersion !== APP_VERSION;
        updateButtonVerfuegbarSetzen(hasUpdate);
        if (hasUpdate) syncStatusSetzen("Update verfuegbar", "warn");
    } catch (err) {
        console.warn("Auto-Update-Pruefung fehlgeschlagen:", err);
    }
}

function autoUpdateEinrichten() {
    if (!("serviceWorker" in navigator)) return;
    if (updatePruefTimer) clearInterval(updatePruefTimer);

    updatePruefTimer = setInterval(() => {
        if (document.hidden) return;
        void autoUpdatePruefen("interval");
    }, AUTO_UPDATE_CHECK_INTERVAL_MS);

    if (!autoUpdateEinrichten._listenersRegistered) {
        autoUpdateEinrichten._listenersRegistered = true;
        window.addEventListener("focus", () => void autoUpdatePruefen("focus"));
        window.addEventListener("online", () => void autoUpdatePruefen("online"));
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) void autoUpdatePruefen("visible");
        });
    }

    void autoUpdatePruefen("startup");
}


/* --- Sync-UI ---------------------------------------------------- */

function syncDebugAktualisieren() {
    if (!syncDebug) return;
    if (!debugEnabled) {
        syncDebug.hidden = true;
        return;
    }

    syncDebug.hidden = false;
    const uid = kurzeId(supabaseUserId);
    const syncText = lastSyncAt || "-";
    const code = currentSyncCode || "-";
    syncDebug.textContent = `debug code=${code} uid=${uid} lastSync=${syncText}`;
}

function syncBearbeitungsmodusSetzen(enabled) {
    syncEditMode = Boolean(enabled);
    // Gäste können den Code nicht ändern → auth-bar niemals anzeigen
    const darfBearbeiten = geraetRolleLesen() !== "gast";
    const showAuthBar = syncEditMode && modus === MODUS_ERFASSEN && darfBearbeiten;
    if (authBar) authBar.hidden = !showAuthBar;
    if (syncCodeCompact) syncCodeCompact.hidden = modus !== MODUS_ERFASSEN;
    if (syncCodeInput && syncEditMode && modus === MODUS_ERFASSEN) {
        syncCodeInput.focus();
        syncCodeInput.select();
    }
}

function syncEditorOeffnen() {
    syncBearbeitungsmodusSetzen(true);
}

function syncCodeUiEinrichten(initOptions = {}) {
    if (!authBar) return Promise.resolve();

    const initPromise = initialenGeraeteStatusErmitteln(initOptions)
        .then(async status => {
            const initialRole = status?.rolle || "";
            const initialCode = status?.syncCode || await syncCodeLadenMitBackup();
            const requiresServerRole = Boolean((initOptions.joinToken || initOptions.legacyInviteDeviceId) && !initialRole);
            if (initialRole) geraetRolleSetzen(initialRole);
            await syncCodeAnwenden(initialCode, false, {
                targetRole: initialRole,
                disableAutoRole: requiresServerRole
            });
        })
        .then(async () => {
            // Sicherstellen dass {device_id → sync_code} in sync_invites eingetragen ist.
            // Ermöglicht sofortiges Teilen ohne Wartezeit und stellt sicher dass
            // bestehende Geräte (Update von älterer Version) automatisch registriert werden.
            if (supabaseClient && currentSyncCode) void einladungInDbSpeichern(currentSyncCode);
            if (supabaseClient && currentSyncCode) void installKontextAktualisieren();
            geraetRolleUiAktualisieren();
        })
        .catch(err => console.warn("Initialer Sync-Code fehlgeschlagen:", err));
    syncBearbeitungsmodusSetzen(false);

    if (!hasSupabaseCredentials) {
        const msg = "Supabase nicht konfiguriert. App laeuft nur lokal.";
        authStatusSetzen(msg);
        eingabeFehlerSetzen(msg);
    } else if (!hasSupabaseLibrary) {
        const msg = "Supabase nicht geladen. Internet pruefen und neu laden.";
        authStatusSetzen(msg);
        eingabeFehlerSetzen(msg);
    } else {
        eingabeFehlerSetzen("");
    }

    if (syncCodeInput) {
        syncCodeInput.addEventListener("input", () => {
            const normalized = syncCodeNormalisieren(syncCodeInput.value);
            if (syncCodeInput.value !== normalized) {
                const cursorPos = syncCodeInput.selectionStart ?? normalized.length;
                const delta = normalized.length - syncCodeInput.value.length;
                syncCodeInput.value = normalized;
                const newPos = Math.max(0, Math.min(cursorPos + delta, normalized.length));
                syncCodeInput.setSelectionRange(newPos, newPos);
            }
        });
    }

    function syncButtonsDeaktivieren(disabled) {
        if (btnSyncApply) btnSyncApply.disabled = disabled;
    }

    if (btnSyncApply) {
        btnSyncApply.onclick = async () => {
            syncButtonsDeaktivieren(true);
            authStatusSetzen("Verbinde...");
            try {
                await syncCodeAnwenden(syncCodeInput?.value || "", true, { allowOccupied: true, userInitiated: true });
            } finally {
                syncButtonsDeaktivieren(false);
            }
        };
    }

    if (btnSyncConnect) {
        btnSyncConnect.onclick = () => {
            if (syncCodeInput) syncCodeInput.value = "";
            syncBearbeitungsmodusSetzen(true);
        };
    }

    if (btnSyncCodeShare) {
        btnSyncCodeShare.onclick = () => void syncCodeTeilen();
    }

    // Initiale UI-Anpassung (Rolle ggf. noch leer → zeigt Verbinden)
    geraetRolleUiAktualisieren();

    return initPromise;
}
