const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-checkin-queue-v0111.js"), "utf8");
const listeners = { window: {}, document: {} };
let now = 200_000;
let planChanged = false;
let expired = false;
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

vm.runInNewContext(source, {
  window, document, navigator,
  Date: FakeDate, Number, String, Boolean, Object, Array, Set, Math,
  setTimeout: () => 1,
  clearTimeout: () => {},
});

(async () => {
  const queue = window.NVSCheckinQueue0111;
  assert.ok(queue);

  queue.queueStatus("arrived", now);
  const beforeFreeze = banner.innerHTML;
  emitWindow("pagehide");

  planChanged = true;
  navigator.onLine = false;
  emitWindow("nvs-shared-live-change");
  emitWindow("offline");
  emitWindow("nvs-live-plan-synced");
  emitWindow("nvs-shared-checkin-outcome", { status: "rejected", reason: "plan_updated" });
  document.hidden = false;
  emitVisibility();
  queue.render();

  assert.equal(banner.innerHTML, beforeFreeze, "late ancillary events must not repaint the queue while bfcache-frozen");
  assert.equal(queue.getPending(now)?.status, "arrived", "frozen ancillary events must not erase memory-only pending intent");
  assert.equal(queue.queueStatus("missed", now + 1), null, "new voluntary intent must not be accepted while frozen");
  assert.equal(await queue.sendPending(), false, "pending intent must not send while frozen");
  assert.equal(checkInCalls, 0, "freeze handling must not create a hidden/background network send");

  navigator.onLine = true;
  emitWindow("pageshow");
  assert.match(banner.innerHTML, /organizer changed the plan/i, "pageshow should reconcile plan ownership after reopening the lifecycle");
  assert.equal(queue.getPending(now)?.status, "arrived", "plan reconciliation should preserve intent for explicit user review");

  planChanged = false;
  queue.discardPending();
  now += 1_000;
  queue.queueStatus("at-stop", now);
  const beforeExpiryFreeze = banner.innerHTML;
  emitWindow("pagehide");
  expired = true;
  emitWindow("nvs-shared-session-expired");

  assert.equal(queue.getPending(now), null, "authoritative expiry must still discard pending intent while frozen");
  assert.equal(banner.innerHTML, beforeExpiryFreeze, "expiry may mutate safety state while frozen but must not repaint the frozen document");

  emitWindow("pageshow");
  assert.match(banner.innerHTML, /session expired/i, "pageshow should reveal the authoritative expiry state after restore");
  assert.equal(await queue.sendPending(), false);
  assert.equal(checkInCalls, 0);

  assert.match(source, /lifecycleFrozen/, "queue should explicitly own the pagehide/pageshow freeze boundary");
  assert.doesNotMatch(source, /localStorage|sessionStorage/, "voluntary queue state must stay memory-only");
  assert.doesNotMatch(source, /watchPosition|getCurrentPosition|geolocation/i, "bfcache hardening must not add location tracking");
  assert.doesNotMatch(source, /fetch\s*\(/, "queue must continue reusing Shared Live rather than creating another request path");

  console.log("shared-checkin-queue-bfcache-events: frozen ancillary events fail closed and restore safely");
})().catch((error) => { console.error(error); process.exit(1); });
