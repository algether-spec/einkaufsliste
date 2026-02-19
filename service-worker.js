const CACHE_VERSION = "v1.0.0";
const CACHE_NAME = "erinnerungen-" + CACHE_VERSION;

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
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
          .filter(key => key !== CACHE_NAME)
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
});

/* FETCH */
self.addEventListener("fetch", event => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  const sameOrigin = requestUrl.origin === self.location.origin;
  const cacheKeyByPath = requestUrl.pathname === "/" ? "./index.html" : `.${requestUrl.pathname}`;

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
