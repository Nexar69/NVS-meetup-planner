const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(file, apiName, nowRef) {
  const source = fs.readFileSync(path.resolve(__dirname, `../${file}`), "utf8");
  let focus = 0;
  let liveEntry = null;
  const window = {
    NVSShare: { getSharedPlan: () => ({ view: "person" }), getFocusIndex: () => focus },
    NVSSharedLive: { getState: () => ({ members: liveEntry ? { "0": liveEntry } : {} }) },
    NVSIntelligenceCore: {
      checkinFreshness(entry, now) {
        const at = Number(entry?.at);
        const age = now.getTime() - at;
        return { fresh: Number.isFinite(at) && age >= 0 && age <= 15 * 60_000 };
      },
    },
    addEventListener() {},
  };
  const document = {
    hidden: true,
    addEventListener() {},
    getElementById() { return null; },
  };
  class MutationObserver { observe() {} disconnect() {} }
  vm.runInNewContext(source, {
    window, document, MutationObserver,
    Date, Math, Number, String, Boolean, Array, Object, Intl, Set,
    setTimeout, clearTimeout,
  });
  const api = window[apiName];
  return {
    api,
    source,
    setEntry(status, minutesOld = 0) {
      liveEntry = { status, at: nowRef - minutesOld * 60_000 };
    },
    clearEntry() { liveEntry = null; },
    setFocus(value) { focus = value; },
  };
}

const now = Date.UTC(2026, 7, 26, 14, 0, 0);
const stop = load("stop-awareness-v0111.js", "NVSStopAwareness0111", now);
const transfer = load("transfer-watch-v0111.js", "NVSTransferWatch0111", now);

for (const runtime of [stop, transfer]) {
  runtime.setEntry("missed");
  assert.equal(runtime.api.blockingVoluntaryState(now), "missed");

  runtime.setEntry("arrived");
  assert.equal(runtime.api.blockingVoluntaryState(now), "arrived");

  runtime.setEntry("at-stop");
  assert.equal(runtime.api.blockingVoluntaryState(now), "at-stop", "fresh at-stop must suppress onboard-only ancillary guidance");

  runtime.setEntry("on-vehicle");
  assert.equal(runtime.api.blockingVoluntaryState(now), null, "fresh on-vehicle should keep onboard stop/transfer assistance");

  runtime.setEntry("at-stop", 16);
  assert.equal(runtime.api.blockingVoluntaryState(now), null, "stale at-stop must fall back to timetable after 15 minutes");
}

assert.match(stop.source, /BLOCKING_VOLUNTARY = new Set\(\["missed", "arrived", "at-stop"\]\)/);
assert.match(transfer.source, /BLOCKING_VOLUNTARY = new Set\(\["missed", "arrived", "at-stop"\]\)/);
assert.doesNotMatch(stop.source + transfer.source, /geolocation|getCurrentPosition|watchPosition/i);

console.log("ancillary-voluntary-precedence: Stop Awareness and Connection Protection cannot contradict fresh at-stop/missed/arrived state");
