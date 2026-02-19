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
const btnErledigt = document.getElementById("btnErledigt");
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
const imageViewer = document.getElementById("image-viewer");
const imageViewerImg = document.getElementById("image-viewer-img");
const btnImageViewerClose = document.getElementById("btn-image-viewer-close");
const helpViewer = document.getElementById("help-viewer");
const btnHelpViewerClose = document.getElementById("btn-help-viewer-close");

let modus = "erfassen";
const APP_VERSION = "1.0.0";
const SpeechRecognitionCtor =
    window.SpeechRecognition || window.webkitSpeechRecognition;
const APP_CONFIG = window.APP_CONFIG || {};
const STORAGE_KEY = "erinnerungen";
const LEGACY_STORAGE_KEY = "einkaufsliste";
const SUPABASE_TABLE = "shopping_items";
const SUPABASE_CODES_TABLE = "sync_codes";
const SYNC_CODE_KEY = "erinnerungen-sync-code";
const LEGACY_SYNC_CODE_KEY = "einkaufsliste-sync-code";
const IMAGE_ENTRY_PREFIX = "__IMG__:";
const SYNC_CODE_LENGTH = 4;
const RESERVED_SYNC_CODE = "0000";
const BACKGROUND_SYNC_INTERVAL_MS = 4000;
const AUTO_UPDATE_CHECK_INTERVAL_MS = 60000;
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

function migrateLegacyLocalStorageKeys() {
    const currentList = localStorage.getItem(STORAGE_KEY);
    const legacyList = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!currentList && legacyList) {
        localStorage.setItem(STORAGE_KEY, legacyList);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
    }

    const currentSyncCode = localStorage.getItem(SYNC_CODE_KEY);
    const legacySyncCode = localStorage.getItem(LEGACY_SYNC_CODE_KEY);
    if (!currentSyncCode && legacySyncCode) {
        localStorage.setItem(SYNC_CODE_KEY, legacySyncCode);
        localStorage.removeItem(LEGACY_SYNC_CODE_KEY);
    }
}

function setAuthStatus(text) {
    if (!authStatus) return;
    authStatus.textContent = text;
}

function normalizeSyncCode(input) {
    return String(input || "")
        .replace(/\D/g, "")
        .slice(0, SYNC_CODE_LENGTH);
}

function isValidSyncCode(code) {
    return new RegExp("^\\d{" + SYNC_CODE_LENGTH + "}$").test(code);
}

function isReservedSyncCode(code) {
    return code === RESERVED_SYNC_CODE;
}

function generateSyncCode() {
    let nextCode = RESERVED_SYNC_CODE;
    while (isReservedSyncCode(nextCode)) {
        nextCode = String(Math.floor(Math.random() * 10000)).padStart(SYNC_CODE_LENGTH, "0");
    }
    return nextCode;
}

function getStoredSyncCode() {
    const stored = normalizeSyncCode(localStorage.getItem(SYNC_CODE_KEY) || "");
    if (stored && !isReservedSyncCode(stored)) return stored;
    const created = generateSyncCode();
    localStorage.setItem(SYNC_CODE_KEY, created);
    return created;
}

async function isSyncCodeOccupied(code) {
    if (!supabaseClient || !isValidSyncCode(code)) return false;
    if (!(await ensureSupabaseAuth())) return false;

    const { data, error } = await supabaseClient
        .from(SUPABASE_CODES_TABLE)
        .select("sync_code")
        .eq("sync_code", String(code))
        .limit(1);

    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
}

async function touchSyncCodeUsage(code) {
    if (!supabaseClient) return;
    if (!isValidSyncCode(code)) return;
    if (isReservedSyncCode(code)) return;
    if (!(await ensureSupabaseAuth())) return;

    const { error } = await supabaseClient
        .from(SUPABASE_CODES_TABLE)
        .upsert(
            { sync_code: String(code), last_used_at: new Date().toISOString() },
            { onConflict: "sync_code" }
        );

    if (error) throw error;
}

async function generateAvailableSyncCode(maxAttempts = 25) {
    for (let i = 0; i < maxAttempts; i += 1) {
        const candidate = generateSyncCode();
        try {
            if (!(await isSyncCodeOccupied(candidate))) return candidate;
        } catch (err) {
            console.warn("Freien Code konnte nicht online geprueft werden:", err);
            return candidate;
        }
    }
    return generateSyncCode();
}

async function applySyncCode(code, shouldReload = true, options = {}) {
    const allowOccupied = options.allowOccupied !== false;
    const normalized = normalizeSyncCode(code);
    if (!isValidSyncCode(normalized)) {
        setAuthStatus("Bitte 4-stelligen Zahlencode eingeben.");
        return;
    }
    if (isReservedSyncCode(normalized)) {
        openHelpViewer();
        setAuthStatus("Code 0000 oeffnet die Kurzanleitung.");
        if (syncCodeInput) syncCodeInput.value = currentSyncCode || "";
        return;
    }

    if (!allowOccupied && normalized !== currentSyncCode) {
        try {
            if (await isSyncCodeOccupied(normalized)) {
                setAuthStatus("Code ist bereits belegt. Bitte anderen Code nutzen.");
                if (syncCodeInput) {
                    syncCodeInput.value = currentSyncCode || "";
                    syncCodeInput.focus();
                    syncCodeInput.select();
                }
                return;
            }
        } catch (err) {
            console.warn("Code-Pruefung fehlgeschlagen:", err);
            setAuthStatus(getSyncErrorHint(err));
            return;
        }
    }

    currentSyncCode = normalized;
    localStorage.setItem(SYNC_CODE_KEY, currentSyncCode);
    if (syncCodeInput) syncCodeInput.value = currentSyncCode;
    if (btnSyncCodeDisplay) btnSyncCodeDisplay.textContent = currentSyncCode;
    setAuthStatus(`Geraete-Code: ${currentSyncCode}`);
    setSyncEditMode(false);
    if (syncCodeInput) syncCodeInput.blur();
    void touchSyncCodeUsage(currentSyncCode).catch(err => {
        console.warn("Code-Nutzung konnte nicht markiert werden:", err);
    });
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
        setAuthStatus("Supabase nicht konfiguriert. App laeuft nur lokal.");
    } else if (!hasSupabaseLibrary) {
        setAuthStatus("Supabase nicht geladen. Internet pruefen und neu laden.");
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
        .map((e, index) => {
            const itemId = String(e?.itemId || e?.item_id || "").trim();
            const text = String(e?.text || e?.title || "").trim();
            const title = String(e?.title || text).trim();
            const note = String(e?.note || "").trim();
            const createdAt =
                normalizeDateIso(e?.createdAt || e?.created_at)
                || extractDateFromItemId(itemId);
            const entryDate =
                normalizeDateIso(e?.entryDate || e?.entry_date || e?.createdAt || e?.created_at)
                || createdAt;

            return {
                itemId,
                text: text || title,
                title: title || text,
                note,
                erledigt: Boolean(e?.erledigt),
                createdAt,
                entryDate,
                position: Number.isFinite(e?.position) ? e.position : index
            };
        })
        .filter(e => (e.text || e.title).length > 0)
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
            title: e.title.toLowerCase(),
            note: e.note.toLowerCase(),
            erledigt: e.erledigt,
            createdAt: e.createdAt || "",
            entryDate: e.entryDate || "",
            position: e.position
        }))
    );
}

function generateItemId() {
    return `item-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeDateIso(input) {
    if (!input) return "";
    const parsedMs = Date.parse(String(input));
    if (!Number.isFinite(parsedMs)) return "";
    return new Date(parsedMs).toISOString();
}

function extractDateFromItemId(itemId) {
    const match = String(itemId || "").match(/^item-(\d{13})-[a-z0-9]+$/i);
    if (!match) return "";
    const parsedMs = Number(match[1]);
    if (!Number.isFinite(parsedMs)) return "";
    return new Date(parsedMs).toISOString();
}

function formatEntryDate(createdAt) {
    const iso = normalizeDateIso(createdAt);
    if (!iso) return "";

    try {
        const d = new Date(iso);
        const day = String(d.getDate()).padStart(2, "0");
        const month = String(d.getMonth() + 1).padStart(2, "0");
        return `${day}.${month}.`;
    } catch {
        return iso.slice(0, 10);
    }
}

function entryLabelFromData(entryLike) {
    const text = String(entryLike?.text || entryLike?.title || "").trim();
    const note = String(entryLike?.note || "").trim();
    if (!text || text.startsWith(IMAGE_ENTRY_PREFIX)) return text;
    return note ? `${text} — ${note}` : text;
}

function getEntryTimestamp(entryLike) {
    const fromEntryDate = normalizeDateIso(entryLike?.entryDate || entryLike?.entry_date);
    if (fromEntryDate) return Date.parse(fromEntryDate);
    const fromCreatedAt = normalizeDateIso(entryLike?.createdAt || entryLike?.created_at);
    if (fromCreatedAt) return Date.parse(fromCreatedAt);
    const fromItemId = extractDateFromItemId(entryLike?.itemId || entryLike?.item_id);
    if (fromItemId) return Date.parse(fromItemId);
    return 0;
}

function sortListByReminderDate() {
    const daten = normalizeListData(datenAusListeLesen());
    if (!daten.length) return false;

    const offene = daten.filter(e => !e.erledigt);
    const erledigte = daten.filter(e => e.erledigt);
    const collator = new Intl.Collator("de", { sensitivity: "base" });

    const sortFn = (a, b) => {
        const tsDiff = getEntryTimestamp(b) - getEntryTimestamp(a);
        if (tsDiff !== 0) return tsDiff;
        return collator.compare(entryLabelFromData(a), entryLabelFromData(b));
    };
    offene.sort(sortFn);
    erledigte.sort(sortFn);

    const sortierte = [...offene, ...erledigte].map((e, index) => ({
        itemId: e.itemId,
        text: e.text,
        title: e.title,
        note: e.note,
        erledigt: e.erledigt,
        createdAt: e.createdAt || "",
        entryDate: e.entryDate || e.createdAt || "",
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
        merged.push({
            itemId: item.itemId,
            text: item.text,
            title: item.title,
            note: item.note,
            erledigt: item.erledigt,
            createdAt: item.createdAt || "",
            entryDate: item.entryDate || item.createdAt || "",
            position: merged.length
        });
    }

    for (const item of remote) {
        if (seenById.has(item.itemId)) continue;
        seenById.add(item.itemId);
        merged.push({
            itemId: item.itemId,
            text: item.text,
            title: item.title,
            note: item.note,
            erledigt: item.erledigt,
            createdAt: item.createdAt || "",
            entryDate: item.entryDate || item.createdAt || "",
            position: merged.length
        });
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
    if (message.includes("failed to fetch") || message.includes("network")) {
        return "Netzwerkfehler. Internetverbindung pruefen.";
    }
    return "Sync-Fehler: " + raw.slice(0, 120);
}

async function forceAppUpdate() {
    if (btnForceUpdate) btnForceUpdate.disabled = true;
    setSyncStatus("Update: komplette Neuinstallation...", "warn");

    try {
        if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter(key => key.startsWith("erinnerungen-") || key.startsWith("einkaufsliste-"))
                    .map(key => caches.delete(key))
            );
        }

        if ("serviceWorker" in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(registration => registration.unregister()));
        }

        // Kleine Pause, damit SW-Abmeldung und Cache-Loeschung sicher wirksam sind.
        await new Promise(resolve => setTimeout(resolve, 180));

        const url = new URL(location.href);
        url.searchParams.set("u", String(Date.now()));
        location.replace(url.toString());
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
    if (!supabaseClient) return false;
    if (supabaseReady && supabaseUserId) return true;

    try {
        setSyncStatus("Sync: Verbinde...", "warn");
        const sessionResult = await supabaseClient.auth.getSession();
        let user = sessionResult?.data?.session?.user || null;

        if (!user) {
            const anonResult = await supabaseClient.auth.signInAnonymously();
            user = anonResult?.data?.user || null;
        }

        if (!user?.id) return false;
        supabaseUserId = user.id;
        supabaseReady = true;
        startRealtimeSync();
        setSyncStatus("Sync: Verbunden", "ok");
        updateSyncDebug();
        return true;
    } catch (err) {
        console.warn("Supabase Auth nicht verfuegbar:", err);
        supabaseReady = false;
        supabaseUserId = "";
        stopRealtimeSync();
        setSyncStatus("Sync: Offline (lokal)", "offline");
        updateSyncDebug();
        return false;
    }
}

function datenAusListeLesen() {
    const daten = [];

    liste.querySelectorAll("li").forEach((li, index) => {
        const itemId = String(li.dataset.itemId || "").trim() || generateItemId();
        const createdAt = normalizeDateIso(li.dataset.createdAt) || extractDateFromItemId(itemId) || new Date().toISOString();
        const entryDate = normalizeDateIso(li.dataset.entryDate || li.dataset.createdAt) || createdAt;
        const title = String(li.dataset.title || li.dataset.rawText || li.dataset.text || "").trim();
        const note = String(li.dataset.note || "").trim();
        li.dataset.itemId = itemId;
        li.dataset.createdAt = createdAt;
        li.dataset.entryDate = entryDate;
        li.dataset.title = title;
        li.dataset.note = note;
        daten.push({
            itemId,
            text: li.dataset.rawText || li.dataset.text || title,
            title,
            note,
            erledigt: li.classList.contains("erledigt"),
            createdAt,
            entryDate,
            position: index
        });
    });

    return daten;
}

function datenInListeSchreiben(daten) {
    liste.innerHTML = "";
    daten.forEach(e => eintragAnlegen(e));
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
                text: String(e.text || e.title || ""),
                title: String(e.title || e.text || ""),
                note: String(e.note || ""),
                erledigt: Boolean(e.erledigt),
                createdAt: normalizeDateIso(e.createdAt || e.created_at) || extractDateFromItemId(e.itemId || e.item_id),
                entryDate:
                    normalizeDateIso(e.entryDate || e.entry_date || e.createdAt || e.created_at)
                    || extractDateFromItemId(e.itemId || e.item_id),
                position: Number.isFinite(e.position) ? e.position : index
            }))
            .filter(e => (e.text || e.title).trim().length > 0);
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
        title: String(e.text || ""),
        note: "",
        erledigt: Boolean(e.erledigt),
        createdAt: extractDateFromItemId(e.item_id),
        entryDate: extractDateFromItemId(e.item_id),
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
        text: String(e.text || e.title || ""),
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
                            speichernLokal(datenZumSpeichern);
                            setAuthStatus("Konflikt erkannt: Listen wurden zusammengefuehrt.");
                        }
                    }
                }
            }

            await speichernRemote(datenZumSpeichern, { allowRemoteDeletes: overwriteThisRun });
        } while (remoteSyncQueued);
        lastSyncAt = formatTimeIso(new Date());
        localDirty = false;
        setSyncStatus("Sync: Verbunden", "ok");
        updateSyncDebug();
    } catch (err) {
        console.warn("Remote-Sync fehlgeschlagen, lokal bleibt aktiv:", err, formatSupabaseError(err));
        setSyncStatus("Sync: Offline (lokal)", "offline");
        setAuthStatus(getSyncErrorHint(err));
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
            speichernLokal(normalizedRemote);
            setAuthStatus("Liste von anderem Geraet aktualisiert.");
        }

        lastSyncAt = formatTimeIso(new Date());
        setSyncStatus("Sync: Verbunden", "ok");
        updateSyncDebug();
    } catch (err) {
        console.warn("Remote-Refresh fehlgeschlagen:", err, formatSupabaseError(err));
        setSyncStatus("Sync: Offline (lokal)", "offline");
        setAuthStatus(getSyncErrorHint(err));
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
        return;
    }

    try {
        const remoteDaten = await ladenRemote();
        if (remoteDaten && remoteDaten.length > 0) {
            datenInListeSchreiben(remoteDaten);
            speichernLokal(remoteDaten);
            localDirty = false;
            setSyncStatus("Sync: Verbunden", "ok");
            lastSyncAt = formatTimeIso(new Date());
            updateSyncDebug();
            return;
        }

        datenInListeSchreiben(lokaleDaten);
        if (lokaleDaten.length > 0) void syncRemoteIfNeeded();
        else {
            localDirty = false;
            setSyncStatus("Sync: Verbunden", "ok");
            updateSyncDebug();
        }
    } catch (err) {
        console.warn("Remote-Laden fehlgeschlagen, nutze lokale Daten:", err, formatSupabaseError(err));
        setSyncStatus("Sync: Offline (lokal)", "offline");
        setAuthStatus(getSyncErrorHint(err));
        updateSyncDebug();
        datenInListeSchreiben(lokaleDaten);
        localDirty = true;
    }
}


/* ======================
   EINTRÄGE
====================== */

function eintragAnlegen(text, erledigt = false, itemId = generateItemId(), createdAt = "") {
    const li = document.createElement("li");
    const inputIsObject = typeof text === "object" && text !== null;
    const rawText = String(inputIsObject ? (text.text || text.title || "") : (text || ""));
    const entryTitle = String(inputIsObject ? (text.title || rawText) : rawText).trim();
    const entryNote = String(inputIsObject ? (text.note || "") : "").trim();
    const inputItemId = inputIsObject ? text.itemId : itemId;
    const inputCreatedAt = inputIsObject ? (text.createdAt || text.entryDate) : createdAt;
    const normalizedItemId = String(inputItemId || "").trim() || generateItemId();
    const normalizedCreatedAt =
        normalizeDateIso(inputCreatedAt) || extractDateFromItemId(normalizedItemId) || new Date().toISOString();
    const normalizedEntryDate =
        normalizeDateIso(inputIsObject ? (text.entryDate || text.createdAt) : createdAt)
        || normalizedCreatedAt;
    li.dataset.itemId = normalizedItemId;
    li.dataset.rawText = rawText;
    li.dataset.text = rawText;
    li.dataset.title = entryTitle;
    li.dataset.note = entryNote;
    li.dataset.createdAt = normalizedCreatedAt;
    li.dataset.entryDate = normalizedEntryDate;

    if (rawText.startsWith(IMAGE_ENTRY_PREFIX)) {
        const imageSrc = rawText.slice(IMAGE_ENTRY_PREFIX.length);
        const wrapper = document.createElement("div");
        wrapper.className = "list-photo-item";

        const thumb = document.createElement("img");
        thumb.className = "list-photo-thumb";
        thumb.src = imageSrc;
        thumb.alt = "Fotoeintrag";

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "list-photo-open";
        openBtn.textContent = "Foto öffnen";
        openBtn.onclick = event => {
            event.stopPropagation();
            openImageViewer(imageSrc);
        };

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

        thumb.onclick = event => {
            event.stopPropagation();
            openImageViewer(imageSrc);
        };

        wrapper.appendChild(thumb);
        wrapper.appendChild(openBtn);
        wrapper.appendChild(deleteBtn);
        li.appendChild(wrapper);
    } else {
        const textWrap = document.createElement("span");
        textWrap.className = "list-item-text";

        const titleSpan = document.createElement("span");
        titleSpan.className = "list-item-title";
        titleSpan.textContent = entryTitle;
        textWrap.appendChild(titleSpan);

        if (entryNote) {
            const noteSpan = document.createElement("span");
            noteSpan.className = "list-item-note";
            noteSpan.textContent = entryNote;
            textWrap.appendChild(noteSpan);
        }

        li.appendChild(textWrap);
    }

    const dateSpan = document.createElement("span");
    dateSpan.className = "list-item-date";
    dateSpan.textContent = formatEntryDate(normalizedEntryDate);
    li.appendChild(dateSpan);

    if (erledigt) li.classList.add("erledigt");

    li.onclick = () => {
        if (modus !== "erledigt") return;

        li.classList.toggle("erledigt");
        speichern();

        if (li.classList.contains("erledigt")) {
            liste.appendChild(li);
        } else {
            liste.insertBefore(li, liste.firstChild);
        }
    };

    erledigt
        ? liste.appendChild(li)
        : liste.insertBefore(li, liste.firstChild);
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
        eintragAnlegen(IMAGE_ENTRY_PREFIX + optimizedImageSrc);
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
        multiInput.focus();
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
    btnErledigt.classList.toggle("active", modus === "erledigt");
    if (modeBadge) modeBadge.textContent = modus === "erledigt" ? "Erledigt" : "Erfassen";
    document.body.classList.toggle("modus-erledigt", modus === "erledigt");
    if (syncCodeCompact) syncCodeCompact.hidden = modus !== "erfassen";
    if (authBar) {
        const showAuthBar = modus === "erfassen" && syncEditMode;
        authBar.hidden = !showAuthBar;
        authBar.classList.toggle("is-hidden", !showAuthBar);
    }

    if (vorher !== "erfassen" && neu === "erledigt") {
        if (sortListByReminderDate()) speichern();
    }

    if (vorher === "erledigt" && neu === "erfassen") {
        liste.querySelectorAll("li.erledigt").forEach(li => li.remove());
        speichern(true);
    }
}

btnErfassen.onclick  = () => setModus("erfassen");
btnErledigt.onclick = () => setModus("erledigt");


/* ======================
   EXPORT
====================== */

btnExport.onclick = async () => {
    const text = [...liste.querySelectorAll("li")]
        .map(li => {
            const raw = String(li.dataset.rawText || li.dataset.text || "");
            const title = String(li.dataset.title || raw).trim();
            const note = String(li.dataset.note || "").trim();
            const label = raw.startsWith(IMAGE_ENTRY_PREFIX) ? "[Foto]" : (note ? `${title} — ${note}` : title);
            return (li.classList.contains("erledigt") ? "✔ " : "• ") + label;
        })
        .join("\n");

    if (navigator.share) {
        try {
            await navigator.share({ title: "Erinnerungen", text });
            return;
        } catch {}
    }

    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        alert("Erinnerungen kopiert.");
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
migrateLegacyLocalStorageKeys();

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
}
