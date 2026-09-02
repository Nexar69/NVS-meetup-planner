const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../trip-tools-v0111.js"), "utf8");

(async () => {
  const windowHandlers = new Map();
  const documentHandlers = new Map();
  const timers = new Map();
  let nextTimerId = 1;
  let domReads = 0;
  let wakeRequests = 0;
  let observerConnects = 0;
  let observerDisconnects = 0;

  const document = {
    hidden: true,
    documentElement: {},
    getElementById() {
      domReads += 1;
      return null;
    },
    createElement() {
      throw new Error("hidden Trip Tools must not create DOM");
    },
    addEventListener(name, handler) { documentHandlers.set(name, handler); },
  };

  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() { observerConnects += 1; }
    disconnect() { observerDisconnects += 1; }
  }

  const window = {
    NVSSharedExpiry0111: { isAuthoritativelyExpired: () => false },
    NVSSharedLive: {
      canCheckIn: () => true,
      getState: () => ({ members: {}, updatedAt: Date.now() }),
      async checkIn() { throw new Error("hidden check-in must not run"); },
      refresh() {},
    },
    NVSShare: { getFocusIndex: () => 0 },
    addEventListener(name, handler) { windowHandlers.set(name, handler); },
  };

  const navigator = {
    onLine: true,
    wakeLock: {
      async request() {
        wakeRequests += 1;
        return { async release() {}, addEventListener() {} };
      },
    },
  };

  function setTimeout(callback, delay) {
    const id = nextTimerId++;
    timers.set(id, { callback, delay });
    return id;
  }
  function clearTimeout(id) { timers.delete(id); }

  vm.runInNewContext(source, {
    window,
    document,
    navigator,
    MutationObserver,
    Object,
    String,
    Boolean,
    Number,
    Math,
    Date,
    Error,
    setTimeout,
    clearTimeout,
  });

  assert.ok(window.NVSTripTools0111, "Trip Tools should expose its testable API");
  assert.equal(domReads, 0, "hidden boot must perform zero Trip Tools DOM reads");
  assert.equal(observerConnects, 0, "hidden boot must not attach the bootstrap observer");
  assert.equal(timers.size, 0, "hidden boot must not arm route-age timers");
  assert.equal(window.NVSTripTools0111.canCheckIn(), false, "hidden documents must not advertise check-in availability");

  window.NVSTripTools0111.refresh();
  await window.NVSTripTools0111.setWakeLock(true);
  windowHandlers.get("nvs-shared-live-change")?.();
  windowHandlers.get("online")?.();
  windowHandlers.get("offline")?.();
  assert.equal(domReads, 0, "direct refreshes and routine events must remain DOM-inert while hidden");
  assert.equal(wakeRequests, 0, "hidden direct calls must not request a screen wake lock");

  document.hidden = false;
  documentHandlers.get("visibilitychange")?.();
  assert.ok(domReads > 0, "returning visible should reconcile current Trip Tools state");
  assert.equal(observerConnects, 1, "visible reconciliation should reacquire bootstrap observation when the dialog is absent");

  windowHandlers.get("nvs-group-recommendations-rendered")?.();
  const periodic = [...timers.values()].find((entry) => entry.delay === 15_000);
  assert.ok(periodic, "visible active recommendations should own a route-age timer");

  const readsBeforeHide = domReads;
  document.hidden = true;
  documentHandlers.get("visibilitychange")?.();
  assert.ok(observerDisconnects >= 1, "ordinary hiding should release bootstrap observer ownership");
  assert.equal(timers.size, 0, "ordinary hiding should cancel owned route-age timers");

  periodic.callback();
  windowHandlers.get("nvs-shared-live-change")?.();
  windowHandlers.get("online")?.();
  windowHandlers.get("offline")?.();
  windowHandlers.get("nvs-shared-session-expired")?.();
  assert.equal(domReads, readsBeforeHide, "stale timer/event callbacks must perform zero hidden DOM work");
  assert.equal(timers.size, 0, "a stale hidden timer callback must not rearm itself");

  document.hidden = false;
  documentHandlers.get("visibilitychange")?.();
  assert.ok(domReads > readsBeforeHide, "visibility restoration should reconcile the latest current state");
  assert.ok(observerConnects >= 2, "visibility restoration should reacquire bootstrap observation");

  assert.doesNotMatch(source, /\bfetch\s*\(/,
    "Trip Tools must keep using Shared Live instead of opening a duplicate network path");
  assert.doesNotMatch(source, /watchPosition|getCurrentPosition|geolocation/i,
    "hidden-work hardening must not add background or continuous location tracking");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
    "Trip Tools lifecycle and voluntary state must remain memory-only");

  console.log("trip-tools-hidden-ownership: hidden boot, stale timer and routine events perform zero DOM/wake work");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
