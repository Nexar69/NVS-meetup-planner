const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-connection-v0111.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../shared-connection-v0111.css"), "utf8");
const release = fs.readFileSync(path.resolve(__dirname, "../release-v011.js"), "utf8");
const sw = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

const listeners = new Map();
const sync = { dataset: {}, textContent: "", title: "" };
let hidden = false;
let online = true;
let nextTimer = 1;
const timers = new Map();

const window = {
  addEventListener(name, handler) { listeners.set(name, handler); },
};
const document = {
  get hidden() { return hidden; },
  addEventListener(name, handler) { listeners.set(`document:${name}`, handler); },
  getElementById(id) { return id === "v010Sync" ? sync : null; },
};
const navigator = {};
Object.defineProperty(navigator, "onLine", { get: () => online });
function setTimeoutFake(handler, delay) {
  const id = nextTimer++;
  timers.set(id, { handler, delay });
  return id;
}
function clearTimeoutFake(id) { timers.delete(id); }

vm.runInNewContext(source, {
  window,
  document,
  navigator,
  Date,
  Math,
  Number,
  String,
  Boolean,
  Object,
  setTimeout: setTimeoutFake,
  clearTimeout: clearTimeoutFake,
});

const api = window.NVSSharedConnection0111;
assert.equal(typeof api?.connectionModel, "function");
assert.deepEqual({ ...api.connectionModel(100_000, true, 0) }, { status: "connecting", text: "Connecting to shared live…" });
assert.deepEqual({ ...api.connectionModel(100_000, false, 0) }, { status: "offline", text: "Offline · no live response yet" });
assert.equal(api.connectionModel(100_000, true, 75_000).status, "current", "a response within 30 seconds should be current");
assert.equal(api.connectionModel(100_001, true, 70_000).status, "delayed", "a response older than 30 seconds should be delayed");

const lifecycleNow = Date.now();
api.markSuccess(lifecycleNow);
assert.equal(api.getLastSuccessAt(), lifecycleNow);
assert.equal(sync.dataset.connection, "current");
assert.equal(sync.textContent, "Live sync current");
assert.equal(timers.size, 1, "one stale-boundary timer should be armed after a successful response");
assert.ok([...timers.values()][0].delay >= 29_900 && [...timers.values()][0].delay <= 30_100);

online = false;
listeners.get("offline")();
assert.equal(sync.dataset.connection, "offline");
assert.match(sync.textContent, /last live response/);
assert.equal(timers.size, 0, "offline state should not keep a stale timer alive");

online = true;
listeners.get("online")();
assert.equal(sync.dataset.connection, "current");
assert.equal(timers.size, 1);

hidden = true;
listeners.get("document:visibilitychange")();
assert.equal(timers.size, 0, "hidden pages should suspend the one-shot connection timer");
hidden = false;
listeners.get("document:visibilitychange")();
assert.equal(timers.size, 1, "visible pages should re-arm the stale boundary");

assert.match(css, /data-connection="delayed"/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /forced-colors/);
assert.match(release, /shared-connection-v0111\.js/, "release loader must wire connection freshness runtime");
assert.match(release, /shared-connection-v0111\.css/, "release loader must wire connection freshness styles");
assert.match(sw, /shared-connection-v0111\.js/, "connection freshness runtime should be available offline");
assert.match(sw, /shared-connection-v0111\.css/, "connection freshness styles should be available offline");
assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|sendBeacon/, "connection freshness must not add another network path");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/, "connection freshness should remain memory-only");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "connection freshness must not introduce location tracking");

console.log("shared-connection: current/delayed/offline/connecting states, visibility lifecycle, offline shell and privacy boundaries passed");