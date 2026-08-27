const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

function runtime() {
  const handlers = {};
  const focused = [];
  const opened = [];
  let clients = [];

  const context = {
    URL, Request, Response, Promise, Error, AbortController, setTimeout, clearTimeout,
    fetch: async () => new Response("ok", { status: 200 }),
    caches: {
      async open() { return { addAll: async () => {}, match: async () => null, put: async () => {} }; },
      async match() { return null; },
      async keys() { return []; },
      async delete() { return true; },
    },
    self: {
      location: { origin: "https://app.example" },
      registration: { scope: "https://app.example/meet-schwerin/" },
      addEventListener(type, handler) { handlers[type] = handler; },
      skipWaiting() {},
      clients: {
        async claim() {},
        async matchAll() { return clients; },
        async openWindow(url) { opened.push(url); return { url }; },
      },
    },
  };

  vm.runInNewContext(source, context, { filename: "service-worker.js" });

  async function dispatchNotificationClick() {
    const waits = [];
    handlers.notificationclick({
      notification: { close() {} },
      waitUntil(value) { waits.push(Promise.resolve(value)); },
    });
    await Promise.all(waits);
  }

  return {
    focused,
    opened,
    dispatchNotificationClick,
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
    rt.setClients([
      { url: "https://app.example/other-app/" },
      { url: "https://app.example/meet-schwerin/p/abc" },
    ]);
    await rt.dispatchNotificationClick();
    assert.deepEqual(rt.focused, ["https://app.example/meet-schwerin/p/abc"], "notification should focus a client inside the service-worker scope, not merely the same origin");
    assert.deepEqual(rt.opened, []);
  }

  {
    const rt = runtime();
    rt.setClients([
      { url: "https://app.example/meet-schwerin-legacy/" },
      { url: "https://app.example/other-app/" },
    ]);
    await rt.dispatchNotificationClick();
    assert.deepEqual(rt.focused, [], "lookalike paths outside the registration scope must not be focused");
    assert.deepEqual(rt.opened, ["./"], "notification should reopen Meet Schwerin when no scoped client exists");
  }

  assert.match(source, /self\.registration\?\.scope/, "notification targeting should be anchored to the service-worker registration scope");
  assert.match(source, /url\.pathname\.startsWith\(scopeUrl\.pathname\)/, "scope checks should require the actual registration path boundary");
  console.log("service-worker-notification-scope: scoped notification focus behavior passed");
})().catch((error) => { console.error(error); process.exit(1); });
