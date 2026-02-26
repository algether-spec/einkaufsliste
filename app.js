/* ======================
   SPLASH + START
====================== */

window.addEventListener("load", () => {
    const splash = document.getElementById("splash");
    setTimeout(() => {
        if (splash) splash.remove();
    }, 2600);

    setTimeout(autoResize, 200);
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

let modus = "erfassen";
const APP_VERSION = "1.0.85";
const SpeechRecognitionCtor =
    window.SpeechRecognition || window.webkitSpeechRecognition;
const APP_CONFIG = window.APP_CONFIG || {};
const STORAGE_KEY = "einkaufsliste";
const SUPABASE_TABLE = "shopping_items";
const SUPABASE_CODES_TABLE = "sync_codes";
const SYNC_CODE_KEY = "einkaufsliste-sync-code";
const IMAGE_ENTRY_PREFIX = "__IMG__:";
const IMAGE_ENTRY_CAPTION_MARKER = "\n__CAPTION__:";

function parsePhotoEntryText(rawText) {
    const raw = String(rawText || "");
    if (!raw.startsWith(IMAGE_ENTRY_PREFIX)) return null;

    const markerIndex = raw.indexOf(IMAGE_ENTRY_CAPTION_MARKER, IMAGE_ENTRY_PREFIX.length);
    if (markerIndex === -1) {
        return { imageSrc: raw.slice(IMAGE_ENTRY_PREFIX.length), caption: "" };
    }

    return {
        imageSrc: raw.slice(IMAGE_ENTRY_PREFIX.length, markerIndex),
        caption: raw.slice(markerIndex + IMAGE_ENTRY_CAPTION_MARKER.length)
    };
}

function buildPhotoEntryText(imageSrc, caption = "") {
    const img = String(imageSrc || "");
    const cap = String(caption || "").trim();
    return cap ? (IMAGE_ENTRY_PREFIX + img + IMAGE_ENTRY_CAPTION_MARKER + cap) : (IMAGE_ENTRY_PREFIX + img);
}
const SYNC_CODE_LENGTH = 8;
const RESERVED_SYNC_CODE = "HELP0000";
const BACKGROUND_SYNC_INTERVAL_MS = 4000;
const AUTO_UPDATE_CHECK_INTERVAL_MS = 60000;
const GROUP_DEFINITIONS = {
    obst_gemuese: ["apfel", "banane", "birne", "zitrone", "orange", "traube", "beere", "salat", "gurke", "tomate", "paprika", "zucchini", "kartoffel", "zwiebel", "knoblauch", "karotte", "mohrrube", "brokkoli", "blumenkohl", "pilz", "avocado"],
    backen: ["brot", "broetchen", "toast", "mehl", "hefe", "backpulver", "zucker", "vanille", "kuchen", "croissant"],
    fleisch_fisch: ["fleisch", "huhn", "haehnchen", "pute", "rind", "schwein", "hack", "wurst", "schinken", "salami", "speck", "fisch", "lachs", "thunfisch"],
    milch_eier: ["milch", "joghurt", "quark", "kaese", "butter", "sahne", "ei", "frischkaese", "mozzarella", "parmesan"],
    tiefkuehl: ["tk", "tiefkuehl", "pizza", "pommes", "eis", "gemuese mix", "beeren mix"],
    trockenwaren: ["nudel", "reis", "linsen", "bohnen", "konserve", "dose", "tomatenmark", "sauce", "bruehe", "muessli", "haferflocken"],
    getraenke: ["wasser", "saft", "cola", "fanta", "sprite", "bier", "wein", "kaffee", "tee"],
    drogerie: ["toilettenpapier", "kuechenrolle", "spuelmittel", "waschmittel", "seife", "shampoo", "zahnpasta", "deo", "muellbeutel"]
};
const DEFAULT_GROUP_ORDER = [
    "obst_gemuese",
    "backen",
    "fleisch_fisch",
    "milch_eier",
    "tiefkuehl",
    "trockenwaren",
    "getraenke",
    "drogerie"
];
const GROUP_ORDER = Array.isArray(APP_CONFIG.storeGroupOrder)
    ? APP_CONFIG.storeGroupOrder.filter(name => Array.isArray(GROUP_DEFINITIONS[name]))
    : DEFAULT_GROUP_ORDER;
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
let remoteSyncInFlight = false;
let remoteSyncQueued = false;
let remoteSyncForceOverwrite = false;
let remotePullInFlight = false;
let localDirty = false;
let supabaseReady = false;
let supabaseUserId = "";
let lastSyncAt = "";
const debugEnabled = new URLSearchParams(location.search).get("debug") === "1";
let currentSyncCode = "";
let syncEditMode = false;
let backgroundSyncTimer = null;
let remoteRealtimeChannel = null;
let remoteRealtimeTimer = null;
let autoUpdateCheckTimer = null;
let autoUpdateInProgress = false;

if (authBar) {
    authBar.hidden = true;
    authBar.classList.add("is-hidden");
}


/* ======================
   SPEICHERN & LADEN
====================== */

function setSyncStatus(text, tone = "offline") {
    if (!syncStatus) return;
    syncStatus.textContent = text;
    syncStatus.classList.remove("ok", "warn", "offline");
    syncStatus.classList.add(tone);
}

function setAuthStatus(text) {
    if (!authStatus) return;
    authStatus.textContent = text;
}

function setInputErrorStatus(text) {
    if (!inputErrorStatus) return;
    inputErrorStatus.textContent = String(text || "").trim();
}

function normalizeSyncCode(input) {
    const raw = String(input || "").toUpperCase();
    const letters = raw.replace(/[^A-Z]/g, "").slice(0, 4);
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    return (letters + digits).slice(0, SYNC_CODE_LENGTH);
}

function isValidSyncCode(code) {
    return /^[A-Z]{4}[0-9]{4}$/.test(String(code || ""));
}

function isReservedSyncCode(code) {
    return code === RESERVED_SYNC_CODE;
}

function generateSyncCode() {
    const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let nextCode = RESERVED_SYNC_CODE;
    while (isReservedSyncCode(nextCode)) {
        let letters = "";
        for (let i = 0; i < 4; i += 1) {
            letters += LETTERS[Math.floor(Math.random() * LETTERS.length)];
        }
        const digits = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
        nextCode = letters + digits;
    }
    return nextCode;
}

function getStoredSyncCode() {
    const stored = normalizeSyncCode(localStorage.getItem(SYNC_CODE_KEY) || "");
    if (isValidSyncCode(stored) && !isReservedSyncCode(stored)) return stored;
    const created = generateSyncCode();
    localStorage.setItem(SYNC_CODE_KEY, created);
    return created;
}

async function isSyncCodeOccupied(code) {
    if (!isValidSyncCode(code)) return false;
    return false;
}

async function useSyncCodeRpc(code, options = {}) {
    if (!supabaseClient) throw new Error("SUPABASE_CLIENT_MISSING");
    if (!isValidSyncCode(code)) throw new Error("SYNC_CODE_FORMAT_INVALID");
    if (isReservedSyncCode(code)) throw new Error("SYNC_CODE_RESERVED");
    if (!(await ensureSupabaseAuth())) throw new Error("AUTH_REQUIRED");

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

async function touchSyncCodeUsage(code) {
    if (!supabaseClient) return;
    if (!isValidSyncCode(code)) return;
    if (isReservedSyncCode(code)) return;
    await useSyncCodeRpc(code, { allowCreate: true, requireNew: false });
}


async function generateAvailableSyncCode(maxAttempts = 25) {
    let last = generateSyncCode();
    for (let i = 0; i < maxAttempts; i += 1) {
        const candidate = generateSyncCode();
        if (candidate !== currentSyncCode && !isReservedSyncCode(candidate)) return candidate;
        last = candidate;
    }
    return last;
}


async function applySyncCode(code, shouldReload = true, options = {}) {
    const allowOccupied = options.allowOccupied !== false;
    const normalized = normalizeSyncCode(code);
    if (!isValidSyncCode(normalized)) {
        setAuthStatus("Bitte Code im Format AAAA1234 eingeben.");
        return;
    }
    if (isReservedSyncCode(normalized)) {
        openHelpViewer();
        setAuthStatus("Code HELP0000 oeffnet die Kurzanleitung.");
        if (syncCodeInput) syncCodeInput.value = currentSyncCode || "";
        return;
    }

    try {
        await useSyncCodeRpc(normalized, {
            allowCreate: true,
            requireNew: !allowOccupied && normalized !== currentSyncCode
        });
    } catch (err) {
        console.warn("Code-Verbinden fehlgeschlagen:", err);
        const hint = getSyncErrorHint(err);
        if (String(formatSupabaseError(err)).includes("SYNC_CODE_ALREADY_EXISTS")) {
            setAuthStatus("Code ist bereits belegt. Bitte anderen Code nutzen.");
        } else {
            setAuthStatus(hint);
        }
        if (syncCodeInput) {
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
    setAuthStatus(`Geraete-Code: ${currentSyncCode}`);
    setInputErrorStatus("");
    setSyncEditMode(false);
    if (syncCodeInput) syncCodeInput.blur();
    if (supabaseClient) startRealtimeSync();
    updateSyncDebug();
    if (shouldReload) void laden();
}

function setSyncEditMode(enabled) {
    syncEditMode = Boolean(enabled);
    const showAuthBar = syncEditMode && modus === "erfassen";
    if (authBar) {
        authBar.hidden = !showAuthBar;
        authBar.classList.toggle("is-hidden", !showAuthBar);
    }
    if (syncCodeCompact) syncCodeCompact.hidden = modus !== "erfassen";
    if (syncCodeInput && syncEditMode && modus === "erfassen") {
        syncCodeInput.focus();
        syncCodeInput.select();
    }
}

function setupSyncCodeUi() {
    if (!authBar) return;

    void applySyncCode(getStoredSyncCode(), false);
    setSyncEditMode(false);

    if (!hasSupabaseCredentials) {
        const msg = "Supabase nicht konfiguriert. App laeuft nur lokal.";
        setAuthStatus(msg);
        setInputErrorStatus(msg);
    } else if (!hasSupabaseLibrary) {
        const msg = "Supabase nicht geladen. Internet pruefen und neu laden.";
        setAuthStatus(msg);
        setInputErrorStatus(msg);
    } else {
        setInputErrorStatus("");
    }

    if (syncCodeInput) {
        syncCodeInput.addEventListener("input", () => {
            const normalized = normalizeSyncCode(syncCodeInput.value);
            if (syncCodeInput.value !== normalized) syncCodeInput.value = normalized;
        });
    }

    if (btnSyncApply) {
        btnSyncApply.onclick = () => void applySyncCode(syncCodeInput?.value || "", true, { allowOccupied: true });
    }

    if (btnSyncNew) {
        btnSyncNew.onclick = () =>
            void (async () => {
                const newCode = await generateAvailableSyncCode();
                await applySyncCode(newCode, true, { allowOccupied: false });
            })();
    }

    if (btnSyncCodeEdit) {
        btnSyncCodeEdit.onclick = () => setSyncEditMode(!syncEditMode);
    }

    if (btnSyncCodeDisplay) {
        btnSyncCodeDisplay.onclick = () => setSyncEditMode(true);
    }
}

function normalizeListData(daten) {
    if (!Array.isArray(daten)) return [];
    const seenItemIds = new Set();
    return daten
        .map((e, index) => ({
            itemId: String(e?.itemId || e?.item_id || "").trim(),
            text: String(e?.text || "").trim(),
            erledigt: Boolean(e?.erledigt),
            position: Number.isFinite(e?.position) ? e.position : index
        }))
        .filter(e => e.text.length > 0)
        .map(e => {
            let itemId = e.itemId || generateItemId();
            if (seenItemIds.has(itemId)) itemId = generateItemId();
            seenItemIds.add(itemId);
            return { ...e, itemId };
        })
        .map((e, index) => ({ ...e, position: index }));
}

function listDataSignature(daten) {
    return JSON.stringify(
        normalizeListData(daten).map(e => ({
            itemId: e.itemId,
            text: e.text.toLowerCase(),
            erledigt: e.erledigt,
            position: e.position
        }))
    );
}

function generateItemId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeForGroupMatch(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/ä/g, "ae")
        .replace(/ö/g, "oe")
        .replace(/ü/g, "ue")
        .replace(/ß/g, "ss");
}

function getGroupIndex(text) {
    if (String(text || "").startsWith(IMAGE_ENTRY_PREFIX)) return GROUP_ORDER.length + 1;
    const normalized = normalizeForGroupMatch(text);
    for (let i = 0; i < GROUP_ORDER.length; i += 1) {
        const groupName = GROUP_ORDER[i];
        const patterns = GROUP_DEFINITIONS[groupName] || [];
        if (patterns.some(pattern => normalized.includes(pattern))) return i;
    }
    return GROUP_ORDER.length;
}

function isPhotoEntryText(text) {
    return String(text || "").startsWith(IMAGE_ENTRY_PREFIX);
}

function sortListByCaptureTextFirst() {
    const daten = normalizeListData(datenAusListeLesen());
    if (!daten.length) return false;

    const offeneTexte = daten.filter(e => !e.erledigt && !isPhotoEntryText(e.text));
    const offeneFotos = daten.filter(e => !e.erledigt && isPhotoEntryText(e.text));
    const erledigte = daten.filter(e => e.erledigt);

    const sortierte = [...offeneTexte, ...offeneFotos, ...erledigte].map((e, index) => ({
        itemId: e.itemId,
        text: e.text,
        erledigt: e.erledigt,
        position: index
    }));

    datenInListeSchreiben(sortierte);
    speichernLokal(sortierte);
    return true;
}

function sortListByStoreGroups() {
    const daten = normalizeListData(datenAusListeLesen());
    if (!daten.length) return false;

    const offeneTexte = daten.filter(e => !e.erledigt && !isPhotoEntryText(e.text));
    const offeneFotos = daten.filter(e => !e.erledigt && isPhotoEntryText(e.text));
    const erledigteTexte = daten.filter(e => e.erledigt && !isPhotoEntryText(e.text));
    const erledigteFotos = daten.filter(e => e.erledigt && isPhotoEntryText(e.text));
    const collator = new Intl.Collator("de", { sensitivity: "base" });

    offeneTexte.sort((a, b) => {
        const groupDiff = getGroupIndex(a.text) - getGroupIndex(b.text);
        if (groupDiff !== 0) return groupDiff;
        return collator.compare(a.text, b.text);
    });

    erledigteTexte.sort((a, b) => {
        const groupDiff = getGroupIndex(a.text) - getGroupIndex(b.text);
        if (groupDiff !== 0) return groupDiff;
        return collator.compare(a.text, b.text);
    });

    const sortierte = [...offeneTexte, ...erledigteTexte, ...offeneFotos, ...erledigteFotos].map((e, index) => ({
        itemId: e.itemId,
        text: e.text,
        erledigt: e.erledigt,
        position: index
    }));

    datenInListeSchreiben(sortierte);
    speichernLokal(sortierte);
    return true;
}

function mergeListConflict(localDaten, remoteDaten) {
    const local = normalizeListData(localDaten);
    const remote = normalizeListData(remoteDaten);
    const merged = [];
    const seenById = new Set();

    for (const item of local) {
        if (seenById.has(item.itemId)) continue;
        seenById.add(item.itemId);
        merged.push({ itemId: item.itemId, text: item.text, erledigt: item.erledigt, position: merged.length });
    }

    for (const item of remote) {
        if (seenById.has(item.itemId)) continue;
        seenById.add(item.itemId);
        merged.push({ itemId: item.itemId, text: item.text, erledigt: item.erledigt, position: merged.length });
    }

    return merged;
}

function shortUserId(id) {
    if (!id) return "-";
    if (id.length <= 12) return id;
    return id.slice(0, 8) + "..." + id.slice(-4);
}

function formatTimeIso(date) {
    return date.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

function formatSupabaseError(err) {
    const code = String(err?.code || "").trim();
    const message = String(err?.message || "").trim();
    const details = String(err?.details || "").trim();
    const hint = String(err?.hint || "").trim();
    return [code, message, details, hint].filter(Boolean).join(" | ");
}

function getSyncErrorHint(err) {
    const raw = formatSupabaseError(err);
    const message = raw.toLowerCase();
    if (!message) return "Bitte Verbindung und Supabase-Einstellungen pruefen.";
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

function reloadWithCacheBust() {
    const url = new URL(location.href);
    url.searchParams.set("u", String(Date.now()));
    location.replace(url.toString());
}

function waitForControllerChange(timeoutMs = 4500) {
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

async function activateWaitingServiceWorker(registration) {
    if (!registration?.waiting) return false;
    const changedPromise = waitForControllerChange();
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
    return changedPromise;
}

async function forceAppUpdate() {
    if (btnForceUpdate) btnForceUpdate.disabled = true;
    setSyncStatus("Update: wird angewendet...", "warn");

    try {
        if ("serviceWorker" in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();

            for (const registration of registrations) {
                await registration.update();
                if (await activateWaitingServiceWorker(registration)) {
                    setSyncStatus("Update: aktiv", "ok");
                    reloadWithCacheBust();
                    return;
                }
            }
        }

        setSyncStatus("Update: komplette Neuinstallation...", "warn");
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
            await Promise.all(registrations.map(registration => registration.unregister()));
        }

        // Kleine Pause, damit SW-Abmeldung und Cache-Loeschung sicher wirksam sind.
        await new Promise(resolve => setTimeout(resolve, 180));

        reloadWithCacheBust();
    } catch (err) {
        console.warn("Update fehlgeschlagen:", err);
        setSyncStatus("Update fehlgeschlagen", "offline");
        setAuthStatus("Update fehlgeschlagen. Bitte Seite neu laden.");
        if (btnForceUpdate) btnForceUpdate.disabled = false;
    }
}

function hasActiveEditingState() {
    return Boolean(
        isListening
        || (multiInput && multiInput.value.trim().length > 0)
        || localDirty
        || remoteSyncInFlight
    );
}

async function hasWaitingServiceWorkerUpdate() {
    if (!("serviceWorker" in navigator)) return false;
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
        await registration.update();
        if (registration.waiting) return true;
    }
    return false;
}

async function maybeAutoUpdate(trigger = "auto") {
    if (autoUpdateInProgress) return;

    try {
        const hasUpdate = await hasWaitingServiceWorkerUpdate();
        if (!hasUpdate) return;

        if (hasActiveEditingState()) {
            setSyncStatus("Update verfuegbar", "warn");
            setAuthStatus("Neue Version erkannt. Bei Leerlauf wird automatisch aktualisiert.");
            return;
        }

        autoUpdateInProgress = true;
        setAuthStatus(`Neue Version erkannt (${trigger}). Update startet...`);
        await forceAppUpdate();
    } catch (err) {
        console.warn("Auto-Update-Pruefung fehlgeschlagen:", err);
    } finally {
        autoUpdateInProgress = false;
    }
}

function setupAutoUpdateChecks() {
    if (!("serviceWorker" in navigator)) return;
    if (autoUpdateCheckTimer) clearInterval(autoUpdateCheckTimer);

    autoUpdateCheckTimer = setInterval(() => {
        if (document.hidden) return;
        void maybeAutoUpdate("interval");
    }, AUTO_UPDATE_CHECK_INTERVAL_MS);

    window.addEventListener("focus", () => void maybeAutoUpdate("focus"));
    window.addEventListener("online", () => void maybeAutoUpdate("online"));
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) void maybeAutoUpdate("visible");
    });

    void maybeAutoUpdate("startup");
}

function updateSyncDebug() {
    if (!syncDebug) return;
    if (!debugEnabled) {
        syncDebug.hidden = true;
        return;
    }

    syncDebug.hidden = false;
    const uid = shortUserId(supabaseUserId);
    const syncText = lastSyncAt || "-";
    const code = currentSyncCode || "-";
    syncDebug.textContent = `debug code=${code} uid=${uid} lastSync=${syncText}`;
}

function stopRealtimeSync() {
    if (remoteRealtimeTimer) {
        clearTimeout(remoteRealtimeTimer);
        remoteRealtimeTimer = null;
    }
    if (!supabaseClient || !remoteRealtimeChannel) return;
    try {
        supabaseClient.removeChannel(remoteRealtimeChannel);
    } catch (err) {
        console.warn("Realtime-Channel konnte nicht entfernt werden:", err);
    }
    remoteRealtimeChannel = null;
}

function scheduleRealtimeRefresh() {
    if (remoteRealtimeTimer) clearTimeout(remoteRealtimeTimer);
    remoteRealtimeTimer = setTimeout(() => {
        void refreshFromRemoteIfChanged();
    }, 250);
}

function startRealtimeSync() {
    if (!supabaseClient || !currentSyncCode) return;
    stopRealtimeSync();

    remoteRealtimeChannel = supabaseClient
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
                scheduleRealtimeRefresh();
            }
        )
        .subscribe(status => {
            if (status === "CHANNEL_ERROR") {
                console.warn("Realtime-Channel Fehler, nutze Polling weiter.");
            }
        });
}

async function ensureSupabaseAuth() {
    if (!supabaseClient) {
        setInputErrorStatus("Supabase Client nicht initialisiert. config.js / Internet pruefen.");
        setSyncStatus("Sync: Offline (lokal)", "offline");
        return false;
    }
    if (supabaseReady && supabaseUserId) return true;

    try {
        setSyncStatus("Sync: Verbinde...", "warn");
        const sessionResult = await supabaseClient.auth.getSession();
        if (sessionResult?.error) throw sessionResult.error;
        let user = sessionResult?.data?.session?.user || null;

        if (!user) {
            const anonResult = await supabaseClient.auth.signInAnonymously();
            if (anonResult?.error) throw anonResult.error;
            user = anonResult?.data?.user || null;
        }

        if (!user?.id) {
            setInputErrorStatus("Anonyme Anmeldung fehlgeschlagen. Supabase Auth/Anon-Login pruefen.");
            setSyncStatus("Anonyme Anmeldung fehlgeschlagen. Supabase Auth/Anon-Login pruefen.", "offline");
            updateSyncDebug();
            return false;
        }
        supabaseUserId = user.id;
        supabaseReady = true;
        startRealtimeSync();
        setInputErrorStatus("");
        setInputErrorStatus("");
        setSyncStatus("Sync: Verbunden", "ok");
        updateSyncDebug();
        return true;
    } catch (err) {
        console.warn("Supabase Auth nicht verfuegbar:", err);
        supabaseReady = false;
        supabaseUserId = "";
        stopRealtimeSync();
        setInputErrorStatus(getSyncErrorHint(err));
        setSyncStatus(getSyncErrorHint(err), "offline");
        updateSyncDebug();
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
    liste.innerHTML = "";
    daten.forEach(e => eintragAnlegen(e.text, e.erledigt, e.itemId));
}

function applyModeSortAfterLoad() {
    if (modus === "einkaufen") {
        sortListByStoreGroups();
        return;
    }
    if (modus === "erfassen") {
        sortListByCaptureTextFirst();
    }
}

function speichernLokal(daten) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(daten));
}

function ladenLokal() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((e, index) => ({
                itemId: String(e.itemId || e.item_id || "").trim() || generateItemId(),
                text: String(e.text || ""),
                erledigt: Boolean(e.erledigt),
                position: Number.isFinite(e.position) ? e.position : index
            }))
            .filter(e => e.text.trim().length > 0);
    } catch (err) {
        console.warn("Fehler beim lokalen Laden:", err);
        return [];
    }
}

async function ladenRemote() {
    if (!supabaseClient) return null;
    if (!(await ensureSupabaseAuth())) return null;

    const { data, error } = await supabaseClient
        .from(SUPABASE_TABLE)
        .select("item_id, text, erledigt, position")
        .eq("sync_code", currentSyncCode)
        .order("position", { ascending: true });

    if (error) throw error;
    if (!Array.isArray(data)) return [];

    return data.map((e, index) => ({
        itemId: String(e.item_id || "").trim() || generateItemId(),
        text: String(e.text || ""),
        erledigt: Boolean(e.erledigt),
        position: Number.isFinite(e.position) ? e.position : index
    }));
}

async function speichernRemote(daten, options = {}) {
    const allowRemoteDeletes = options.allowRemoteDeletes === true;
    if (!supabaseClient) return;
    if (!(await ensureSupabaseAuth())) return;

    if (!daten.length) {
        const { error: deleteAllError } = await supabaseClient
            .from(SUPABASE_TABLE)
            .delete()
            .eq("sync_code", currentSyncCode);

        if (deleteAllError) throw deleteAllError;
        return;
    }

    const payload = daten.map((e, index) => ({
        sync_code: currentSyncCode,
        item_id: String(e.itemId || "").trim() || generateItemId(),
        text: e.text,
        erledigt: e.erledigt,
        position: index
    }));

    const { error: upsertError } = await supabaseClient
        .from(SUPABASE_TABLE)
        .upsert(payload, { onConflict: "sync_code,item_id" });

    if (upsertError) throw upsertError;

    const localItemIdSet = new Set(payload.map(item => item.item_id));
    const { data: remoteRows, error: remoteRowsError } = await supabaseClient
        .from(SUPABASE_TABLE)
        .select("item_id")
        .eq("sync_code", currentSyncCode);

    if (remoteRowsError) throw remoteRowsError;
    const remoteItemIds = (remoteRows || []).map(row => String(row.item_id || "").trim()).filter(Boolean);
    const obsoleteItemIds = remoteItemIds.filter(itemId => !localItemIdSet.has(itemId));

    if (allowRemoteDeletes && obsoleteItemIds.length > 0) {
        const { error: deleteObsoleteError } = await supabaseClient
            .from(SUPABASE_TABLE)
            .delete()
            .eq("sync_code", currentSyncCode)
            .in("item_id", obsoleteItemIds);

        if (deleteObsoleteError) throw deleteObsoleteError;
    }
}

async function syncRemoteIfNeeded(forceOverwrite = false) {
    if (!supabaseClient) return;
    if (remoteSyncInFlight) {
        remoteSyncQueued = true;
        remoteSyncForceOverwrite = remoteSyncForceOverwrite || forceOverwrite;
        return;
    }

    remoteSyncInFlight = true;
    try {
        setSyncStatus("Sync: Synchronisiere...", "warn");
        do {
            const overwriteThisRun = forceOverwrite || remoteSyncForceOverwrite;
            forceOverwrite = false;
            remoteSyncForceOverwrite = false;
            remoteSyncQueued = false;
            const lokaleDaten = normalizeListData(datenAusListeLesen());
            let datenZumSpeichern = lokaleDaten;

            if (!overwriteThisRun) {
                const remoteVorher = await ladenRemote();
                if (Array.isArray(remoteVorher)) {
                    const remoteDaten = normalizeListData(remoteVorher);
                    if (listDataSignature(lokaleDaten) !== listDataSignature(remoteDaten)) {
                        datenZumSpeichern = mergeListConflict(lokaleDaten, remoteDaten);
                        if (listDataSignature(datenZumSpeichern) !== listDataSignature(lokaleDaten)) {
                            datenInListeSchreiben(datenZumSpeichern);
                            applyModeSortAfterLoad();
                            speichernLokal(datenAusListeLesen());
                            setAuthStatus("Konflikt erkannt: Listen wurden zusammengefuehrt.");
                        }
                    }
                }
            }

            await speichernRemote(datenZumSpeichern, { allowRemoteDeletes: overwriteThisRun });
        } while (remoteSyncQueued);
        lastSyncAt = formatTimeIso(new Date());
        localDirty = false;
        setInputErrorStatus("");
        setSyncStatus("Sync: Verbunden", "ok");
        updateSyncDebug();
    } catch (err) {
        console.warn("Remote-Sync fehlgeschlagen, lokal bleibt aktiv:", err, formatSupabaseError(err));
        setSyncStatus("Sync: Offline (lokal)", "offline");
        setInputErrorStatus(getSyncErrorHint(err));
        updateSyncDebug();
    } finally {
        remoteSyncInFlight = false;
    }
}

async function refreshFromRemoteIfChanged() {
    if (!supabaseClient) return;
    if (remoteSyncInFlight || remotePullInFlight) return;

    remotePullInFlight = true;
    try {
        const remoteDaten = await ladenRemote();
        if (!Array.isArray(remoteDaten)) return;

        const normalizedRemote = normalizeListData(remoteDaten);
        const lokaleDaten = normalizeListData(datenAusListeLesen());

        if (localDirty && listDataSignature(normalizedRemote) !== listDataSignature(lokaleDaten)) {
            return;
        }

        if (listDataSignature(normalizedRemote) !== listDataSignature(lokaleDaten)) {
            datenInListeSchreiben(normalizedRemote);
            applyModeSortAfterLoad();
            speichernLokal(datenAusListeLesen());
            setAuthStatus("Liste von anderem Geraet aktualisiert.");
        }

        lastSyncAt = formatTimeIso(new Date());
        setInputErrorStatus("");
        setSyncStatus("Sync: Verbunden", "ok");
        updateSyncDebug();
    } catch (err) {
        console.warn("Remote-Refresh fehlgeschlagen:", err, formatSupabaseError(err));
        setSyncStatus("Sync: Offline (lokal)", "offline");
        setInputErrorStatus(getSyncErrorHint(err));
        updateSyncDebug();
    } finally {
        remotePullInFlight = false;
    }
}

function startBackgroundSync() {
    if (!supabaseClient) return;
    if (backgroundSyncTimer) clearInterval(backgroundSyncTimer);

    backgroundSyncTimer = setInterval(() => {
        if (document.hidden) return;
        void refreshFromRemoteIfChanged();
    }, BACKGROUND_SYNC_INTERVAL_MS);

    window.addEventListener("focus", () => void refreshFromRemoteIfChanged());
    window.addEventListener("online", () => void refreshFromRemoteIfChanged());
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) void refreshFromRemoteIfChanged();
    });
}

function speichern(forceOverwrite = false) {
    const daten = datenAusListeLesen();
    speichernLokal(daten);
    localDirty = true;
    void syncRemoteIfNeeded(forceOverwrite);
}

async function laden() {
    const lokaleDaten = ladenLokal();

    if (!supabaseClient) {
        setSyncStatus("Sync: Lokal", "offline");
        updateSyncDebug();
        datenInListeSchreiben(lokaleDaten);
        applyModeSortAfterLoad();
        return;
    }

    try {
        const remoteDaten = await ladenRemote();
        if (remoteDaten && remoteDaten.length > 0) {
            datenInListeSchreiben(remoteDaten);
            applyModeSortAfterLoad();
            speichernLokal(datenAusListeLesen());
            localDirty = false;
            setSyncStatus("Sync: Verbunden", "ok");
            lastSyncAt = formatTimeIso(new Date());
            updateSyncDebug();
            return;
        }

        datenInListeSchreiben(lokaleDaten);
        applyModeSortAfterLoad();
        if (lokaleDaten.length > 0) void syncRemoteIfNeeded();
        else {
            localDirty = false;
            setSyncStatus("Sync: Verbunden", "ok");
            updateSyncDebug();
        }
    } catch (err) {
        console.warn("Remote-Laden fehlgeschlagen, nutze lokale Daten:", err, formatSupabaseError(err));
        setSyncStatus("Sync: Offline (lokal)", "offline");
        setInputErrorStatus(getSyncErrorHint(err));
        updateSyncDebug();
        datenInListeSchreiben(lokaleDaten);
        applyModeSortAfterLoad();
        localDirty = true;
    }
}


/* ======================
   EINTRÄGE
====================== */

function eintragAnlegen(text, erledigt = false, itemId = generateItemId()) {
    const li = document.createElement("li");
    const rawText = String(text || "");
    li.dataset.itemId = String(itemId || "").trim() || generateItemId();
    li.dataset.rawText = rawText;
    li.dataset.text = rawText;

    if (rawText.startsWith(IMAGE_ENTRY_PREFIX)) {
        const parsedPhoto = parsePhotoEntryText(rawText) || { imageSrc: "", caption: "" };
        const imageSrc = parsedPhoto.imageSrc;
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
            openImageViewer(imageSrc);
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
            speichern(true);
            setMicStatus("Foto gelöscht.");
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
            if (saveNow) speichern(true);
        };

        captionBtn.onclick = event => {
            event.stopPropagation();
            const current = photoCaption;
            const result = window.prompt("Bildbeschreibung (optional):", current);
            if (result === null) return;
            applyPhotoCaption(result, true);
            setMicStatus(result.trim() ? "Bildbeschreibung gespeichert." : "Bildbeschreibung entfernt.");
        };

        thumb.onclick = event => {
            event.stopPropagation();
            openImageViewer(imageSrc);
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
        if (modus !== "einkaufen") return;

        li.classList.toggle("erledigt");
        if (sortListByStoreGroups()) speichern();
        else speichern();
    };

    if (erledigt) {
        liste.appendChild(li);
        return;
    }

    if (modus === "erfassen") {
        if (isPhotoEntryText(rawText)) {
            liste.appendChild(li);
        } else {
            const firstPhoto = [...liste.querySelectorAll("li")].find(entry => isPhotoEntryText(entry.dataset.rawText || entry.dataset.text));
            if (firstPhoto) liste.insertBefore(li, firstPhoto);
            else liste.appendChild(li);
        }
        return;
    }

    liste.insertBefore(li, liste.firstChild);
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

    if (modus === "einkaufen") sortListByStoreGroups();
    speichern();
    multiInput.value = "";
    autoResize();
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
        setMicStatus("Eintrag gespeichert, Mikro wird neu gestartet...");
    }
}

multiAdd.onclick = mehrzeilenSpeichern;

function clearInputBuffer(stopDictation = false) {
    multiInput.value = "";
    autoResize();

    finalTranscript = "";
    latestTranscript = "";
    skipAutoSaveForCurrentBuffer = true;
    ignoreResultsUntil = Date.now() + 700;

    if (stopDictation && isListening && recognition) {
        restartMicAfterManualCommit = false;
        clearTimeout(micSessionTimer);
        recognition.stop();
        setMicStatus("Eingabe geloescht.");
        return;
    }

    if (isListening) setMicStatus("Eingabe geloescht. Bitte weiter sprechen...");
    else setMicStatus("Eingabe geloescht.");
}

function openImageViewer(src) {
    if (!imageViewer || !imageViewerImg) return;
    imageViewerImg.src = src;
    imageViewer.hidden = false;
}

function closeImageViewer() {
    if (!imageViewer || !imageViewerImg) return;
    imageViewer.hidden = true;
    imageViewerImg.src = "";
}

function openHelpViewer() {
    if (!helpViewer) return;
    helpViewer.hidden = false;
}

function closeHelpViewer() {
    if (!helpViewer) return;
    helpViewer.hidden = true;
}

async function addPhotoAsListItem(file) {
    if (!file) return;
    if (btnPhotoOcr) btnPhotoOcr.disabled = true;
    setMicStatus("Foto wird geladen...");

    try {
        const imageSrc = await readFileAsDataUrl(file);
        const optimizedImageSrc = await optimizePhotoDataUrl(imageSrc);
        eintragAnlegen(buildPhotoEntryText(optimizedImageSrc));
        if (modus === "einkaufen") sortListByStoreGroups();
        speichern();
        if (multiInput?.value?.trim()) {
            setMicStatus("Foto gespeichert. Text bleibt im Feld und kann mit Übernehmen gespeichert werden.");
        } else {
            setMicStatus("Foto zur Liste hinzugefügt.");
        }
    } catch (err) {
        console.warn("Foto konnte nicht hinzugefuegt werden:", err);
        setMicStatus("Foto konnte nicht gelesen werden.");
    } finally {
        if (btnPhotoOcr) btnPhotoOcr.disabled = false;
        if (photoOcrInput) photoOcrInput.value = "";
    }
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
        reader.readAsDataURL(file);
    });
}

async function optimizePhotoDataUrl(dataUrl) {
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
        clearInputBuffer(false);
    };
}

if (btnPhotoOcr && photoOcrInput) {
    btnPhotoOcr.onclick = () => photoOcrInput.click();
    photoOcrInput.onchange = () => {
        const file = photoOcrInput.files?.[0];
        void addPhotoAsListItem(file);
    };
}

if (btnImageViewerClose) btnImageViewerClose.onclick = closeImageViewer;
if (imageViewer) {
    imageViewer.onclick = event => {
        if (event.target === imageViewer) closeImageViewer();
    };
}
if (btnHelpViewerClose) btnHelpViewerClose.onclick = closeHelpViewer;
if (helpViewer) {
    helpViewer.onclick = event => {
        if (event.target === helpViewer) closeHelpViewer();
    };
}

btnNewLine.onclick = () => {
    multiInput.value += "\n";
    autoResize();
    multiInput.blur();
};

multiInput.addEventListener("input", autoResize);
multiInput.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.isComposing) return;

    event.preventDefault();
    const start = multiInput.selectionStart;
    const end = multiInput.selectionEnd;
    const text = multiInput.value;
    multiInput.value = text.slice(0, start) + "\n" + text.slice(end);
    const nextPos = start + 1;
    multiInput.setSelectionRange(nextPos, nextPos);
    autoResize();
});

function autoResize() {
    multiInput.style.height = "auto";
    multiInput.style.height = multiInput.scrollHeight + "px";
}

function isLocalhost() {
    return location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

function setMicStatus(message = "") {
    if (!micStatus) return;
    micStatus.textContent = message;
}

function setMicButtonState(listening) {
    if (!btnMic) return;
    btnMic.classList.toggle("listening", listening);
    btnMic.setAttribute("aria-pressed", listening ? "true" : "false");
    btnMic.textContent = listening ? "⏹" : "🎤";
}

function setInputWithDictation(text) {
    multiInput.value = text;
    autoResize();
    if (document.activeElement === multiInput) {
        fokusInputAmEnde();
    }
}

function initRecognition() {
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
        setMicButtonState(true);
        setMicStatus("Spracheingabe aktiv (max. 30s)...");
        clearTimeout(micSessionTimer);
        micSessionTimer = setTimeout(() => {
            if (!isListening) return;
            setMicStatus("Zeitlimit erreicht.");
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
        setInputWithDictation(combined);
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

        setMicStatus(errorText);
    };

    r.onend = () => {
        clearTimeout(micSessionTimer);
        isListening = false;
        setMicButtonState(false);
        if (restartMicAfterManualCommit) {
            restartMicAfterManualCommit = false;
            startRecognition();
            return;
        }

        if (skipAutoSaveForCurrentBuffer) {
            skipAutoSaveForCurrentBuffer = false;
            setMicStatus("Spracheingabe beendet.");
            return;
        }

        const spokenText = finalTranscript.trim() || latestTranscript.trim();

        if (spokenText) {
            if (multiInput.value.trim()) {
                multiInput.value = `${multiInput.value.trim()}\n${spokenText}`;
            } else {
                multiInput.value = spokenText;
            }
            autoResize();
            multiInput.focus();
            fokusInputAmEnde();
            setMicStatus("Text erkannt. Mit Übernehmen speichern.");
            return;
        }

        if (!micStatus?.textContent) setMicStatus("Keine Sprache erkannt.");
    };

    return r;
}

function startRecognition() {
    if (!recognition) return;
    setMicStatus("Mikrofon wird gestartet...");

    try {
        recognition.start();
    } catch (error) {
        setMicStatus("Start fehlgeschlagen. Bitte erneut tippen.");
        console.warn("Speech start error:", error);
    }
}

function toggleDictation() {
    if (!SpeechRecognitionCtor) {
        setMicStatus("Safari unterstuetzt hier keine Spracherkennung.");
        return;
    }

    if (!window.isSecureContext && !isLocalhost()) {
        setMicStatus("Spracheingabe braucht HTTPS.");
        return;
    }

    if (!recognition) recognition = initRecognition();
    if (!recognition) return;

    if (isListening) {
        clearTimeout(micSessionTimer);
        restartMicAfterManualCommit = false;
        recognition.stop();
        return;
    }

    startRecognition();
}

if (btnMic) btnMic.onclick = toggleDictation;


/* ======================
   MODUS
====================== */

function setModus(neu) {
    const vorher = modus;
    modus = neu;

    btnErfassen.classList.toggle("active", modus === "erfassen");
    btnEinkaufen.classList.toggle("active", modus === "einkaufen");
    if (modeBadge) modeBadge.textContent = modus === "einkaufen" ? "Einkaufen" : "Erfassen";
    document.body.classList.toggle("modus-einkaufen", modus === "einkaufen");
    if (syncCodeCompact) syncCodeCompact.hidden = modus !== "erfassen";
    if (authBar) {
        const showAuthBar = modus === "erfassen" && syncEditMode;
        authBar.hidden = !showAuthBar;
        authBar.classList.toggle("is-hidden", !showAuthBar);
    }

    if (vorher !== "einkaufen" && neu === "einkaufen") {
        if (sortListByStoreGroups()) speichern();
    }

    if (vorher === "einkaufen" && neu === "erfassen") {
        liste.querySelectorAll("li.erledigt").forEach(li => li.remove());
        sortListByCaptureTextFirst();
        speichern(true);
    }
}

btnErfassen.onclick  = () => setModus("erfassen");
btnEinkaufen.onclick = () => setModus("einkaufen");


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
        "Einkaufsliste",
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
            await navigator.share({ title: "Einkaufsliste", text });
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

setModus("erfassen");
if (versionBadge) versionBadge.textContent = "v" + APP_VERSION;
updateSyncDebug();

if (btnMic && !SpeechRecognitionCtor) {
    btnMic.disabled = true;
    btnMic.title = "Spracherkennung wird hier nicht unterstuetzt";
    setMicStatus("Spracherkennung wird in diesem Browser nicht unterstuetzt.");
}

setupSyncCodeUi();
if (btnForceUpdate) btnForceUpdate.onclick = () => void forceAppUpdate();
setupAutoUpdateChecks();

if (supabaseClient) {
    startBackgroundSync();
    void laden();
} else {
    setSyncStatus("Sync: Lokal", "offline");
    updateSyncDebug();
    datenInListeSchreiben(ladenLokal());
    applyModeSortAfterLoad();
}
