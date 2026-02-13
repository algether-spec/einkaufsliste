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
const imageViewer = document.getElementById("image-viewer");
const imageViewerImg = document.getElementById("image-viewer-img");
const btnImageViewerClose = document.getElementById("btn-image-viewer-close");

let modus = "erfassen";
const APP_VERSION = "1.0.32";
const SpeechRecognitionCtor =
    window.SpeechRecognition || window.webkitSpeechRecognition;
const APP_CONFIG = window.APP_CONFIG || {};
const STORAGE_KEY = "einkaufsliste";
const SUPABASE_TABLE = "shopping_items";
const SYNC_CODE_KEY = "einkaufsliste-sync-code";
const IMAGE_ENTRY_PREFIX = "__IMG__:";
const SYNC_CODE_LENGTH = 4;
const GROUP_RULES = [
    { name: "obst_gemuese", patterns: ["apfel", "banane", "birne", "zitrone", "orange", "traube", "beere", "salat", "gurke", "tomate", "paprika", "zucchini", "kartoffel", "zwiebel", "knoblauch", "karotte", "mohrrube", "brokkoli", "blumenkohl", "pilz", "avocado"] },
    { name: "backen", patterns: ["brot", "broetchen", "toast", "mehl", "hefe", "backpulver", "zucker", "vanille", "kuchen", "croissant"] },
    { name: "milch_eier", patterns: ["milch", "joghurt", "quark", "kaese", "butter", "sahne", "ei", "frischkaese", "mozzarella", "parmesan"] },
    { name: "fleisch_fisch", patterns: ["fleisch", "huhn", "haehnchen", "pute", "rind", "schwein", "hack", "wurst", "schinken", "salami", "speck", "fisch", "lachs", "thunfisch"] },
    { name: "tiefkuehl", patterns: ["tk", "tiefkuehl", "pizza", "pommes", "eis", "gemuese mix", "beeren mix"] },
    { name: "trockenwaren", patterns: ["nudel", "reis", "linsen", "bohnen", "konserve", "dose", "tomatenmark", "sauce", "bruehe", "muessli", "haferflocken"] },
    { name: "getraenke", patterns: ["wasser", "saft", "cola", "fanta", "sprite", "bier", "wein", "kaffee", "tee"] },
    { name: "drogerie", patterns: ["toilettenpapier", "kuechenrolle", "spuelmittel", "waschmittel", "seife", "shampoo", "zahnpasta", "deo", "muellbeutel"] }
];
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
let supabaseReady = false;
let supabaseUserId = "";
let lastSyncAt = "";
const debugEnabled = new URLSearchParams(location.search).get("debug") === "1";
let currentSyncCode = "";
let syncEditMode = false;

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

function normalizeSyncCode(input) {
    return String(input || "")
        .replace(/\D/g, "")
        .slice(0, SYNC_CODE_LENGTH);
}

function isValidSyncCode(code) {
    return new RegExp("^\\d{" + SYNC_CODE_LENGTH + "}$").test(code);
}

function generateSyncCode() {
    return String(Math.floor(Math.random() * 10000)).padStart(SYNC_CODE_LENGTH, "0");
}

function getStoredSyncCode() {
    const stored = normalizeSyncCode(localStorage.getItem(SYNC_CODE_KEY) || "");
    if (stored) return stored;
    const created = generateSyncCode();
    localStorage.setItem(SYNC_CODE_KEY, created);
    return created;
}

function applySyncCode(code, shouldReload = true) {
    const normalized = normalizeSyncCode(code);
    if (!isValidSyncCode(normalized)) {
        setAuthStatus("Bitte 4-stelligen Zahlencode eingeben.");
        return;
    }

    currentSyncCode = normalized;
    localStorage.setItem(SYNC_CODE_KEY, currentSyncCode);
    if (syncCodeInput) syncCodeInput.value = currentSyncCode;
    if (btnSyncCodeDisplay) btnSyncCodeDisplay.textContent = currentSyncCode;
    setAuthStatus(`Geraete-Code: ${currentSyncCode}`);
    setSyncEditMode(false);
    if (syncCodeInput) syncCodeInput.blur();
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

    applySyncCode(getStoredSyncCode(), false);
    if (syncStatus) syncStatus.hidden = true;
    setSyncEditMode(false);

    if (!hasSupabaseCredentials) {
        setAuthStatus("Supabase nicht konfiguriert. App laeuft nur lokal.");
    } else if (!hasSupabaseLibrary) {
        setAuthStatus("Supabase nicht geladen. Internet pruefen und neu laden.");
    }

    if (btnSyncApply) {
        btnSyncApply.onclick = () => applySyncCode(syncCodeInput?.value || "");
    }

    if (btnSyncNew) {
        btnSyncNew.onclick = () => applySyncCode(generateSyncCode());
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
    return daten
        .map((e, index) => ({
            text: String(e?.text || "").trim(),
            erledigt: Boolean(e?.erledigt),
            position: Number.isFinite(e?.position) ? e.position : index
        }))
        .filter(e => e.text.length > 0)
        .map((e, index) => ({ ...e, position: index }));
}

function listDataSignature(daten) {
    return JSON.stringify(
        normalizeListData(daten).map(e => ({
            text: e.text.toLowerCase(),
            erledigt: e.erledigt
        }))
    );
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
    if (String(text || "").startsWith(IMAGE_ENTRY_PREFIX)) return GROUP_RULES.length + 1;
    const normalized = normalizeForGroupMatch(text);
    for (let i = 0; i < GROUP_RULES.length; i += 1) {
        const rule = GROUP_RULES[i];
        if (rule.patterns.some(pattern => normalized.includes(pattern))) return i;
    }
    return GROUP_RULES.length;
}

function sortListByStoreGroups() {
    const daten = normalizeListData(datenAusListeLesen());
    if (!daten.length) return false;

    const offene = daten.filter(e => !e.erledigt);
    const erledigte = daten.filter(e => e.erledigt);
    const collator = new Intl.Collator("de", { sensitivity: "base" });

    offene.sort((a, b) => {
        const groupDiff = getGroupIndex(a.text) - getGroupIndex(b.text);
        if (groupDiff !== 0) return groupDiff;
        return collator.compare(a.text, b.text);
    });

    const sortierte = [...offene, ...erledigte].map((e, index) => ({
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
    const seen = new Set();

    for (const item of local) {
        const key = item.text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push({ text: item.text, erledigt: item.erledigt, position: merged.length });
    }

    for (const item of remote) {
        const key = item.text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push({ text: item.text, erledigt: item.erledigt, position: merged.length });
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
    setSyncStatus("Update: wird geladen...", "warn");

    try {
        if ("serviceWorker" in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
                await registration.update();
                if (registration.waiting) {
                    registration.waiting.postMessage({ type: "SKIP_WAITING" });
                }
            }
        }

        if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter(key => key.startsWith("einkaufsliste-"))
                    .map(key => caches.delete(key))
            );
        }

        location.reload();
    } catch (err) {
        console.warn("Update fehlgeschlagen:", err);
        setSyncStatus("Update fehlgeschlagen", "offline");
        setAuthStatus("Update fehlgeschlagen. Bitte Seite neu laden.");
        if (btnForceUpdate) btnForceUpdate.disabled = false;
    }
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
        setSyncStatus("Sync: Verbunden", "ok");
        updateSyncDebug();
        return true;
    } catch (err) {
        console.warn("Supabase Auth nicht verfuegbar:", err);
        supabaseReady = false;
        supabaseUserId = "";
        setSyncStatus("Sync: Offline (lokal)", "offline");
        updateSyncDebug();
        return false;
    }
}

function datenAusListeLesen() {
    const daten = [];

    liste.querySelectorAll("li").forEach((li, index) => {
        daten.push({
            text: li.dataset.rawText || li.dataset.text || "",
            erledigt: li.classList.contains("erledigt"),
            position: index
        });
    });

    return daten;
}

function datenInListeSchreiben(daten) {
    liste.innerHTML = "";
    daten.forEach(e => eintragAnlegen(e.text, e.erledigt));
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
        .select("text, erledigt, position")
        .eq("sync_code", currentSyncCode)
        .order("position", { ascending: true });

    if (error) throw error;
    if (!Array.isArray(data)) return [];

    return data.map((e, index) => ({
        text: String(e.text || ""),
        erledigt: Boolean(e.erledigt),
        position: Number.isFinite(e.position) ? e.position : index
    }));
}

async function speichernRemote(daten) {
    if (!supabaseClient) return;
    if (!(await ensureSupabaseAuth())) return;

    const { error: deleteError } = await supabaseClient
        .from(SUPABASE_TABLE)
        .delete()
        .eq("sync_code", currentSyncCode);

    if (deleteError) throw deleteError;
    if (!daten.length) return;

    const payload = daten.map((e, index) => ({
        sync_code: currentSyncCode,
        text: e.text,
        erledigt: e.erledigt,
        position: index
    }));

    const { error: insertError } = await supabaseClient
        .from(SUPABASE_TABLE)
        .insert(payload);

    if (insertError) throw insertError;
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

            await speichernRemote(datenZumSpeichern);
        } while (remoteSyncQueued);
        lastSyncAt = formatTimeIso(new Date());
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

function speichern(forceOverwrite = false) {
    const daten = datenAusListeLesen();
    speichernLokal(daten);
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
            setSyncStatus("Sync: Verbunden", "ok");
            lastSyncAt = formatTimeIso(new Date());
            updateSyncDebug();
            return;
        }

        datenInListeSchreiben(lokaleDaten);
        if (lokaleDaten.length > 0) void syncRemoteIfNeeded();
        else {
            setSyncStatus("Sync: Verbunden", "ok");
            updateSyncDebug();
        }
    } catch (err) {
        console.warn("Remote-Laden fehlgeschlagen, nutze lokale Daten:", err, formatSupabaseError(err));
        setSyncStatus("Sync: Offline (lokal)", "offline");
        setAuthStatus(getSyncErrorHint(err));
        updateSyncDebug();
        datenInListeSchreiben(lokaleDaten);
    }
}


/* ======================
   EINTRÄGE
====================== */

function eintragAnlegen(text, erledigt = false) {
    const li = document.createElement("li");
    const rawText = String(text || "");
    li.dataset.rawText = rawText;
    li.dataset.text = rawText;

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

        thumb.onclick = event => {
            event.stopPropagation();
            openImageViewer(imageSrc);
        };

        wrapper.appendChild(thumb);
        wrapper.appendChild(openBtn);
        li.appendChild(wrapper);
    } else {
        li.textContent = rawText;
    }

    if (erledigt) li.classList.add("erledigt");

    li.onclick = () => {
        if (modus !== "einkaufen") return;

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

    if (isListening) {
        setMicStatus("Eingabe geloescht. Bitte weiter sprechen...");
    } else {
        setMicStatus("Eingabe geloescht.");
    }
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

async function addPhotoAsListItem(file) {
    if (!file) return;
    if (btnPhotoOcr) btnPhotoOcr.disabled = true;
    setMicStatus("Foto wird eingefuegt...");

    try {
        const imageSrc = await readFileAsDataUrl(file);
        eintragAnlegen(IMAGE_ENTRY_PREFIX + imageSrc);
        speichern();
        setMicStatus("Foto zur Liste hinzugefuegt.");
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
            eintragAnlegen(spokenText);
            speichern();
            multiInput.value = "";
            autoResize();
            multiInput.blur();
            setMicStatus("Eintrag per Sprache gespeichert.");
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
        speichern(true);
    }
}

btnErfassen.onclick  = () => setModus("erfassen");
btnEinkaufen.onclick = () => setModus("einkaufen");


/* ======================
   EXPORT
====================== */

btnExport.onclick = async () => {
    const text = [...liste.querySelectorAll("li")]
        .map(li => {
            const raw = String(li.dataset.rawText || li.dataset.text || "");
            const label = raw.startsWith(IMAGE_ENTRY_PREFIX) ? "[Foto]" : raw;
            return (li.classList.contains("erledigt") ? "✔ " : "• ") + label;
        })
        .join("\n");

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

if (supabaseClient) {
    void laden();
} else {
    setSyncStatus("Sync: Lokal", "offline");
    updateSyncDebug();
    datenInListeSchreiben(ladenLokal());
}
