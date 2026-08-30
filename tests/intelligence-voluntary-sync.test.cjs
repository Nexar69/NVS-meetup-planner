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
let tripDialogCloseCount = 0;
const tripDialog = {
  open: true,
  close() { this.open = false; tripDialogCloseCount += 1; },
  querySelector(selector) {
    return {
      "#v011TripPill": tripPill,
      "#v011TripAction": tripAction,
      "#v011TripDetail": tripDetail,
      "#v011TripNext": nextBox,
    }[selector] || null;
  },
};
let commandCenterVisible = true;
const commandCenter = {
  classList: {
    remove(name) { if (name === "visible") commandCenterVisible = false; },
  },
};

const listeners = new Map();
const timers = [];
const clearedTimers = [];
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
  addEventListener(name, handler) { listeners.set(name, handler); },
};

const document = {
  hidden: true,
  body: null,
  addEventListener(name, handler) { listeners.set(`document:${name}`, handler); },
  getElementById(id) {
    return { v011CurrentAction: currentAction, v011TripDialog: tripDialog, v011CommandCenter: commandCenter }[id] || null;
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
  setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
  clearTimeout(id) { clearedTimers.push(id); },
});

const api = window.NVSIntelligenceVoluntarySync0111;
assert.ok(api, "voluntary intelligence sync should expose a small testable API");
assert.equal(typeof api.modelForEntry, "function");
assert.equal(typeof api.sync, "function");
assert.equal(typeof api.freshEntry, "function");
assert.equal(typeof api.schedule, "function");
assert.equal(typeof api.clearRecommendationSurfaces, "function");

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
assert.match(currentAction.innerHTML, /You&#039;re on Tram 2/);
assert.equal(tripPill.textContent, "CONFIRMED");
assert.match(tripDetail.textContent, /Confirmed on board/);

liveEntry = { status: "at-stop", at: now - 10_000 };
assert.equal(api.sync(now), true);
assert.match(currentAction.innerHTML, /You&#039;re at a stop/);
assert.doesNotMatch(currentAction.innerHTML, /Timetable says riding/, "fresh at-stop status must replace contradictory timetable current-action copy");

liveEntry = { status: "missed", at: now - 16 * 60_000 };
assert.equal(api.freshEntry(now), null, "stale voluntary status must stop outranking timetable intelligence");
assert.equal(api.sync(now), false, "stale status should leave the underlying timetable render in control");

liveEntry = { status: "left", at: now - 5_000 };
assert.equal(api.freshEntry(now), null, "non-contradictory left status should not unnecessarily replace route guidance");

const fallback = api.modelForEntry({}, { status: "missed" }, now);
assert.match(fallback.title, /missed connection/);
assert.match(fallback.nextTitle, /Recover this journey/);

assert.ok(listeners.has("nvs-shared-live-change"), "shared-live changes should schedule reconciliation");
assert.ok(listeners.has("nvs-group-recommendations-rendered"), "fresh route renders should schedule reconciliation");
assert.ok(listeners.has("nvs-live-plan-synced"), "live plan synchronization should schedule reconciliation");
assert.ok(listeners.has("nvs-shared-view-resumed"), "Safari shared-view resume should schedule reconciliation");
assert.ok(listeners.has("nvs-recommendations-cleared"), "empty recommendation transitions should synchronously clear command-center surfaces");
assert.ok(listeners.has("pageshow"), "bfcache restores should schedule reconciliation");

const initialTimerCount = timers.length;
document.hidden = false;
listeners.get("nvs-shared-live-change")();
assert.equal(timers.length, initialTimerCount + 1, "a visible shared-live event should schedule exactly one reconciliation");
assert.equal(timers.at(-1).delay, 60, "reconciliation should settle after the base intelligence render debounce");
const firstScheduledId = timers.length;
listeners.get("nvs-group-recommendations-rendered")();
assert.equal(timers.at(-1).delay, 60, "a newer route event should schedule a fresh settle window");
assert.ok(clearedTimers.includes(firstScheduledId), "a newer event should cancel the obsolete pending reconciliation timer");
const clearPendingId = timers.length;
listeners.get("nvs-recommendations-cleared")();
assert.equal(commandCenterVisible, false, "clearing recommendations should immediately hide the stale Journey Command Center");
assert.equal(tripDialog.open, false, "clearing recommendations should immediately close stale Trip Mode");
assert.equal(tripDialogCloseCount, 1, "the open Trip Mode dialog should be closed exactly once");
assert.ok(clearedTimers.includes(clearPendingId), "clearing recommendations should cancel pending voluntary reconciliation work");
listeners.get("nvs-recommendations-cleared")();
assert.equal(tripDialogCloseCount, 1, "repeated clear events should remain idempotent once Trip Mode is closed");

const beforeEmptyResume = timers.length;
listeners.get("pageshow")();
assert.equal(timers.length, beforeEmptyResume, "bfcache resume must not restart voluntary intelligence work while recommendations are empty");
listeners.get("nvs-shared-view-resumed")();
assert.equal(timers.length, beforeEmptyResume, "shared-view resume must remain inert while recommendations are empty");
listeners.get("nvs-group-recommendations-rendered")();
assert.equal(timers.length, beforeEmptyResume + 1, "fresh authoritative recommendations should re-arm reconciliation after an empty state");
assert.equal(timers.at(-1).delay, 60, "fresh recommendation rehydration should settle before periodic reconciliation restarts");
timers.at(-1).callback();
assert.equal(timers.at(-1).delay, 30_000, "settled fresh recommendations should restart the relaxed periodic safety reconciliation");

const beforeHiddenEvent = timers.length;
document.hidden = true;
listeners.get("nvs-live-plan-synced")();
assert.equal(timers.length, beforeHiddenEvent, "hidden pages should not arm reconciliation work");

assert.match(release, /intelligence-voluntary-sync-v0111\.js/, "release loader must include voluntary intelligence synchronization");
assert.match(serviceWorker, /^const CACHE_NAME = "meet-schwerin-v0\.11\.1-r20";/, "PWA shell should use the current validated cache identity");
assert.match(serviceWorker, /intelligence-voluntary-sync-v0111\.js/, "runtime must remain available to installed/offline PWA copies");
assert.match(serviceWorker, /test-lab-v0111\.js/, "hardened Test Lab should remain available in the current PWA shell");
assert.match(serviceWorker, /test-lab-journey-v0111\.js/, "journey simulation should remain available in the current offline Test Lab shell");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "status precedence must not introduce location tracking");
assert.match(source, /15 \* 60_000/, "fallback freshness must preserve the 15-minute policy");
assert.match(source, /document\.hidden/, "periodic reconciliation should pause while hidden");
assert.match(source, /recommendationsActive/, "periodic reconciliation should also pause while authoritative recommendation state is empty");
assert.match(source, /clearPeriodicSync/, "recommendation clearing should explicitly cancel the relaxed periodic safety timer");
assert.match(source, /const SYNC_MS = 30_000/, "periodic safety reconciliation should remain relaxed");
assert.match(source, /const SETTLE_MS = 60/, "event-driven reconciliation should settle after the base intelligence renderer's short debounce");
assert.match(source, /cancelScheduledSync/, "new events should replace obsolete pending reconciliations rather than stacking timers");
assert.match(source, /clearRecommendationSurfaces/, "empty recommendation transitions should have an explicit command-center teardown path");
assert.doesNotMatch(source, /MutationObserver/, "voluntary intelligence reconciliation should no longer observe DOM mutations");
assert.doesNotMatch(source, /observer\.observe/, "the removed DOM observer must not quietly return");

console.log("intelligence-voluntary-sync: voluntary state, empty-state scheduling and command-center lifecycle stay authoritative without GPS or DOM observation on r20");
