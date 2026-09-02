const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../stop-awareness-v0111.js"), "utf8");

let visibilityHandler = null;
let observerCallback = null;
let observerDisconnects = 0;
let observerObserves = 0;
let timerId = 0;
const timers = new Map();
const cleared = [];
let guidanceLookups = 0;

const assignment = {
  member: { name: "Passenger" },
  route: {
    segments: [{
      mode: "TRAM",
      departure: new Date(Date.now() - 60_000).toISOString(),
      arrival: new Date(Date.now() + 10 * 60_000).toISOString(),
      to: "Marienplatz",
      intermediateStops: [{
        name: "Schlossblick",
        arrival: new Date(Date.now() + 4 * 60_000).toISOString(),
      }],
    }],
  },
};

const document = {
  hidden: false,
  addEventListener(name, handler) {
    if (name === "visibilitychange") visibilityHandler = handler;
  },
  getElementById(id) {
    if (id === "personalSharedPlan") return { id };
    if (id === "v0111TripGuidance") {
      guidanceLookups += 1;
      return null;
    }
    return null;
  },
  createElement() {
    throw new Error("Stop Awareness should not create DOM in this harness");
  },
};

class MutationObserver {
  constructor(callback) { observerCallback = callback; }
  disconnect() { observerDisconnects += 1; }
  observe() { observerObserves += 1; }
}

const listeners = new Map();
const window = {
  MutationObserver,
  __NVS_LAST_RECOMMENDATIONS__: { primary: { assignments: [assignment] } },
  NVSShare: {
    getFocusIndex: () => 0,
    getSharedPlan: () => ({ id: "shared" }),
  },
  NVSSharedLive: { getState: () => ({ members: {} }) },
  addEventListener(name, handler) { listeners.set(name, handler); },
};

function setTimeoutMock(callback, delay) {
  const id = ++timerId;
  timers.set(id, { callback, delay });
  return id;
}

function clearTimeoutMock(id) {
  if (id == null) return;
  cleared.push(id);
  timers.delete(id);
}

vm.runInNewContext(source, {
  window,
  document,
  MutationObserver,
  Date,
  Number,
  String,
  Boolean,
  Array,
  Set,
  Object,
  Math,
  setTimeout: setTimeoutMock,
  clearTimeout: clearTimeoutMock,
});

assert.equal(typeof observerCallback, "function", "Stop Awareness should attach its scoped observer while visible");
assert.equal(typeof visibilityHandler, "function", "Stop Awareness should own visibility lifecycle changes");
assert.ok(observerObserves >= 1, "the visible personal plan should be observed");

observerCallback();
const queuedEntry = [...timers.entries()].find(([, entry]) => entry.delay === 0);
assert.ok(queuedEntry, "an observer mutation should queue one zero-delay render while visible");
const [queuedId, queuedWork] = queuedEntry;

const lookupsBeforeHide = guidanceLookups;
document.hidden = true;
visibilityHandler();
assert.ok(cleared.includes(queuedId), "hiding the document must cancel already queued observer render work");
assert.equal(timers.has(queuedId), false, "cancelled hidden-tab observer work must leave the active timer set");
assert.ok(observerDisconnects >= 1, "hiding the document should disconnect the scoped observer");

queuedWork.callback();
assert.equal(guidanceLookups, lookupsBeforeHide, "a late queued callback must remain DOM-inert while the document is hidden");
const zeroDelayWhileHidden = [...timers.values()].filter((entry) => entry.delay === 0).length;
observerCallback();
assert.equal([...timers.values()].filter((entry) => entry.delay === 0).length, zeroDelayWhileHidden,
  "observer callbacks must not queue fresh work while hidden");

document.hidden = false;
visibilityHandler();
assert.ok(observerObserves >= 2, "becoming visible should reconcile and reattach observation from current state");

assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
  "Stop Awareness lifecycle state must remain memory-only");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
  "hidden-tab hardening must not introduce location access");

console.log("stop-awareness-hidden-queue-ownership: hidden transitions cancel queued observer work and late callbacks stay DOM-inert");
