const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-reload-v0111.js"), "utf8");
const release = fs.readFileSync(path.resolve(__dirname, "../release-v011.js"), "utf8");
const serviceWorker = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

let clickHandler = null;
let pageShowHandler = null;
let pageHideHandler = null;
let reloadCalls = 0;
let assignCalls = 0;
let sharedRefreshes = 0;
let intelligenceRefreshes = 0;
let resumedEvents = 0;
let timerCallback = null;

const button = {
  disabled: false,
  textContent: "Reload updated plan",
  dataset: {},
  attrs: {},
  setAttribute(name, value) { this.attrs[name] = value; },
  removeAttribute(name) { delete this.attrs[name]; },
};

const document = {
  addEventListener(name, handler, capture) {
    if (name === "click") {
      clickHandler = handler;
      assert.equal(capture, true, "reload interception should run in capture phase before stale per-node handlers");
    }
  },
  getElementById(id) { return id === "v010ReloadPlan" ? button : null; },
};

const window = {
  location: {
    href: "https://example.test/p/Abc234?me=0",
    reload() { reloadCalls += 1; },
    assign(value) {
      assignCalls += 1;
      assert.equal(value, this.href, "fallback navigation must preserve the exact shared-link URL");
    },
  },
  NVSSharedLive: { refresh() { sharedRefreshes += 1; } },
  NVSIntelligence: { refresh() { intelligenceRefreshes += 1; } },
  addEventListener(name, handler) {
    if (name === "pageshow") pageShowHandler = handler;
    if (name === "pagehide") pageHideHandler = handler;
  },
  dispatchEvent(event) {
    if (event.type === "nvs-shared-view-resumed") resumedEvents += 1;
  },
};

class CustomEvent {
  constructor(type) { this.type = type; }
}

vm.runInNewContext(source, {
  window,
  document,
  CustomEvent,
  Object,
  String,
  Boolean,
  setTimeout(callback) { timerCallback = callback; return 1; },
  clearTimeout() { timerCallback = null; },
});

assert.ok(window.NVSSharedReload0111, "Safari reload guard should expose a small testable API");
assert.equal(typeof clickHandler, "function");
assert.equal(typeof pageShowHandler, "function");
assert.equal(typeof pageHideHandler, "function");

let prevented = 0;
let stopped = 0;
const target = { closest(selector) { return selector === "#v010ReloadPlan" ? button : null; } };
clickHandler({
  target,
  preventDefault() { prevented += 1; },
  stopImmediatePropagation() { stopped += 1; },
});

assert.equal(prevented, 1, "delegated handler should own the reload click");
assert.equal(stopped, 1, "old per-node reload handlers should not race the robust handler");
assert.equal(reloadCalls, 1, "first tap should request an immediate reload");
assert.equal(button.disabled, true, "button should become inert while navigation is in progress");
assert.equal(button.attrs["aria-busy"], "true");
assert.match(button.textContent, /Loading updated plan/);
assert.equal(window.NVSSharedReload0111.isNavigating(), true);

clickHandler({ target, preventDefault() {}, stopImmediatePropagation() {} });
assert.equal(reloadCalls, 1, "rapid repeated taps must not trigger multiple reload races");

assert.equal(typeof timerCallback, "function", "a fallback navigation should be armed for Safari reload stalls");
timerCallback();
assert.equal(assignCalls, 1, "fallback should retry navigation when reload did not leave the page");

pageShowHandler({ persisted: true });
assert.equal(window.NVSSharedReload0111.isNavigating(), false, "bfcache restore must clear a stale navigating latch");
assert.equal(button.disabled, false);
assert.equal(button.textContent, "Reload updated plan");
assert.equal(button.attrs["aria-busy"], undefined);

assert.equal(typeof timerCallback, "function", "bfcache restore should queue subsystem refreshes");
timerCallback();
assert.equal(sharedRefreshes, 1, "shared live state should refresh after Safari bfcache restore when API is available");
assert.equal(intelligenceRefreshes, 1, "journey intelligence should refresh after Safari bfcache restore");
assert.equal(resumedEvents, 1, "other runtime layers should receive one resume signal");

assert.match(release, /shared-reload-v0111\.js/, "release loader must include the reload guard");
assert.match(serviceWorker, /meet-schwerin-v0\.11\.1-r12/, "Safari reload guard should ride the current validated PWA shell revision");
assert.match(serviceWorker, /shared-reload-v0111\.js/, "reload guard must be available to installed\/offline copies");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "reload hardening must not introduce location access");

console.log("shared-reload-safari: delegated reload is single-shot, fallback-safe and bfcache-aware");
