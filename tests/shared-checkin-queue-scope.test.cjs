const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-checkin-queue-v0111.js"), "utf8");

const listeners = { window: {}, document: {} };
let focus = 0;
let timerId = 0;
const timers = new Map();
const banner = { hidden: true, className: "", innerHTML: "", setAttribute() {} };
const checkin = { querySelector() { return null; }, appendChild(node) { if (node.id === "v0111PendingCheckin") Object.assign(banner, node); } };
const document = {
  hidden: false,
  addEventListener(name, handler, capture) { (listeners.document[name] ||= []).push({ handler, capture }); },
  getElementById(id) {
    if (id === "v010Checkin") return checkin;
    if (id === "v0111PendingCheckin") return banner.id ? banner : null;
    return null;
  },
  createElement() { return { id: "", className: "", hidden: false, innerHTML: "", setAttribute() {}, querySelector() { return null; }, appendChild() {} }; },
};
const navigator = { onLine: false };
const window = {
  NVSShare: { getFocusIndex: () => focus },
  NVSSharedLive: {
    getState: () => ({ members: {} }),
    canCheckIn: () => true,
    hasPendingPlanUpdate: () => false,
    async checkIn() {},
  },
  addEventListener(name, handler) { (listeners.window[name] ||= []).push(handler); },
};
function setTimeoutMock(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }
function clearTimeoutMock(id) { timers.delete(id); }

vm.runInNewContext(source, {
  window, document, navigator,
  Date, Number, String, Boolean, Object, Array, Set, Math,
  setTimeout: setTimeoutMock,
  clearTimeout: clearTimeoutMock,
});

const queue = window.NVSCheckinQueue0111;
assert.ok(queue);

const base = Date.now();
const queued = queue.queueStatus("at-stop", base);
assert.equal(queued.memberIndex, 0, "pending intent should remember which personal member it belongs to");
assert.equal(queue.getPending(base + 1_000)?.status, "at-stop");

focus = 1;
assert.equal(queue.getPending(base + 2_000), null, "switching personal member must discard another member's pending intent");
assert.match(banner.innerHTML, /Personal route changed|pending status was discarded/i);

focus = 0;
queue.queueStatus("on-vehicle", base + 3_000);
assert.equal(queue.getPending(base + 4_000)?.memberIndex, 0);
const expiryHandlers = listeners.window["nvs-shared-session-expired"] || [];
assert.equal(expiryHandlers.length, 1, "queue should react to authoritative shared-session expiry");
expiryHandlers[0]();
assert.equal(queue.getPending(base + 5_000), null, "session expiry must immediately clear pending voluntary intent");
assert.match(banner.innerHTML, /session expired|Nothing was shared/i);

focus = -1;
assert.equal(queue.queueStatus("left", base + 6_000), null, "non-personal views must never queue a writable personal status");

assert.match(source, /memberIndex/, "queued state should remain member-scoped in memory");
assert.match(source, /nvs-shared-session-expired/, "session expiry must have an explicit queue lifecycle hook");
assert.doesNotMatch(source, /localStorage|sessionStorage/, "member scope must remain memory-only");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "scope hardening must not introduce location tracking");

console.log("shared-checkin-queue-scope: member-bound pending intent and authoritative session-expiry cleanup passed");
