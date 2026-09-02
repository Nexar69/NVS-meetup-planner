const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../offline-journey-v0111.js"), "utf8");
const storageKey = "meet-schwerin-offline-journey-v1";
const saved = new Map();
const nodes = new Map();
const listeners = {};
const documentListeners = {};
const timers = new Map();
let nextTimer = 1;
const base = Date.now();

const sessionStorage = {
  setItem(key, value) { saved.set(key, String(value)); },
  getItem(key) { return saved.has(key) ? saved.get(key) : null; },
  removeItem(key) { saved.delete(key); },
};

const personalPlan = {
  insertAdjacentElement(_position, node) { nodes.set(node.id, node); },
};

const document = {
  hidden: false,
  createElement() {
    return {
      id: "",
      className: "",
      innerHTML: "",
      attributes: new Map(),
      setAttribute(name, value) { this.attributes.set(name, String(value)); },
      remove() { if (this.id) nodes.delete(this.id); },
    };
  },
  getElementById(id) {
    if (id === "personalSharedPlan") return personalPlan;
    return nodes.get(id) || null;
  },
  querySelector() { return null; },
  addEventListener(name, fn) { documentListeners[name] = fn; },
};

let pendingPlanUpdate = false;
const routeAssignment = {
  route: {
    arrival: new Date(base + 30 * 60_000).toISOString(),
    segments: [{
      mode: "TRAM",
      modeLabel: "Tram",
      line: "4",
      from: "Marienplatz",
      to: "Krebsförden",
      departure: new Date(base + 5 * 60_000).toISOString(),
      arrival: new Date(base + 20 * 60_000).toISOString(),
      platformFrom: "A",
    }],
  },
};

const window = {
  NVSShare: {
    getSharedPlan: () => ({ view: "person" }),
    getFocusIndex: () => 0,
  },
  NVSSharedLive: {
    getState: () => ({ expiresAt: new Date(base + 60 * 60_000).toISOString() }),
    hasPendingPlanUpdate: () => pendingPlanUpdate,
  },
  __NVS_LAST_RECOMMENDATIONS__: { primary: { assignments: [routeAssignment] } },
  location: { pathname: "/p/example", search: "?me=0" },
  addEventListener(name, fn) { listeners[name] = fn; },
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
  setTimeout(fn, delay) {
    const id = nextTimer++;
    timers.set(id, { fn, delay: Number(delay) });
    return id;
  },
  clearTimeout(id) { timers.delete(id); },
});

const api = window.NVSOfflineJourney0111;
assert.equal(typeof api.hasPendingPlanUpdate, "function");
assert.equal(typeof api.handleSharedLiveChange, "function");
assert.equal(nodes.has("offlineJourney0111"), false, "a fresh current personal route should not need the saved fallback card");

const initial = JSON.parse(sessionStorage.getItem(storageKey));
assert.equal(initial.segments[0].line, "4");
routeAssignment.route.segments[0].line = "99";

pendingPlanUpdate = true;
listeners["nvs-shared-live-change"]?.({ detail: { revision: 2 } });
let card = nodes.get("offlineJourney0111");
assert.ok(card, "a newly detected plan revision must immediately demote the mounted personal route and expose the saved historical fallback");
assert.equal(card.attributes.get("data-connection"), "plan-updated");
assert.match(card.innerHTML, /PLAN UPDATED · SAVED ROUTE/);
assert.match(card.innerHTML, /previous plan/);
assert.match(card.innerHTML, /historical until you reload the updated plan/);
assert.match(card.innerHTML, /Tram 4 to Krebsförden/, "the card must keep the last trusted snapshot, not the stale mounted route from the superseded revision");
assert.doesNotMatch(card.innerHTML, /Tram 99/);

const beforeStaleRender = sessionStorage.getItem(storageKey);
listeners["nvs-group-recommendations-rendered"]?.();
assert.equal(sessionStorage.getItem(storageKey), beforeStaleRender, "recommendation renders from a superseded plan revision must not recapture or renew the saved fallback");
assert.equal(api.capture(), null, "direct capture must also fail closed while a newer shared-plan revision is pending");
assert.ok(nodes.get("offlineJourney0111"), "a stale recommendation render must not dismiss the historical fallback");

pendingPlanUpdate = false;
routeAssignment.route.segments[0].line = "7";
listeners["nvs-group-recommendations-rendered"]?.();
const replacement = JSON.parse(sessionStorage.getItem(storageKey));
assert.equal(replacement.segments[0].line, "7", "after the updated plan is actually loaded, its fresh personal route should replace the historical snapshot");
assert.equal(nodes.has("offlineJourney0111"), false, "fresh rendering from the loaded revision should dismiss the fallback");
assert.equal(timers.size, 0, "live route restoration should leave no offline freshness timer armed");

assert.doesNotMatch(source, /localStorage|indexedDB/i, "plan-revision protection must keep personal fallback storage tab-scoped only");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "plan-revision recovery must not add location tracking");

console.log("offline-journey-plan-revision: newer shared-plan revisions demote stale mounted routes without renewing the saved snapshot, until fresh updated rendering replaces it");
