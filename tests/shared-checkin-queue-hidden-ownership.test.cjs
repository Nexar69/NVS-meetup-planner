const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-checkin-queue-v0111.js"), "utf8");
const listeners = { window: {}, document: {} };
const timers = new Map();
let nextTimerId = 1;
let now = 300_000;
let expired = false;
let planChanged = false;
let checkInCalls = 0;

const banner = { id: "", hidden: true, className: "", innerHTML: "", setAttribute() {} };
const checkin = {
  querySelector() { return null; },
  appendChild(node) { Object.assign(banner, node); },
};
const document = {
  hidden: false,
  addEventListener(name, handler, capture) { listeners.document[name] ||= []; listeners.document[name].push({ handler, capture }); },
  getElementById(id) {
    if (id === "v010Checkin") return checkin;
    if (id === "v0111PendingCheckin") return banner.id ? banner : null;
    return null;
  },
  createElement() { return { id: "", hidden: false, className: "", innerHTML: "", setAttribute() {}, querySelector() { return null; }, appendChild() {} }; },
};
const navigator = { onLine: true };
const window = {
  NVSShare: { getFocusIndex: () => 0 },
  NVSSharedExpiry0111: { isAuthoritativelyExpired: () => expired },
  NVSSharedLive: {
    getState: () => ({ members: {} }),
    canCheckIn: () => !expired && !planChanged,
    hasPendingPlanUpdate: () => planChanged,
    async checkIn() { checkInCalls += 1; return { ok: true, status: "sent" }; },
  },
  addEventListener(name, handler) { listeners.window[name] ||= []; listeners.window[name].push(handler); },
};
function emitWindow(name, detail = undefined) {
  for (const handler of listeners.window[name] || []) handler({ type: name, detail, persisted: name === "pageshow" });
}
function emitVisibility() {
  for (const entry of listeners.document.visibilitychange || []) entry.handler({ type: "visibilitychange" });
}
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
function setTimeoutFake(callback) {
  const id = nextTimerId++;
  timers.set(id, callback);
  return id;
}
function clearTimeoutFake(id) {
  timers.delete(id);
}

vm.runInNewContext(source, {
  window, document, navigator,
  Date: FakeDate, Number, String, Boolean, Object, Array, Set, Math,
  setTimeout: setTimeoutFake,
  clearTimeout: clearTimeoutFake,
});

(async () => {
  const queue = window.NVSCheckinQueue0111;
  assert.ok(queue);

  queue.queueStatus("arrived", now);
  const visiblePending = queue.getPending(now);
  assert.equal(visiblePending?.status, "arrived");
  const beforeHidden = banner.innerHTML;
  const staleExpiryCallback = [...timers.values()][0];
  assert.equal(typeof staleExpiryCallback, "function", "visible pending intent should own an expiry callback");

  document.hidden = true;
  emitVisibility();
  navigator.onLine = false;
  planChanged = true;
  emitWindow("offline");
  emitWindow("online");
  emitWindow("nvs-shared-live-change");
  emitWindow("nvs-live-plan-synced");
  emitWindow("nvs-shared-checkin-outcome", { status: "rejected", reason: "plan_updated" });
  queue.render();

  assert.equal(banner.innerHTML, beforeHidden, "ordinary hidden events and direct rendering must not repaint the pending banner");
  assert.equal(queue.getPending(now)?.status, "arrived", "hidden reconciliation must preserve memory-only pending intent for later review");
  assert.equal(queue.queueStatus("missed", now + 1), null, "hidden documents must not accept new voluntary pending intent");
  assert.equal(queue.rememberOnlineAttempt("missed", now + 1), null, "hidden documents must not remember a fresh online attempt");
  assert.equal(await queue.sendPending(), false, "hidden documents must not send pending intent");
  assert.equal(checkInCalls, 0, "hidden lifecycle handling must not create a background Shared Live write");

  now += queue.maxPendingMs + 1_000;
  staleExpiryCallback();
  assert.equal(queue.getPending(now)?.status, "arrived", "a stale expiry callback must not mutate pending state while hidden");
  assert.equal(banner.innerHTML, beforeHidden, "a stale expiry callback must not repaint while hidden");

  document.hidden = false;
  planChanged = false;
  navigator.onLine = true;
  emitVisibility();
  assert.equal(queue.getPending(now), null, "visibility restore should reconcile a pending intent that expired while hidden");
  assert.match(banner.innerHTML, /pending status expired/i, "restore should explain that stale pending intent expired without sharing");

  now += 1_000;
  queue.queueStatus("at-stop", now);
  const beforeAuthoritativeHidden = banner.innerHTML;
  document.hidden = true;
  emitVisibility();
  expired = true;
  emitWindow("nvs-shared-session-expired");

  assert.equal(queue.getPending(now), null, "authoritative expiry must still discard unsafe pending intent while hidden");
  assert.equal(banner.innerHTML, beforeAuthoritativeHidden, "authoritative expiry may change safety state while hidden but must not repaint the document");

  document.hidden = false;
  emitVisibility();
  assert.match(banner.innerHTML, /session expired/i, "restore should reveal the authoritative expiry outcome");
  assert.equal(await queue.sendPending(), false);
  assert.equal(checkInCalls, 0);

  assert.match(source, /function ownsVisibleLifecycle\(\)/, "queue should use one explicit visible lifecycle ownership boundary");
  assert.doesNotMatch(source, /localStorage|sessionStorage/, "voluntary queue state must remain memory-only");
  assert.doesNotMatch(source, /watchPosition|getCurrentPosition|geolocation/i, "hidden lifecycle hardening must not add location tracking");
  assert.doesNotMatch(source, /fetch\s*\(/, "queue must keep reusing Shared Live instead of creating another request path");

  console.log("shared-checkin-queue-hidden-ownership: hidden callbacks fail closed and restore reconciles safely");
})().catch((error) => { console.error(error); process.exit(1); });
