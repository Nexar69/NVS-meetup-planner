const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../trip-guidance-v0111.js"), "utf8");
const window = {
  NVSShare: { getSharedPlan: () => null, getFocusIndex: () => -1 },
  addEventListener() {},
};
const document = {
  hidden: true,
  addEventListener() {},
  getElementById() { return null; },
};
class MutationObserver { observe() {} disconnect() {} }

vm.runInNewContext(source, {
  window,
  document,
  MutationObserver,
  Intl,
  Date,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Object,
  setTimeout,
  clearTimeout,
});

const guidanceForRoute = window.NVSTripGuidance0111.guidanceForRoute;
const time = (hour, minute) => new Date(Date.UTC(2026, 7, 25, hour, minute, 0));
const route = {
  segments: [
    { mode: "WALK", from: "Home", to: "Marienplatz", departure: time(8, 0), arrival: time(8, 5) },
    { mode: "TRAM", modeLabel: "Tram", line: "4", from: "Marienplatz", to: "Krebsförden", departure: time(8, 6), arrival: time(8, 20) },
    { mode: "WALK", from: "Krebsförden", to: "Meetup", departure: time(8, 20), arrival: time(8, 25) },
  ],
};

const replay = [
  { at: time(7, 59), expect: /Walk toward Marienplatz|Coming up/i },
  { at: time(8, 2), expect: /Walking to Marienplatz/i },
  { at: time(8, 7), expect: /Tram 4|On the way/i },
  { at: time(8, 18), expect: /Krebsförden in about 2 min/i },
  { at: time(8, 21), expect: /Walking to Meetup/i },
  { at: time(8, 26), expect: /journey complete|reached the meetup/i },
];

for (const step of replay) {
  const model = guidanceForRoute(route, step.at.getTime());
  const output = `${model?.eyebrow || ""} ${model?.title || ""} ${model?.detail || ""}`;
  assert.match(output, step.expect, `replay state at ${step.at.toISOString()} should match ${step.expect}`);
}

const disruptionMoment = time(8, 18).getTime();
const missed = guidanceForRoute(route, disruptionMoment, { status: "missed" });
assert.match(`${missed.title} ${missed.detail}`, /missed connection/i);
assert.doesNotMatch(`${missed.title} ${missed.detail}`, /Krebsförden in about 2 min/i, "explicit disruption should interrupt the replayed timetable instruction");

const arrivedEarly = guidanceForRoute(route, time(8, 18).getTime(), { status: "arrived" });
assert.match(`${arrivedEarly.title} ${arrivedEarly.detail}`, /at the meetup/i);
assert.doesNotMatch(`${arrivedEarly.title} ${arrivedEarly.detail}`, /get ready to leave/i, "explicit arrival should end active-trip guidance immediately");

console.log("journey-chaos-replay: accelerated journey phases and disruption overrides passed");
