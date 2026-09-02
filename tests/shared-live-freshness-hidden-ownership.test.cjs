const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-live-freshness-v0111.js"), "utf8");
const handlers = { window: {}, document: {} };
const timeouts = [];
let pendingPlanUpdate = false;
let expired = false;
let reloads = 0;
let observed = 0;
let disconnected = 0;
let rowMutations = 0;
let observerCallback = null;
const member = { at: Date.now() };
const root = { dataset: {} };
const guidance = {
  hidden: false,
  dataset: {},
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
  removeAttribute(name) { delete this.attributes[name]; },
};
const sharedPanel = {
  hidden: false,
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
};
const row = {
  dataset: {},
  classList: {
    remove() { rowMutations += 1; },
    add() { rowMutations += 1; },
  },
  querySelector() { return null; },
};
const list = { querySelectorAll() { return [row]; } };
const window = {
  location: { pathname: "/p/ABCDEF", reload() { reloads += 1; } },
  NVSSharedLive: {
    getState: () => ({ members: { "0": member }, expiresAt: Date.now() + 60_000 }),
    hasPendingPlanUpdate: () => pendingPlanUpdate,
  },
  NVSSharedExpiry0111: {
    isAuthoritativelyExpired: () => expired,
    getAuthoritativeExpiryAt: () => expired ? Date.now() - 1 : null,
  },
  addEventListener(name, handler) { handlers.window[name] ||= []; handlers.window[name].push(handler); },
  dispatchEvent() { return true; },
};
class FakeMutationObserver {
  constructor(callback) { observerCallback = callback; }
  observe() { observed += 1; }
  disconnect() { disconnected += 1; }
}
window.MutationObserver = FakeMutationObserver;
const document = {
  hidden: false,
  body: {},
  documentElement: root,
  addEventListener(name, handler) { handlers.document[name] ||= []; handlers.document[name].push(handler); },
  getElementById(id) {
    if (id === "v010StatusList") return list;
    if (id === "sharedLiveV010") return sharedPanel;
    if (id === "v0111TripGuidance") return guidance;
    return null;
  },
};
function emitWindow(name) {
  for (const handler of handlers.window[name] || []) handler({ type: name });
}
function emitDocument(name) {
  for (const handler of handlers.document[name] || []) handler({ type: name });
}
class FakeCustomEvent { constructor(type) { this.type = type; } }

vm.runInNewContext(source, {
  window, document, MutationObserver: FakeMutationObserver, CustomEvent: FakeCustomEvent,
  Date, Math, Number, String, Boolean, Array, Object,
  setTimeout(callback) { timeouts.push(callback); return timeouts.length; },
  clearTimeout() {},
});

const api = window.NVSSharedLiveFreshness0111;
assert.ok(api);
assert.equal(api.getScopedPlanId(), "ABCDEF");
assert.ok(timeouts.length >= 1, "visible bootstrap should schedule freshness reconciliation");
assert.equal(rowMutations, 0, "fresh bootstrap row should remain untouched");

const staleTimer = timeouts[0];
const scheduledBeforeHide = timeouts.length;
const observedBeforeHide = observed;
document.hidden = true;
emitDocument("visibilitychange");

pendingPlanUpdate = true;
expired = true;
member.at = Date.now() - 20 * 60_000;
window.location.pathname = "/p/BCDEFG";
const rootBefore = JSON.stringify(root.dataset);
const guidanceBefore = JSON.stringify({ hidden: guidance.hidden, dataset: guidance.dataset, attributes: guidance.attributes });

staleTimer();
observerCallback?.();
emitWindow("nvs-shared-live-change");
emitWindow("nvs-shared-session-expired");
emitWindow("online");
emitWindow("popstate");
api.refresh();
api.applyPlanTrustBoundary();
api.enforcePlanScope();

assert.equal(rowMutations, 0, "hidden stale callbacks must not rewrite member freshness rows");
assert.equal(JSON.stringify(root.dataset), rootBefore, "hidden trust reconciliation must not repaint root state");
assert.equal(JSON.stringify({ hidden: guidance.hidden, dataset: guidance.dataset, attributes: guidance.attributes }), guidanceBefore,
  "hidden trust reconciliation must not repaint route intelligence");
assert.equal(reloads, 0, "hidden plan-scope changes must not trigger a reload");
assert.equal(timeouts.length, scheduledBeforeHide, "a stale hidden timer callback must not rearm itself");
assert.equal(observed, observedBeforeHide, "hidden observer callbacks must not reacquire observation");
assert.ok(disconnected >= 1, "hiding should disconnect the trust observer");

window.location.pathname = "/p/ABCDEF";
document.hidden = false;
emitDocument("visibilitychange");

assert.equal(root.dataset.nvsPlanUpdatePending, "true", "visibility restore must reconcile pending organizer revision");
assert.equal(root.dataset.nvsSharedSessionExpired, "true", "visibility restore must reconcile authoritative expiry");
assert.equal(guidance.hidden, true, "restored blocked trust state must hide route-derived intelligence");
assert.equal(guidance.attributes["aria-hidden"], "true");
assert.ok(rowMutations >= 2, "visibility restore must reconcile a check-in that became stale while hidden");
assert.ok(timeouts.length > scheduledBeforeHide, "visibility restore should resume the freshness timer");
assert.ok(observed > observedBeforeHide, "blocked visible state should reacquire trust observation");

assert.match(source, /function ownsVisibleLifecycle\(\)/, "freshness layer should centralize visible lifecycle ownership");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, "freshness lifecycle state must remain memory-only");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "freshness hardening must not add location tracking");
assert.doesNotMatch(source, /fetch\s*\(/, "freshness UI must not create another network path");

console.log("shared-live-freshness-hidden-ownership: hidden stale timers, observers, events, and direct calls defer until visible restore");
