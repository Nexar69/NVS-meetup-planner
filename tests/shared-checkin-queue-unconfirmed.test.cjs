const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-checkin-queue-v0111.js"), "utf8");

const listeners = { document: {}, window: {} };
let focus = 0;
let currentState = { members: { "0": { status: "left", at: 1_000 } } };
let canCheckIn = true;
let pendingPlanUpdate = false;
const checkInCalls = [];
let now = 10_000;
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
    async checkIn(status) { checkInCalls.push(status); },
  },
  addEventListener(name, handler) { listeners.window[name] ||= []; listeners.window[name].push(handler); },
};

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
  assert.equal(queue.confirmWaitMs, 8_000);

  const attempt = queue.rememberOnlineAttempt("on-vehicle", now);
  assert.equal(attempt.status, "on-vehicle");
  assert.equal(attempt.baselineAt, 1_000);
  assert.equal(queue.getPending(now), null, "online attempt must not become pending immediately");

  now += 8_100;
  assert.equal(queue.promoteUnconfirmedAttempt(now), true, "unconfirmed online attempt should become pending after the bounded wait");
  let pending = queue.getPending(now);
  assert.equal(pending.status, "on-vehicle");
  assert.equal(pending.source, "unconfirmed");
  assert.match(fakeBanner.innerHTML, /could not confirm whether/);
  assert.match(fakeBanner.innerHTML, /will never retry automatically/);
  assert.equal(checkInCalls.length, 0, "queue promotion must not create another network send");

  currentState = { members: { "0": { status: "on-vehicle", at: 20_000 } } };
  queue.rememberOnlineAttempt("on-vehicle", 19_000);
  assert.equal(queue.settleConfirmedAttempt(), true, "a later fresh live state should settle a slow original request");
  assert.equal(queue.getPending(now), null, "late confirmation should clear matching uncertain pending state");
  assert.match(fakeBanner.innerHTML, /confirmed this status after the slow response/);
  assert.equal(checkInCalls.length, 0, "late confirmation must not resend the status");

  currentState = { members: { "0": { status: "at-stop", at: 30_000 } } };
  now = 40_000;
  queue.rememberOnlineAttempt("missed", now);
  now += 8_100;
  queue.promoteUnconfirmedAttempt(now);
  pending = queue.getPending(now);
  assert.equal(pending.status, "missed");
  currentState = { members: { "0": { status: "missed", at: 41_000 } } };
  assert.equal(await queue.sendPending(), true, "Send now should notice when the original attempt already succeeded");
  assert.equal(checkInCalls.length, 0, "already-confirmed uncertain status must not be duplicated");
  assert.match(fakeBanner.innerHTML, /already confirmed/);

  currentState = { members: { "0": { status: "left", at: 50_000 } } };
  now = 60_000;
  queue.rememberOnlineAttempt("arrived", now);
  pendingPlanUpdate = true;
  now += 8_100;
  assert.equal(queue.promoteUnconfirmedAttempt(now), false, "a changed plan must prevent uncertain status from being queued");
  assert.equal(queue.getPending(now), null);
  pendingPlanUpdate = false;

  queue.rememberOnlineAttempt("arrived", now);
  canCheckIn = false;
  now += 8_100;
  assert.equal(queue.promoteUnconfirmedAttempt(now), false, "read-only/revoked state must prevent uncertain status from being queued");
  assert.equal(queue.getPending(now), null);
  canCheckIn = true;

  focus = 0;
  queue.rememberOnlineAttempt("at-stop", now);
  focus = 1;
  now += 8_100;
  assert.equal(queue.promoteUnconfirmedAttempt(now), false, "online attempt must stay scoped to the personal member that made it");
  assert.equal(queue.getPending(now), null);

  assert.doesNotMatch(source, /fetch\s*\(/, "weak-network fallback must reuse the existing sender and never add a direct fetch path");
  assert.doesNotMatch(source, /localStorage|sessionStorage/, "uncertain attempts must remain memory-only");
  assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "uncertain check-in handling must not add location tracking");
  console.log("shared-checkin-queue-unconfirmed: slow confirmation, no duplicate resend, bounded pending fallback, member/plan/read-only guards passed");
})().catch((error) => { console.error(error); process.exit(1); });
