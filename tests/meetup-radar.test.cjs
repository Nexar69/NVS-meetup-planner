const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../meetup-radar-v0111.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../meetup-radar-v0111.css"), "utf8");
const release = fs.readFileSync(path.resolve(__dirname, "../release-v011.js"), "utf8");
const sw = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

const window = {
  NVSIntelligenceCore: {
    checkinFreshness(entry, at) {
      const age = at.getTime() - Number(entry.at);
      return { fresh: age >= 0 && age <= 15 * 60_000 };
    },
  },
  addEventListener() {},
};
const document = {
  hidden: true,
  addEventListener() {},
  getElementById() { return null; },
};

vm.runInNewContext(source, {
  window,
  document,
  Date,
  Intl,
  Number,
  String,
  Boolean,
  Object,
  Array,
  Math,
  Set,
  Map,
  setTimeout: () => 0,
  clearTimeout() {},
});

const radarModel = window.NVSMeetupRadar0111?.radarModel;
assert.equal(typeof radarModel, "function", "Meetup Radar should expose its pure coordination model");

const now = Date.UTC(2026, 7, 25, 18, 0, 0);
const at = (minutes) => new Date(now + minutes * 60_000);
const group = {
  destination: "Gymnasium Neumühler Schule",
  assignments: [
    { member: { id: "a", name: "A" }, route: { arrival: at(20), segments: [] } },
    { member: { id: "b", name: "B" }, route: { arrival: at(24), segments: [] } },
    { member: { id: "c", name: "C" }, route: { arrival: at(26), segments: [] } },
  ],
};
const joinAnalysis = {
  events: [
    { kind: "join", title: "B joins A", label: "Marienplatz", time: at(6), memberIds: ["a", "b"] },
    { kind: "everyone", final: true, title: "Everyone together", label: "Gymnasium Neumühler Schule", time: at(26), memberIds: ["a", "b", "c"] },
  ],
};

const normal = radarModel(group, { members: {} }, joinAnalysis, now);
assert.equal(normal.eyebrow, "Meetup radar · next join");
assert.match(normal.title, /B joins A in about 6 min/);
assert.match(normal.detail, /Marienplatz/);
assert.match(normal.detail, /2\/3 people planned there/);
assert.match(normal.meta, /timetable estimates active/);
assert.match(normal.meta, /planned arrival spread 6 min/);

const urgentJoin = radarModel(group, { members: {} }, { events: [{ ...joinAnalysis.events[0], time: at(4) }] }, now);
assert.equal(urgentJoin.tone, "action", "a join within five minutes should be visually action-oriented without claiming emergency");

const finalOnly = radarModel(group, { members: {} }, { events: [joinAnalysis.events[1]] }, now);
assert.equal(finalOnly.eyebrow, "Meetup radar · final convergence");
assert.match(finalOnly.title, /Everyone expected together in about 26 min/);
assert.match(finalOnly.detail, /not live location tracking/);

const missed = radarModel(group, {
  members: {
    "0": { status: "on-vehicle", at: now - 30_000 },
    "1": { status: "missed", at: now - 10_000 },
  },
}, joinAnalysis, now);
assert.equal(missed.tone, "warn");
assert.match(missed.title, /1 person reported a missed connection/);
assert.match(missed.detail, /Recovery should take priority/);
assert.match(missed.meta, /2\/3 recent voluntary updates/);
assert.doesNotMatch(missed.title + missed.detail, /B joins A/, "fresh missed state must override optimistic convergence copy");

const staleMissed = radarModel(group, {
  members: { "1": { status: "missed", at: now - 16 * 60_000 } },
}, joinAnalysis, now);
assert.equal(staleMissed.eyebrow, "Meetup radar · next join", "stale voluntary state must fall back to timetable convergence");
assert.match(staleMissed.meta, /timetable estimates active/);

const allArrived = radarModel(group, {
  members: {
    "0": { status: "arrived", at: now - 10_000 },
    "1": { status: "arrived", at: now - 20_000 },
    "2": { status: "arrived", at: now - 30_000 },
  },
}, joinAnalysis, now);
assert.equal(allArrived.tone, "good");
assert.match(allArrived.title, /Everyone has checked in at the meetup/);
assert.match(allArrived.detail, /fresh voluntary arrival confirmations/);

assert.equal(radarModel({ assignments: [group.assignments[0]] }, null, null, now), null, "radar should stay hidden for a one-person journey");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "Meetup Radar must not introduce location tracking");
assert.match(source, /15 \* 60_000/, "Radar must retain the shared 15-minute voluntary freshness fallback");
assert.match(source, /document\.hidden/, "Radar periodic work should suspend while hidden");
assert.match(source, /nvs-shared-view-resumed/, "Safari shared-view resume should refresh the Radar");
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /forced-colors/);
assert.match(release, /meetup-radar-v0111\.js/, "release owner must load Meetup Radar runtime");
assert.match(release, /meetup-radar-v0111\.css/, "release owner must load Meetup Radar styles");
assert.match(sw, /meetup-radar-v0111\.js/, "Meetup Radar runtime should be available offline");
assert.match(sw, /meetup-radar-v0111\.css/, "Meetup Radar styles should be available offline");

console.log("meetup-radar: convergence, recovery precedence, stale fallback, accessibility and no-GPS behavior passed");
