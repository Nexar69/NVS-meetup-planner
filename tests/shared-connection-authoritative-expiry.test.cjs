const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-connection-v0111.js"), "utf8");
const handlers = {};
let refreshResolve;
let refreshCalls = 0;
let now = Date.now();

function unrefSetTimeout(callback, delay) {
  const timer = setTimeout(callback, delay);
  timer.unref?.();
  return timer;
}

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
  },
  NVSSharedLiveTimeout0111: { allowNextGet() {} },
  addEventListener(name, handler) { handlers[name] = handler; },
};

vm.runInNewContext(source, { window, document, navigator, Date, Math, Number, String, Object, setTimeout: unrefSetTimeout, clearTimeout });
const api = window.NVSSharedConnection0111;
assert.ok(api, "connection layer should expose its API");

api.markFailure(now, "timeout");
const preExpiryRetry = api.retryNow();
assert.equal(refreshCalls, 1, "manual read-only recovery should start a GET refresh");
const boundaryBefore = api.getRecoveryBoundaryGeneration();
handlers["nvs-shared-session-expired"]?.({ type: "nvs-shared-session-expired" });
assert.equal(api.getRecoveryBoundaryGeneration(), boundaryBefore + 1,
  "authoritative expiry must cross the recovery ownership boundary");
refreshResolve();

Promise.resolve(preExpiryRetry).then(async (acknowledged) => {
  assert.equal(acknowledged, false,
    "a retry started before authoritative expiry must not publish post-boundary success feedback");
  assert.equal(api.getRetryCooldownUntil(), 0,
    "an invalidated pre-expiry retry must not install a stale cooldown after expiry");

  api.markFailure(Date.now(), "timeout");
  const postExpiryRetry = api.retryNow();
  assert.equal(refreshCalls, 2,
    "expiry must not disable explicit read-only GET recovery for the expired session");
  api.markSuccess(Date.now());
  refreshResolve();
  assert.equal(await postExpiryRetry, true,
    "a fresh retry begun after the expiry boundary may acknowledge a read-only response");

  assert.match(source, /nvs-shared-session-expired/,
    "connection recovery must listen for authoritative expiry directly");
  assert.match(source, /boundaryGeneration/,
    "retry tasks must carry recovery-boundary ownership");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
    "connection ownership must remain memory-only");
  assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
    "connection recovery must not add hidden or continuous location tracking");

  console.log("shared-connection-authoritative-expiry: pre-expiry retry ownership invalidated; read-only recovery preserved");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
