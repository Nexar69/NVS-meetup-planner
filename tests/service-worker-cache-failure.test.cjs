const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

function runtime({ fetchImpl, openFails = false, putFails = false, matchFails = false, keysFail = false, deleteFails = false } = {}) {
  const handlers = {};
  const cacheEntries = new Map();
  let claimed = 0;
  const cache = {
    async addAll() {},
    async put(key, response) {
      if (putFails) throw new Error("CACHE_PUT_FAILED");
      const normalized = typeof key === "string" ? key : key.url;
      cacheEntries.set(normalized, response.clone());
    },
  };
  const context = {
    URL, Request, Response, Promise, Error, console, AbortController, setTimeout, clearTimeout,
    fetch: (...args) => (fetchImpl || (async () => new Response("network", { status: 200 })))(...args),
    caches: {
      async open() {
        if (openFails) throw new Error("CACHE_OPEN_FAILED");
        return cache;
      },
      async match(key) {
        if (matchFails) throw new Error("CACHE_MATCH_FAILED");
        const normalized = typeof key === "string" ? key : key.url;
        return cacheEntries.get(normalized) || null;
      },
      async keys() {
        if (keysFail) throw new Error("CACHE_KEYS_FAILED");
        return ["stale-cache", "meet-schwerin-v0.11.1-r12"];
      },
      async delete() {
        if (deleteFails) throw new Error("CACHE_DELETE_FAILED");
        return true;
      },
    },
    self: {
      location: { origin: "https://app.example" },
      addEventListener(type, handler) { handlers[type] = handler; },
      skipWaiting() {},
      clients: { async claim() { claimed += 1; }, async matchAll() { return []; }, async openWindow() {} },
    },
  };
  vm.runInNewContext(source, context, { filename: "service-worker.js" });
  async function fetchEvent(url, mode = "same-origin") {
    const request = new Request(url);
    if (mode === "navigate") Object.defineProperty(request, "mode", { value: "navigate" });
    let responsePromise = null;
    handlers.fetch({ request, respondWith(value) { responsePromise = Promise.resolve(value); } });
    return responsePromise ? responsePromise : null;
  }
  async function activate() {
    const waits = [];
    handlers.activate({ waitUntil(value) { waits.push(Promise.resolve(value)); } });
    await Promise.all(waits);
  }
  return { fetchEvent, activate, cacheEntries, get claimed() { return claimed; } };
}

(async () => {
  {
    const rt = runtime({ openFails: true, fetchImpl: async () => new Response("fresh-page", { status: 200 }) });
    const response = await rt.fetchEvent("https://app.example/p/cache-open-failure", "navigate");
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "fresh-page", "CacheStorage open failure must not turn a healthy navigation into an app failure");
  }
  {
    const rt = runtime({ putFails: true, fetchImpl: async () => new Response("fresh-js", { status: 200 }) });
    const response = await rt.fetchEvent("https://app.example/app.js");
    assert.equal(await response.text(), "fresh-js", "cache quota/write failure must not discard a healthy app-shell response");
  }
  {
    const rt = runtime({ matchFails: true, fetchImpl: async () => new Response("fresh-page", { status: 200 }) });
    const response = await rt.fetchEvent("https://app.example/p/cache-read-failure", "navigate");
    assert.equal(await response.text(), "fresh-page", "cache read failure must still allow a healthy network navigation");
  }
  {
    const rt = runtime({ matchFails: true, fetchImpl: async () => new Response("fresh-image", { status: 200 }) });
    const response = await rt.fetchEvent("https://app.example/icons/icon.svg");
    assert.equal(await response.text(), "fresh-image", "cache-first static requests must recover from cache read failure by using the network");
  }
  {
    const rt = runtime({ deleteFails: true });
    await rt.activate();
    assert.equal(rt.claimed, 1, "failure deleting a stale cache must not prevent the new service worker from claiming clients");
  }
  {
    const rt = runtime({ keysFail: true });
    await rt.activate();
    assert.equal(rt.claimed, 1, "failure enumerating caches must not prevent service-worker activation");
  }

  assert.match(source, /async function cleanupOldCaches/, "activation should isolate stale-cache cleanup failures");
  assert.match(source, /async function safeCacheMatch/, "service worker should isolate CacheStorage read failures");
  assert.match(source, /CacheStorage can fail because of quota\/private-mode\/browser issues/, "cache write failures should be intentionally documented and tolerated");
  assert.match(source, /async function cacheFirstWithRefresh/, "non-app-shell static requests should share the safe cache-read path");
  assert.match(source, /pathname\.startsWith\("\/api\/"\)/, "API traffic must remain outside service-worker caching");

  console.log("service-worker-cache-failure: online loads and activation survive CacheStorage failures without weakening API privacy");
})().catch((error) => { console.error(error); process.exit(1); });
