const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../transfer-watch-v0111.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../transfer-watch-v0111.css"), "utf8");
const release = fs.readFileSync(path.resolve(__dirname, "../release-v011.js"), "utf8");
const sw = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

const window = {
  addEventListener() {},
  NVSShare: { getFocusIndex: () => -1 },
};
const document = {
  hidden: true,
  addEventListener() {},
  getElementById() { return null; },
};
vm.runInNewContext(source, { window, document, Date, Math, Number, String, Array, Object, Intl, setTimeout, clearTimeout });

const api = window.NVSTransferWatch0111;
assert.equal(typeof api?.transferModel, "function");
assert.equal(typeof api?.transferCandidates, "function");
assert.equal(typeof api?.freshMissed, "function");

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
assert.match(tight.detail, /platform C/);

const sixMinute = api.transferModel({
  segments: [
    { mode: "BUS", from: "A", to: "X", departure: at(0), arrival: at(20) },
    { mode: "TRAM", line: "1", from: "X", to: "B", departure: at(26), arrival: at(40) },
  ],
}, at(5).getTime());
assert.equal(sixMinute.tone, "info");
assert.equal(sixMinute.gap, 6);

const comfortable = api.transferModel({
  segments: [
    { mode: "BUS", from: "A", to: "X", departure: at(0), arrival: at(20) },
    { mode: "TRAM", line: "1", from: "X", to: "B", departure: at(28), arrival: at(40) },
  ],
}, at(5).getTime());
assert.equal(comfortable, null, "comfortable transfers should stay quiet");

const impossible = api.transferModel({
  segments: [
    { mode: "TRAM", line: "2", from: "A", to: "X", departure: at(0), arrival: at(25) },
    { mode: "TRAM", line: "3", from: "X", to: "B", departure: at(23), arrival: at(40) },
  ],
}, at(5).getTime());
assert.equal(impossible.tone, "critical");
assert.equal(impossible.gap, -2);
assert.match(impossible.title, /no longer fits/);
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
window.NVSSharedLive = { getState: () => ({ members: { "0": { status: "missed", at: at(5).getTime() } } }) };
assert.equal(api.freshMissed(at(5).getTime()), true);
assert.equal(api.freshMissed(at(21).getTime()), false, "stale missed reports should stop suppressing timetable transfer watch");

assert.match(source, /MAX_WATCH_MIN = 6/);
assert.match(source, /nvs-shared-live-change/);
assert.match(source, /document\.hidden/);
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "transfer protection must remain route-data-only");
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /forced-colors/);
assert.match(release, /loadTransferWatch0111/, "release owner should load proactive transfer watch");
assert.match(release, /transfer-watch-v0111\.js/);
assert.match(release, /transfer-watch-v0111\.css/);
assert.match(sw, /transfer-watch-v0111\.js/, "installed/offline PWA should include transfer watch runtime");
assert.match(sw, /transfer-watch-v0111\.css/);

console.log("transfer-watch: proactive tight/impossible transfer protection, quiet comfortable gaps, recovery precedence, PWA wiring and no-GPS behavior passed");
