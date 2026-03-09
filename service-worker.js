const CACHE_VERSION = "v1.0.137";
const CACHE_NAME = "einkaufsliste-" + CACHE_VERSION;

// Separater Cache ohne Versionsnummer – überlebt SW-Updates.
// Speichert den aktuellen Sync-Code für die dynamische Manifest-Injektion.
const HANDOFF_CACHE = "einkaufsliste-handoff";
const HANDOFF_KEY = "/__sync_code__";

// Im Speicher (geht verloren wenn iOS den SW beendet, daher Cache als Backup)
let _manifestSyncCode = null;

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

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(FILES_TO_CACHE))
  );
});

/* ACTIVATE */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== HANDOFF_CACHE)
          .map(key => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "SET_SYNC_CODE" && event.data.code) {
    _manifestSyncCode = event.data.code;
    // Persistent speichern – überlebt SW-Neustarts
    caches.open(HANDOFF_CACHE).then(cache =>
      cache.put(HANDOFF_KEY, new Response(event.data.code, {
        headers: { "Content-Type": "text/plain" }
      }))
    ).catch(() => {});
  }
});

// Code aus dem Cache lesen (Fallback wenn SW neu gestartet wurde)
async function handoffCodeLesen() {
  if (_manifestSyncCode) return _manifestSyncCode;
  try {
    const cache = await caches.open(HANDOFF_CACHE);
    const res = await cache.match(HANDOFF_KEY);
    if (res) {
      _manifestSyncCode = await res.text();
      return _manifestSyncCode;
    }
  } catch (_) {}
  return null;
}

// Manifest dynamisch mit aktuellem Sync-Code ausliefern.
// Wenn iOS beim "Zum Homescreen hinzufügen" das Manifest liest, enthält
// start_url den Code → PWA startet immer mit dem richtigen Code.
async function manifestMitCodeAusliefern(request) {
  const code = await handoffCodeLesen();
  let response;
  try {
    response = await fetch(request.url);
  } catch (_) {
    const cached = await caches.match("./manifest.json");
    if (cached) response = cached;
  }
  if (!response) return new Response("Not found", { status: 404 });
  if (!code) return response;
  try {
    const manifest = await response.json();
    manifest.start_url = "./#code=" + code;
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
self.addEventListener("fetch", event => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  const sameOrigin = requestUrl.origin === self.location.origin;
  const cacheKeyByPath = requestUrl.pathname === "/" ? "./index.html" : `.${requestUrl.pathname}`;

  // Manifest dynamisch ausliefern – immer vor dem Cache-Lookup,
  // damit start_url den aktuellen Code enthält (für PWA-Homescreen-Install).
  if (sameOrigin && requestUrl.pathname.endsWith("/manifest.json")) {
    event.respondWith(manifestMitCodeAusliefern(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request)
      .then(response => {
        if (response) return response;
        if (sameOrigin) {
          return caches.match(cacheKeyByPath).then(byPath => {
            if (byPath) return byPath;
            return fetch(request).catch(() => caches.match("./index.html"));
          });
        }
        return fetch(request).catch(() =>
          caches.match("./index.html")
        );
      })
  );
});
