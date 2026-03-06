/* ======================
   UTILS.JS
   Reine Datenfunktionen ohne DOM- oder localStorage-Abhängigkeiten.
   Wird von app.js verwendet und ist unabhängig per Node.js testbar.
====================== */

/* --- Konstanten -------------------------------------------------- */

const IMAGE_ENTRY_PREFIX = "__IMG__:";
const IMAGE_ENTRY_CAPTION_MARKER = "\n__CAPTION__:";

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
    "obst_gemuese", "backen", "fleisch_fisch", "milch_eier",
    "tiefkuehl", "trockenwaren", "getraenke", "drogerie"
];
// APP_CONFIG kann via config.js (Browser) oder globalThis (Tests) kommen
const _cfg = (typeof globalThis !== "undefined" && globalThis.APP_CONFIG) || {};
const GROUP_ORDER = Array.isArray(_cfg.storeGroupOrder)
    ? _cfg.storeGroupOrder.filter(name => Array.isArray(GROUP_DEFINITIONS[name]))
    : DEFAULT_GROUP_ORDER;

/* --- Photo-Entry-Text -------------------------------------------- */

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
    return cap
        ? (IMAGE_ENTRY_PREFIX + img + IMAGE_ENTRY_CAPTION_MARKER + cap)
        : (IMAGE_ENTRY_PREFIX + img);
}

function isPhotoEntryText(text) {
    return String(text || "").startsWith(IMAGE_ENTRY_PREFIX);
}

/* --- IDs --------------------------------------------------------- */

function generateItemId() {
    const crypto = (typeof globalThis !== "undefined" && globalThis.crypto)
        || (typeof window !== "undefined" && window.crypto);
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* --- Gruppen / Sortierung ---------------------------------------- */

function normalizeForGroupMatch(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/ä/g, "ae").replace(/ö/g, "oe")
        .replace(/ü/g, "ue").replace(/ß/g, "ss");
}

const _groupIndexCache = new Map();
function getGroupIndex(text) {
    const key = String(text || "");
    if (_groupIndexCache.has(key)) return _groupIndexCache.get(key);
    let result;
    if (key.startsWith(IMAGE_ENTRY_PREFIX)) {
        result = GROUP_ORDER.length + 1;
    } else {
        const normalized = normalizeForGroupMatch(key);
        result = GROUP_ORDER.length;
        for (let i = 0; i < GROUP_ORDER.length; i += 1) {
            if ((GROUP_DEFINITIONS[GROUP_ORDER[i]] || []).some(p => normalized.includes(p))) {
                result = i;
                break;
            }
        }
    }
    _groupIndexCache.set(key, result);
    return result;
}

/* --- Datennormalisierung ----------------------------------------- */

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

function normalizeSnapshotData(daten) {
    return normalizeListData(daten).map((entry, index) => ({
        itemId: entry.itemId,
        text: entry.text,
        erledigt: entry.erledigt,
        position: Number.isFinite(entry.position) ? entry.position : index
    }));
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

/* --- Reine Sortierfunktionen (kein DOM, kein localStorage) ------- */

function sortDataByCaptureTextFirst(daten) {
    const offeneTexte = daten.filter(e => !e.erledigt && !isPhotoEntryText(e.text));
    const offeneFotos = daten.filter(e => !e.erledigt && isPhotoEntryText(e.text));
    const erledigte  = daten.filter(e => e.erledigt);
    return [...offeneTexte, ...offeneFotos, ...erledigte].map((e, index) => ({
        itemId: e.itemId, text: e.text, erledigt: e.erledigt, position: index
    }));
}

function sortDataByStoreGroups(daten) {
    const offeneTexte   = [...daten.filter(e => !e.erledigt && !isPhotoEntryText(e.text))];
    const offeneFotos   = daten.filter(e => !e.erledigt && isPhotoEntryText(e.text));
    const erledigteTexte = [...daten.filter(e => e.erledigt && !isPhotoEntryText(e.text))];
    const erledigteFotos = daten.filter(e => e.erledigt && isPhotoEntryText(e.text));
    const collator = new Intl.Collator("de", { sensitivity: "base" });
    const sortFn = (a, b) => {
        const d = getGroupIndex(a.text) - getGroupIndex(b.text);
        return d !== 0 ? d : collator.compare(a.text, b.text);
    };
    offeneTexte.sort(sortFn);
    erledigteTexte.sort(sortFn);
    return [...offeneTexte, ...erledigteTexte, ...offeneFotos, ...erledigteFotos].map((e, index) => ({
        itemId: e.itemId, text: e.text, erledigt: e.erledigt, position: index
    }));
}

/* --- Netzwerk / Browser-Helpers ---------------------------------- */

function keinNetzwerk() {
    return typeof navigator !== "undefined" && navigator.onLine === false;
}

function istLokalhost() {
    return typeof location !== "undefined"
        && (location.hostname === "localhost" || location.hostname === "127.0.0.1");
}

function seitenNeuladen() {
    const url = new URL(location.href);
    url.searchParams.set("u", String(Date.now()));
    location.replace(url.toString());
}

function geraeteIdLaden() {
    const existing = String(localStorage.getItem(DEVICE_ID_KEY) || "").trim();
    if (existing) return existing;
    const created = window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
}

/* --- Fehler / Formatierung --------------------------------------- */

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

/* --- Sync-Meta Hilfe --------------------------------------------- */

function leereSyncMetaErstellen() {
    return {
        opSeq: 0,
        pendingOps: [],
        snapshot: [],
        lastRemoteSyncAt: ""
    };
}

/* --- IndexedDB Foto-Store --------------------------------------- */

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

/* --- Lokales Speichern & Laden ----------------------------------- */

async function speichernLokal(daten) {
    const stripped = await Promise.all(daten.map(async item => {
        if (!isPhotoEntryText(item.text)) return item;
        const parsed = parsePhotoEntryText(item.text);
        if (!parsed?.imageSrc?.startsWith("data:")) return item;
        try {
            await fotoInIdbSpeichern(item.itemId, parsed.imageSrc);
        } catch (err) {
            console.warn("Foto-IDB Schreibfehler – behalte Data-URL:", err);
            return item;
        }
        const ref = IMAGE_IDB_REF_PREFIX + item.itemId
            + (parsed.caption ? IMAGE_ENTRY_CAPTION_MARKER + parsed.caption : "");
        return { ...item, text: ref };
    }));
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

/* --- Node.js-Export für Tests ------------------------------------ */

if (typeof module !== "undefined") {
    module.exports = {
        IMAGE_ENTRY_PREFIX, IMAGE_ENTRY_CAPTION_MARKER,
        GROUP_DEFINITIONS, GROUP_ORDER, DEFAULT_GROUP_ORDER,
        parsePhotoEntryText, buildPhotoEntryText, isPhotoEntryText,
        generateItemId,
        normalizeForGroupMatch, getGroupIndex,
        normalizeListData, normalizeSnapshotData, listDataSignature,
        sortDataByCaptureTextFirst, sortDataByStoreGroups
    };
}
