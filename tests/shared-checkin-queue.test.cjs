const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-checkin-queue-v0111.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../shared-checkin-queue-v0111.css"), "utf8");
const loader = fs.readFileSync(path.resolve(__dirname, "../intelligence-voluntary-sync-v0111.js"), "utf8");
const sw = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

(async () => {
  const listeners = { document: {}, window: {} };
  let currentState = { members: {} };
  let canCheckIn = true;
  let pendingPlanUpdate = false;
  const checkInCalls = [];
  let timerId = 0;
  const timers = new Map();

  const fakeBanner = {
    hidden: true,
    className: "",
    innerHTML: "",
    setAttribute() {},
  };
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
      return {
        id: "",
        className: "",
        hidden: false,
        innerHTML: "",
        setAttribute() {},
        querySelector() { return null; },
        appendChild() {},
      };
    },
  };
  const navigator = { onLine: false };
  const window = {
    NVSShare: { getFocusIndex: () => 0 },
    NVSSharedLive: {
      getState: () => currentState,
      canCheckIn: () => canCheckIn,
      hasPendingPlanUpdate: () => pendingPlanUpdate,
      async checkIn(status) {
        checkInCalls.push(status);
        if (status === "clear") currentState = { members: {} };
        else currentState = { members: { "0": { status, at: Date.now() } } };
      },
    },
    addEventListener(name, handler) { listeners.window[name] ||= []; listeners.window[name].push(handler); },
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
  assert.ok(queue, "queue API should be exported");
  assert.equal(queue.maxPendingMs, 5 * 60_000);

  const base = Date.UTC(2026, 7, 26, 15, 0, 0);
  let item = queue.queueStatus("on-vehicle", base);
  assert.equal(item.status, "on-vehicle");
  assert.equal(queue.getPending(base + 30_000).status, "on-vehicle");
  assert.equal(queue.getPending(base + 5 * 60_000), null, "pending state should expire after five minutes");

  queue.queueStatus("at-stop", base);
  queue.queueStatus("missed", base + 1_000);
  assert.equal(queue.getPending(base + 1_500).status, "missed", "newer offline intent should replace the older one");
  assert.equal(queue.discardPending(), true);
  assert.equal(queue.getPending(base + 2_000), null);

  queue.queueStatus("arrived", Date.now());
  navigator.onLine = false;
  assert.equal(await queue.sendPending(), false, "offline send should remain pending");
  assert.equal(checkInCalls.length, 0);
  assert.equal(queue.getPending()?.status, "arrived");

  navigator.onLine = true;
  pendingPlanUpdate = true;
  assert.equal(await queue.sendPending(), false, "plan updates should block sending queued state");
  assert.equal(checkInCalls.length, 0);
  pendingPlanUpdate = false;

  canCheckIn = true;
  assert.equal(await queue.sendPending(), true, "explicit send should post once online and current");
  assert.deepEqual(checkInCalls, ["arrived"]);
  assert.equal(queue.getPending(), null);

  queue.queueStatus("clear", Date.now());
  assert.equal(await queue.sendPending(), true, "queued clear should be confirmable too");
  assert.equal(checkInCalls.at(-1), "clear");
  assert.equal(queue.getPending(), null);

  queue.queueStatus("left", Date.now());
  canCheckIn = false;
  assert.equal(await queue.sendPending(), false, "read-only personal links should discard pending state");
  assert.equal(queue.getPending(), null);

  assert.ok((listeners.document.click || []).some((entry) => entry.capture === true), "offline status interception must run in capture phase before the base sender");
  assert.match(source, /stopImmediatePropagation\(\)/, "definite-offline taps must not leak through to the base POST handler");
  assert.match(source, /Pending — not shared/, "UI must clearly disclose that queued state has not been shared");
  assert.match(source, /Connection is available again\. Confirm it is still true, then send it\./, "reconnect must require a fresh explicit send rather than silently auto-posting stale state");
  assert.doesNotMatch(source, /localStorage|sessionStorage/, "pending voluntary state must remain memory-only and disappear with the page");
  assert.doesNotMatch(source, /fetch\s*\(/, "queue layer must not create a second direct network path");
  assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "queue must not add location tracking");
  assert.match(css, /min-height:44px/, "pending send/discard controls should remain mobile-sized");
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /forced-colors/);
  assert.match(loader, /shared-checkin-queue-v0111\.js/, "voluntary reconciliation loader must wire the queue runtime");
  assert.match(loader, /shared-checkin-queue-v0111\.css/, "voluntary reconciliation loader must wire queue styles");
  assert.match(sw, /shared-checkin-queue-v0111\.js/, "offline shell must contain queue runtime");
  assert.match(sw, /shared-checkin-queue-v0111\.css/, "offline shell must contain queue styles");

  console.log("shared-checkin-queue: memory-only offline intent, explicit reconnect confirmation, plan-update/read-only guards and privacy boundaries passed");
})().catch((error) => { console.error(error); process.exit(1); });
