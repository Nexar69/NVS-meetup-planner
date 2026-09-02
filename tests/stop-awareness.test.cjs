const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../stop-awareness-v0111.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../stop-awareness-v0111.css"), "utf8");
const release = fs.readFileSync(path.resolve(__dirname, "../release-v011.js"), "utf8");
const sw = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

const listeners = new Map();
const documentListeners = new Map();
const timers = new Map();
let nextTimer = 1;
let stopRow = null;
let observerCallback = null;
let observerDisconnects = 0;
const personalSharedPlan = {};

function fakeSetTimeout(callback, delay) {
  const id = nextTimer++;
  timers.set(id, { callback, delay });
  return id;
}
function fakeClearTimeout(id) {
  timers.delete(id);
}

const window = {
  NVSShare: { getSharedPlan: () => null, getFocusIndex: () => -1 },
  addEventListener(name, handler) { listeners.set(name, handler); },
};
const document = {
  hidden: true,
  addEventListener(name, handler) { documentListeners.set(name, handler); },
  getElementById(id) {
    if (id === "v0111StopAwareness") return stopRow;
    if (id === "personalSharedPlan") return personalSharedPlan;
    return null;
  },
};
class MutationObserver {
  constructor(callback) { observerCallback = callback; }
  observe() {}
  disconnect() { observerDisconnects += 1; }
}
window.MutationObserver = MutationObserver;

vm.runInNewContext(source, {
  window,
  document,
  MutationObserver,
  Date,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Object,
  Set,
  setTimeout: fakeSetTimeout,
  clearTimeout: fakeClearTimeout,
});

const api = window.NVSStopAwareness0111;
assert.equal(typeof api?.stopAwarenessForSegment, "function");
assert.equal(typeof api?.modelForRoute, "function");
assert.equal(typeof api?.blockingVoluntaryState, "function");

const at = (minute) => new Date(Date.UTC(2026, 7, 25, 8, minute, 0));
const segment = {
  mode: "TRAM",
  from: "Marienplatz",
  to: "Krebsförden",
  departure: at(0),
  arrival: at(20),
  intermediateStops: [
    { name: "Platz der Jugend", arrival: at(12) },
    { name: "Gartenstadt", arrival: at(15) },
    { name: "Stauffenbergstraße", arrival: at(18) },
  ],
};

const early = api.stopAwarenessForSegment(segment, at(10).getTime());
assert.equal(early.nextStop, "Platz der Jugend");
assert.equal(early.nextMinutes, 2);
assert.equal(early.stopsUntilExit, 4);
assert.equal(early.destination, "Krebsförden");
assert.match(early.title, /Next expected: Platz der Jugend/);
assert.match(early.detail, /4 stops until Krebsförden/);
assert.match(early.detail, /Timetable estimate/);

const later = api.stopAwarenessForSegment(segment, at(16).getTime());
assert.equal(later.nextStop, "Stauffenbergstraße");
assert.equal(later.stopsUntilExit, 2);
assert.equal(later.urgency, "soon");

const afterLastIntermediate = api.stopAwarenessForSegment(segment, at(19).getTime());
assert.equal(afterLastIntermediate, null, "existing get-off guidance should own the final-stop-only case");

const walk = api.stopAwarenessForSegment({ ...segment, mode: "WALK" }, at(10).getTime());
assert.equal(walk, null, "stop awareness should not invent vehicle stops for walking legs");

const routeModel = api.modelForRoute({ segments: [segment] }, at(10).getTime());
assert.equal(routeModel.nextStop, "Platz der Jugend");

window.NVSShare.getFocusIndex = () => 0;
let liveEntry = { status: "at-stop", at: at(10).getTime() };
window.NVSSharedLive = { getState: () => ({ members: { "0": liveEntry } }) };
assert.equal(api.blockingVoluntaryState(at(10).getTime()), "at-stop", "an explicit at-stop report must suppress onboard-only stop progression");
liveEntry = { status: "missed", at: at(10).getTime() };
assert.equal(api.blockingVoluntaryState(at(10).getTime()), "missed", "a missed-service report must suppress obsolete onboard stop progression");
liveEntry = { status: "arrived", at: at(10).getTime() };
assert.equal(api.blockingVoluntaryState(at(10).getTime()), "arrived", "confirmed arrival must suppress obsolete stop progression");
liveEntry = { status: "on-vehicle", at: at(10).getTime() };
assert.equal(api.blockingVoluntaryState(at(10).getTime()), null, "an on-board confirmation should keep useful intermediate-stop awareness");
liveEntry = { status: "at-stop", at: at(10).getTime() };
assert.equal(api.blockingVoluntaryState(at(26).getTime()), null, "stale at-stop reports should stop suppressing timetable stop awareness");

// Partial-shell fallback must preserve the central timestamp-trust boundary.
window.NVSIntelligenceCore = null;
const fallbackNow = at(10).getTime();
liveEntry = { status: "at-stop", at: fallbackNow + 5 * 60_000 };
assert.equal(api.blockingVoluntaryState(fallbackNow), "at-stop", "fallback should tolerate up to five minutes of ordinary device-clock skew");
liveEntry = { status: "at-stop", at: fallbackNow + 5 * 60_000 + 1 };
assert.equal(api.blockingVoluntaryState(fallbackNow), null, "fallback must reject check-ins beyond the future-skew trust boundary");
liveEntry = { status: "at-stop", at: fallbackNow - 15 * 60_000 };
assert.equal(api.blockingVoluntaryState(fallbackNow), "at-stop", "exactly 15 minutes old remains fresh at the fallback boundary");
liveEntry = { status: "at-stop", at: fallbackNow - 15 * 60_000 - 1 };
assert.equal(api.blockingVoluntaryState(fallbackNow), null, "older fallback reports must stop suppressing timetable guidance");
liveEntry = { status: "at-stop", at: "not-a-time" };
assert.equal(api.blockingVoluntaryState(fallbackNow), null, "malformed fallback timestamps must never become authoritative");

// Lifecycle: only an authoritative recommendation render may activate periodic/observer work.
let removed = false;
window.NVSShare.getSharedPlan = () => ({ id: "shared" });
document.hidden = false;
window.__NVS_LAST_RECOMMENDATIONS__ = { primary: { assignments: [] } };
assert.equal(typeof listeners.get("nvs-group-recommendations-rendered"), "function");
listeners.get("nvs-group-recommendations-rendered")();
assert.equal(timers.size, 1, "fresh recommendations should arm the Stop Awareness refresh timer");
assert.equal(typeof observerCallback, "function", "fresh recommendations should arm the scoped observer");
observerCallback();
assert.equal(timers.size, 2, "a queued observer render should be separately cancellable");

stopRow = { remove() { removed = true; stopRow = null; } };
assert.equal(typeof listeners.get("nvs-recommendations-cleared"), "function", "Stop Awareness must react immediately when recommendations are cleared");
listeners.get("nvs-recommendations-cleared")();
assert.equal(removed, true, "clearing recommendations must remove stale Stop Awareness immediately");
assert.equal(timers.size, 0, "clearing recommendations must cancel refresh and queued observer work");
const disconnectsAfterClear = observerDisconnects;

listeners.get("pageshow")();
assert.equal(timers.size, 0, "pageshow must not resurrect Stop Awareness while recommendation state is empty");
assert.equal(observerDisconnects, disconnectsAfterClear, "empty-state pageshow must not re-arm observer work");
listeners.get("nvs-shared-view-resumed")();
assert.equal(timers.size, 0, "shared-view resume must remain inert while recommendations are empty");

listeners.get("nvs-group-recommendations-rendered")();
assert.equal(timers.size, 1, "a later authoritative recommendation render should reactivate periodic work");

assert.match(source, /BLOCKING_VOLUNTARY/);
assert.match(source, /at-stop/, "stop awareness should explicitly respect at-stop voluntary state");
assert.match(source, /MAX_FUTURE_SKEW_MS/, "stop awareness fallback must explicitly bound tolerated future clock skew");
assert.match(source, /STALE_AFTER_MS/, "stop awareness should share the 15-minute voluntary freshness fallback");
assert.match(source, /recommendationsActive/, "Stop Awareness should gate lifecycle work on authoritative recommendation state");
assert.match(source, /queuedTimer/, "queued observer renders should be cancellable at the clear boundary");
assert.match(source, /nvs-recommendations-cleared/, "Stop Awareness must consume the empty-recommendation lifecycle");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "stop awareness must stay timetable-only");
assert.match(css, /v0111-stop-awareness/);
assert.match(release, /stop-awareness-v0111\.js/);
assert.match(release, /stop-awareness-v0111\.css/);
assert.match(sw, /stop-awareness-v0111\.js/);
assert.match(sw, /stop-awareness-v0111\.css/);

console.log("stop-awareness: timetable-only next-stop guidance, fallback clock-skew trust, lifecycle teardown/rehydration and voluntary-state precedence passed");