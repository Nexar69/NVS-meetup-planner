const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../intelligence-voluntary-sync-v0111.js"), "utf8");
const release = fs.readFileSync(path.resolve(__dirname, "../release-v011.js"), "utf8");
const serviceWorker = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

let now = Date.UTC(2026, 7, 25, 14, 30, 0);
let liveEntry = { status: "missed", at: now - 60_000 };

const currentAction = { innerHTML: "" };
const nextBox = { innerHTML: "" };
const tripPill = { textContent: "LIVE" };
const tripAction = { textContent: "Timetable says riding" };
const tripDetail = { textContent: "Old timetable detail" };
const tripDialog = {
  querySelector(selector) {
    return {
      "#v011TripPill": tripPill,
      "#v011TripAction": tripAction,
      "#v011TripDetail": tripDetail,
      "#v011TripNext": nextBox,
    }[selector] || null;
  },
};

const window = {
  NVSShare: { getFocusIndex: () => 0 },
  NVSSharedLive: { getState: () => ({ members: { "0": liveEntry } }) },
  NVSIntelligenceCore: {
    checkinFreshness(entry, at) {
      const age = at.getTime() - Number(entry.at);
      return { fresh: age >= 0 && age <= 15 * 60_000 };
    },
  },
  NVSTripGuidance0111: {
    guidanceForRoute(route, at, entry) {
      if (entry.status === "missed") return { title: "You reported a missed connection", detail: "Use Recovery Desk for a fresh route." };
      if (entry.status === "arrived") return { title: "You're at the meetup", detail: "Your voluntary arrival check-in is current." };
      if (entry.status === "on-vehicle") return { title: "You're on Tram 2", detail: "Confirmed on board; Stauffenbergstraße is coming up." };
      if (entry.status === "at-stop") return { title: "You're at a stop", detail: "Your check-in outranks contradictory timetable riding state." };
      return null;
    },
  },
  __NVS_LAST_RECOMMENDATIONS__: {
    primary: {
      assignments: [{ member: { name: "You" }, route: { segments: [{ mode: "TRAM", line: "2" }] } }],
    },
  },
  addEventListener() {},
};

const document = {
  hidden: true,
  body: null,
  addEventListener() {},
  getElementById(id) {
    return { v011CurrentAction: currentAction, v011TripDialog: tripDialog }[id] || null;
  },
};

vm.runInNewContext(source, {
  window,
  document,
  Date,
  Number,
  String,
  Boolean,
  Object,
  Set,
  Math,
  setTimeout: () => 0,
  clearTimeout() {},
});

const api = window.NVSIntelligenceVoluntarySync0111;
assert.ok(api, "voluntary intelligence sync should expose a small testable API");
assert.equal(typeof api.modelForEntry, "function");
assert.equal(typeof api.sync, "function");
assert.equal(typeof api.freshEntry, "function");

assert.equal(api.freshEntry(now)?.status, "missed", "fresh voluntary status should be accepted");
assert.equal(api.sync(now), true, "fresh override should update command and Trip Mode surfaces");
assert.match(currentAction.innerHTML, /NOW · VOLUNTARY/);
assert.match(currentAction.innerHTML, /missed connection/);
assert.equal(tripPill.textContent, "RECOVERY");
assert.match(tripAction.textContent, /missed connection/);
assert.match(tripDetail.textContent, /Recovery Desk/);
assert.match(nextBox.innerHTML, /Recover this journey/);
assert.doesNotMatch(currentAction.innerHTML, /Timetable says riding/, "fresh missed status must not be contradicted by timetable current-action copy");

liveEntry = { status: "arrived", at: now - 20_000 };
assert.equal(api.sync(now), true);
assert.equal(tripPill.textContent, "CONFIRMED");
assert.match(currentAction.innerHTML, /at the meetup/);
assert.match(nextBox.innerHTML, /Meetup confirmed by you/);

liveEntry = { status: "on-vehicle", at: now - 10_000 };
assert.equal(api.sync(now), true);
assert.match(currentAction.innerHTML, /You're on Tram 2/);
assert.equal(tripPill.textContent, "CONFIRMED");
assert.match(tripDetail.textContent, /Confirmed on board/);

liveEntry = { status: "at-stop", at: now - 10_000 };
assert.equal(api.sync(now), true);
assert.match(currentAction.innerHTML, /You're at a stop/);
assert.doesNotMatch(currentAction.innerHTML, /Timetable says riding/, "fresh at-stop status must replace contradictory timetable current-action copy");

liveEntry = { status: "missed", at: now - 16 * 60_000 };
assert.equal(api.freshEntry(now), null, "stale voluntary status must stop outranking timetable intelligence");
assert.equal(api.sync(now), false, "stale status should leave the underlying timetable render in control");

liveEntry = { status: "left", at: now - 5_000 };
assert.equal(api.freshEntry(now), null, "non-contradictory left status should not unnecessarily replace route guidance");

const fallback = api.modelForEntry({}, { status: "missed" }, now);
assert.match(fallback.title, /missed connection/);
assert.match(fallback.nextTitle, /Recover this journey/);

assert.match(release, /intelligence-voluntary-sync-v0111\.js/, "release loader must include voluntary intelligence synchronization");
assert.match(serviceWorker, /meet-schwerin-v0\.11\.1-r12/, "PWA shell should be refreshed for the new runtime layer");
assert.match(serviceWorker, /intelligence-voluntary-sync-v0111\.js/, "new runtime must be available to installed/offline PWA copies");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "status precedence must not introduce location tracking");
assert.match(source, /15 \* 60_000/, "fallback freshness must preserve the 15-minute policy");
assert.match(source, /document\.hidden/, "periodic reconciliation should pause while hidden");

console.log("intelligence-voluntary-sync: command center and Trip Mode respect fresh voluntary status without GPS");
