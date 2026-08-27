const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../transfer-watch-v0111.js"), "utf8");

const window = {
  addEventListener() {},
  NVSShare: { getFocusIndex: () => -1 },
};
const document = {
  hidden: true,
  addEventListener() {},
  getElementById() { return null; },
};
vm.runInNewContext(source, { window, document, Date, Math, Number, String, Array, Object, Intl, Set, setTimeout, clearTimeout });

const api = window.NVSTransferWatch0111;
assert.equal(typeof api?.transferModel, "function");
assert.match(source, /isCancelled/, "Connection Protection must normalize the alternate provider cancellation flag");

const at = (minute) => new Date(Date.UTC(2026, 7, 28, 8, minute, 0));

const nextViaIsCancelled = api.transferModel({
  segments: [
    { mode: "TRAM", line: "2", from: "A", to: "Central", departure: at(0), arrival: at(20) },
    { mode: "TRAM", line: "5", from: "Central", to: "B", departure: at(24), arrival: at(40), isCancelled: true },
  ],
}, at(18).getTime());
assert.equal(nextViaIsCancelled?.tone, "critical");
assert.equal(nextViaIsCancelled?.cancelledSegment, "next");
assert.match(nextViaIsCancelled?.title || "", /TRAM 5 is cancelled/i);
assert.match(nextViaIsCancelled?.detail || "", /Recovery Desk|replan/i);

const incomingViaIsCancelled = api.transferModel({
  segments: [
    { mode: "BUS", line: "8", from: "A", to: "Central", departure: at(0), arrival: at(20), isCancelled: true },
    { mode: "TRAM", line: "3", from: "Central", to: "B", departure: at(23), arrival: at(40) },
  ],
}, at(10).getTime());
assert.equal(incomingViaIsCancelled?.tone, "critical");
assert.equal(incomingViaIsCancelled?.cancelledSegment, "current");
assert.match(incomingViaIsCancelled?.title || "", /BUS 8 is cancelled/i);

const explicitFalseDoesNotCancel = api.transferModel({
  segments: [
    { mode: "TRAM", line: "2", from: "A", to: "Central", departure: at(0), arrival: at(20), cancelled: false, isCancelled: false },
    { mode: "TRAM", line: "3", from: "Central", to: "B", departure: at(23), arrival: at(40), cancelled: false, isCancelled: false },
  ],
}, at(10).getTime());
assert.equal(explicitFalseDoesNotCancel?.tone, "warn", "false provider flags must not be interpreted as cancellation");
assert.equal(explicitFalseDoesNotCancel?.cancelledSegment, undefined);

console.log("transfer-watch cancellation shapes: cancelled/isCancelled normalization passed");
