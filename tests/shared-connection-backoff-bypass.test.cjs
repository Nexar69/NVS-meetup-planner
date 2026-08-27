const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-connection-v0111.js"), "utf8");
const listeners = new Map();
const elements = new Map();
let bypassCalls = 0;
let refreshCalls = 0;
let successVersionAtRefresh = 0;

function makeElement(id = "") {
  const element = {
    id,
    dataset: {},
    textContent: "",
    title: "",
    hidden: false,
    disabled: false,
    parentElement: null,
    setAttribute(name, value) { this[name] = value; },
    addEventListener() {},
    insertAdjacentElement(_position, child) { elements.set(child.id, child); },
  };
  if (id) elements.set(id, element);
  return element;
}
const sync = makeElement("v010Sync");
sync.parentElement = { appendChild(child) { elements.set(child.id, child); } };

const window = {
  addEventListener(name, handler) { listeners.set(name, handler); },
  NVSSharedLiveTimeout0111: {
    allowNextGet() { bypassCalls += 1; },
  },
  NVSSharedLive: {
    async refresh() {
      refreshCalls += 1;
      assert.equal(bypassCalls, refreshCalls, "manual recovery must open the one-shot GET bypass before refresh begins");
      const api = window.NVSSharedConnection0111;
      successVersionAtRefresh = api.getSuccessVersion();
      api.markSuccess(Date.now());
    },
  },
};
const document = {
  hidden: false,
  addEventListener(name, handler) { listeners.set(`document:${name}`, handler); },
  getElementById(id) { return elements.get(id) || null; },
  createElement() { return makeElement(); },
};
const navigator = { onLine: true };
const timers = new Map();
let nextTimer = 1;
function setTimeoutFake(handler, delay) { const id = nextTimer++; timers.set(id, { handler, delay }); return id; }
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

(async () => {
  const api = window.NVSSharedConnection0111;
  api.markFailure(Date.now());
  assert.equal(bypassCalls, 0, "ordinary delayed-state rendering must not consume a polling-backoff bypass");

  const recovered = await api.retryNow();
  assert.equal(recovered, true, "a fresh acknowledgement during manual retry should report recovery");
  assert.equal(bypassCalls, 1, "one Check now action should grant exactly one GET bypass");
  assert.equal(refreshCalls, 1, "one Check now action should call the existing refresh path exactly once");
  assert.equal(api.getSuccessVersion(), successVersionAtRefresh + 1);

  api.render();
  listeners.get("pageshow")?.();
  assert.equal(bypassCalls, 1, "render/lifecycle events must not silently bypass automatic polling backoff");

  assert.match(source, /NVSSharedLiveTimeout0111\?\.allowNextGet\?\.\(\)/,
    "manual retry must explicitly cooperate with the narrow Shared Live timeout/backoff guard");
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|sendBeacon/,
    "connection recovery must continue reusing Shared Live rather than adding another network path");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|geolocation|getCurrentPosition|watchPosition/i,
    "manual backoff bypass must remain storage-free and location-free");

  console.log("shared-connection-backoff-bypass: explicit Check now bypasses only one automatic GET backoff and preserves existing privacy/network boundaries");
})().catch((error) => { console.error(error); process.exit(1); });