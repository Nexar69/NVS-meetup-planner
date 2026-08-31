const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-connection-v0111.js"), "utf8");
const handlers = {};
let refreshResolve;
let refreshCalls = 0;
let pendingPlanUpdate = false;
let nextTimerId = 1;
const setTimeoutFake = () => nextTimerId++;
const clearTimeoutFake = () => {};

const sync = { dataset: {}, textContent: "", title: "", parentElement: { appendChild() {} } };
const document = {
  hidden: false,
  getElementById(id) { return id === "v010Sync" ? sync : null; },
  createElement() { return { hidden: true, disabled: false, textContent: "", setAttribute() {}, addEventListener() {} }; },
  addEventListener() {},
};
const navigator = { onLine: true };
const window = {
  NVSSharedLive: {
    refresh() {
      refreshCalls += 1;
      return new Promise((resolve) => { refreshResolve = resolve; });
    },
    hasPendingPlanUpdate() { return pendingPlanUpdate; },
  },
  NVSSharedLiveTimeout0111: { allowNextGet() {} },
  addEventListener(name, handler) { handlers[name] = handler; },
};

vm.runInNewContext(source, {
  window,
  document,
  navigator,
  Date,
  Math,
  Number,
  String,
  Object,
  setTimeout: setTimeoutFake,
  clearTimeout: clearTimeoutFake,
});
const api = window.NVSSharedConnection0111;
assert.ok(api, "connection layer should expose its API");

api.markFailure(Date.now(), "timeout");
const frozenRetry = api.retryNow();
assert.equal(refreshCalls, 1, "manual recovery should start one Shared Live GET before bfcache freeze");
const versionBeforeFreeze = api.getSuccessVersion();
const failureBeforeFreeze = api.getLastFailureAt();

handlers.pagehide?.({ type: "pagehide", persisted: true });
assert.equal(api.isLifecycleFrozen(), true, "pagehide must freeze connection ownership");

handlers["nvs-shared-live-change"]?.({ type: "nvs-shared-live-change" });
handlers["nvs-shared-live-timeout"]?.({ type: "nvs-shared-live-timeout" });
handlers["nvs-shared-live-degraded"]?.({ type: "nvs-shared-live-degraded" });
pendingPlanUpdate = true;
handlers["nvs-shared-checkin-outcome"]?.({ detail: { reason: "plan_updated", revision: 2 } });

assert.equal(api.getSuccessVersion(), versionBeforeFreeze,
  "late live-change events must not publish a success while the document is frozen");
assert.equal(api.getLastFailureAt(), failureBeforeFreeze,
  "late timeout/degraded events must not replace connection health while frozen");
assert.equal(api.isPlanUpdateBoundaryLocked(), false,
  "late check-in outcomes must not mutate organizer-revision ownership while frozen");

refreshResolve();
Promise.resolve(frozenRetry).then(async (acknowledged) => {
  assert.equal(acknowledged, false,
    "a manual recovery begun before pagehide must not acknowledge after the bfcache boundary");
  assert.equal(api.getRetryCooldownUntil(), 0,
    "invalidated pre-freeze recovery must not install retry cooldown feedback");

  handlers.pageshow?.({ type: "pageshow", persisted: true });
  assert.equal(api.isLifecycleFrozen(), false, "pageshow must re-open connection ownership");
  assert.equal(api.isPlanUpdateBoundaryLocked(), true,
    "resume must reconcile an organizer revision learned while the document was frozen");

  const versionAfterResume = api.getSuccessVersion();
  handlers["nvs-shared-live-change"]?.({ type: "nvs-shared-live-change", detail: { revision: 2 } });
  assert.equal(api.getSuccessVersion(), versionAfterResume + 1,
    "a fresh post-resume Shared Live acknowledgement must be accepted normally");

  api.markFailure(Date.now(), "timeout");
  const postResumeRetry = api.retryNow();
  assert.equal(refreshCalls, 2,
    "read-only manual recovery must remain available after bfcache restoration");
  handlers["nvs-shared-live-change"]?.({ type: "nvs-shared-live-change", detail: { revision: 2 } });
  refreshResolve();
  assert.equal(await postResumeRetry, true,
    "fresh post-resume recovery may acknowledge current read-only Shared Live state");

  assert.match(source, /lifecycleFrozen/, "connection recovery must own an explicit bfcache freeze boundary");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
    "bfcache recovery ownership must remain memory-only");
  assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
    "connection recovery must not add hidden or continuous location tracking");

  console.log("shared-connection-bfcache-ownership: frozen events suppressed; resume reconciled; fresh recovery preserved");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
