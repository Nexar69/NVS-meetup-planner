const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../offline-journey-v0111.js"), "utf8");
const saved = new Map();
const nodes = new Map();
const listeners = {};
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
  createElement() {
    return {
      id: "",
      className: "",
      innerHTML: "",
      setAttribute() {},
      remove() { if (this.id) nodes.delete(this.id); },
    };
  },
  getElementById(id) {
    if (id === "personalSharedPlan") return personalPlan;
    return nodes.get(id) || null;
  },
  querySelector() { return null; },
};

let sharedPlan = { view: "person" };
let focus = 0;
const routeAssignment = {
  route: {
    arrival: new Date(base + 20 * 60_000).toISOString(),
    segments: [
      {
        mode: "TRAM",
        modeLabel: "Tram",
        line: "OLD",
        from: "Old stop",
        to: "Already passed",
        departure: new Date(base - 20 * 60_000).toISOString(),
        arrival: new Date(base - 10 * 60_000).toISOString(),
      },
      {
        mode: "TRAM",
        modeLabel: "Tram",
        line: "4",
        from: "Marienplatz",
        to: "Krebsförden",
        departure: new Date(base + 5 * 60_000).toISOString(),
        arrival: new Date(base + 15 * 60_000).toISOString(),
        plannedPlatformFrom: "A",
        platformFrom: "C",
        cancelled: true,
        remarks: [{ text: "Replacement buses may operate." }],
      },
    ],
  },
};

const window = {
  NVSShare: {
    getSharedPlan: () => sharedPlan,
    getFocusIndex: () => focus,
  },
  NVSSharedLive: {
    getState: () => ({ expiresAt: new Date(base + 60 * 60_000).toISOString() }),
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
});

const api = window.NVSOfflineJourney0111;
const storageKey = "meet-schwerin-offline-journey-v1";
const snapshot = api.buildSnapshot(routeAssignment, new Date(base));
sessionStorage.setItem(storageKey, JSON.stringify(snapshot));

navigator.onLine = false;
sharedPlan = null;
focus = -1;
api.refresh();

let card = nodes.get("offlineJourney0111");
assert.ok(card, "offline personal viewer should render its tab-scoped saved route when the live plan is unavailable");
assert.doesNotMatch(card.innerHTML, /OLD|Old stop|Already passed/, "clearly completed route legs should not clutter the offline mobile card");
assert.match(card.innerHTML, /Tram 4 to Krebsförden/);
assert.match(card.innerHTML, /platform C/);
assert.match(card.innerHTML, /platform changed A → C/);
assert.match(card.innerHTML, /Cancelled when last online/);
assert.match(card.innerHTML, /Replacement buses may operate/);
assert.match(card.innerHTML, /At least one remaining saved leg was already cancelled/);
assert.match(card.innerHTML, /Completed legs are hidden when possible/);
assert.match(card.innerHTML, /Authoritative shared-session expiry is honored offline when known/);
assert.doesNotMatch(card.innerHTML, /secret|planId|capability/i);

const staleSnapshot = { ...snapshot, capturedAt: new Date(base - 16 * 60_000).toISOString() };
sessionStorage.setItem(storageKey, JSON.stringify(staleSnapshot));
api.refresh();
card = nodes.get("offlineJourney0111");
assert.match(card.innerHTML, /Saved realtime details are more than 15 minutes old/);
assert.match(card.innerHTML, /Stale last-known cancellation/);
assert.match(card.innerHTML, /platform changed A → C/);
assert.match(card.innerHTML, /Replacement buses may operate/);
assert.match(card.innerHTML, /Tram 4 to Krebsförden/, "stale realtime context must not discard the still-useful timetable fallback");
assert.doesNotMatch(card.innerHTML, /Cancelled when last online/, "aged cancellation state must not retain fresh-looking wording");

sessionStorage.removeItem(storageKey);
api.refresh();
card = nodes.get("offlineJourney0111");
assert.ok(card, "an offline personal link without a saved route should explain the limitation instead of failing silently");
assert.match(card.innerHTML, /No saved journey is available in this tab/);
assert.match(card.innerHTML, /Reconnect while this personal route is open/);
assert.match(card.innerHTML, /does not persist personal route fallbacks beyond this tab/);
assert.doesNotMatch(card.innerHTML, /Marienplatz|Krebsförden|Replacement buses/, "the no-snapshot state must not leak stale route details from the previous render");

navigator.onLine = true;
api.refresh();
assert.equal(nodes.has("offlineJourney0111"), false, "offline fallback should disappear immediately when normal online rendering resumes");

console.log("offline-journey-render: executable mobile fallback hides completed legs, distinguishes fresh vs historical realtime facts, and clearly explains when no tab-scoped route is saved");
