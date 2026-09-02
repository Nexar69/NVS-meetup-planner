const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-checkin-queue-v0111.js"), "utf8");

const listeners = { document: {}, window: {} };
let focus = 0;
let currentState = { members: {} };
let canCheckIn = true;
let pendingPlanUpdate = false;
let now = 100_000;
let deferred = null;
let checkInCalls = 0;
let timerId = 0;
const timers = new Map();

const fakeBanner = { hidden: true, className: "", innerHTML: "", setAttribute() {} };
const fakeCheckin = {
  querySelector() { return null; },
  appendChild(node) { if (node.id === "v0111PendingCheckin") Object.assign(fakeBanner, node); },
};
const document = {
  hidden: false,
  addEventListener(name, handler, capture) { listeners.document[name] ||= []; listeners.document[name].push({ handler, capture }); },
  getElementById(id) {
    if (id === "v010Checkin") return fakeCheckin;
    if (id === "v0111PendingCheckin") return fakeBanner.id ? fakeBanner : null;
    return null;
  },
  createElement() {
    return { id: "", className: "", hidden: false, innerHTML: "", setAttribute() {}, querySelector() { return null; }, appendChild() {} };
  },
};
const navigator = { onLine: true };
const window = {
  NVSShare: { getFocusIndex: () => focus },
  NVSSharedLive: {
    getState: () => currentState,
    canCheckIn: () => canCheckIn,
    hasPendingPlanUpdate: () => pendingPlanUpdate,
    checkIn(status) {
      checkInCalls += 1;
      return new Promise((resolve) => {
        deferred = () => {
          currentState = status === "clear"
            ? { members: {} }
            : { members: { [String(focus)]: { status, at: now + checkInCalls } } };
          resolve();
        };
      });
    },
  },
  addEventListener(name, handler) { listeners.window[name] ||= []; listeners.window[name].push(handler); },
};

function emitWindow(name) {
  for (const handler of listeners.window[name] || []) handler({ type: name, persisted: name === "pageshow" });
}
function emitVisibility() {
  for (const entry of listeners.document.visibilitychange || []) entry.handler({ type: "visibilitychange" });
}
function setTimeoutMock(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }
function clearTimeoutMock(id) { timers.delete(id); }
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}

vm.runInNewContext(source, {
  window, document, navigator,
  Date: FakeDate, Number, String, Boolean, Object, Array, Set, Math,
  setTimeout: setTimeoutMock,
  clearTimeout: clearTimeoutMock,
});

(async () => {
  const queue = window.NVSCheckinQueue0111;
  assert.ok(queue, "queue API should load");

  queue.queueStatus("arrived", now);
  let send = queue.sendPending();
  assert.equal(checkInCalls, 1);
  assert.match(fakeBanner.innerHTML, /Sending…/);
  emitWindow("pagehide");
  deferred();
  assert.equal(await send, false, "a completion after pagehide must lose ownership");
  assert.equal(queue.getPending(now)?.status, "arrived", "pagehide must not erase the user's memory-only intent");
  assert.doesNotMatch(fakeBanner.innerHTML, /sent successfully/i, "a stale lifecycle completion must not claim success");

  now += 1_000;
  emitWindow("pageshow");
  send = queue.sendPending();
  deferred();
  assert.equal(await send, true, "the same pending intent may be explicitly retried after restore");
  assert.equal(queue.getPending(now), null);

  now += 1_000;
  currentState = { members: {} };
  queue.queueStatus("missed", now);
  send = queue.sendPending();
  pendingPlanUpdate = true;
  emitWindow("nvs-shared-live-change");
  deferred();
  assert.equal(await send, false, "a plan revision discovered mid-send must invalidate queue ownership");
  assert.equal(queue.getPending(now)?.status, "missed", "stale-plan invalidation should preserve intent for user review, not auto-resend it");
  assert.match(fakeBanner.innerHTML, /organizer changed the plan/i);
  assert.doesNotMatch(fakeBanner.innerHTML, /sent successfully/i);

  pendingPlanUpdate = false;
  emitWindow("nvs-live-plan-synced");
  queue.discardPending();
  now += 1_000;
  currentState = { members: {} };
  queue.queueStatus("left", now);
  send = queue.sendPending();
  queue.discardPending("Discarded while sending. Nothing should be restored.");
  deferred();
  assert.equal(await send, false, "manual discard must invalidate an in-flight queue completion");
  assert.equal(queue.getPending(now), null);
  assert.match(fakeBanner.innerHTML, /Discarded while sending/);
  assert.doesNotMatch(fakeBanner.innerHTML, /sent successfully/i);

  now += 1_000;
  currentState = { members: { "0": { status: "left", at: now - 500 } } };
  queue.rememberOnlineAttempt("on-vehicle", now);
  document.hidden = true;
  emitVisibility();
  now += queue.confirmWaitMs + 100;
  document.hidden = false;
  emitVisibility();
  assert.equal(queue.promoteUnconfirmedAttempt(now), false, "a pre-freeze online attempt must not become a resend prompt after restore");
  assert.equal(queue.getPending(now), null);

  now += 1_000;
  currentState = { members: {} };
  queue.queueStatus("at-stop", now);
  send = queue.sendPending();
  emitWindow("nvs-shared-session-expired");
  deferred();
  assert.equal(await send, false, "session expiry must invalidate an in-flight queued send");
  assert.equal(queue.getPending(now), null);
  assert.match(fakeBanner.innerHTML, /session expired/i);
  assert.doesNotMatch(fakeBanner.innerHTML, /sent successfully/i);

  focus = 0;
  canCheckIn = true;
  assert.match(source, /pendingSendGeneration/, "queue should use explicit async generations");
  assert.match(source, /pendingSendStillOwned/, "queue should verify the exact pending item still owns an async completion");
  assert.match(source, /pagehide/, "queue lifecycle ownership must include pagehide/bfcache suspension");
  assert.doesNotMatch(source, /fetch\s*\(/, "queue ownership must continue reusing the existing Shared Live sender");
  assert.doesNotMatch(source, /localStorage|sessionStorage/, "pending voluntary intent must remain memory-only");
  assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "ownership hardening must not add location tracking");

  console.log("shared-checkin-queue-ownership: pagehide, plan revision, discard, expiry and restore ownership boundaries passed");
})().catch((error) => { console.error(error); process.exit(1); });