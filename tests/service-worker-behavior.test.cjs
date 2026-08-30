const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const originalSource = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

function runtime(fetchImpl = async () => new Response("network", { status: 200 }), { fastTimeout = false, currentShellReady = true, clientListFails = false, focusFails = false, openWindowFails = false } = {}) {
  const source = fastTimeout ? originalSource.replace("const NETWORK_TIMEOUT_MS = 5_000;", "const NETWORK_TIMEOUT_MS = 5;") : originalSource;
  const handlers = {};
  const puts = [];
  const deleted = [];
  const addedShells = [];
  const cacheEntries = new Map();
  const focused = [];
  const opened = [];
  let claimed = 0;
  let skipped = 0;
  let clients = [];

  const cache = {
    async addAll(entries) { addedShells.push([...entries]); },
    async match(key) {
      const normalized = typeof key === "string" ? key : key.url;
      if (normalized === "./index.html" && currentShellReady) return new Response("current-shell", { status: 200 });
      return cacheEntries.get(normalized) || null;
    },
    async put(key, response) {
      const normalized = typeof key === "string" ? key : key.url;
      puts.push(normalized);
      cacheEntries.set(normalized, response.clone());
    },
  };

  const context = {
    URL, Request, Response, Promise, Error, console, AbortController, setTimeout, clearTimeout,
    fetch: (...args) => fetchImpl(...args),
    caches: {
      async open() { return cache; },
      async match(key) {
        const normalized = typeof key === "string" ? key : key.url;
        return cacheEntries.get(normalized) || null;
      },
      async keys() { return ["old-cache", "meet-schwerin-v0.11.1-r13", "meet-schwerin-v0.11.1-r14", "meet-schwerin-v0.11.1-r15", "meet-schwerin-v0.11.1-r16", "meet-schwerin-v0.11.1-r17", "meet-schwerin-v0.11.1-r18", "meet-schwerin-v0.11.1-r19", "meet-schwerin-v0.11.1-r20"]; },
      async delete(key) { deleted.push(key); return true; },
    },
    self: {
      location: { origin: "https://app.example" },
      addEventListener(type, handler) { handlers[type] = handler; },
      skipWaiting() { skipped += 1; },
      clients: {
        async claim() { claimed += 1; },
        async matchAll() {
          if (clientListFails) throw new Error("CLIENT_LIST_FAILED");
          return clients;
        },
        async openWindow(url) {
          if (openWindowFails) throw new Error("OPEN_WINDOW_FAILED");
          opened.push(url);
          return { url };
        },
      },
    },
  };

  vm.runInNewContext(source, context, { filename: "service-worker.js" });

  async function dispatch(type, event = {}) {
    const waits = [];
    let responsePromise = null;
    const wrapped = {
      ...event,
      waitUntil(value) { waits.push(Promise.resolve(value)); },
      respondWith(value) { responsePromise = Promise.resolve(value); },
    };
    handlers[type](wrapped);
    await Promise.all(waits);
    return responsePromise ? responsePromise : null;
  }

  return {
    handlers, dispatch, puts, deleted, addedShells, cacheEntries, focused, opened,
    get claimed() { return claimed; },
    get skipped() { return skipped; },
    setClients(next) {
      clients = next.map((client) => ({
        ...client,
        async focus() {
          if (focusFails) throw new Error("FOCUS_FAILED");
          focused.push(client.url);
          return this;
        },
      }));
    },
  };
}

(async () => {
  {
    const rt = runtime();
    await rt.dispatch("install");
    assert.equal(rt.addedShells.length, 1, "install should precache one app shell");
    assert.ok(rt.addedShells[0].includes("./index.html"));
    assert.ok(rt.addedShells[0].includes("./recovery-v0111.js"));
    assert.ok(rt.addedShells[0].includes("./accessibility-v0111.js"));
    assert.ok(rt.addedShells[0].includes("./accessibility-v0111.css"));
    assert.ok(rt.addedShells[0].includes("./routing-coalesce-v0111.js"));
    assert.ok(rt.addedShells[0].includes("./provider-health-v0111.js"));
    assert.ok(rt.addedShells[0].includes("./provider-health-v0111.css"));
    assert.ok(rt.addedShells[0].includes("./shared-expiry-v0111.js"));
    assert.ok(rt.addedShells[0].includes("./shared-expiry-v0111.css"));
    assert.ok(rt.addedShells[0].includes("./trip-guidance-v0111.js"));
    assert.ok(rt.addedShells[0].includes("./trip-guidance-v0111.css"));
    assert.ok(rt.addedShells[0].includes("./intelligence-voluntary-sync-v0111.js"));
    assert.ok(rt.addedShells[0].includes("./test-lab-v0111.js"), "hardened Test Lab runtime should be available offline");
    assert.ok(rt.addedShells[0].includes("./test-lab-v0111.css"), "hardened Test Lab styles should be available offline");
    assert.ok(rt.addedShells[0].includes("./test-lab-journey-v0111.js"), "Test Lab journey simulation should be available offline");
    assert.ok(rt.addedShells[0].includes("./test-lab-scenarios-v0111.js"), "Test Lab scenario presets should be available offline");
  }
  {
    const rt = runtime();
    await rt.dispatch("activate");
    assert.deepEqual(rt.deleted, ["old-cache", "meet-schwerin-v0.11.1-r13", "meet-schwerin-v0.11.1-r14", "meet-schwerin-v0.11.1-r15", "meet-schwerin-v0.11.1-r16", "meet-schwerin-v0.11.1-r17", "meet-schwerin-v0.11.1-r18", "meet-schwerin-v0.11.1-r19"], "healthy r20 shell should clean older caches while preserving itself");
    assert.equal(rt.claimed, 1);
  }
  {
    const rt = runtime(undefined, { currentShellReady: false });
    await rt.dispatch("activate");
    assert.deepEqual(rt.deleted, [], "activation must preserve older caches when the current shell is not usable");
    assert.equal(rt.claimed, 1, "a cache-precache problem must not prevent the worker from claiming clients");
  }
  {
    const rt = runtime();
    await rt.dispatch("message", { data: { type: "SKIP_WAITING" } });
    assert.equal(rt.skipped, 1);
  }
  {
    const rt = runtime();
    const response = await rt.dispatch("fetch", { request: new Request("https://app.example/api/live/abc123", { method: "GET" }) });
    assert.equal(response, null);
    assert.equal(rt.puts.length, 0);
  }
  {
    const rt = runtime(async () => new Response("fresh-page", { status: 200 }));
    const request = new Request("https://app.example/p/example", { method: "GET" });
    Object.defineProperty(request, "mode", { value: "navigate" });
    const response = await (await rt.dispatch("fetch", { request }));
    assert.equal(await response.text(), "fresh-page");
    assert.ok(rt.puts.includes("./index.html"));
  }
  {
    const rt = runtime(async () => { throw new Error("offline"); });
    rt.cacheEntries.set("https://app.example/app.js", new Response("cached-js", { status: 200 }));
    const response = await (await rt.dispatch("fetch", { request: new Request("https://app.example/app.js", { method: "GET" }) }));
    assert.equal(await response.text(), "cached-js");
  }
  {
    let aborted = false;
    const rt = runtime((request, options = {}) => new Promise((resolve, reject) => {
      options.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); });
    }), { fastTimeout: true });
    rt.cacheEntries.set("./index.html", new Response("cached-page", { status: 200 }));
    const request = new Request("https://app.example/p/slow", { method: "GET" });
    Object.defineProperty(request, "mode", { value: "navigate" });
    const response = await (await rt.dispatch("fetch", { request }));
    assert.equal(await response.text(), "cached-page", "stalled navigation should fall back to cached app shell after the timeout");
    assert.equal(aborted, true, "stalled network-first fetch should be aborted instead of lingering indefinitely");
  }
  {
    const rt = runtime(async () => new Response("server-down", { status: 503 }));
    rt.cacheEntries.set("./index.html", new Response("cached-page", { status: 200 }));
    const request = new Request("https://app.example/p/server-error", { method: "GET" });
    Object.defineProperty(request, "mode", { value: "navigate" });
    const response = await (await rt.dispatch("fetch", { request }));
    assert.equal(await response.text(), "cached-page", "transient 5xx navigation responses should prefer the cached app shell");
    assert.equal(rt.puts.length, 0, "transient server errors must not replace healthy cached app-shell responses");
  }
  {
    const rt = runtime(async () => new Response("rate-limited", { status: 429 }));
    rt.cacheEntries.set("https://app.example/app.js", new Response("cached-js", { status: 200 }));
    const response = await (await rt.dispatch("fetch", { request: new Request("https://app.example/app.js", { method: "GET" }) }));
    assert.equal(await response.text(), "cached-js", "rate-limited app-shell requests should use the existing cached asset when available");
  }
  {
    const rt = runtime(async () => new Response("not-found", { status: 404 }));
    rt.cacheEntries.set("https://app.example/missing.js", new Response("stale-missing", { status: 200 }));
    const response = await (await rt.dispatch("fetch", { request: new Request("https://app.example/missing.js", { method: "GET" }) }));
    assert.equal(response.status, 404, "definitive 4xx responses should not be masked by stale cache entries");
    assert.equal(await response.text(), "not-found");
  }
  {
    const rt = runtime(async () => new Response("server-down", { status: 503 }));
    const request = new Request("https://app.example/p/no-cache", { method: "GET" });
    Object.defineProperty(request, "mode", { value: "navigate" });
    const response = await (await rt.dispatch("fetch", { request }));
    assert.equal(response.status, 503, "a transient server response should still be returned when no safe cached fallback exists");
  }
  {
    const rt = runtime();
    rt.setClients([{ url: "https://app.example/p/abc" }, { url: "https://other.example/" }]);
    let closed = 0;
    await rt.dispatch("notificationclick", { notification: { close() { closed += 1; } } });
    assert.equal(closed, 1);
    assert.deepEqual(rt.focused, ["https://app.example/p/abc"]);
    assert.equal(rt.opened.length, 0);
  }
  {
    const rt = runtime();
    rt.setClients([{ url: "https://other.example/" }]);
    await rt.dispatch("notificationclick", { notification: { close() {} } });
    assert.deepEqual(rt.opened, ["./"]);
  }
  {
    const rt = runtime(undefined, { clientListFails: true });
    await rt.dispatch("notificationclick", { notification: { close() {} } });
    assert.deepEqual(rt.opened, ["./"], "notification tap should reopen the app even if client enumeration fails");
  }
  {
    const rt = runtime(undefined, { focusFails: true });
    rt.setClients([{ url: "https://app.example/p/abc" }]);
    await rt.dispatch("notificationclick", { notification: { close() {} } });
    assert.deepEqual(rt.opened, ["./"], "notification tap should reopen the app if focusing an existing window fails");
  }
  {
    const rt = runtime(undefined, { clientListFails: true, openWindowFails: true });
    let closed = 0;
    await rt.dispatch("notificationclick", { notification: { close() { closed += 1; } } });
    assert.equal(closed, 1, "notification lifecycle should resolve safely even when browser window APIs fail");
  }
  assert.match(originalSource, /^const CACHE_NAME = "meet-schwerin-v0\.11\.1-r20";/, "service-worker behavior suite should exercise the current cache revision");
  assert.match(originalSource, /NETWORK_TIMEOUT_MS = 5_000/, "network-first routes should have a bounded slow-network wait");
  assert.match(originalSource, /AbortController/, "slow network-first requests should be cancellable");
  assert.match(originalSource, /response\.status === 408 \|\| response\.status === 429 \|\| response\.status >= 500/, "transient HTTP failures should prefer a healthy cached app-shell response");
  assert.match(originalSource, /currentShellReady/, "activation should verify the new shell before deleting older offline caches");
  assert.match(originalSource, /async function reopenFromNotification/, "notification taps should isolate browser client/window failures");
  console.log("service-worker-behavior: privacy, offline, guarded install/activation, slow-network/transient-server fallback, resilient notification taps and r20 app-shell behavior passed");
})().catch((error) => { console.error(error); process.exit(1); });