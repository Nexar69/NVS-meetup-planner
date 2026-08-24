const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

function runtime(fetchImpl = async () => new Response("network", { status: 200 })) {
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
    URL,
    Request,
    Response,
    Promise,
    Error,
    console,
    fetch: (...args) => fetchImpl(...args),
    caches: {
      async open() { return cache; },
      async match(key) {
        const normalized = typeof key === "string" ? key : key.url;
        return cacheEntries.get(normalized) || null;
      },
      async keys() { return ["old-cache", "meet-schwerin-v0.11.1-r5"]; },
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
    handlers,
    dispatch,
    puts,
    deleted,
    addedShells,
    cacheEntries,
    focused,
    opened,
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
    assert.ok(rt.addedShells[0].includes("./accessibility-v0111.js"), "accessibility runtime should be available offline");
    assert.ok(rt.addedShells[0].includes("./accessibility-v0111.css"), "accessibility styles should be available offline");
  }

  {
    const rt = runtime();
    await rt.dispatch("activate");
    assert.deepEqual(rt.deleted, ["old-cache"], "activate should delete stale cache versions only");
    assert.equal(rt.claimed, 1, "activate should claim clients");
  }

  {
    const rt = runtime();
    await rt.dispatch("message", { data: { type: "SKIP_WAITING" } });
    assert.equal(rt.skipped, 1, "explicit update activation should call skipWaiting");
  }

  {
    const rt = runtime();
    const response = await rt.dispatch("fetch", {
      request: new Request("https://app.example/api/live/abc123", { method: "GET" }),
    });
    assert.equal(response, null, "same-origin API requests must not be intercepted by the service worker");
    assert.equal(rt.puts.length, 0, "API responses must never enter runtime cache");
  }

  {
    const rt = runtime(async () => new Response("fresh-page", { status: 200 }));
    const request = new Request("https://app.example/p/example", { method: "GET" });
    Object.defineProperty(request, "mode", { value: "navigate" });
    const responsePromise = await rt.dispatch("fetch", { request });
    const response = await responsePromise;
    assert.equal(await response.text(), "fresh-page");
    assert.ok(rt.puts.includes("./index.html"), "navigation should refresh the cached app shell document");
  }

  {
    const rt = runtime(async () => { throw new Error("offline"); });
    rt.cacheEntries.set("https://app.example/app.js", new Response("cached-js", { status: 200 }));
    const responsePromise = await rt.dispatch("fetch", {
      request: new Request("https://app.example/app.js", { method: "GET" }),
    });
    const response = await responsePromise;
    assert.equal(await response.text(), "cached-js", "offline script request should fall back to runtime cache");
  }

  {
    const rt = runtime();
    rt.setClients([{ url: "https://app.example/p/abc" }, { url: "https://other.example/" }]);
    let closed = 0;
    await rt.dispatch("notificationclick", { notification: { close() { closed += 1; } } });
    assert.equal(closed, 1);
    assert.deepEqual(rt.focused, ["https://app.example/p/abc"], "notification click should focus an existing app window");
    assert.equal(rt.opened.length, 0);
  }

  {
    const rt = runtime();
    rt.setClients([{ url: "https://other.example/" }]);
    await rt.dispatch("notificationclick", { notification: { close() {} } });
    assert.deepEqual(rt.opened, ["./"], "notification click should reopen the PWA when no app window exists");
  }

  console.log("service-worker-behavior: privacy, offline, update, notification and accessibility-shell behavior passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
