const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-checkin-queue-v0111.js"), "utf8");

const listeners = { document: {}, window: {} };
let now = 200_000;
let authoritativeExpired = false;
let checkInCalls = 0;
let resolveCheckIn = null;
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
  NVSShare: { getFocusIndex: () => 0 },
  NVSSharedExpiry0111: { isAuthoritativelyExpired: () => authoritativeExpired },
  NVSSharedLive: {
    getState: () => ({ members: {} }),
    canCheckIn: () => true,
    hasPendingPlanUpdate: () => false,
    checkIn() {
      checkInCalls += 1;
      return new Promise((resolve) => { resolveCheckIn = resolve; });
    },
  },
  addEventListener(name, handler) { listeners.window[name] ||= []; listeners.window[name].push(handler); },
};

function emitWindow(name) {
  for (const handler of listeners.window[name] || []) handler({ type: name, persisted: name === "pageshow" });
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
  const send = queue.sendPending();
  assert.equal(checkInCalls, 1, "a writable queued status should use the existing Shared Live sender once");

  authoritativeExpired = true;
  emitWindow("nvs-shared-session-expired");
  resolveCheckIn({ ok: true, status: "sent" });
  assert.equal(await send, false, "a pre-expiry send completion must lose ownership after authoritative expiry");
  assert.equal(queue.getPending(now), null, "authoritative expiry should discard queued voluntary intent");
  assert.match(fakeBanner.innerHTML, /session expired/i);
  assert.doesNotMatch(fakeBanner.innerHTML, /sent successfully/i);

  navigator.onLine = false;
  now += 1_000;
  assert.equal(queue.queueStatus("missed", now), null, "offline status taps must not create new queued intent after authoritative expiry");
  assert.equal(queue.getPending(now), null);

  navigator.onLine = true;
  assert.equal(queue.rememberOnlineAttempt("left", now), null, "online uncertainty tracking must also fail closed after authoritative expiry");
  assert.equal(await queue.sendPending(), false, "authoritative expiry must win even if an older Shared Live module still reports writable");
  assert.equal(checkInCalls, 1, "no second Shared Live write may be attempted after authoritative expiry");

  authoritativeExpired = false;
  assert.ok(queue.queueStatus("at-stop", now + 1), "queue should remain usable before a future authoritative expiry in a fresh document state");
  authoritativeExpired = true;
  emitWindow("pageshow");
  assert.equal(queue.getPending(now + 1), null, "lifecycle recovery must reconcile queued intent against the sticky expiry predicate even if the expiry event was missed");

  assert.match(source, /NVSSharedExpiry0111\?\.isAuthoritativelyExpired\?\.\(\)/,
    "the queue should consult the newer authoritative expiry layer directly for mixed-cache defense in depth");
  assert.doesNotMatch(source, /fetch\s*\(/,
    "expiry hardening must not create a second network path for voluntary check-ins");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
    "queued voluntary intent and expiry reconciliation must remain memory-only");
  assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
    "expiry hardening must not add hidden or continuous location tracking");

  console.log("shared-checkin-queue-authoritative-expiry: sticky expiry discards queued intent and blocks stale mixed-cache writes");
})().catch((error) => { console.error(error); process.exit(1); });