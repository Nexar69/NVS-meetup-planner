const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-connection-v0111.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../shared-connection-v0111.css"), "utf8");
const release = fs.readFileSync(path.resolve(__dirname, "../release-v011.js"), "utf8");
const sw = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

const listeners = new Map();
const elements = new Map();
let hidden = false;
let online = true;
let nextTimer = 1;
const timers = new Map();
let refreshCalls = 0;

function makeElement(id = "") {
  const handlers = new Map();
  const element = {
    id,
    dataset: {},
    textContent: "",
    title: "",
    hidden: false,
    disabled: false,
    className: "",
    parentElement: null,
    setAttribute(name, value) { this[name] = value; },
    addEventListener(name, handler) { handlers.set(name, handler); },
    click() { return handlers.get("click")?.(); },
    insertAdjacentElement(_position, child) { child.parentElement = this.parentElement; elements.set(child.id, child); },
  };
  if (id) elements.set(id, element);
  return element;
}
const sync = makeElement("v010Sync");
sync.parentElement = { appendChild(child) { elements.set(child.id, child); return child; } };

const window = {
  addEventListener(name, handler) { listeners.set(name, handler); },
  NVSSharedLive: { refresh: async () => { refreshCalls += 1; } },
};
const document = {
  get hidden() { return hidden; },
  addEventListener(name, handler) { listeners.set(`document:${name}`, handler); },
  getElementById(id) { return elements.get(id) || null; },
  createElement() { return makeElement(); },
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
assert.equal(typeof api?.retryNow, "function");
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
const retry = elements.get("v0111SharedConnectionRetry");
assert.ok(retry, "connection freshness should add one recovery button beside the sync chip");
assert.equal(retry.hidden, true, "manual refresh should stay quiet while sync is healthy");

api.markSuccess(Date.now() - 31_000);
api.render();
assert.equal(sync.dataset.connection, "delayed");
assert.equal(retry.hidden, false, "delayed Shared Live should expose an explicit manual recovery action");
assert.equal(retry.textContent, "Check now");

(async () => {
  const noAck = await api.retryNow();
  assert.equal(refreshCalls, 1, "manual retry should reuse the existing Shared Live refresh path exactly once");
  assert.equal(noAck, false, "a refresh attempt without a new successful-response event must not claim recovery");
  assert.equal(sync.dataset.connection, "delayed");

  window.NVSSharedLive.refresh = async () => {
    refreshCalls += 1;
    api.markSuccess(Date.now());
  };
  const acknowledged = await api.retryNow();
  assert.equal(acknowledged, true, "manual retry should report recovery only after a fresh backend acknowledgement");
  assert.equal(sync.dataset.connection, "current");
  assert.equal(retry.hidden, true, "successful acknowledgement should remove the delayed recovery action");

  online = false;
  listeners.get("offline")();
  assert.equal(sync.dataset.connection, "offline");
  assert.match(sync.textContent, /last live response/);
  assert.equal(retry.hidden, true, "offline state must not offer a misleading online retry control");
  assert.equal(timers.size, 0, "offline state should not keep a stale timer alive");
  const offlineRetry = await api.retryNow();
  assert.equal(offlineRetry, false);
  assert.equal(refreshCalls, 2, "offline retry must not invoke Shared Live refresh");

  online = true;
  listeners.get("online")();
  assert.equal(sync.dataset.connection, "current");
  assert.equal(timers.size, 1);

  hidden = true;
  listeners.get("document:visibilitychange")();
  assert.equal(timers.size, 0, "hidden pages should suspend the one-shot connection timer");
  const hiddenRetry = await api.retryNow();
  assert.equal(hiddenRetry, false);
  assert.equal(refreshCalls, 2, "hidden page must not start a manual refresh");
  hidden = false;
  listeners.get("document:visibilitychange")();
  assert.equal(timers.size, 1, "visible pages should re-arm the stale boundary");

  assert.match(css, /data-connection="delayed"/);
  assert.match(css, /v0111-shared-connection-retry/);
  assert.match(css, /min-height:44px/, "manual recovery control should preserve the mobile touch-target contract");
  assert.match(css, /focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /forced-colors/);
  assert.match(release, /shared-connection-v0111\.js/, "release loader must wire connection freshness runtime");
  assert.match(release, /shared-connection-v0111\.css/, "release loader must wire connection freshness styles");
  assert.match(sw, /shared-connection-v0111\.js/, "connection freshness runtime should be available offline");
  assert.match(sw, /shared-connection-v0111\.css/, "connection freshness styles should be available offline");
  assert.match(source, /NVSSharedLive\?\.refresh/, "manual recovery should reuse the existing shared-live refresh path");
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|sendBeacon/, "connection freshness must not add another direct network path");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/, "connection freshness should remain memory-only");
  assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "connection freshness must not introduce location tracking");

  console.log("shared-connection: current/delayed/offline/connecting states, explicit acknowledged retry, visibility lifecycle, offline shell and privacy boundaries passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});