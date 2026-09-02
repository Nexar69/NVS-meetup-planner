const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-freshness-v011.js"), "utf8");

let visibilityHandler = null;
let createCalls = 0;
let appendCalls = 0;
let timerId = 0;
const timers = new Map();
const listeners = new Map();

const document = {
  hidden: true,
  head: {
    appendChild(node) {
      appendCalls += 1;
      node.isConnected = true;
    },
  },
  createElement(tag) {
    createCalls += 1;
    assert.equal(tag, "style", "Shared Freshness should only create its scoped style in this harness");
    return { textContent: "", isConnected: false };
  },
  getElementById() { return null; },
  addEventListener(name, handler) {
    if (name === "visibilitychange") visibilityHandler = handler;
  },
};

const window = {
  NVSIntelligenceCore: {
    checkinFreshness() { return { fresh: false, stale: true, ageMinutes: 20 }; },
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
  if (id != null) timers.delete(id);
}

vm.runInNewContext(source, {
  window,
  document,
  Date,
  Number,
  String,
  Boolean,
  Array,
  Object,
  Math,
  setTimeout: setTimeoutMock,
  clearTimeout: clearTimeoutMock,
});

assert.equal(typeof visibilityHandler, "function", "Shared Freshness should own ordinary visibility changes");
assert.equal(createCalls, 0, "a hidden cold start must not create style DOM");
assert.equal(appendCalls, 0, "a hidden cold start must not append style DOM");
assert.equal(timers.size, 0, "a hidden cold start must not arm freshness work");

listeners.get("nvs-shared-live-change")?.();
assert.equal(createCalls, 0, "hidden Shared Live events must remain DOM-inert");
assert.equal(timers.size, 0, "hidden Shared Live events must not arm freshness work");

document.hidden = false;
visibilityHandler();
assert.equal(createCalls, 1, "returning visible should lazily create the scoped freshness style");
assert.equal(appendCalls, 1, "returning visible should attach the scoped freshness style once");
assert.equal(timers.size, 1, "visible reconciliation should arm one freshness timer");

const [queuedId, queued] = [...timers.entries()][0];
document.hidden = true;
visibilityHandler();
assert.equal(timers.has(queuedId), false, "hiding should cancel queued freshness work");

queued.callback();
assert.equal(createCalls, 1, "a dequeued stale callback must not mutate hidden DOM");
assert.equal(appendCalls, 1, "a dequeued stale callback must not reattach hidden DOM");
assert.equal(timers.size, 0, "a dequeued stale callback must not rearm itself while hidden");

document.hidden = false;
visibilityHandler();
assert.equal(createCalls, 1, "visible restore should reuse the existing scoped style");
assert.equal(appendCalls, 1, "visible restore should not duplicate the scoped style");
assert.equal(timers.size, 1, "visible restore should resume a single freshness timer");

assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
  "Shared Freshness lifecycle ownership must remain memory-only");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
  "Shared Freshness hardening must not introduce location access");

console.log("shared-freshness-hidden-bootstrap: hidden cold start, stale callback suppression, visible reconciliation and privacy boundary passed");
