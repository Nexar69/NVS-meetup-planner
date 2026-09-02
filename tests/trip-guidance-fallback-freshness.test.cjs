const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../trip-guidance-v0111.js"), "utf8");
let entry = null;
const window = {
  NVSShare: {
    getSharedPlan: () => ({ view: "person" }),
    getFocusIndex: () => 0,
  },
  NVSSharedLive: {
    getState: () => ({ members: entry ? { "0": entry } : {} }),
  },
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

const freshVoluntaryEntry = window.NVSTripGuidance0111?.freshVoluntaryEntry;
assert.equal(typeof freshVoluntaryEntry, "function", "trip guidance should expose its fallback freshness helper for regression testing");

const now = Date.UTC(2026, 7, 30, 2, 30, 0);
entry = { status: "on-vehicle", at: now - 15 * 60_000 };
assert.equal(freshVoluntaryEntry(now)?.status, "on-vehicle", "15-minute-old check-ins should remain fresh at the boundary");

entry = { status: "on-vehicle", at: now - 15 * 60_000 - 1 };
assert.equal(freshVoluntaryEntry(now), null, "older check-ins must fall back to timetable guidance");

entry = { status: "at-stop", at: now + 5 * 60_000 };
assert.equal(freshVoluntaryEntry(now)?.status, "at-stop", "up to five minutes of clock skew should remain tolerated when the core helper is unavailable");

entry = { status: "missed", at: now + 5 * 60_000 + 1 };
assert.equal(freshVoluntaryEntry(now), null, "impossible future check-ins must never override timetable guidance through the fallback path");

entry = { status: "arrived", at: "not-a-timestamp" };
assert.equal(freshVoluntaryEntry(now), null, "malformed timestamps must not be treated as fresh");

assert.match(source, /age < -5 \* 60_000/, "fallback must enforce the same future-skew boundary as the intelligence core");
assert.match(source, /age > 15 \* 60_000/, "fallback must retain the 15-minute stale boundary");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "freshness hardening must not introduce location tracking");

console.log("trip-guidance-fallback-freshness: stale and impossible-future voluntary check-ins cannot override timetable guidance when the core helper is unavailable");
