const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-connection-v0111.js"), "utf8");
const handlers = {};
const documentHandlers = {};
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
  addEventListener(name, handler) { documentHandlers[name] = handler; },
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

const initialText = sync.textContent;
const initialSuccessVersion = api.getSuccessVersion();
const initialFailureAt = api.getLastFailureAt();
document.hidden = true;
documentHandlers.visibilitychange?.({ type: "visibilitychange" });

api.markSuccess(Date.now());
api.markFailure(Date.now(), "timeout");
api.render();
handlers["nvs-shared-live-change"]?.({ type: "nvs-shared-live-change" });
handlers["nvs-shared-live-timeout"]?.({ type: "nvs-shared-live-timeout" });
handlers["nvs-shared-live-degraded"]?.({ type: "nvs-shared-live-degraded" });
pendingPlanUpdate = true;
handlers["nvs-shared-checkin-outcome"]?.({ detail: { reason: "plan_updated", revision: 2 } });
handlers.online?.({ type: "online" });
handlers["nvs-shared-view-resumed"]?.({ type: "nvs-shared-view-resumed" });
const hiddenRetry = api.retryNow();

assert.equal(api.getSuccessVersion(), initialSuccessVersion,
  "hidden Shared Live success events must not mutate connection health");
assert.equal(api.getLastFailureAt(), initialFailureAt,
  "hidden timeout/degraded events must not mutate connection health");
assert.equal(api.isPlanUpdateBoundaryLocked(), false,
  "hidden organizer revision events must not cross the recovery boundary");
assert.equal(sync.textContent, initialText,
  "hidden connection entrypoints must not repaint stale UI");
assert.equal(refreshCalls, 0,
  "manual recovery must not start a Shared Live GET while hidden");

Promise.resolve(hiddenRetry).then(async (hiddenAcknowledged) => {
  assert.equal(hiddenAcknowledged, false, "hidden manual recovery should fail closed");

  document.hidden = false;
  documentHandlers.visibilitychange?.({ type: "visibilitychange" });
  assert.equal(api.isPlanUpdateBoundaryLocked(), true,
    "visibility restore must reconcile an organizer revision learned while hidden");

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
  handlers["nvs-shared-checkin-outcome"]?.({ detail: { reason: "plan_updated", revision: 3 } });

  assert.equal(api.getSuccessVersion(), versionBeforeFreeze,
    "late live-change events must not publish a success while the document is frozen");
  assert.equal(api.getLastFailureAt(), failureBeforeFreeze,
    "late timeout/degraded events must not replace connection health while frozen");

  refreshResolve();
  assert.equal(await frozenRetry, false,
    "a manual recovery begun before pagehide must not acknowledge after the bfcache boundary");
  assert.equal(api.getRetryCooldownUntil(), 0,
    "invalidated pre-freeze recovery must not install retry cooldown feedback");

  handlers.pageshow?.({ type: "pageshow", persisted: true });
  assert.equal(api.isLifecycleFrozen(), false, "pageshow must re-open connection ownership");

  const versionAfterResume = api.getSuccessVersion();
  handlers["nvs-shared-live-change"]?.({ type: "nvs-shared-live-change", detail: { revision: 3 } });
  assert.equal(api.getSuccessVersion(), versionAfterResume + 1,
    "a fresh post-resume Shared Live acknowledgement must be accepted normally");

  api.markFailure(Date.now(), "timeout");
  const postResumeRetry = api.retryNow();
  assert.equal(refreshCalls, 2,
    "read-only manual recovery must remain available after bfcache restoration");
  handlers["nvs-shared-live-change"]?.({ type: "nvs-shared-live-change", detail: { revision: 3 } });
  refreshResolve();
  assert.equal(await postResumeRetry, true,
    "fresh post-resume recovery may acknowledge current read-only Shared Live state");

  assert.match(source, /lifecycleFrozen \|\| document\.hidden/,
    "connection state and UI entrypoints should share an explicit hidden/frozen ownership boundary");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
    "connection recovery ownership must remain memory-only");
  assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
    "connection recovery must not add hidden or continuous location tracking");

  console.log("shared-connection-bfcache-ownership: hidden/frozen events suppressed; restore reconciled; fresh recovery preserved");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
