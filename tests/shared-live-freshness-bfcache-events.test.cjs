const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-live-freshness-v0111.js"), "utf8");
const handlers = { window: {}, document: {} };
let pendingPlanUpdate = false;
let expired = false;
let reloads = 0;
let scheduled = 0;
let disconnected = 0;
let observed = 0;
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
const list = { querySelectorAll() { return []; } };
const window = {
  location: { pathname: "/p/ABCDEF", reload() { reloads += 1; } },
  NVSSharedLive: {
    getState: () => ({ members: {}, expiresAt: Date.now() + 60_000 }),
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
  constructor(callback) { this.callback = callback; }
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
  for (const handler of handlers.window[name] || []) handler({ type: name, persisted: name === "pageshow" });
}
function emitDocument(name) {
  for (const handler of handlers.document[name] || []) handler({ type: name });
}
class FakeCustomEvent { constructor(type) { this.type = type; } }

vm.runInNewContext(source, {
  window, document, MutationObserver: FakeMutationObserver, CustomEvent: FakeCustomEvent,
  Date, Math, Number, String, Boolean, Array, Object,
  setTimeout() { scheduled += 1; return scheduled; },
  clearTimeout() {},
});

const api = window.NVSSharedLiveFreshness0111;
assert.ok(api);
assert.equal(api.getScopedPlanId(), "ABCDEF");

emitWindow("pagehide");
const rootBefore = JSON.stringify(root.dataset);
const guidanceBefore = JSON.stringify({ hidden: guidance.hidden, dataset: guidance.dataset, attributes: guidance.attributes });
const reloadsBefore = reloads;
const scheduledBefore = scheduled;

pendingPlanUpdate = true;
expired = true;
window.location.pathname = "/p/BCDEFG";
emitWindow("nvs-shared-live-change");
emitWindow("nvs-shared-session-expired");
emitWindow("online");
emitWindow("popstate");
document.hidden = false;
emitDocument("visibilitychange");
api.refresh();
api.applyPlanTrustBoundary();
api.enforcePlanScope();

assert.equal(JSON.stringify(root.dataset), rootBefore, "late trust events must not repaint root state while bfcache-frozen");
assert.equal(JSON.stringify({ hidden: guidance.hidden, dataset: guidance.dataset, attributes: guidance.attributes }), guidanceBefore,
  "late trust events must not repaint route intelligence while frozen");
assert.equal(reloads, reloadsBefore, "same-document path changes must not trigger reload work until the document resumes");
assert.equal(scheduled, scheduledBefore, "frozen direct events must not restart freshness timers");

window.location.pathname = "/p/ABCDEF";
emitWindow("pageshow");
assert.equal(root.dataset.nvsPlanUpdatePending, "true", "pageshow must reconcile organizer revision after restore");
assert.equal(root.dataset.nvsSharedSessionExpired, "true", "pageshow must reconcile authoritative expiry after restore");
assert.equal(guidance.hidden, true, "route-derived intelligence must fail closed after restored trust reconciliation");
assert.equal(guidance.attributes["aria-hidden"], "true");
assert.equal(reloads, reloadsBefore, "same plan restore should not reload");

pendingPlanUpdate = false;
expired = false;
emitWindow("nvs-shared-live-change");
assert.equal(guidance.hidden, false, "fresh trustworthy state may restore route intelligence after resume");
assert.equal(root.dataset.nvsPlanUpdatePending, undefined);
assert.equal(root.dataset.nvsSharedSessionExpired, undefined);
assert.ok(disconnected >= 1, "pagehide should disconnect trust observers");
assert.ok(observed >= 1, "blocked trust state should observe late DOM insertions after resume");

assert.match(source, /lifecycleFrozen/, "freshness layer should explicitly own the pagehide/pageshow boundary");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, "freshness lifecycle ownership must remain memory-only");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "freshness hardening must not add location tracking");
assert.doesNotMatch(source, /fetch\s*\(/, "freshness UI must not create another network path");

console.log("shared-live-freshness-bfcache-events: frozen ancillary trust events are deferred until safe resume");
