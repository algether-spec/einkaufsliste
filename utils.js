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
