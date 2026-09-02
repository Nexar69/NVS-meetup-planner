const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../trip-guidance-v0111.js"), "utf8");

const windowHandlers = new Map();
const documentHandlers = new Map();
let observerCallback = null;
let observerDisconnects = 0;
let observerObserves = 0;
let nextTimerId = 1;
const timers = new Map();
const clearedTimers = [];

const resultsRoot = {};
const document = {
  hidden: false,
  getElementById(id) {
    if (id === "results") return resultsRoot;
    return null;
  },
  createElement() { throw new Error("guidance should not render without a personal shared view"); },
  addEventListener(name, handler) { documentHandlers.set(name, handler); },
};

class MutationObserver {
  constructor(callback) { observerCallback = callback; }
  observe(node) {
    assert.equal(node, resultsRoot, "observer should remain scoped to the planner results root in this fixture");
    observerObserves += 1;
  }
  disconnect() { observerDisconnects += 1; }
}

const window = {
  MutationObserver,
  NVSShare: {
    getSharedPlan() { return null; },
    getFocusIndex() { return -1; },
  },
  addEventListener(name, handler) { windowHandlers.set(name, handler); },
};

function setTimeoutStub(callback) {
  const id = nextTimerId++;
  timers.set(id, callback);
  return id;
}
function clearTimeoutStub(id) {
  if (id == null) return;
  clearedTimers.push(id);
  timers.delete(id);
}

vm.runInNewContext(source, {
  window,
  document,
  MutationObserver,
  setTimeout: setTimeoutStub,
  clearTimeout: clearTimeoutStub,
  Date,
  Intl,
  Number,
  String,
  Boolean,
  Array,
  Math,
  Object,
});

assert.equal(typeof observerCallback, "function", "Trip Guidance should install its scoped mutation observer");
assert.ok(observerObserves >= 1, "Trip Guidance should observe a relevant guidance surface");
assert.equal(typeof windowHandlers.get("pagehide"), "function");
assert.equal(typeof windowHandlers.get("pageshow"), "function");
assert.equal(typeof windowHandlers.get("nvs-recommendations-cleared"), "function");
assert.equal(typeof documentHandlers.get("visibilitychange"), "function");

observerCallback();
assert.equal(timers.size, 1, "a mutation should queue exactly one delayed guidance refresh");
const frozenTimer = [...timers.keys()][0];
windowHandlers.get("pagehide")();
assert.equal(timers.has(frozenTimer), false, "pagehide must cancel an already queued mutation refresh");
assert.ok(clearedTimers.includes(frozenTimer), "the frozen mutation timer should be explicitly cleared");

windowHandlers.get("pageshow")();
observerCallback();
assert.equal(timers.size, 1, "a fresh post-restore mutation may queue again");
const clearedRecommendationTimer = [...timers.keys()][0];
windowHandlers.get("nvs-recommendations-cleared")();
assert.equal(timers.has(clearedRecommendationTimer), false,
  "authoritative recommendation clear must cancel queued mutation work so stale guidance cannot resurrect");

observerCallback();
assert.equal(timers.size, 1);
const hiddenTimer = [...timers.keys()][0];
const lateHiddenCallback = timers.get(hiddenTimer);
document.hidden = true;
documentHandlers.get("visibilitychange")();
assert.equal(timers.has(hiddenTimer), false, "hidden transition must cancel queued mutation work");
lateHiddenCallback();
assert.equal(timers.size, 0, "a mutation callback already dequeued before hiding must not requeue work while hidden");
observerCallback();
assert.equal(timers.size, 0, "observer delivery itself must be inert without foreground ownership");
assert.ok(observerDisconnects >= 3, "freeze/clear/hidden transitions should stop mutation observation");

assert.match(source, /let mutationRefreshTimer = null;/,
  "queued mutation work should have explicit timer ownership");
assert.match(source, /function ownsForeground\(\) \{ return !lifecycleFrozen && !document\.hidden; \}/,
  "queued mutation work should share the centralized foreground ownership boundary");
assert.match(source, /function cancelMutationRefresh\(\)/,
  "Trip Guidance should centralize cancellation of queued mutation work");
assert.match(source, /if \(!ownsForeground\(\) \|\| mutationRefreshQueued\) return;/,
  "MutationObserver delivery must refuse to queue work while hidden or frozen");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
  "mutation lifecycle hardening must not introduce location tracking");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
  "Trip Guidance lifecycle ownership should remain memory-only");

console.log("trip-guidance-mutation-queue-ownership: freeze, hidden and authoritative clear cancel stale queued guidance work, including already-dequeued callbacks");
