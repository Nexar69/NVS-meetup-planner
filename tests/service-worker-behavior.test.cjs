const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const originalSource = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

function runtime(fetchImpl = async () => new Response("network", { status: 200 }), { fastTimeout = false } = {}) {
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
      async keys() { return ["old-cache", "meet-schwerin-v0.11.1-r12"]; },
      async delete(key) { deleted.push(key); return true; },
    },
    self: {
      location: { origin: "https://app.example" },
      addEventListener(type, handler) { handlers[type] = handler; },
      skipWaiting() { skipped += 1; },
      clients: {
        async claim() { claimed += 1; },
        async matchAll() { return clients; },
        async openWindow(url) { opened.push(url); return { url }; },
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
        async focus() { focused.push(client.url); return this; },
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
  }
  {
    const rt = runtime();
    await rt.dispatch("activate");
    assert.deepEqual(rt.deleted, ["old-cache"]);
    assert.equal(rt.claimed, 1);
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
  assert.match(originalSource, /NETWORK_TIMEOUT_MS = 5_000/, "network-first routes should have a bounded slow-network wait");
  assert.match(originalSource, /AbortController/, "slow network-first requests should be cancellable");
  console.log("service-worker-behavior: privacy, offline, slow-network fallback, update, notification and r12 app-shell behavior passed");
})().catch((error) => { console.error(error); process.exit(1); });
