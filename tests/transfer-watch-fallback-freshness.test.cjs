const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../transfer-watch-v0111.js"), "utf8");
const listeners = new Map();
const window = {
  addEventListener(name, handler) { listeners.set(name, handler); },
  NVSShare: { getFocusIndex: () => 0 },
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
  Math,
  Number,
  String,
  Array,
  Object,
  Intl,
  Set,
  setTimeout: () => 1,
  clearTimeout() {},
});

const api = window.NVSTransferWatch0111;
assert.equal(typeof api?.blockingVoluntaryState, "function");
assert.equal(typeof api?.focusedFreshEntry, "function");

const now = Date.UTC(2026, 7, 25, 8, 10, 0);
let liveEntry = null;
window.NVSSharedLive = { getState: () => ({ members: { "0": liveEntry } }) };
window.NVSIntelligenceCore = null;

liveEntry = { status: "missed", at: now + 5 * 60_000 };
assert.equal(api.blockingVoluntaryState(now), "missed", "fallback should tolerate exactly five minutes of ordinary clock skew");

liveEntry = { status: "missed", at: now + 5 * 60_000 + 1 };
assert.equal(api.blockingVoluntaryState(now), null, "fallback must reject impossible-future voluntary state beyond five minutes");

liveEntry = { status: "arrived", at: now - 15 * 60_000 };
assert.equal(api.blockingVoluntaryState(now), "arrived", "exactly 15 minutes old remains authoritative at the boundary");

liveEntry = { status: "arrived", at: now - 15 * 60_000 - 1 };
assert.equal(api.blockingVoluntaryState(now), null, "older voluntary state must return Connection Protection to timetable/realtime route data");

liveEntry = { status: "at-stop", at: "invalid" };
assert.equal(api.blockingVoluntaryState(now), null, "malformed timestamps must never suppress route guidance");

assert.match(source, /MAX_FUTURE_SKEW_MS\s*=\s*5 \* 60_000/);
assert.match(source, /STALE_AFTER_MS\s*=\s*15 \* 60_000/);
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "Connection Protection fallback must remain route-data-only");

console.log("transfer-watch-fallback-freshness: clock-skew/stale boundaries and no-GPS behavior passed");