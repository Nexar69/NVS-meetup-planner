const CACHE_NAME = "meet-schwerin-v0.8.1-r4";

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./live.css",
  "./map.css",
  "./places.css",
  "./fair.css",
  "./journey.css",
  "./recommend.css",
  "./group.css",
  "./convergence.css",
  "./share-v072.css",
  "./personal-v074.css",
  "./ux-v051.css",
  "./config.js",
  "./transit.js",
  "./vmv-v080.js",
  "./places.js",
  "./share-v072.js",
  "./recommend.js",
  "./convergence.js",
  "./convergence-v074.js",
  "./group-engine.js",
  "./map.js",
  "./v05.js",
  "./ux-v051.js",
  "./app.js",
  "./results-v052.js",
  "./fair.js",
  "./journey.js",
  "./group.js",
  "./group-events.js",
  "./convergence-ui.js",
  "./personal-v074.js",
  "./release-v074.js",
  "./release-v080.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function updateCache(request, response, navigation = false) {
  if (!response?.ok) return response;
  const cache = await caches.open(CACHE_NAME);
  const key = navigation ? "./index.html" : request;
  await cache.put(key, response.clone());
  return response;
}

async function networkFirst(request, navigation = false) {
  try {
    const response = await fetch(request, { cache: "no-cache" });
    return await updateCache(request, response, navigation);
  } catch {
    const cached = await caches.match(navigation ? "./index.html" : request);
    if (cached) return cached;
    throw new Error("NETWORK_AND_CACHE_MISS");
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, true));
    return;
  }

  // Code/config files are network-first while online. This prevents an iOS PWA
  // from mixing a new HTML shell with stale JavaScript after a deployment.
  if (/\.(?:js|css|html|webmanifest)$/i.test(requestUrl.pathname)) {
    event.respondWith(networkFirst(event.request, false));
    return;
  }

  // Static images/icons stay cache-first, but refresh in the background.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fresh = fetch(event.request)
        .then((response) => updateCache(event.request, response, false))
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});