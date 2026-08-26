const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../stop-awareness-v0111.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../stop-awareness-v0111.css"), "utf8");
const release = fs.readFileSync(path.resolve(__dirname, "../release-v011.js"), "utf8");
const sw = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

const window = {
  NVSShare: { getSharedPlan: () => null, getFocusIndex: () => -1 },
  addEventListener() {},
};
const document = {
  hidden: true,
  addEventListener() {},
  getElementById() { return null; },
};
class MutationObserver {
  observe() {}
  disconnect() {}
}

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
  setTimeout,
  clearTimeout,
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

assert.match(source, /BLOCKING_VOLUNTARY/);
assert.match(source, /at-stop/, "stop awareness should explicitly respect at-stop voluntary state");
assert.match(source, /15 \* 60_000/, "stop awareness should share the 15-minute voluntary freshness fallback");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "stop awareness must stay timetable-only");
assert.match(css, /v0111-stop-awareness/);
assert.match(release, /stop-awareness-v0111\.js/);
assert.match(release, /stop-awareness-v0111\.css/);
assert.match(sw, /stop-awareness-v0111\.js/);
assert.match(sw, /stop-awareness-v0111\.css/);

console.log("stop-awareness: timetable-only next-stop guidance and voluntary-state precedence passed");
