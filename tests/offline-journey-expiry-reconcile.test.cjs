const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../offline-journey-v0111.js"), "utf8");
const saved = new Map();
const sessionStorage = {
  setItem(key, value) { saved.set(key, String(value)); },
  getItem(key) { return saved.has(key) ? saved.get(key) : null; },
  removeItem(key) { saved.delete(key); },
};

const base = Date.now();
const iso = (offsetMs) => new Date(base + offsetMs).toISOString();
const assignment = {
  route: {
    arrival: iso(45 * 60_000),
    segments: [{
      mode: "TRAM",
      line: "2",
      from: "Marienplatz",
      to: "Krebsförden",
      departure: iso(10 * 60_000),
      arrival: iso(35 * 60_000),
    }],
  },
};
let liveState = { expiresAt: null };
const listeners = {};
const personalPlanNode = {};
const window = {
  NVSShare: {
    getSharedPlan: () => ({ view: "person" }),
    getFocusIndex: () => 0,
  },
  NVSSharedLive: { getState: () => liveState },
  __NVS_LAST_RECOMMENDATIONS__: { primary: { assignments: [assignment] } },
  location: { pathname: "/p/example", search: "?me=0" },
  addEventListener(name, fn) { listeners[name] = fn; },
};
const document = {
  hidden: false,
  getElementById(id) {
    if (id === "personalSharedPlan") return personalPlanNode;
    return null;
  },
  querySelector() { return null; },
  addEventListener() {},
};
const navigator = { onLine: true };

vm.runInNewContext(source, {
  window,
  document,
  navigator,
  sessionStorage,
  URLSearchParams,
  Intl,
  Date,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Object,
  JSON,
});

const api = window.NVSOfflineJourney0111;
const storageKey = "meet-schwerin-offline-journey-v1";
const capturedAt = new Date(base - 60_000);
api.capture(capturedAt);
let stored = JSON.parse(sessionStorage.getItem(storageKey));
assert.equal(stored.expiresAt, null, "snapshot may begin without authoritative expiry while Shared Live is still loading");

liveState = { expiresAt: iso(60 * 60_000) };
const reconciled = api.reconcileAuthoritativeExpiry(base);
assert.equal(reconciled.expiresAt, iso(60 * 60_000), "late authoritative expiry should tighten the existing tab snapshot");
stored = JSON.parse(sessionStorage.getItem(storageKey));
assert.equal(stored.expiresAt, iso(60 * 60_000), "reconciled expiry must persist in sessionStorage for later offline reads");

liveState = { expiresAt: iso(30 * 60_000) };
listeners["nvs-live-plan-synced"]?.();
stored = JSON.parse(sessionStorage.getItem(storageKey));
assert.equal(stored.expiresAt, iso(30 * 60_000), "successful live-plan sync should reconcile newly learned authoritative expiry automatically");

const atExpiry = api.reconcileAuthoritativeExpiry(base + 30 * 60_000);
assert.equal(atExpiry, null, "snapshot must be rejected exactly at the authoritative deadline");
assert.equal(sessionStorage.getItem(storageKey), null, "expired snapshot must be evicted instead of being extended or resurrected");

liveState = { expiresAt: null };
api.capture(capturedAt);
liveState = { expiresAt: "not-a-date" };
const unchanged = api.reconcileAuthoritativeExpiry(base);
assert.equal(unchanged.expiresAt, null, "malformed live metadata must not invent or corrupt an offline expiry");
assert.equal(JSON.parse(sessionStorage.getItem(storageKey)).expiresAt, null);

assert.match(source, /nvs-live-plan-synced\", reconcileExpiryAndRender/, "live-plan sync must own expiry reconciliation before rendering");
assert.doesNotMatch(source, /localStorage|indexedDB/i, "expiry reconciliation must keep personal fallback data tab-scoped");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "expiry reconciliation must not add location tracking");

console.log("offline-journey-expiry-reconcile: late authoritative deadlines tighten tab snapshots and exact expiry cannot resurrect stale personal routes");
