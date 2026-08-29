const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../transfer-watch-v0111.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../transfer-watch-v0111.css"), "utf8");
const release = fs.readFileSync(path.resolve(__dirname, "../release-v011.js"), "utf8");
const sw = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

const listeners = new Map();
const documentListeners = new Map();
const timers = new Map();
let nextTimer = 1;
let transferCard = null;
function fakeSetTimeout(callback, delay) {
  const id = nextTimer++;
  timers.set(id, { callback, delay });
  return id;
}
function fakeClearTimeout(id) {
  timers.delete(id);
}
const window = {
  addEventListener(name, handler) { listeners.set(name, handler); },
  NVSShare: { getFocusIndex: () => -1 },
};
const document = {
  hidden: true,
  addEventListener(name, handler) { documentListeners.set(name, handler); },
  getElementById(id) { return id === "v0111TransferWatch" ? transferCard : null; },
};
vm.runInNewContext(source, { window, document, Date, Math, Number, String, Array, Object, Intl, Set, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout });

const api = window.NVSTransferWatch0111;
assert.equal(typeof api?.transferModel, "function");
assert.equal(typeof api?.transferCandidates, "function");
assert.equal(typeof api?.platformChange, "function");
assert.equal(typeof api?.disruptionSummary, "function");
assert.equal(typeof api?.freshMissed, "function");
assert.equal(typeof api?.blockingVoluntaryState, "function");

const at = (minute) => new Date(Date.UTC(2026, 7, 25, 8, minute, 0));
const route = {
  segments: [
    { mode: "TRAM", modeLabel: "Tram", line: "2", from: "A", to: "Central", departure: at(0), arrival: at(20) },
    { mode: "TRAM", modeLabel: "Tram", line: "3", from: "Central", to: "B", departure: at(23), arrival: at(35), platformFrom: "C" },
  ],
};
const tight = api.transferModel(route, at(5).getTime());
assert.equal(tight.tone, "warn");
assert.equal(tight.gap, 3);
assert.match(tight.title, /3 min transfer at Central/);
assert.match(tight.detail, /Tram 3/);
assert.match(tight.detail, /Platform C/);

const sixMinute = api.transferModel({
  segments: [
    { mode: "BUS", from: "A", to: "X", departure: at(0), arrival: at(20) },
    { mode: "TRAM", line: "1", from: "X", to: "B", departure: at(26), arrival: at(40) },
  ],
}, at(20).getTime());
assert.equal(sixMinute.tone, "info");
assert.equal(sixMinute.gap, 6);
assert.match(sixMinute.detail, /departs in about 6 min/, "nearby connections should expose a calm timetable countdown");

const platformDrift = api.transferModel({
  segments: [
    { mode: "TRAM", line: "2", from: "A", to: "Central", departure: at(0), arrival: at(20) },
    { mode: "TRAM", line: "4", from: "Central", to: "B", departure: at(26), arrival: at(40), plannedPlatformFrom: "A", platformFrom: "C" },
  ],
}, at(20).getTime());
assert.equal(platformDrift.gap, 6);
assert.equal(platformDrift.tone, "warn", "a changed boarding platform should elevate an otherwise watch-only transfer");
assert.equal(platformDrift.platformChanged, true);
assert.match(platformDrift.eyebrow, /platform changed/i);
assert.match(platformDrift.detail, /changed from A to C/i);
assert.match(platformDrift.detail, /live platform signs/i);
assert.deepEqual(api.platformChange({ plannedPlatformFrom: "A", platformFrom: "A" }), null, "matching planned/realtime platforms should stay quiet");

const cancelledNext = api.transferModel({
  segments: [
    { mode: "TRAM", line: "2", from: "A", to: "Central", departure: at(0), arrival: at(20) },
    { mode: "TRAM", line: "4", from: "Central", to: "B", departure: at(24), arrival: at(40), cancelled: true, plannedPlatformFrom: "A", platformFrom: "C", remarks: [{ text: "Service cancelled due to an operational disruption" }] },
  ],
}, at(18).getTime());
assert.equal(cancelledNext.tone, "critical");
assert.equal(cancelledNext.cancelledSegment, "next");
assert.equal(cancelledNext.segmentIndex, 1);
assert.equal(cancelledNext.platformChanged, true);
assert.match(cancelledNext.eyebrow, /cancelled/i);
assert.match(cancelledNext.title, /tram 4 is cancelled/i);
assert.match(cancelledNext.detail, /planned onward service/i);
assert.match(cancelledNext.detail, /changed from A to C/i);
assert.match(cancelledNext.detail, /operational disruption/i);
assert.match(cancelledNext.detail, /Recovery Desk|replan/);

const cancelledIncoming = api.transferModel({
  segments: [
    { mode: "BUS", line: "7", from: "A", to: "Central", departure: at(0), arrival: at(20), cancelled: true },
    { mode: "TRAM", line: "3", from: "Central", to: "B", departure: at(23), arrival: at(40) },
  ],
}, at(10).getTime());
assert.equal(cancelledIncoming.tone, "critical");
assert.equal(cancelledIncoming.cancelledSegment, "current");
assert.equal(cancelledIncoming.segmentIndex, 0);
assert.match(cancelledIncoming.title, /BUS 7 is cancelled/i);
assert.match(cancelledIncoming.detail, /feeding this transfer/i);
assert.match(cancelledIncoming.detail, /Recovery Desk|replan/);

assert.equal(api.disruptionSummary({ remarks: [] }), "");
assert.equal(api.disruptionSummary({ remarks: [{ summary: "  Platform staffing issue  " }] }), "Platform staffing issue");

const comfortable = api.transferModel({
  segments: [
    { mode: "BUS", from: "A", to: "X", departure: at(0), arrival: at(20) },
    { mode: "TRAM", line: "1", from: "X", to: "B", departure: at(28), arrival: at(40) },
  ],
}, at(5).getTime());
assert.equal(comfortable, null, "comfortable transfers should stay quiet");

const farFuture = api.transferModel({
  segments: [
    { mode: "TRAM", from: "A", to: "Far", departure: at(0), arrival: at(40) },
    { mode: "TRAM", line: "9", from: "Far", to: "B", departure: at(43), arrival: at(55) },
  ],
}, at(5).getTime());
assert.equal(farFuture, null, "a tight transfer more than 30 minutes away should not occupy the live UI yet");

const impossible = api.transferModel({
  segments: [
    { mode: "TRAM", line: "2", from: "A", to: "X", departure: at(0), arrival: at(25) },
    { mode: "TRAM", line: "3", from: "X", to: "B", departure: at(23), arrival: at(40), plannedPlatformFrom: "1", platformFrom: "2" },
  ],
}, at(5).getTime());
assert.equal(impossible.tone, "critical");
assert.equal(impossible.gap, -2);
assert.equal(impossible.platformChanged, true);
assert.match(impossible.title, /no longer fits/);
assert.match(impossible.detail, /changed from 1 to 2/);
assert.match(impossible.detail, /Recovery Desk|replan/);

const walkingTransfer = api.transferModel({
  segments: [
    { mode: "TRAM", from: "A", to: "X", departure: at(0), arrival: at(20) },
    { mode: "WALK", from: "X", to: "Y", departure: at(20), arrival: at(24) },
    { mode: "TRAM", from: "Y", to: "B", departure: at(27), arrival: at(40) },
  ],
}, at(5).getTime());
assert.equal(walkingTransfer, null, "walking legs should not be mislabeled as direct vehicle transfers");

const past = api.transferModel(route, at(24).getTime());
assert.equal(past, null, "already departed transfers should not remain on screen");

window.NVSShare.getFocusIndex = () => 0;
let liveEntry = { status: "missed", at: at(5).getTime() };
window.NVSSharedLive = { getState: () => ({ members: { "0": liveEntry } }) };
assert.equal(api.freshMissed(at(5).getTime()), true);
assert.equal(api.blockingVoluntaryState(at(5).getTime()), "missed");
assert.equal(api.freshMissed(at(21).getTime()), false, "stale missed reports should stop suppressing timetable transfer watch");
liveEntry = { status: "arrived", at: at(5).getTime() };
assert.equal(api.blockingVoluntaryState(at(5).getTime()), "arrived", "confirmed arrival must suppress obsolete future-transfer advice");
liveEntry = { status: "on-vehicle", at: at(5).getTime() };
assert.equal(api.blockingVoluntaryState(at(5).getTime()), null, "on-board confirmation can still benefit from upcoming transfer protection");

// Authoritative lifecycle: empty recommendation state must not keep Connection Protection awake.
document.hidden = false;
window.__NVS_LAST_RECOMMENDATIONS__ = { primary: { assignments: [] } };
assert.equal(typeof listeners.get("nvs-group-recommendations-rendered"), "function");
listeners.get("nvs-group-recommendations-rendered")();
assert.equal(timers.size, 1, "fresh recommendations should arm the Connection Protection refresh timer");
let removed = false;
transferCard = { remove() { removed = true; transferCard = null; } };
assert.equal(typeof listeners.get("nvs-recommendations-cleared"), "function");
listeners.get("nvs-recommendations-cleared")();
assert.equal(removed, true, "clearing recommendations must remove stale Connection Protection immediately");
assert.equal(timers.size, 0, "clearing recommendations must cancel periodic Connection Protection work");
listeners.get("pageshow")();
assert.equal(timers.size, 0, "pageshow must not resurrect Connection Protection while recommendations remain empty");
listeners.get("nvs-shared-view-resumed")();
assert.equal(timers.size, 0, "shared-view resume must remain inert while recommendations are empty");
listeners.get("nvs-group-recommendations-rendered")();
assert.equal(timers.size, 1, "a later authoritative recommendation render should reactivate Connection Protection");

assert.match(source, /MAX_WATCH_MIN = 6/);
assert.match(source, /MAX_LEAD_MIN = 30/, "proactive warnings should be bounded so distant transfers do not create persistent noise");
assert.match(source, /plannedPlatformFrom/, "connection protection should compare planned and realtime boarding platforms");
assert.match(source, /cancelled/, "connection protection should never present a cancelled leg as a viable transfer");
assert.match(source, /Provider note:/, "useful disruption remarks should survive into recovery guidance without exposing unrelated data");
assert.match(source, /slice\(0, 180\)/, "provider remarks should be bounded so the live card cannot become unreasonably large");
assert.match(source, /departs in about/, "nearby connection protection should include a timetable countdown without implying location awareness");
assert.match(source, /BLOCKING_VOLUNTARY/);
assert.match(source, /nvs-shared-live-change/);
assert.match(source, /recommendationsActive/, "Connection Protection scheduler must be gated by authoritative recommendation state");
assert.match(source, /nvs-recommendations-cleared/, "Connection Protection must consume the empty-recommendation lifecycle directly");
assert.match(source, /document\.hidden/);
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "transfer protection must remain route-data-only");
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /forced-colors/);
assert.match(release, /loadTransferWatch0111/, "release owner should load proactive transfer watch");
assert.match(release, /transfer-watch-v0111\.js/);
assert.match(release, /transfer-watch-v0111\.css/);
assert.match(sw, /transfer-watch-v0111\.js/, "installed/offline PWA should include transfer watch runtime");
assert.match(sw, /transfer-watch-v0111\.css/);

console.log("transfer-watch: tight/impossible/cancelled connection protection, lifecycle teardown/rehydration, realtime platform drift, bounded noise, voluntary precedence, PWA wiring and no-GPS behavior passed");