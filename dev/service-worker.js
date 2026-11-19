const CACHE_VERSION = "v1.0.166-dev";

// Produktion (/einkaufsliste/) und Testversion (/einkaufsliste/dev/) teilen sich
// dieselbe Domain und damit denselben CacheStorage → Caches pro Scope trennen.
const IS_DEV_SCOPE = new URL(self.registration.scope).pathname.endsWith("/dev/");
const CACHE_PREFIX = IS_DEV_SCOPE ? "einkaufsliste-dev-" : "einkaufsliste-";
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

// Separater Cache ohne Versionsnummer – überlebt SW-Updates.
// Speichert den aktuellen Install-Kontext für die dynamische Manifest-Injektion.
const HANDOFF_CACHE = CACHE_PREFIX + "handoff";
const HANDOFF_KEY = "/__install_context__";

// Im Speicher (geht verloren wenn iOS den SW beendet, daher Cache als Backup)
let _manifestInstallContext = null;

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./config.js",
  "./style.css",
  "./utils.js",
  "./supabase-lib.js",
  "./supabase.js",
  "./sync.js",
  "./ui.js",
  "./app.js",
  "./manifest.json",
  "./icon-cart-192.png",
  "./icon-cart-512.png",
  "./icon-cart-maskable-512.png",
  "./apple-touch-icon-180.png"
];

/* INSTALL */
self.addEventListener("install", event => {
  self.skipWaiting();

  // cache: "reload" umgeht den HTTP-Cache – sonst landen evtl. alte Dateien
  // im Cache der neuen Version.
  const requests = FILES_TO_CACHE.map(url => new Request(url, { cache: "reload" }));
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(requests))
  );
});

// Alte Versions-Caches dieses Scopes (z. B. "einkaufsliste-v1.0.150")
function istAlterVersionsCache(key) {
  return key.startsWith(CACHE_PREFIX + "v") && key !== CACHE_NAME;
}

/* ACTIVATE */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(istAlterVersionsCache).map(key => caches.delete(key)))
    )
  );

  self.clients.claim();
});

self.addEventListener("message", event => {
  if (event.data?.type === "SET_INSTALL_CONTEXT") {
    _manifestInstallContext = {
      joinToken: String(event.data.joinToken || ""),
      inviteDeviceId: String(event.data.inviteDeviceId || ""),
      code: String(event.data.code || "")
    };
    // Persistent speichern – überlebt SW-Neustarts
    caches.open(HANDOFF_CACHE).then(cache =>
      cache.put(HANDOFF_KEY, new Response(JSON.stringify(_manifestInstallContext), {
        headers: { "Content-Type": "application/json" }
      }))
    ).catch(() => {});
  }
});

// Install-Kontext aus dem Cache lesen (Fallback wenn SW neu gestartet wurde)
async function handoffKontextLesen() {
  if (_manifestInstallContext) return _manifestInstallContext;
  try {
    const cache = await caches.open(HANDOFF_CACHE);
    const res = await cache.match(HANDOFF_KEY);
    if (res) {
      _manifestInstallContext = await res.json();
      return _manifestInstallContext;
    }
  } catch (_) {}
  return null;
}

// Manifest dynamisch mit aktuellem Install-Kontext ausliefern.
// Wenn iOS beim "Zum Homescreen hinzufügen" das Manifest liest, enthält
// start_url einen Join-Token, damit die installierte PWA Rolle und Code
// wieder aus Supabase laden kann.
async function manifestMitKontextAusliefern(request) {
  const context = await handoffKontextLesen();
  let response;
  try {
    response = await fetch(request.url);
  } catch (_) {
    const cached = await caches.match("./manifest.json");
    if (cached) response = cached;
  }
  if (!response) return new Response("Not found", { status: 404 });
  if (!context?.joinToken && !context?.inviteDeviceId && !context?.code) return response;
  try {
    const manifest = await response.json();
    if (context?.joinToken) {
      // Bevorzugt: serverseitiger Join-Token (enthält Rolle + Code)
      manifest.start_url = "./#join=" + encodeURIComponent(context.joinToken);
    } else if (context?.inviteDeviceId) {
      // Fallback für Gäste: legacy invite-Pfad via sync_invites-Tabelle
      manifest.start_url = "./#invite=" + encodeURIComponent(context.inviteDeviceId);
    } else if (context?.code) {
      // Fallback für Hauptgerät: Code direkt (Rolle wird beim Start aus Supabase geladen)
      manifest.start_url = "./#code=" + context.code;
    }
    return new Response(JSON.stringify(manifest), {
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": "no-store"
      }
    });
  } catch (_) {
    return response;
  }
}

/* FETCH */

function offlineAntwort() {
  return new Response("Offline", { status: 503, statusText: "Offline" });
}

// Seite: zuerst Netz (immer aktuell), offline aus dem Cache.
async function seiteAusliefern(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy)).catch(() => {});
    }
    return response;
  } catch (_) {
    return (await caches.match("./index.html", { cacheName: CACHE_NAME })) || offlineAntwort();
  }
}

// App-Dateien: zuerst Cache (versioniert über CACHE_VERSION), sonst Netz.
// ignoreSearch, weil index.html die Dateien mit ?v=… lädt.
async function dateiAusliefern(request) {
  const cached = await caches.match(request, { cacheName: CACHE_NAME, ignoreSearch: true });
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch (_) {
    return offlineAntwort();
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const requestUrl = new URL(request.url);

  // Supabase, andere Domains und POST/PUT/… gehen direkt ans Netz
  if (request.method !== "GET" || requestUrl.origin !== self.location.origin) return;

  // version.json und service-worker.js immer frisch vom Netz – nie aus Cache
  if (requestUrl.pathname.endsWith("/version.json") ||
      requestUrl.pathname.endsWith("/service-worker.js")) {
    event.respondWith(fetch(request).catch(() => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    return;
  }

  // Manifest dynamisch ausliefern – immer vor dem Cache-Lookup,
  // damit start_url den aktuellen Install-Kontext enthält (für PWA-Homescreen-Install).
  if (requestUrl.pathname.endsWith("/manifest.json")) {
    event.respondWith(manifestMitKontextAusliefern(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(seiteAusliefern(request));
    return;
  }

  event.respondWith(dateiAusliefern(request));
});
