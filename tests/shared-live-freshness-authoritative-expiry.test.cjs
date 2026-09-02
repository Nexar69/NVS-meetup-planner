const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-live-freshness-v0111.js"), "utf8");

let now = Date.now();
let authoritativeExpired = false;
let authoritativeExpiryAt = null;
const state = {
  expiresAt: now + 60 * 60_000,
  members: {},
};
const handlers = {};
const guidance = {
  hidden: false,
  dataset: {},
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
  removeAttribute(name) { delete this.attributes[name]; },
};
const document = {
  hidden: false,
  body: {},
  documentElement: { dataset: {} },
  getElementById(id) {
    if (id === "v0111TripGuidance") return guidance;
    return null;
  },
  addEventListener() {},
};
const window = {
  location: { pathname: "/p/ABCDEF", reload() {} },
  NVSSharedLive: {
    getState: () => state,
    hasPendingPlanUpdate: () => false,
  },
  NVSSharedExpiry0111: {
    isAuthoritativelyExpired: () => authoritativeExpired,
    getAuthoritativeExpiryAt: () => authoritativeExpiryAt,
  },
  addEventListener(name, handler) { handlers[name] = handler; },
  dispatchEvent() { return true; },
};
class FakeCustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}

vm.runInNewContext(source, {
  window,
  document,
  CustomEvent: FakeCustomEvent,
  Date,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Object,
  setTimeout() { return 1; },
  clearTimeout() {},
});

const api = window.NVSSharedLiveFreshness0111;
assert.ok(api, "freshness guard should expose its trust-boundary API");
assert.equal(api.sharedSessionExpired(now), false, "future live-state expiry is initially writable-looking");
assert.equal(api.routeIntelligenceBlocked(now), false);

// Simulate a newer expiry layer latching authoritative expiry while an older cached
// Shared Live module continues to expose a future-looking expiresAt value.
authoritativeExpired = true;
authoritativeExpiryAt = now - 1_000;
state.expiresAt = now + 24 * 60 * 60_000;

assert.equal(api.isAuthoritativelyExpired(), true,
  "freshness should consult the newer sticky expiry layer directly");
assert.equal(api.authoritativeExpiresAt(), authoritativeExpiryAt,
  "the sticky authoritative deadline should outrank a stale future-looking live-state deadline");
assert.equal(api.sharedSessionExpired(now), true,
  "an older cached Shared Live module must not reopen the session by reporting a future expiry");
assert.equal(api.routeIntelligenceBlocked(now), true,
  "route-derived intelligence must remain blocked after authoritative expiry");
assert.equal(api.applyPlanTrustBoundary(now), 1);
assert.equal(guidance.hidden, true, "route guidance must fail closed after authoritative expiry");
assert.equal(guidance.attributes["aria-hidden"], "true", "expired route guidance must leave the accessibility tree");
assert.equal(guidance.dataset.nvsPlanTrustHidden, "true");
assert.equal(document.documentElement.dataset.nvsSharedSessionExpired, "true");

// A later read-only poll from the older module may still emit live-change and may
// still claim a future expiry. It must not revive route-derived UI.
state.expiresAt = now + 48 * 60 * 60_000;
assert.doesNotThrow(() => handlers["nvs-shared-live-change"]?.({ type: "nvs-shared-live-change" }));
assert.equal(guidance.hidden, true, "future-looking post-expiry refreshes must not revive route guidance");
assert.equal(guidance.attributes["aria-hidden"], "true");
assert.equal(api.sharedSessionExpired(now), true);

assert.match(source, /NVSSharedExpiry0111\?\.isAuthoritativelyExpired\?\.\(\)/,
  "mixed-cache freshness must explicitly consult the sticky expiry owner");
assert.match(source, /getAuthoritativeExpiryAt/,
  "freshness diagnostics should prefer the authoritative sticky deadline after expiry");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
  "expiry ownership must stay memory-only");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
  "freshness hardening must not add hidden or continuous location tracking");

console.log("shared-live-freshness-authoritative-expiry: sticky expiry outranks stale mixed-cache live state while visible");
