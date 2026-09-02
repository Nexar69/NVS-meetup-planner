const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../trip-guidance-v0111.js"), "utf8");
const window = { NVSShare: { getSharedPlan: () => null, getFocusIndex: () => -1 }, addEventListener() {} };
const document = { hidden: true, body: {}, addEventListener() {}, getElementById() { return null; } };
class MutationObserver { observe() {} }
vm.runInNewContext(source, { window, document, MutationObserver, Intl, Date, Math, Number, String, Boolean, Array, Object, setTimeout, clearTimeout });
const guidanceForRoute = window.NVSTripGuidance0111.guidanceForRoute;
const at = (minute) => new Date(Date.UTC(2026, 7, 25, 8, minute, 0));

const tight = guidanceForRoute({ segments: [
  { mode: "TRAM", modeLabel: "Tram", line: "2", from: "A", to: "Transferplatz", departure: at(0), arrival: at(15) },
  { mode: "TRAM", modeLabel: "Tram", line: "3", from: "Transferplatz", to: "Meetup", departure: at(18), arrival: at(30) },
] }, at(10).getTime());
assert.match(tight.detail, /planned transfer window is about 3 min/i, "tight transfers should be surfaced before the rider reaches the stop");
assert.match(tight.detail, /be ready to change/i);

const comfortable = guidanceForRoute({ segments: [
  { mode: "TRAM", modeLabel: "Tram", line: "2", from: "A", to: "Transferplatz", departure: at(0), arrival: at(15) },
  { mode: "TRAM", modeLabel: "Tram", line: "3", from: "Transferplatz", to: "Meetup", departure: at(25), arrival: at(35) },
] }, at(10).getTime());
assert.doesNotMatch(comfortable.detail, /transfer window/i, "comfortable transfers should not add unnecessary urgency");

const completed = guidanceForRoute({ segments: [
  { mode: "TRAM", modeLabel: "Tram", line: "2", from: "A", to: "Meetup", departure: at(0), arrival: at(10) },
] }, at(20).getTime());
assert.equal(completed.eyebrow, "Planned journey complete");
assert.match(completed.title, /should have reached/i, "completion copy must not claim actual arrival without location evidence");
assert.match(completed.detail, /based on the timetable, not your location/i);
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i);

console.log("trip-guidance-transfer-window: tight-transfer warning and timetable-only completion semantics passed");
