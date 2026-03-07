/**
 * Simulates browser script loading to detect runtime errors in module files.
 */
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";

const noop = () => {};
const eventHandlers = {};
const mockEl = () => ({
    hidden: false, textContent: "", value: "", disabled: false,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, removeEventListener: noop, style: {},
    dataset: {}, blur: noop, focus: noop, select: noop,
    querySelectorAll: () => [],
    appendChild: noop, insertBefore: noop, innerHTML: "",
    scrollHeight: 0, selectionStart: 0, selectionEnd: 0,
    setSelectionRange: noop, remove: noop, setAttribute: noop, onclick: null,
    type: "", src: "", alt: "", onchange: null, onload: null, onerror: null,
    readAsDataURL: noop, result: null,
    getContext: () => ({ drawImage: noop, toDataURL: () => "data:image/jpeg;base64,test" }),
    width: 0, height: 0, files: null, tagName: "div"
});

const addEvt = (type, fn) => { eventHandlers[type] = eventHandlers[type] || []; eventHandlers[type].push(fn); };

const elements = {};
const getEl = (id) => { if (!elements[id]) elements[id] = mockEl(); return elements[id]; };

const ctx = {
    navigator: {
        onLine: true,
        serviceWorker: {
            register: () => Promise.resolve(),
            ready: Promise.resolve({ active: { postMessage: noop } }),
            controller: null,
            addEventListener: noop,
            removeEventListener: noop,
            getRegistrations: () => Promise.resolve([]),
        },
        share: undefined,
        clipboard: undefined,
    },
    location: {
        search: "",
        hash: "",
        href: "https://example.com/",
        hostname: "example.com",
        pathname: "/",
        origin: "https://example.com",
    },
    localStorage: {
        _d: {},
        getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
        setItem(k, v) { this._d[k] = String(v); },
        removeItem(k) { delete this._d[k]; },
    },
    indexedDB: {},
    history: { replaceState: noop },
    caches: {
        keys: () => Promise.resolve([]),
        open: () => Promise.resolve({ addAll: () => Promise.resolve(), put: () => Promise.resolve(), match: () => Promise.resolve(null) }),
        match: () => Promise.resolve(null),
        delete: () => Promise.resolve(true),
    },
    URL, URLSearchParams, Promise, setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: () => Promise.reject(new Error("no fetch")),
    crypto: { randomUUID: () => "test-" + Math.random().toString(36).slice(2) },
    Intl, performance: { now: Date.now },
    prompt: () => null,
    alert: noop,
    addEventListener: addEvt,
    removeEventListener: noop,
    isSecureContext: true,
    SpeechRecognition: undefined,
    webkitSpeechRecognition: undefined,
};

ctx.window = ctx;
ctx.self = ctx;
ctx.globalThis = ctx;

ctx.document = {
    getElementById: getEl,
    querySelectorAll: () => [{ remove: noop, classList: { contains: () => false } }],
    createElement: (tag) => { const el = mockEl(); el.tagName = tag; return el; },
    createDocumentFragment: () => { const f = mockEl(); f.appendChild = noop; return f; },
    addEventListener: addEvt,
    removeEventListener: noop,
    hidden: false,
    body: { classList: { toggle: noop, add: noop, remove: noop } },
    activeElement: null,
};

// Mock supabase library (what supabase-lib.js would expose)
ctx.supabase = {
    createClient: (_url, _key) => ({
        auth: {
            getSession: () => Promise.resolve({ data: { session: null }, error: null }),
            signInAnonymously: () => Promise.reject(new Error("no network")),
        },
        from: () => ({
            select() { return this; },
            eq() { return this; },
            gt() { return this; },
            order() { return this; },
            range() { return this; },
            then(fn) { return Promise.resolve({ data: [], error: null }).then(fn); },
        }),
        rpc: () => Promise.reject(new Error("no network")),
        removeChannel: noop,
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    }),
};

const files = ["config.js", "utils.js", "supabase.js", "sync.js", "ui.js", "app.js"];
let allOk = true;

for (const f of files) {
    const code = readFileSync(f, "utf8");
    try {
        new Script(code, { filename: f }).runInNewContext(ctx, { filename: f });
        console.log("OK  " + f);
    } catch (e) {
        console.error("ERR " + f + ": " + e.constructor.name + ": " + e.message);
        const lines = (e.stack || "").split("\n").slice(1, 4).join("\n  ");
        console.error("  " + lines);
        allOk = false;
    }
}

console.log("");
console.log("--- Event-Handler Check ---");
const btnErfassen = getEl("btnErfassen");
const btnEinkaufen = getEl("btnEinkaufen");
const multiAdd = getEl("add-all-button");
const btnSyncConnect = getEl("btn-sync-connect");
console.log("btnErfassen.onclick:    ", typeof btnErfassen.onclick);
console.log("btnEinkaufen.onclick:   ", typeof btnEinkaufen.onclick);
console.log("multiAdd.onclick:       ", typeof multiAdd.onclick);
console.log("btnSyncConnect.onclick: ", typeof btnSyncConnect.onclick);
console.log("supabaseClient:         ", ctx.supabaseClient ? "gesetzt" : "null");
console.log("");

if (allOk) {
    console.log("PASS: Alle Module geladen ohne Fehler.");
} else {
    console.log("FAIL: Mindestens ein Modul hat einen Fehler.");
    process.exit(1);
}
