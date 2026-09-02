const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../transfer-watch-v0111.js"), "utf8");
const window = { addEventListener() {}, NVSShare: { getFocusIndex: () => -1 } };
const document = { hidden: true, addEventListener() {}, getElementById() { return null; } };
vm.runInNewContext(source, { window, document, Date, Math, Number, String, Array, Object, Intl, Set, setTimeout, clearTimeout });

const api = window.NVSTransferWatch0111;
assert.equal(typeof api?.transferGapMs, "function");
assert.equal(typeof api?.transferGapMinutes, "function");

const base = Date.UTC(2026, 7, 28, 8, 0, 0);
const t = (ms) => new Date(base + ms);
const routeForGap = (gapMs) => ({
  segments: [
    { mode: "TRAM", line: "2", from: "A", to: "X", departure: t(0), arrival: t(10 * 60_000) },
    { mode: "TRAM", line: "3", from: "X", to: "B", departure: t(10 * 60_000 + gapMs), arrival: t(30 * 60_000) },
  ],
});

const impossibleBy20s = api.transferModel(routeForGap(-20_000), t(2 * 60_000).getTime());
assert.equal(impossibleBy20s?.tone, "critical", "any negative transfer window must be treated as impossible, even below one minute");
assert.equal(impossibleBy20s?.gapMs, -20_000);
assert.equal(impossibleBy20s?.gap, -1, "human-facing impossible gap should never round up to zero");
assert.match(impossibleBy20s?.title || "", /no longer fits/i);
assert.match(impossibleBy20s?.detail || "", /about 1 min before/i);

const twentySeconds = api.transferModel(routeForGap(20_000), t(2 * 60_000).getTime());
assert.equal(twentySeconds?.tone, "warn", "a sub-minute positive transfer remains a tight connection");
assert.equal(twentySeconds?.gapMs, 20_000);
assert.equal(twentySeconds?.gap, 0);
assert.match(twentySeconds?.title || "", /0 min transfer/i);

const exactSix = api.transferModel(routeForGap(6 * 60_000), t(2 * 60_000).getTime());
assert.equal(exactSix?.tone, "info", "exactly six minutes remains inside the protection window");
assert.equal(exactSix?.gapMs, 6 * 60_000);
assert.equal(exactSix?.gap, 6);

const sixPlusOneSecond = api.transferModel(routeForGap(6 * 60_000 + 1_000), t(2 * 60_000).getTime());
assert.equal(sixPlusOneSecond, null, "connections beyond the exact six-minute ceiling must stay quiet instead of rounding down into protection");

assert.equal(api.transferGapMs(routeForGap(-20_000).segments[0], routeForGap(-20_000).segments[1]), -20_000);
assert.equal(api.transferGapMinutes(routeForGap(-20_000).segments[0], routeForGap(-20_000).segments[1]), -1);
assert.equal(api.transferGapMinutes(routeForGap(3 * 60_000 + 59_000).segments[0], routeForGap(3 * 60_000 + 59_000).segments[1]), 3, "positive display gap should represent complete available minutes");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i);

console.log("transfer-watch-boundaries: exact negative/positive and six-minute safety thresholds passed");