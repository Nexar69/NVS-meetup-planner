const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../offline-journey-v0111.js"), "utf8");
const saved = new Map();
const nodes = new Map();
const listeners = {};
const documentListeners = {};
const timers = new Map();
let nextTimer = 1;
const base = Date.now();

function setTimeoutMock(fn, delay) {
  const id = nextTimer++;
  timers.set(id, { fn, delay: Number(delay) });
  return id;
}
function clearTimeoutMock(id) {
  timers.delete(id);
}

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
  setTimeout: setTimeoutMock,
  clearTimeout: clearTimeoutMock,
});

const api = window.NVSOfflineJourney0111;
assert.equal(typeof api.captureAndRender, "function");
assert.equal(typeof api.resumeRender, "function");
const storageKey = "meet-schwerin-offline-journey-v1";
const snapshot = api.buildSnapshot(routeAssignment, new Date(base));
sessionStorage.setItem(storageKey, JSON.stringify(snapshot));

routeAssignment.route.segments[1].line = "5";
const beforeLifecycleResume = sessionStorage.getItem(storageKey);
listeners.online?.();
listeners.pageshow?.();
listeners["nvs-shared-view-resumed"]?.();
listeners["nvs-live-plan-synced"]?.();
assert.equal(sessionStorage.getItem(storageKey), beforeLifecycleResume, "generic reconnect/resume events must not re-capture cached route data or renew its realtime trust timestamp");
listeners["nvs-group-recommendations-rendered"]?.();
const afterFreshRecommendation = JSON.parse(sessionStorage.getItem(storageKey));
assert.equal(afterFreshRecommendation.segments[1].line, "5", "a fresh authoritative recommendation render should replace the offline snapshot with the newly rendered route");
routeAssignment.route.segments[1].line = "4";
sessionStorage.setItem(storageKey, JSON.stringify(snapshot));

navigator.onLine = false;
sharedPlan = null;
focus = -1;
api.resumeRender();

let card = nodes.get("offlineJourney0111");
assert.ok(card, "offline personal viewer should render its tab-scoped saved route when the live plan is unavailable");
assert.equal(card.attributes.get("data-connection"), "offline");
assert.doesNotMatch(card.innerHTML, /OLD|Old stop|Already passed/, "clearly completed route legs should not clutter the offline mobile card");
assert.match(card.innerHTML, /Tram 4 to Krebsförden/);
assert.match(card.innerHTML, /platform C/);
assert.match(card.innerHTML, /platform changed A → C/);
assert.match(card.innerHTML, /Cancelled when last online/);
assert.match(card.innerHTML, /Replacement buses may operate/);
assert.match(card.innerHTML, /At least one remaining saved leg was already cancelled/);
assert.match(card.innerHTML, /Completed legs are hidden when possible/);
assert.match(card.innerHTML, /Authoritative shared-session expiry is honored/);
assert.doesNotMatch(card.innerHTML, /secret|planId|capability/i);
assert.equal(timers.size, 1, "a fresh offline snapshot should arm exactly one next-boundary rerender");
const firstTimer = [...timers.values()][0];
assert.ok(firstTimer.delay > 0 && firstTimer.delay <= 15 * 60_000 + 100, "fresh snapshots should first wake at the 15-minute realtime trust boundary");

document.hidden = true;
documentListeners.visibilitychange?.();
assert.equal(timers.size, 0, "hidden pages should cancel the offline boundary timer");
document.hidden = false;
documentListeners.visibilitychange?.();
assert.equal(timers.size, 1, "returning to a visible offline card should re-arm only the next meaningful boundary");

const staleSnapshot = { ...snapshot, capturedAt: new Date(base - 16 * 60_000).toISOString() };
sessionStorage.setItem(storageKey, JSON.stringify(staleSnapshot));
api.resumeRender();
card = nodes.get("offlineJourney0111");
assert.equal(timers.size, 1, "stale realtime context should retain one timer for authoritative session expiry instead of polling");
const expiryTimer = [...timers.values()][0];
assert.ok(expiryTimer.delay > 45 * 60_000 && expiryTimer.delay <= 61 * 60_000, "after realtime data is stale, the next wake should be the known session-expiry boundary");
assert.match(card.innerHTML, /Saved realtime details are more than 15 minutes old/);
assert.match(card.innerHTML, /Stale last-known cancellation/);
assert.match(card.innerHTML, /last-known platform C/);
assert.match(card.innerHTML, /platform changed A → C/);
assert.match(card.innerHTML, /Replacement buses may operate/);
assert.match(card.innerHTML, /Tram 4 to Krebsförden/, "stale realtime context must not discard the still-useful timetable fallback");
assert.doesNotMatch(card.innerHTML, /Cancelled when last online/, "aged cancellation state must not retain fresh-looking wording");

sessionStorage.removeItem(storageKey);
api.resumeRender();
card = nodes.get("offlineJourney0111");
assert.ok(card, "an offline personal link without a saved route should explain the limitation instead of failing silently");
assert.equal(timers.size, 0, "the no-snapshot state should leave no boundary timer armed");
assert.match(card.innerHTML, /No saved journey is available in this tab/);
assert.match(card.innerHTML, /Reconnect while this personal route is open/);
assert.match(card.innerHTML, /does not persist personal route fallbacks beyond this tab/);
assert.doesNotMatch(card.innerHTML, /Marienplatz|Krebsförden|Replacement buses/, "the no-snapshot state must not leak stale route details from the previous render");

sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
navigator.onLine = true;
api.resumeRender();
card = nodes.get("offlineJourney0111");
assert.ok(card, "navigator.onLine alone must not erase the saved journey before live route data is actually usable");
assert.equal(card.attributes.get("data-connection"), "reconnecting");
assert.match(card.innerHTML, /RECONNECTING · SAVED FALLBACK/);
assert.match(card.innerHTML, /Keeping your saved journey until live data returns/);
assert.match(card.innerHTML, /At least one remaining saved leg was already cancelled/, "higher-priority saved disruption warnings should remain visible while reconnecting");
assert.match(card.innerHTML, /Tram 4 to Krebsförden/);
assert.equal(timers.size, 1, "a reconnecting fallback should keep its one-shot freshness\/expiry boundary timer active");

sharedPlan = { view: "person" };
focus = 0;
api.resumeRender();
assert.equal(timers.size, 0, "restored live-route rendering should cancel the saved-fallback boundary timer");
assert.equal(nodes.has("offlineJourney0111"), false, "saved fallback should disappear only after usable live personal route data has returned");
assert.doesNotMatch(source, /setInterval\s*\(/, "offline lifecycle should use one-shot boundary timers, never background polling");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "saved journey continuity must not add location tracking");

console.log("offline-journey-render: generic lifecycle resumes cannot re-age cached realtime facts; fresh recommendations may replace the tab-scoped fallback, which still preserves disruption priority, expiry, privacy and mobile cleanup");