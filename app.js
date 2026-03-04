/* ======================
   SPLASH + START
====================== */

window.addEventListener("load", () => {
    const splash = document.getElementById("splash");
    setTimeout(() => {
        if (splash) splash.remove();
    }, 350);

    setTimeout(eingabeGroessenpassen, 200);
});


/* ======================
   DOM ELEMENTE
====================== */

const liste = document.getElementById("liste");

const btnErfassen  = document.getElementById("btnErfassen");
const btnEinkaufen = document.getElementById("btnEinkaufen");
const btnExport    = document.getElementById("btnExport");
const btnForceUpdate = document.getElementById("btn-force-update");
const syncCodeCompact = document.getElementById("sync-code-compact");
const btnSyncCodeDisplay = document.getElementById("btn-sync-code-display");
const btnSyncCodeEdit = document.getElementById("btn-sync-code-edit");
const btnSyncCodeShare = document.getElementById("btn-sync-code-share");
const modeBadge    = document.getElementById("mode-badge");
const versionBadge = document.getElementById("version-badge");
const syncStatus   = document.getElementById("sync-status");
const syncDebug    = document.getElementById("sync-debug");
const authBar      = document.getElementById("auth-bar");
const syncCodeInput = document.getElementById("sync-code");
const btnSyncApply  = document.getElementById("btn-sync-apply");
const btnSyncNew    = document.getElementById("btn-sync-new");
const authStatus   = document.getElementById("auth-status");

const multiInput = document.getElementById("multi-line-input");
const multiAdd   = document.getElementById("add-all-button");
const btnPhotoOcr = document.getElementById("btn-photo-ocr");
const photoOcrInput = document.getElementById("photo-ocr-input");
const btnClearInput = document.getElementById("btn-clear-input");
const btnNewLine = document.getElementById("newline-button");
const btnMic     = document.getElementById("mic-button");
const micStatus  = document.getElementById("mic-status");
const inputErrorStatus = document.getElementById("input-error-status");
const imageViewer = document.getElementById("image-viewer");
const imageViewerImg = document.getElementById("image-viewer-img");
const btnImageViewerClose = document.getElementById("btn-image-viewer-close");
const helpViewer = document.getElementById("help-viewer");
const btnHelpViewerClose = document.getElementById("btn-help-viewer-close");

const MODUS_ERFASSEN = "erfassen";
const MODUS_EINKAUFEN = "einkaufen";
let modus = MODUS_ERFASSEN;
const APP_VERSION = "1.0.112";
const SpeechRecognitionCtor =
    window.SpeechRecognition || window.webkitSpeechRecognition;
const APP_CONFIG = window.APP_CONFIG || {};
const STORAGE_KEY = "einkaufsliste";
const SUPABASE_TABLE = "shopping_items";
const SUPABASE_CODES_TABLE = "sync_codes";
const SYNC_CODE_KEY = "einkaufsliste-sync-code";
const SYNC_META_PREFIX = "einkaufsliste-sync-meta:";
const DEVICE_ID_KEY = "einkaufsliste-device-id";
const SYNC_OP_BATCH_SIZE = 200;
const TOMBSTONE_TEXT = "[deleted]";
// IMAGE_ENTRY_PREFIX, IMAGE_ENTRY_CAPTION_MARKER, parsePhotoEntryText, buildPhotoEntryText → utils.js
const IMAGE_IDB_REF_PREFIX = "__IMG_IDB__:";

// IndexedDB-basierter Photo-Store (verhindert localStorage-Überlauf bei großen Fotos)
const PHOTO_IDB_NAME = "einkaufsliste-photos";
const PHOTO_IDB_STORE = "photos";
let _photoDb = null;

function fotoDatenbankOeffnen() {
    if (_photoDb) return Promise.resolve(_photoDb);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(PHOTO_IDB_NAME, 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore(PHOTO_IDB_STORE);
        req.onsuccess = e => { _photoDb = e.target.result; resolve(_photoDb); };
        req.onerror = () => reject(req.error);
    });
}

function fotoInIdbSpeichern(itemId, dataUrl) {
    return fotoDatenbankOeffnen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(PHOTO_IDB_STORE, "readwrite");
        tx.objectStore(PHOTO_IDB_STORE).put(dataUrl, itemId);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    }));
}

function fotoAusIdbLaden(itemId) {
    return fotoDatenbankOeffnen().then(db => new Promise(resolve => {
        const tx = db.transaction(PHOTO_IDB_STORE, "readonly");
        const req = tx.objectStore(PHOTO_IDB_STORE).get(itemId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
    }));
}

const SYNC_CODE_LENGTH = 8;
const RESERVED_SYNC_CODE = "HELP0000";
const BACKGROUND_SYNC_INTERVAL_MS = 4000;
const AUTO_UPDATE_CHECK_INTERVAL_MS = 60000;
// GROUP_DEFINITIONS, GROUP_ORDER → utils.js
const hasSupabaseCredentials = Boolean(
    APP_CONFIG.supabaseUrl && APP_CONFIG.supabaseAnonKey
);
const hasSupabaseLibrary = Boolean(
    window.supabase && typeof window.supabase.createClient === "function"
);
const supabaseClient = hasSupabaseCredentials && hasSupabaseLibrary
    ? window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey)
    : null;

let recognition;
let isListening = false;
let finalTranscript = "";
let latestTranscript = "";
let micSessionTimer;
const MIC_SESSION_MS = 30000;
let skipAutoSaveForCurrentBuffer = false;
let ignoreResultsUntil = 0;
let restartMicAfterManualCommit = false;
// Sync-Zustand gebündelt – verhindert verstreute Mutations an Einzelvariablen
const syncState = {
    lock: Promise.resolve(),  // Promise-Chain-Lock für syncWennNoetig
    pending: false,           // true = mindestens 1 Sync-Runde in der Queue
    pullInFlight: false,      // true = vonRemoteAktualisieren läuft
    dirty: false              // true = lokale Änderungen noch nicht bestätigt gesynct
};
let supabaseReady = false;
let supabaseUserId = "";
let lastSyncAt = "";
const debugEnabled = new URLSearchParams(location.search).get("debug") === "1";
let currentSyncCode = "";
let syncEditMode = false;
let hintergrundTimer = null;
let echtzeitKanal = null;
let echtzeitTimer = null;
let updatePruefTimer = null;
let updateLaeuft = false;
let snapshotWirdAngewendet = false;
let _speichernSyncTimer = null;

if (authBar) authBar.hidden = true;


/* ======================
   SPEICHERN & LADEN
====================== */

function syncStatusSetzen(text, tone = "offline") {
    if (!syncStatus) return;
    syncStatus.textContent = text;
    syncStatus.classList.remove("ok", "warn", "offline");
    syncStatus.classList.add(tone);
}

function authStatusSetzen(text) {
    if (!authStatus) return;
    authStatus.textContent = text;
}

function eingabeFehlerSetzen(text) {
    if (!inputErrorStatus) return;
    inputErrorStatus.textContent = String(text || "").trim();
}

function keinNetzwerk() {
    return typeof navigator !== "undefined" && navigator.onLine === false;
}

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

function syncCodeLaden() {
    const stored = syncCodeNormalisieren(localStorage.getItem(SYNC_CODE_KEY) || "");
    if (istGueltigerSyncCode(stored) && !istReservierterSyncCode(stored)) return stored;
    const created = syncCodeErzeugen();
    localStorage.setItem(SYNC_CODE_KEY, created);
    return created;
}


async function syncCodeRpcVerwenden(code, options = {}) {
    if (!supabaseClient) throw new Error("SUPABASE_CLIENT_MISSING");
    if (!istGueltigerSyncCode(code)) throw new Error("SYNC_CODE_FORMAT_INVALID");
    if (istReservierterSyncCode(code)) throw new Error("SYNC_CODE_RESERVED");
    if (!(await authSicherstellen())) throw new Error("AUTH_REQUIRED");

    const allowCreate = options.allowCreate !== false;
    const requireNew = options.requireNew === true;

    const { data, error } = await supabaseClient.rpc("use_sync_code", {
        p_code: String(code),
        p_allow_create: allowCreate,
        p_require_new: requireNew
    });
    if (error) throw error;
    return data;
}

async function syncCodeNutzungAktualisieren(code) {
    if (!supabaseClient) return;
    if (!istGueltigerSyncCode(code)) return;
    if (istReservierterSyncCode(code)) return;
    await syncCodeRpcVerwenden(code, { allowCreate: true, requireNew: false });
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


async function syncCodeAnwenden(code, shouldReload = true, options = {}) {
    const allowOccupied = options.allowOccupied !== false;
    const userInitiated = options.userInitiated === true;
    const normalized = syncCodeNormalisieren(code);
    if (!istGueltigerSyncCode(normalized)) {
        authStatusSetzen("Bitte Code im Format AAAA1234 eingeben.");
        if (userInitiated) syncBearbeitungsmodusSetzen(true);
        return;
    }
    if (istReservierterSyncCode(normalized)) {
        hilfeViewerOeffnen();
        authStatusSetzen("Code HELP0000 oeffnet die Kurzanleitung.");
        if (syncCodeInput) syncCodeInput.value = currentSyncCode || "";
        if (userInitiated) syncBearbeitungsmodusSetzen(true);
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
        if (String(fehlerFormatieren(err)).includes("SYNC_CODE_ALREADY_EXISTS")) {
            authStatusSetzen("Code ist bereits belegt. Bitte anderen Code nutzen.");
        } else {
            authStatusSetzen(hint);
        }
        if (userInitiated && syncCodeInput) {
            syncBearbeitungsmodusSetzen(true);
            syncCodeInput.value = currentSyncCode || normalized || "";
            syncCodeInput.focus();
            syncCodeInput.select();
        }
        return;
    }

    currentSyncCode = normalized;
    localStorage.setItem(SYNC_CODE_KEY, currentSyncCode);
    if (syncCodeInput) syncCodeInput.value = currentSyncCode;
    if (btnSyncCodeDisplay) btnSyncCodeDisplay.textContent = currentSyncCode;
    authStatusSetzen(`Geraete-Code: ${currentSyncCode}`);
    eingabeFehlerSetzen("");
    if (userInitiated) syncBearbeitungsmodusSetzen(false);
    if (syncCodeInput) syncCodeInput.blur();
    if (supabaseClient) echtzeitSyncStarten();
    syncDebugAktualisieren();
    if (shouldReload) void laden();
}

function syncBearbeitungsmodusSetzen(enabled) {
    syncEditMode = Boolean(enabled);
    const showAuthBar = syncEditMode && modus === MODUS_ERFASSEN;
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

function syncCodeUiEinrichten() {
    if (!authBar) return;

    void syncCodeAnwenden(syncCodeLaden(), false);
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
        if (btnSyncNew) btnSyncNew.disabled = disabled;
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

    if (btnSyncNew) {
        btnSyncNew.onclick = async () => {
            syncButtonsDeaktivieren(true);
            authStatusSetzen("Neuer Code wird erstellt...");
            try {
                const newCode = await verfuegbarenSyncCodeErzeugen();
                await syncCodeAnwenden(newCode, true, { allowOccupied: false, userInitiated: true });
            } finally {
                syncButtonsDeaktivieren(false);
            }
        };
    }

    if (btnSyncCodeEdit) {
        btnSyncCodeEdit.onclick = () => syncBearbeitungsmodusSetzen(!syncEditMode);
    }

    if (btnSyncCodeDisplay) {
        btnSyncCodeDisplay.onclick = () => syncEditorOeffnen();
    }

    if (btnSyncCodeShare) {
        btnSyncCodeShare.onclick = () => void syncCodeTeilen();
    }
}

async function syncCodeTeilen() {
    if (!currentSyncCode || !istGueltigerSyncCode(currentSyncCode)) {
        authStatusSetzen("Kein gültiger Code zum Teilen vorhanden.");
        return;
    }
    const shareUrl = new URL(location.origin + location.pathname);
    shareUrl.searchParams.set("code", currentSyncCode);
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
            if (err.name === "AbortError") return; // Benutzer hat abgebrochen
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

// normalizeListData, listDataSignature → utils.js

function geraeteIdLaden() {
    const existing = String(localStorage.getItem(DEVICE_ID_KEY) || "").trim();
    if (existing) return existing;
    const created = window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
}

function syncMetaSchuessel() {
    if (!currentSyncCode) return "";
    return SYNC_META_PREFIX + currentSyncCode;
}

function leereSyncMetaErstellen() {
    return {
        opSeq: 0,
        pendingOps: [],
        snapshot: [],
        lastRemoteSyncAt: ""
    };
}

// normalizeSnapshotData → utils.js

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

function aenderungenEinstellen(currentData) {
    if (snapshotWirdAngewendet) return false;
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
    // In-Memory sortieren vor DOM-Write: vermeidet doppeltes datenInListeSchreiben + DOM-Roundtrip
    const base = normalizeSnapshotData(snapshotData)
        .sort((a, b) => a.position - b.position)
        .map((entry, index) => ({ ...entry, position: index }));
    const sorted = modus === MODUS_EINKAUFEN
        ? sortDataByStoreGroups(base)
        : sortDataByCaptureTextFirst(base);
    snapshotWirdAngewendet = true;
    try {
        datenInListeSchreiben(sorted);
        speichernLokal(sorted);
    } finally {
        snapshotWirdAngewendet = false;
    }
}

// generateItemId, normalizeForGroupMatch, getGroupIndex, isPhotoEntryText,
// sortDataByCaptureTextFirst, sortDataByStoreGroups → utils.js

function listeNachErfassungSortieren() {
    const daten = normalizeListData(datenAusListeLesen());
    if (!daten.length) return false;
    const sortierte = sortDataByCaptureTextFirst(daten);
    datenInListeSchreiben(sortierte);
    speichernLokal(sortierte);
    return true;
}

function listeNachGruppenSortieren() {
    const daten = normalizeListData(datenAusListeLesen());
    if (!daten.length) return false;
    const sortierte = sortDataByStoreGroups(daten);
    datenInListeSchreiben(sortierte);
    speichernLokal(sortierte);
    return true;
}

function kurzeId(id) {
    if (!id) return "-";
    if (id.length <= 12) return id;
    return id.slice(0, 8) + "..." + id.slice(-4);
}

function zeitFormatieren(date) {
    return date.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

function fehlerFormatieren(err) {
    const code = String(err?.code || "").trim();
    const message = String(err?.message || "").trim();
    const details = String(err?.details || "").trim();
    const hint = String(err?.hint || "").trim();
    return [code, message, details, hint].filter(Boolean).join(" | ");
}

function syncFehlerHinweis(err) {
    const raw = fehlerFormatieren(err);
    const message = raw.toLowerCase();
    if (!message) return "Bitte Verbindung und Supabase-Einstellungen pruefen.";
    if (message.includes("json parse error") && message.includes("unrecognized token '<'")) {
        return "Cloud-Sync derzeit nicht erreichbar (Netz/CDN). Lokal wird weiter gespeichert.";
    }
    if (message.includes("column shopping_items.deleted_at does not exist")) {
        return "DB-Migration fehlt: Bitte supabase/schema.sql im Supabase SQL Editor ausfuehren.";
    }
    if (message.includes("function public.apply_shopping_ops") && message.includes("does not exist")) {
        return "DB-Migration fehlt: RPC apply_shopping_ops wurde noch nicht angelegt.";
    }
    if (message.includes("permission denied") || message.includes("not allowed")) {
        return "Supabase Rechte fehlen (schema.sql erneut ausfuehren).";
    }
    if (message.includes("jwt") || message.includes("auth")) {
        return "Anmeldung fehlgeschlagen. Bitte Seite neu laden.";
    }
    if (message.includes("sync_code_already_exists")) {
        return "Code ist bereits belegt. Bitte anderen Code nutzen.";
    }
    if (message.includes("sync_code_format_invalid")) {
        return "Bitte Code im Format AAAA1234 eingeben.";
    }
    if (message.includes("sync_code_reserved")) {
        return "Code HELP0000 ist reserviert.";
    }
    if (message.includes("failed to fetch") || message.includes("network")) {
        return "Netzwerkfehler. Internetverbindung pruefen.";
    }
    return "Sync-Fehler: " + raw.slice(0, 120);
}

function seitenNeuladen() {
    const url = new URL(location.href);
    url.searchParams.set("u", String(Date.now()));
    location.replace(url.toString());
}

function aufSwWarten(worker, timeoutMs = 10000) {
    if (!worker || worker.state === "installed" || worker.state === "redundant") {
        return Promise.resolve();
    }
    return new Promise(resolve => {
        const handler = () => {
            if (worker.state === "installed" || worker.state === "redundant") {
                worker.removeEventListener("statechange", handler);
                resolve();
            }
        };
        worker.addEventListener("statechange", handler);
        setTimeout(() => { worker.removeEventListener("statechange", handler); resolve(); }, timeoutMs);
    });
}

function aufControllerWarten(timeoutMs = 4500) {
    return new Promise(resolve => {
        let finished = false;
        const done = value => {
            if (finished) return;
            finished = true;
            navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
            clearTimeout(timer);
            resolve(value);
        };
        const onControllerChange = () => done(true);
        const timer = setTimeout(() => done(false), timeoutMs);
        navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    });
}

async function wartendenSwAktivieren(registration) {
    if (!registration?.waiting) return false;
    const changedPromise = aufControllerWarten();
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
    return changedPromise;
}

async function updateErzwingen() {
    // Nur bei aktiver Benutzereingabe blockieren – Hintergrund-Sync ist nach Reload sicher
    const activeInput = isListening || (multiInput && multiInput.value.trim().length > 0);
    if (activeInput) {
        syncStatusSetzen("Update blockiert: Eingabe beenden", "warn");
        authStatusSetzen("Bitte Mikrofon stoppen und Eingabe mit 'Übernehmen' speichern.");
        return;
    }

    if (btnForceUpdate) btnForceUpdate.disabled = true;
    syncStatusSetzen("Update: wird angewendet...", "warn");

    try {
        // Caches immer zuerst leeren – damit nach Reload keine alten Dateien geliefert werden
        if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter(key => key.startsWith("einkaufsliste-"))
                    .map(key => caches.delete(key))
            );
        }

        if ("serviceWorker" in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();

            for (const registration of registrations) {
                await registration.update();
                // Warten bis neue SW fertig installiert ist, bevor aktiviert wird
                if (!registration.waiting && registration.installing) {
                    await aufSwWarten(registration.installing);
                }
                if (await wartendenSwAktivieren(registration)) {
                    syncStatusSetzen("Update: aktiv", "ok");
                    seitenNeuladen();
                    return;
                }
            }

            await Promise.all(registrations.map(r => r.unregister()));
        }

        // Kleine Pause, damit SW-Abmeldung und Cache-Loeschung sicher wirksam sind.
        await new Promise(resolve => setTimeout(resolve, 180));

        seitenNeuladen();
    } catch (err) {
        console.warn("Update fehlgeschlagen:", err);
        syncStatusSetzen("Update fehlgeschlagen", "offline");
        authStatusSetzen("Update fehlgeschlagen. Bitte Seite neu laden.");
        if (btnForceUpdate) btnForceUpdate.disabled = false;
    }
}

function hatAktiveBearbeitung() {
    return Boolean(
        isListening
        || (multiInput && multiInput.value.trim().length > 0)
        || syncState.dirty
        || syncState.pending
    );
}


async function hatWartendesUpdate() {
    if (!("serviceWorker" in navigator)) return false;
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
        if (registration.waiting) return true;
        await registration.update();
        if (registration.waiting) return true;
        // Neue SW lädt noch (installing) – warten bis fertig installiert
        if (registration.installing) {
            await aufSwWarten(registration.installing);
        }
        if (registration.waiting) return true;
    }
    return false;
}

async function autoUpdatePruefen(trigger = "auto") {
    if (updateLaeuft) return;

    try {
        const hasUpdate = await hatWartendesUpdate();
        if (!hasUpdate) return;

        if (hatAktiveBearbeitung()) {
            syncStatusSetzen("Update verfuegbar", "warn");
            authStatusSetzen("Neue Version erkannt. Bei Leerlauf wird automatisch aktualisiert.");
            return;
        }

        updateLaeuft = true;
        authStatusSetzen(`Neue Version erkannt (${trigger}). Update startet...`);
        await updateErzwingen();
    } catch (err) {
        console.warn("Auto-Update-Pruefung fehlgeschlagen:", err);
    } finally {
        updateLaeuft = false;
    }
}

function autoUpdateEinrichten() {
    if (!("serviceWorker" in navigator)) return;
    if (updatePruefTimer) clearInterval(updatePruefTimer);

    updatePruefTimer = setInterval(() => {
        if (document.hidden) return;
        void autoUpdatePruefen("interval");
    }, AUTO_UPDATE_CHECK_INTERVAL_MS);

    window.addEventListener("focus", () => void autoUpdatePruefen("focus"));
    window.addEventListener("online", () => void autoUpdatePruefen("online"));
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) void autoUpdatePruefen("visible");
    });

    void autoUpdatePruefen("startup");
}

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

function echtzeitSyncStoppen() {
    if (echtzeitTimer) {
        clearTimeout(echtzeitTimer);
        echtzeitTimer = null;
    }
    if (!supabaseClient || !echtzeitKanal) return;
    try {
        supabaseClient.removeChannel(echtzeitKanal);
    } catch (err) {
        console.warn("Realtime-Channel konnte nicht entfernt werden:", err);
    }
    echtzeitKanal = null;
}

function echtzeitAktualisierungPlanen() {
    if (echtzeitTimer) clearTimeout(echtzeitTimer);
    echtzeitTimer = setTimeout(() => {
        void vonRemoteAktualisieren();
    }, 250);
}

function echtzeitSyncStarten() {
    if (!supabaseClient || !currentSyncCode) return;
    echtzeitSyncStoppen();

    echtzeitKanal = supabaseClient
        .channel(`shopping_items_${currentSyncCode}`)
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: SUPABASE_TABLE,
                filter: `sync_code=eq.${currentSyncCode}`
            },
            () => {
                if (document.hidden) return;
                echtzeitAktualisierungPlanen();
            }
        )
        .subscribe(status => {
            if (status === "CHANNEL_ERROR") {
                console.warn("Realtime-Channel Fehler, nutze Polling weiter.");
                echtzeitSyncStoppen();
            }
        });
}

async function authSicherstellen() {
    if (keinNetzwerk()) {
        eingabeFehlerSetzen("");
        syncStatusSetzen("Sync: Offline (lokal)", "offline");
        return false;
    }
    if (!supabaseClient) {
        eingabeFehlerSetzen("Supabase Client nicht initialisiert. config.js / Internet pruefen.");
        syncStatusSetzen("Sync: Offline (lokal)", "offline");
        return false;
    }
    if (supabaseReady && supabaseUserId) return true;

    try {
        syncStatusSetzen("Sync: Verbinde...", "warn");
        const sessionResult = await supabaseClient.auth.getSession();
        if (sessionResult?.error) throw sessionResult.error;
        let user = sessionResult?.data?.session?.user || null;

        if (!user) {
            const anonResult = await supabaseClient.auth.signInAnonymously();
            if (anonResult?.error) throw anonResult.error;
            user = anonResult?.data?.user || null;
        }

        if (!user?.id) {
            eingabeFehlerSetzen("Anonyme Anmeldung fehlgeschlagen. Supabase Auth/Anon-Login pruefen.");
            syncStatusSetzen("Anonyme Anmeldung fehlgeschlagen. Supabase Auth/Anon-Login pruefen.", "offline");
            syncDebugAktualisieren();
            return false;
        }
        supabaseUserId = user.id;
        supabaseReady = true;
        echtzeitSyncStarten();
        eingabeFehlerSetzen("");
        syncStatusSetzen("Sync: Verbunden", "ok");
        syncDebugAktualisieren();
        return true;
    } catch (err) {
        console.warn("Supabase Auth nicht verfuegbar:", err);
        supabaseReady = false;
        supabaseUserId = "";
        echtzeitSyncStoppen();
        eingabeFehlerSetzen(syncFehlerHinweis(err));
        syncStatusSetzen(syncFehlerHinweis(err), "offline");
        syncDebugAktualisieren();
        return false;
    }
}

function datenAusListeLesen() {
    const daten = [];

    liste.querySelectorAll("li").forEach((li, index) => {
        const itemId = String(li.dataset.itemId || "").trim() || generateItemId();
        li.dataset.itemId = itemId;
        daten.push({
            itemId,
            text: li.dataset.rawText || li.dataset.text || "",
            erledigt: li.classList.contains("erledigt"),
            position: index
        });
    });

    return daten;
}

function datenInListeSchreiben(daten) {
    const fragment = document.createDocumentFragment();
    daten.forEach(e => eintragAnlegen(e.text, e.erledigt, e.itemId, fragment));
    liste.innerHTML = "";
    liste.appendChild(fragment);
}

function modusSortierungAnwenden() {
    if (modus === MODUS_EINKAUFEN) {
        listeNachGruppenSortieren();
        return;
    }
    if (modus === MODUS_ERFASSEN) {
        listeNachErfassungSortieren();
    }
}

function speichernLokal(daten) {
    const stripped = daten.map(item => {
        if (!isPhotoEntryText(item.text)) return item;
        const parsed = parsePhotoEntryText(item.text);
        if (!parsed?.imageSrc?.startsWith("data:")) return item; // bereits eine IDB-Referenz
        fotoInIdbSpeichern(item.itemId, parsed.imageSrc).catch(err => console.warn("Foto-IDB Schreibfehler:", err));
        const ref = IMAGE_IDB_REF_PREFIX + item.itemId + (parsed.caption ? IMAGE_ENTRY_CAPTION_MARKER + parsed.caption : "");
        return { ...item, text: ref };
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
}

async function ladenLokal() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const items = normalizeListData(parsed);

        return await Promise.all(items.map(async item => {
            if (!item.text.startsWith(IMAGE_IDB_REF_PREFIX)) return item;
            const withoutPrefix = item.text.slice(IMAGE_IDB_REF_PREFIX.length);
            const markerIndex = withoutPrefix.indexOf(IMAGE_ENTRY_CAPTION_MARKER);
            const refId = markerIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, markerIndex);
            const caption = markerIndex === -1 ? "" : withoutPrefix.slice(markerIndex + IMAGE_ENTRY_CAPTION_MARKER.length);
            const dataUrl = await fotoAusIdbLaden(refId || item.itemId);
            if (dataUrl) return { ...item, text: buildPhotoEntryText(dataUrl, caption) };
            return item;
        }));
    } catch (err) {
        console.warn("Fehler beim lokalen Laden:", err);
        return [];
    }
}


async function ausstehendHochladen() {
    const meta = syncMetaLaden();
    if (!Array.isArray(meta.pendingOps) || meta.pendingOps.length === 0) return false;
    if (!supabaseClient) return false;
    if (!(await authSicherstellen())) return false;

    const batch = meta.pendingOps.slice(0, SYNC_OP_BATCH_SIZE);
    const { error } = await supabaseClient.rpc("apply_shopping_ops", {
        p_sync_code: currentSyncCode,
        p_device_id: geraeteIdLaden(),
        p_ops: batch
    });
    if (error) throw error;

    meta.pendingOps = meta.pendingOps.slice(batch.length);
    syncMetaSpeichern(meta);
    return batch.length > 0;
}

function remoteZeilenAnwenden(snapshotData, remoteRows) {
    const snapshotMap = new Map(normalizeSnapshotData(snapshotData).map(item => [item.itemId, item]));
    let latestUpdatedAt = "";

    for (const row of remoteRows) {
        const itemId = String(row.itemId || "").trim();
        if (!itemId) continue;
        const rowUpdatedAt = String(row.updatedAt || "");
        if (rowUpdatedAt && (!latestUpdatedAt || rowUpdatedAt > latestUpdatedAt)) {
            latestUpdatedAt = rowUpdatedAt;
        }
        if (row.deletedAt) {
            snapshotMap.delete(itemId);
            continue;
        }
        snapshotMap.set(itemId, {
            itemId,
            text: String(row.text || ""),
            erledigt: Boolean(row.erledigt),
            position: Number.isFinite(row.position) ? row.position : snapshotMap.size
        });
    }

    return {
        snapshot: [...snapshotMap.values()].sort((a, b) => a.position - b.position),
        latestUpdatedAt
    };
}

async function remoteAenderungenLaden(lastRemoteSyncAt) {
    if (!supabaseClient) return [];
    if (!(await authSicherstellen())) return [];

    let query = supabaseClient
        .from(SUPABASE_TABLE)
        .select("item_id, text, erledigt, position, deleted_at, updated_at")
        .eq("sync_code", currentSyncCode)
        .order("updated_at", { ascending: true })
        .limit(2000);

    if (lastRemoteSyncAt) {
        query = query.gt("updated_at", lastRemoteSyncAt);
    }

    const { data, error } = await query;
    if (error) throw error;
    if (!Array.isArray(data)) return [];
    return data.map((row, index) => ({
        itemId: String(row.item_id || "").trim() || generateItemId(),
        text: String(row.text || ""),
        erledigt: Boolean(row.erledigt),
        position: Number.isFinite(row.position) ? row.position : index,
        deletedAt: row.deleted_at ? String(row.deleted_at) : "",
        updatedAt: row.updated_at ? String(row.updated_at) : ""
    }));
}

async function remoteAenderungenAnwenden(authStatusMsg) {
    const meta = syncMetaLaden();
    const remoteChanges = await remoteAenderungenLaden(meta.lastRemoteSyncAt);
    if (remoteChanges.length > 0) {
        const applied = remoteZeilenAnwenden(meta.snapshot, remoteChanges);
        meta.snapshot = applied.snapshot;
        if (applied.latestUpdatedAt) meta.lastRemoteSyncAt = applied.latestUpdatedAt;
        syncMetaSpeichern(meta);
        snapshotInUiSchreiben(meta.snapshot);
        authStatusSetzen(authStatusMsg);
    }
}

function syncWennNoetig() {
    if (!supabaseClient) return Promise.resolve();
    if (keinNetzwerk()) {
        eingabeFehlerSetzen("");
        syncStatusSetzen("Sync: Offline (lokal)", "offline");
        return Promise.resolve();
    }
    // Bereits eine Sync-Runde in der Queue: kein weiteres Stacking nötig
    if (syncState.pending) return syncState.lock;
    syncState.pending = true;
    syncState.lock = syncState.lock.then(async () => {
        // pending=false JETZT: erlaubt, dass während der Ausführung ein neuer Sync eingereiht wird,
        // damit Änderungen die während ausstehendHochladen() entstehen nicht verloren gehen.
        // Die Promise-Chain selbst garantiert sequenzielle Ausführung (kein paralleles Doppel-Upload).
        syncState.pending = false;
        syncStatusSetzen("Sync: Synchronisiere...", "warn");
        // In Batches leeren, damit große Offline-Queues idempotent abgearbeitet werden
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
        if (echtzeitKanal) return;  // Realtime aktiv – kein Polling nötig
        void vonRemoteAktualisieren();
    }, BACKGROUND_SYNC_INTERVAL_MS);

    window.removeEventListener("focus", _onSyncFocus);
    window.addEventListener("focus", _onSyncFocus);
    window.removeEventListener("online", _onSyncOnline);
    window.addEventListener("online", _onSyncOnline);
    document.removeEventListener("visibilitychange", _onSyncVisibilityChange);
    document.addEventListener("visibilitychange", _onSyncVisibilityChange);
}

function speichern() {
    const daten = datenAusListeLesen();
    speichernLokal(daten);
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


/* ======================
   EINTRÄGE
====================== */

function eintragAnlegen(text, erledigt = false, itemId = generateItemId(), _batchTarget = null) {
    const li = document.createElement("li");
    const rawText = String(text || "");
    li.dataset.itemId = String(itemId || "").trim() || generateItemId();
    li.dataset.rawText = rawText;
    li.dataset.text = rawText;

    if (rawText.startsWith(IMAGE_ENTRY_PREFIX)) {
        const parsedPhoto = parsePhotoEntryText(rawText) || { imageSrc: "", caption: "" };
        const rawImageSrc = parsedPhoto.imageSrc;
        const imageSrc = String(rawImageSrc || "").startsWith("data:image/") ? rawImageSrc : "";
        let photoCaption = String(parsedPhoto.caption || "").trim();

        const wrapper = document.createElement("div");
        wrapper.className = "list-photo-item";

        const thumb = document.createElement("img");
        thumb.className = "list-photo-thumb";
        thumb.src = imageSrc;
        thumb.alt = photoCaption ? `Foto: ${photoCaption}` : "Fotoeintrag";

        const content = document.createElement("div");
        content.className = "list-photo-content";

        const actions = document.createElement("div");
        actions.className = "list-photo-actions";

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "list-photo-open";
        openBtn.textContent = "Foto öffnen";
        openBtn.onclick = event => {
            event.stopPropagation();
            bildViewerOeffnen(imageSrc);
        };

        const captionBtn = document.createElement("button");
        captionBtn.type = "button";
        captionBtn.className = "list-photo-caption";
        captionBtn.textContent = "Text";

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "list-photo-delete";
        deleteBtn.textContent = "Löschen";
        deleteBtn.onclick = event => {
            event.stopPropagation();
            li.remove();
            speichern();
            mikStatusSetzen("Foto gelöscht.");
        };

        const captionText = document.createElement("div");
        captionText.className = "list-photo-caption-text";

        const applyPhotoCaption = (nextCaption, saveNow = false) => {
            photoCaption = String(nextCaption || "").trim();
            li.dataset.rawText = buildPhotoEntryText(imageSrc, photoCaption);
            li.dataset.text = li.dataset.rawText;
            thumb.alt = photoCaption ? `Foto: ${photoCaption}` : "Fotoeintrag";
            captionText.textContent = photoCaption;
            captionText.hidden = !photoCaption;
            captionBtn.textContent = photoCaption ? "Text ändern" : "Text";
            if (saveNow) speichern();
        };

        captionBtn.onclick = event => {
            event.stopPropagation();
            const current = photoCaption;
            const result = window.prompt("Bildbeschreibung (optional):", current);
            if (result === null) return;
            applyPhotoCaption(result, true);
            mikStatusSetzen(result.trim() ? "Bildbeschreibung gespeichert." : "Bildbeschreibung entfernt.");
        };

        thumb.onclick = event => {
            event.stopPropagation();
            bildViewerOeffnen(imageSrc);
        };

        actions.appendChild(openBtn);
        actions.appendChild(captionBtn);
        actions.appendChild(deleteBtn);
        content.appendChild(actions);
        content.appendChild(captionText);

        wrapper.appendChild(thumb);
        wrapper.appendChild(content);
        li.appendChild(wrapper);

        applyPhotoCaption(photoCaption, false);
    } else {
        li.textContent = rawText;
    }

    if (erledigt) li.classList.add("erledigt");

    li.onclick = () => {
        if (modus !== MODUS_EINKAUFEN) return;

        li.classList.toggle("erledigt");
        listeNachGruppenSortieren();
        speichern();
    };

    // Batch-Modus (via datenInListeSchreiben): direkt in Fragment einhängen, Reihenfolge liegt beim Aufrufer
    if (_batchTarget) {
        _batchTarget.appendChild(li);
        return;
    }

    if (erledigt) {
        liste.appendChild(li);
        return;
    }

    if (modus === MODUS_ERFASSEN) {
        if (isPhotoEntryText(rawText)) {
            liste.appendChild(li);
        } else {
            const entries = [...liste.querySelectorAll("li")];
            const firstText = entries.find(entry => !isPhotoEntryText(entry.dataset.rawText || entry.dataset.text));
            const firstPhoto = entries.find(entry => isPhotoEntryText(entry.dataset.rawText || entry.dataset.text));
            if (firstText) liste.insertBefore(li, firstText);
            else if (firstPhoto) liste.insertBefore(li, firstPhoto);
            else liste.appendChild(li);
        }
        return;
    }

    liste.appendChild(li);
}


/* ======================
   MEHRZEILEN-EINGABE
====================== */

function fokusInputAmEnde() {
    const pos = multiInput.value.length;
    multiInput.setSelectionRange(pos, pos);
}

function mehrzeilenSpeichern() {
    const text = multiInput.value.trim();
    if (!text) return;

    text.split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .forEach(item => eintragAnlegen(item));

    if (modus === MODUS_EINKAUFEN) listeNachGruppenSortieren();
    speichern();
    multiInput.value = "";
    eingabeGroessenpassen();
    multiInput.blur();

    if (isListening) {
        // Restart recognition to flush Safari's internal phrase buffer.
        finalTranscript = "";
        latestTranscript = "";
        skipAutoSaveForCurrentBuffer = true;
        ignoreResultsUntil = Date.now() + 500;
        restartMicAfterManualCommit = true;
        clearTimeout(micSessionTimer);
        recognition.stop();
        mikStatusSetzen("Eintrag gespeichert, Mikro wird neu gestartet...");
    }
}

multiAdd.onclick = mehrzeilenSpeichern;

function eingabeLeeren(stopDictation = false) {
    multiInput.value = "";
    eingabeGroessenpassen();

    finalTranscript = "";
    latestTranscript = "";
    skipAutoSaveForCurrentBuffer = true;
    ignoreResultsUntil = Date.now() + 700;

    if (stopDictation && isListening && recognition) {
        restartMicAfterManualCommit = false;
        clearTimeout(micSessionTimer);
        recognition.stop();
        mikStatusSetzen("Eingabe geloescht.");
        return;
    }

    if (isListening) mikStatusSetzen("Eingabe geloescht. Bitte weiter sprechen...");
    else mikStatusSetzen("Eingabe geloescht.");
}

function bildViewerOeffnen(src) {
    if (!imageViewer || !imageViewerImg) return;
    imageViewerImg.src = src;
    imageViewer.hidden = false;
}

function bildViewerSchliessen() {
    if (!imageViewer || !imageViewerImg) return;
    imageViewer.hidden = true;
    imageViewerImg.src = "";
}

function hilfeViewerOeffnen() {
    if (!helpViewer) return;
    helpViewer.hidden = false;
}

function hilfeViewerSchliessen() {
    if (!helpViewer) return;
    helpViewer.hidden = true;
}

async function fotoHinzufuegen(file) {
    if (!file) return;
    if (btnPhotoOcr) btnPhotoOcr.disabled = true;
    mikStatusSetzen("Foto wird geladen...");

    try {
        const imageSrc = await dateiAlsDataUrlLesen(file);
        const optimizedImageSrc = await fotoOptimieren(imageSrc);
        eintragAnlegen(buildPhotoEntryText(optimizedImageSrc));
        if (modus === MODUS_EINKAUFEN) listeNachGruppenSortieren();
        speichern();
        if (multiInput?.value?.trim()) {
            mikStatusSetzen("Foto gespeichert. Text bleibt im Feld und kann mit Übernehmen gespeichert werden.");
        } else {
            mikStatusSetzen("Foto zur Liste hinzugefügt.");
        }
    } catch (err) {
        console.warn("Foto konnte nicht hinzugefuegt werden:", err);
        mikStatusSetzen("Foto konnte nicht gelesen werden.");
    } finally {
        if (btnPhotoOcr) btnPhotoOcr.disabled = false;
        if (photoOcrInput) {
            // value="" + type-Reset: stellt sicher dass dasselbe Foto erneut gewählt werden kann (iOS-Fix)
            photoOcrInput.value = "";
            photoOcrInput.type = "";
            photoOcrInput.type = "file";
        }
    }
}

function dateiAlsDataUrlLesen(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
        reader.readAsDataURL(file);
    });
}

async function fotoOptimieren(dataUrl) {
    if (!String(dataUrl || "").startsWith("data:image/")) return dataUrl;

    try {
        const image = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("Bild konnte nicht geladen werden."));
            img.src = dataUrl;
        });

        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return dataUrl;
        ctx.drawImage(image, 0, 0, width, height);

        const compressed = canvas.toDataURL("image/jpeg", 0.78);
        return compressed.length < dataUrl.length ? compressed : dataUrl;
    } catch {
        return dataUrl;
    }
}

if (btnClearInput) {
    btnClearInput.onclick = () => {
        eingabeLeeren(false);
    };
}

if (btnPhotoOcr && photoOcrInput) {
    btnPhotoOcr.onclick = () => photoOcrInput.click();
    photoOcrInput.onchange = () => {
        const file = photoOcrInput.files?.[0];
        void fotoHinzufuegen(file);
    };
}

if (btnImageViewerClose) btnImageViewerClose.onclick = bildViewerSchliessen;
if (imageViewer) {
    imageViewer.onclick = event => {
        if (event.target === imageViewer) bildViewerSchliessen();
    };
}
if (btnHelpViewerClose) btnHelpViewerClose.onclick = hilfeViewerSchliessen;
if (helpViewer) {
    helpViewer.onclick = event => {
        if (event.target === helpViewer) hilfeViewerSchliessen();
    };
}

btnNewLine.onclick = () => {
    multiInput.value += "\n";
    eingabeGroessenpassen();
    multiInput.blur();
};

multiInput.addEventListener("input", eingabeGroessenpassen);
multiInput.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.isComposing) return;

    event.preventDefault();
    const start = multiInput.selectionStart;
    const end = multiInput.selectionEnd;
    const text = multiInput.value;
    multiInput.value = text.slice(0, start) + "\n" + text.slice(end);
    const nextPos = start + 1;
    multiInput.setSelectionRange(nextPos, nextPos);
    eingabeGroessenpassen();
});

function eingabeGroessenpassen() {
    multiInput.style.height = "auto";
    multiInput.style.height = multiInput.scrollHeight + "px";
}

function istLokalhost() {
    return location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

function mikStatusSetzen(message = "") {
    if (!micStatus) return;
    micStatus.textContent = message;
}

function mikButtonSetzen(listening) {
    if (!btnMic) return;
    btnMic.classList.toggle("listening", listening);
    btnMic.setAttribute("aria-pressed", listening ? "true" : "false");
    btnMic.textContent = listening ? "⏹" : "🎤";
}

function eingabeMitDiktat(text) {
    multiInput.value = text;
    eingabeGroessenpassen();
    if (document.activeElement === multiInput) {
        fokusInputAmEnde();
    }
}

function spracherkennungInit() {
    if (!SpeechRecognitionCtor) return null;

    const r = new SpeechRecognitionCtor();
    r.lang = "de-DE";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onstart = () => {
        isListening = true;
        finalTranscript = "";
        latestTranscript = "";
        skipAutoSaveForCurrentBuffer = false;
        ignoreResultsUntil = 0;
        restartMicAfterManualCommit = false;
        mikButtonSetzen(true);
        mikStatusSetzen("Spracheingabe aktiv (max. 30s)...");
        clearTimeout(micSessionTimer);
        micSessionTimer = setTimeout(() => {
            if (!isListening) return;
            mikStatusSetzen("Zeitlimit erreicht.");
            r.stop();
        }, MIC_SESSION_MS);
    };

    r.onresult = event => {
        if (!isListening) return;
        if (Date.now() < ignoreResultsUntil) return;

        let interimTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const part = event.results[i][0]?.transcript?.trim() || "";
            if (!part) continue;
            if (event.results[i].isFinal) finalTranscript += (finalTranscript ? " " : "") + part;
            else interimTranscript += (interimTranscript ? " " : "") + part;
        }

        const combined = [finalTranscript, interimTranscript].filter(Boolean).join(" ").trim();
        latestTranscript = combined;
        if (combined) skipAutoSaveForCurrentBuffer = false;
        eingabeMitDiktat(combined);
    };

    r.onerror = event => {
        clearTimeout(micSessionTimer);
        const errorText = {
            "not-allowed": "Mikrofon wurde nicht erlaubt.",
            "service-not-allowed": "Spracherkennung ist in Safari blockiert.",
            "audio-capture": "Kein Mikrofon verfuegbar.",
            "network": "Netzwerkfehler bei Spracherkennung.",
            "no-speech": "Keine Sprache erkannt."
        }[event.error] || ("Spracherkennung-Fehler: " + event.error);

        mikStatusSetzen(errorText);
    };

    r.onend = () => {
        clearTimeout(micSessionTimer);
        isListening = false;
        mikButtonSetzen(false);
        if (restartMicAfterManualCommit) {
            restartMicAfterManualCommit = false;
            spracherkennungStarten();
            return;
        }

        if (skipAutoSaveForCurrentBuffer) {
            skipAutoSaveForCurrentBuffer = false;
            mikStatusSetzen("Spracheingabe beendet.");
            return;
        }

        const spokenText = finalTranscript.trim() || latestTranscript.trim();

        if (spokenText) {
            const currentValue = multiInput.value.trim();
            // Nur anhängen wenn das Feld noch nicht denselben Text enthält
            // (eingabeMitDiktat befüllt es bereits während onresult)
            if (currentValue !== spokenText) {
                multiInput.value = currentValue ? `${currentValue}\n${spokenText}` : spokenText;
            }
            eingabeGroessenpassen();
            multiInput.focus();
            fokusInputAmEnde();
            mikStatusSetzen("Text erkannt. Mit Übernehmen speichern.");
            return;
        }

        if (!micStatus?.textContent) mikStatusSetzen("Keine Sprache erkannt.");
    };

    return r;
}

function spracherkennungStarten() {
    if (!recognition) return;
    mikStatusSetzen("Mikrofon wird gestartet...");

    try {
        recognition.start();
    } catch (error) {
        mikStatusSetzen("Start fehlgeschlagen. Bitte erneut tippen.");
        console.warn("Speech start error:", error);
    }
}

function diktatUmschalten() {
    if (!SpeechRecognitionCtor) {
        mikStatusSetzen("Safari unterstuetzt hier keine Spracherkennung.");
        return;
    }

    if (!window.isSecureContext && !istLokalhost()) {
        mikStatusSetzen("Spracheingabe braucht HTTPS.");
        return;
    }

    if (!recognition) recognition = spracherkennungInit();
    if (!recognition) return;

    if (isListening) {
        clearTimeout(micSessionTimer);
        restartMicAfterManualCommit = false;
        recognition.stop();
        return;
    }

    spracherkennungStarten();
}

if (btnMic) btnMic.onclick = diktatUmschalten;


/* ======================
   MODUS
====================== */

function modusSetzen(neu) {
    const vorher = modus;
    modus = neu;

    btnErfassen.classList.toggle("active", modus === MODUS_ERFASSEN);
    btnEinkaufen.classList.toggle("active", modus === MODUS_EINKAUFEN);
    if (modeBadge) modeBadge.textContent = modus === MODUS_EINKAUFEN ? "Einkaufen" : "Erfassen";
    document.body.classList.toggle("modus-einkaufen", modus === MODUS_EINKAUFEN);
    if (syncCodeCompact) syncCodeCompact.hidden = modus !== MODUS_ERFASSEN;
    if (authBar) authBar.hidden = !(modus === MODUS_ERFASSEN && syncEditMode);

    if (vorher !== MODUS_EINKAUFEN && neu === MODUS_EINKAUFEN) {
        if (listeNachGruppenSortieren()) speichern();
    }

    if (vorher === MODUS_EINKAUFEN && neu === MODUS_ERFASSEN) {
        liste.querySelectorAll("li.erledigt").forEach(li => li.remove());
        listeNachErfassungSortieren();
        speichern();
    }
}

btnErfassen.onclick  = () => modusSetzen(MODUS_ERFASSEN);
btnEinkaufen.onclick = () => modusSetzen(MODUS_EINKAUFEN);


/* ======================
   EXPORT
====================== */

btnExport.onclick = async () => {
    const textEntries = [...liste.querySelectorAll("li")]
        .map(li => ({
            erledigt: li.classList.contains("erledigt"),
            raw: String(li.dataset.rawText || li.dataset.text || "")
        }))
        .filter(item => item.raw && !item.raw.startsWith(IMAGE_ENTRY_PREFIX));

    const offeneLines = textEntries
        .filter(item => !item.erledigt)
        .map(item => "• " + item.raw);
    const erledigteLines = textEntries
        .filter(item => item.erledigt)
        .map(item => "✔ " + item.raw);

    const exportDate = new Intl.DateTimeFormat("de-AT", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).format(new Date());

    const text = [
        "Einkaufen",
        `Datum: ${exportDate}`,
        `Text-Einträge: ${textEntries.length}`,
        "────────────",
        "",
        "Offen",
        ...(offeneLines.length ? offeneLines : ["(keine offenen Text-Einträge)"]),
        "",
        "Erledigt",
        ...(erledigteLines.length ? erledigteLines : ["(keine erledigten Text-Einträge)"])
    ].join("\n");

    if (navigator.share) {
        try {
            await navigator.share({ title: "Einkaufen", text });
            return;
        } catch {}
    }

    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        alert("Liste kopiert.");
    } else {
        alert(text);
    }
};


/* ======================
   INIT
====================== */

modusSetzen(MODUS_ERFASSEN);
if (versionBadge) versionBadge.textContent = "v" + APP_VERSION;
syncDebugAktualisieren();

if (btnMic && !SpeechRecognitionCtor) {
    btnMic.disabled = true;
    btnMic.title = "Spracherkennung wird hier nicht unterstuetzt";
    mikStatusSetzen("Spracherkennung wird in diesem Browser nicht unterstuetzt.");
}

syncCodeUiEinrichten();

// ?code=XXXX in der URL → automatisch verbinden (z.B. aus geteiltem Link)
const _urlCode = new URLSearchParams(location.search).get("code");
if (_urlCode) {
    const _cleanUrl = new URL(location.href);
    _cleanUrl.searchParams.delete("code");
    _cleanUrl.searchParams.delete("u");
    history.replaceState(null, "", _cleanUrl.toString());
    void syncCodeAnwenden(_urlCode, true, { allowOccupied: true, userInitiated: true });
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
