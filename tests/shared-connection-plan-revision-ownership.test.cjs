const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-connection-v0111.js"), "utf8");
const handlers = {};
let refreshResolve;
let refreshCalls = 0;
let pendingPlanUpdate = false;
const now = Date.now();

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

vm.runInNewContext(source, { window, document, navigator, Date, Math, Number, String, Object, setTimeout, clearTimeout });
const api = window.NVSSharedConnection0111;
assert.ok(api, "connection layer should expose its API");

api.markFailure(now, "timeout");
const preRevisionRetry = api.retryNow();
assert.equal(refreshCalls, 1, "manual recovery should start a Shared Live GET");
const boundaryBefore = api.getRecoveryBoundaryGeneration();
pendingPlanUpdate = true;
handlers["nvs-shared-live-change"]?.({ type: "nvs-shared-live-change", detail: { revision: 2 } });
assert.equal(api.getRecoveryBoundaryGeneration(), boundaryBefore + 1,
  "first observed organizer revision must cross the recovery ownership boundary");
assert.equal(api.isPlanUpdateBoundaryLocked(), true,
  "organizer revision ownership must remain sticky for the lifetime of the stale document");
refreshResolve();

Promise.resolve(preRevisionRetry).then(async (acknowledged) => {
  assert.equal(acknowledged, false,
    "a retry started before an organizer revision must not publish post-boundary success feedback");
  assert.equal(api.getRetryCooldownUntil(), 0,
    "an invalidated pre-revision retry must not install stale cooldown feedback");

  const lockedBoundary = api.getRecoveryBoundaryGeneration();
  handlers["nvs-shared-live-change"]?.({ type: "nvs-shared-live-change", detail: { revision: 2 } });
  handlers["pageshow"]?.({ type: "pageshow", persisted: true });
  assert.equal(api.getRecoveryBoundaryGeneration(), lockedBoundary,
    "repeated live/lifecycle events must not repeatedly cross the same revision boundary");

  api.markFailure(Date.now(), "timeout");
  const postRevisionRetry = api.retryNow();
  assert.equal(refreshCalls, 2,
    "revision ownership must not disable explicit read-only GET recovery");
  handlers["nvs-shared-live-change"]?.({ type: "nvs-shared-live-change", detail: { revision: 2 } });
  refreshResolve();
  assert.equal(await postRevisionRetry, true,
    "a fresh retry begun after the revision boundary may acknowledge read-only live state");

  const boundaryBeforeOutcome = api.getRecoveryBoundaryGeneration();
  handlers["nvs-shared-checkin-outcome"]?.({ detail: { reason: "plan_updated", revision: 3 } });
  assert.equal(api.getRecoveryBoundaryGeneration(), boundaryBeforeOutcome,
    "a 409 plan_updated outcome must reconcile without duplicating an already latched boundary");

  assert.match(source, /hasPendingPlanUpdate/,
    "connection recovery must consult Shared Live organizer-revision ownership directly");
  assert.match(source, /nvs-shared-checkin-outcome/,
    "connection recovery must reconcile the plan_updated check-in path");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
    "revision recovery ownership must remain memory-only");
  assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
    "connection recovery must not add hidden or continuous location tracking");

  console.log("shared-connection-plan-revision-ownership: pre-revision retry invalidated; boundary sticky; read-only recovery preserved");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
