const CACHE_NAME = "meet-schwerin-v0.11.1-r12";
const NETWORK_TIMEOUT_MS = 5_000;

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
  "./live-v090.css",
  "./shared-live-v010.css",
  "./intelligence-v011.css",
  "./trip-tools-v0111.css",
  "./recovery-v0111.css",
  "./accessibility-v0111.css",
  "./provider-health-v0111.css",
  "./shared-expiry-v0111.css",
  "./trip-guidance-v0111.css",
  "./transfer-watch-v0111.css",
  "./stop-awareness-v0111.css",
  "./diagnostics-v0111.css",
  "./meetup-radar-v0111.css",
  "./what-if-v0111.css",
  "./offline-journey-v0111.css",
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
  "./instructions-v083.js",
  "./live-v090.js",
  "./share-v010.js",
  "./shared-live-v010.js",
  "./intelligence-core.js",
  "./intelligence-v011.js",
  "./shared-freshness-v011.js",
  "./shared-live-freshness-v0111.js",
  "./shared-reload-v0111.js",
  "./trip-tools-v0111.js",
  "./recovery-v0111.js",
  "./accessibility-v0111.js",
  "./routing-coalesce-v0111.js",
  "./provider-health-v0111.js",
  "./shared-expiry-v0111.js",
  "./trip-guidance-v0111.js",
  "./transfer-watch-v0111.js",
  "./stop-awareness-v0111.js",
  "./diagnostics-v0111.js",
  "./meetup-radar-v0111.js",
  "./what-if-v0111.js",
  "./offline-journey-v0111.js",
  "./intelligence-voluntary-sync-v0111.js",
  "./update-safety-v0111.js",
  "./release-v074.js",
  "./release-v080.js",
  "./release-v090.js",
  "./release-v010.js",
  "./release-v011.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

async function precacheAppShell() {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    return true;
  } catch {
    // A quota/private-mode/transient asset failure should not brick the service worker.
    // Activation keeps older healthy caches until this revision has a usable shell.
    return false;
  }
}
self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell());
});
self.addEventListener("message", (event) => { if (event.data?.type === "SKIP_WAITING") self.skipWaiting(); });
async function currentShellReady() {
  try {
    const cache = await caches.open(CACHE_NAME);
    return Boolean(await cache.match("./index.html"));
  } catch {
    return false;
  }
}
async function cleanupOldCaches() {
  let keys = [];
  try {
    keys = await caches.keys();
  } catch {
    return;
  }
  await Promise.all(keys.filter((key) => key !== CACHE_NAME).map(async (key) => {
    try { await caches.delete(key); } catch {}
  }));
}
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    if (await currentShellReady()) await cleanupOldCaches();
    await self.clients.claim();
  })());
});
async function reopenFromNotification() {
  let windows = [];
  try {
    windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  } catch {}
  const ownOrigin = self.location.origin;
  const existing = windows.find((client) => {
    try { return new URL(client.url).origin === ownOrigin; } catch { return false; }
  });
  if (existing) {
    try {
      await existing.focus();
      return;
    } catch {}
  }
  try { await self.clients.openWindow("./"); } catch {}
}
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(reopenFromNotification());
});
async function safeCacheMatch(key) {
  try {
    return await caches.match(key);
  } catch {
    return null;
  }
}
async function updateCache(request, response, navigation = false) {
  if (!response?.ok) return response;
  try {
    const cache = await caches.open(CACHE_NAME);
    const key = navigation ? "./index.html" : request;
    await cache.put(key, response.clone());
  } catch {
    // CacheStorage can fail because of quota/private-mode/browser issues. A healthy
    // network response should still be usable instead of turning into an app load failure.
  }
  return response;
}
async function timedFetch(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    return await fetch(request, { cache: "no-cache", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
function shouldPreferCachedResponse(response) {
  if (!response) return true;
  return response.status === 408 || response.status === 429 || response.status >= 500;
}
async function networkFirst(request, navigation = false) {
  const cacheKey = navigation ? "./index.html" : request;
  try {
    const response = await timedFetch(request);
    if (shouldPreferCachedResponse(response)) {
      const cached = await safeCacheMatch(cacheKey);
      if (cached) return cached;
    }
    return await updateCache(request, response, navigation);
  } catch {
    const cached = await safeCacheMatch(cacheKey);
    if (cached) return cached;
    throw new Error("NETWORK_AND_CACHE_MISS");
  }
}
async function cacheFirstWithRefresh(request) {
  const cached = await safeCacheMatch(request);
  const fresh = timedFetch(request).then((response) => updateCache(request, response, false));
  if (cached) {
    fresh.catch(() => {});
    return cached;
  }
  return fresh;
}
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") { event.respondWith(networkFirst(event.request, true)); return; }
  if (/\.(?:js|css|html|webmanifest)$/i.test(requestUrl.pathname)) { event.respondWith(networkFirst(event.request, false)); return; }
  event.respondWith(cacheFirstWithRefresh(event.request));
});
