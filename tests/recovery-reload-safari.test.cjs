const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../recovery-v0111.js"), "utf8");

function control() {
  return {
    textContent: "",
    disabled: false,
    dataset: {},
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
  };
}

const action = control();
const later = control();
const scope = control();
const title = control();
const detail = control();
const privacy = control();
const desk = {
  hidden: true,
  className: "",
  classList: { toggle() {} },
  setAttribute() {},
  insertAdjacentElement() {},
  querySelector(selector) {
    return ({
      "#v0111RecoveryAction": action,
      "#v0111RecoveryLater": later,
      "#v0111RecoveryScope": scope,
      "#v0111RecoveryTitle": title,
      "#v0111RecoveryDetail": detail,
      "#v0111RecoveryPrivacy": privacy,
    })[selector] || null;
  },
  set innerHTML(value) { this._html = value; },
};

const document = {
  hidden: true,
  getElementById(id) {
    if (id === "v0111RecoveryDesk") return desk;
    if (id === "v0111RecoveryAction") return action;
    return null;
  },
  createElement() { return desk; },
  querySelector() { return { appendChild() {} }; },
  addEventListener() {},
};

let reliableCalls = 0;
let reliableButton = null;
let reloadCalls = 0;
let assignCalls = 0;
let pendingPlanUpdate = true;
let currentAlerts = [];
const window = {
  __NVS_LAST_RECOMMENDATIONS__: { primary: { assignments: [] } },
  NVSShare: { isViewer: () => false, getFocusIndex: () => -1 },
  NVSSharedLive: { hasPendingPlanUpdate: () => pendingPlanUpdate },
  NVSIntelligence: { getAlerts: () => currentAlerts },
  NVSSharedReload0111: {
    reloadUpdatedPlan(button) {
      reliableCalls += 1;
      reliableButton = button;
      return true;
    },
  },
  location: {
    href: "https://example.test/p/abc?me=0",
    reload() { reloadCalls += 1; },
    assign() { assignCalls += 1; },
  },
  addEventListener() {},
};
const navigator = { onLine: true };

vm.runInNewContext(source, {
  window,
  document,
  navigator,
  Number,
  String,
  Boolean,
  Array,
  Object,
  setTimeout: () => 1,
  clearTimeout() {},
});

const api = window.NVSRecovery0111;
assert.equal(typeof api?.reloadPendingPlan, "function", "Recovery Desk should expose its reload helper for executable regression testing");
assert.equal(api.reloadPendingPlan(), true);
assert.equal(reliableCalls, 1, "pending-plan recovery should use the shared Safari-safe reload controller when available");
assert.equal(reliableButton, action, "the shared reload controller should receive the Recovery Desk action button for loading-state feedback");
assert.equal(reloadCalls, 0, "direct location.reload must not run when the hardened shared reload controller is available");

window.NVSSharedReload0111 = null;
assert.equal(api.reloadPendingPlan(), true);
assert.equal(reloadCalls, 1, "a partially updated shell should retain a direct reload compatibility fallback");
assert.equal(assignCalls, 0);

window.location.reload = () => { throw new Error("reload blocked"); };
assert.equal(api.reloadPendingPlan(), true);
assert.equal(assignCalls, 1, "if direct reload throws, Recovery Desk should fall back to same-URL navigation");

pendingPlanUpdate = false;
currentAlerts = [{
  id: "transfer-missed:0:1",
  kind: "recovery",
  title: "Transfer at risk",
  detail: "The connection no longer fits.",
  segmentIndex: 1,
  memberIndex: 0,
  replan: true,
}];
const firstSignature = api.getActiveSignature();
assert.ok(firstSignature.includes("transfer-missed:0:1"));

currentAlerts = [{ ...currentAlerts[0], detail: "The onward service is now cancelled." }];
const escalatedSignature = api.getActiveSignature();
assert.notEqual(escalatedSignature, firstSignature, "a material detail change under the same alert ID must invalidate a snooze so Recovery Desk can resurface");

currentAlerts = [{ ...currentAlerts[0] }];
assert.equal(api.getActiveSignature(), escalatedSignature, "an unchanged recovery condition should keep a stable snooze signature");

assert.match(source, /if \(lifecycleFrozen \|\| document\.hidden \|\| !shouldPoll\(\)\) return;/, "Recovery Desk must not arm periodic work while Safari is frozen/hidden or recovery context is inactive");
assert.doesNotMatch(source, /navigator\.geolocation|watchPosition|getCurrentPosition/, "Recovery reload hardening must not add location access");

console.log("recovery-reload-safari: shared reload delegation, frozen/hidden scheduling and changed-condition snooze resurfacing passed");
