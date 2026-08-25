const CACHE_NAME = "meet-schwerin-v0.11.1-r12";

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
  "./stop-awareness-v0111.css",
  "./diagnostics-v0111.css",
  "./meetup-radar-v0111.css",
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
  "./stop-awareness-v0111.js",
  "./diagnostics-v0111.js",
  "./meetup-radar-v0111.js",
  "./intelligence-voluntary-sync-v0111.js",
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

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});
self.addEventListener("message", (event) => { if (event.data?.type === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const ownOrigin = self.location.origin;
    const existing = windows.find((client) => { try { return new URL(client.url).origin === ownOrigin; } catch { return false; } });
    if (existing) { await existing.focus(); return; }
    await self.clients.openWindow("./");
  })());
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
  if (requestUrl.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") { event.respondWith(networkFirst(event.request, true)); return; }
  if (/\.(?:js|css|html|webmanifest)$/i.test(requestUrl.pathname)) { event.respondWith(networkFirst(event.request, false)); return; }
  event.respondWith(caches.match(event.request).then((cached) => {
    const fresh = fetch(event.request).then((response) => updateCache(event.request, response, false)).catch(() => cached);
    return cached || fresh;
  }));
});
