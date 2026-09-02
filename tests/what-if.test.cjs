const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const convergenceSource = fs.readFileSync(path.resolve(__dirname, "../convergence.js"), "utf8");
const source = fs.readFileSync(path.resolve(__dirname, "../what-if-v0111.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../what-if-v0111.css"), "utf8");
const release = fs.readFileSync(path.resolve(__dirname, "../release-v011.js"), "utf8");
const sw = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

const listeners = {};
let whatIfCard = null;
const window = { addEventListener(name, fn) { listeners[name] = fn; } };
const document = {
  addEventListener() {},
  getElementById(id) { return id === "v0111WhatIf" ? whatIfCard : null; },
};
vm.runInNewContext(convergenceSource, { window, Date, Math, Number, String, Array, Object, Map, Set });
vm.runInNewContext(source, { window, document, Date, Math, Number, String, Array, Object, Intl, Map, Set });

const api = window.NVSWhatIf0111;
assert.equal(typeof api?.simulate, "function");
assert.equal(typeof api?.delayedGroup, "function");
assert.equal(typeof api?.shiftRoute, "function");
assert.equal(typeof api?.recoveryActive, "function");
assert.equal(typeof api?.meetupConfirmed, "function");
assert.equal(typeof listeners["nvs-recommendations-cleared"], "function", "authoritative empty recommendation state must tear down What-if immediately");

const at = (minute) => new Date(Date.UTC(2026, 7, 25, 8, minute, 0));
const group = {
  destination: "School",
  latestArrival: at(30),
  assignments: [
    {
      member: { id: "a", name: "A" },
      route: {
        departure: at(0), arrival: at(25), geometry: [[53.6, 11.4], [53.61, 11.41]],
        segments: [
          { mode: "TRAM", line: "2", from: "A start", to: "Join", departure: at(0), arrival: at(10), intermediateStops: [{ name: "Mid", arrival: at(5), departure: at(5) }] },
          { mode: "TRAM", line: "3", from: "Join", to: "School", departure: at(12), arrival: at(25) },
        ],
      },
    },
    {
      member: { id: "b", name: "B" },
      route: {
        departure: at(3), arrival: at(30), geometry: [[53.5, 11.3], [53.61, 11.41]],
        segments: [
          { mode: "TRAM", line: "4", from: "B start", to: "Join", departure: at(3), arrival: at(10) },
          { mode: "TRAM", line: "3", from: "Join", to: "School", departure: at(12), arrival: at(30) },
        ],
      },
    },
  ],
};

const shifted = api.delayedGroup(group, 0, 5);
assert.notEqual(shifted, group);
assert.notEqual(shifted.assignments[0].route, group.assignments[0].route);
assert.equal(shifted.assignments[0].route.departure.getTime(), at(5).getTime());
assert.equal(shifted.assignments[0].route.segments[0].arrival.getTime(), at(15).getTime());
assert.equal(shifted.assignments[0].route.segments[0].intermediateStops[0].arrival.getTime(), at(10).getTime());
assert.equal(shifted.assignments[1].route.departure.getTime(), at(3).getTime(), "other member route must stay unchanged");
assert.equal(group.assignments[0].route.departure.getTime(), at(0).getTime(), "real group must not be mutated");
assert.deepEqual(group.assignments[0].route.geometry, [[53.6, 11.4], [53.61, 11.41]], "simulation must not mutate geometry");

const result5 = api.simulate(group, 0, 5, at(1).getTime());
assert.equal(result5.localOnly, true);
assert.equal(result5.memberName, "A");
assert.equal(result5.delay, 5);
assert.equal(result5.beforeSpread, 5);
assert.equal(result5.afterSpread, 0, "a hypothetical delay can legitimately improve arrival alignment");
assert.match(result5.detail, /join|converge|arrival spread|recovery/i);

const result10 = api.simulate(group, 1, 10, at(1).getTime());
assert.equal(result10.memberName, "B");
assert.equal(result10.delay, 10);
assert.equal(result10.hypothetical.assignments[1].route.arrival.getTime(), at(40).getTime());
assert.equal(result10.hypothetical.latestArrival.getTime(), at(40).getTime());
assert.equal(result10.afterSpread, 15);

const normalizedDelay = api.simulate(group, 0, 999, at(1).getTime());
assert.equal(normalizedDelay.delay, 5, "unsupported delay choices should stay bounded to the safe UI presets");

const liveNow = at(1).getTime();
assert.equal(api.recoveryActive(group, { members: { "0": { status: "missed", at: liveNow } } }, liveNow), true, "fresh missed status should pause hypothetical advice");
assert.equal(api.recoveryActive(group, { members: { "0": { status: "missed", at: liveNow - 16 * 60_000 } } }, liveNow), false, "stale missed status should no longer block timetable stress testing");
assert.equal(api.recoveryActive(group, { members: { "0": { status: "on-vehicle", at: liveNow } } }, liveNow), false, "non-recovery voluntary states should not pause the simulator");
assert.equal(api.meetupConfirmed(group, { members: { "0": { status: "arrived", at: liveNow }, "1": { status: "arrived", at: liveNow } } }, liveNow), true, "all fresh arrivals should mark the meetup complete and make simulations unnecessary");
assert.equal(api.meetupConfirmed(group, { members: { "0": { status: "arrived", at: liveNow }, "1": { status: "arrived", at: liveNow - 16 * 60_000 } } }, liveNow), false, "a stale arrival must not keep the simulator paused forever");
assert.equal(api.meetupConfirmed(group, { members: { "0": { status: "arrived", at: liveNow } } }, liveNow), false, "partial arrival confirmation is not meetup completion");

let removeCount = 0;
whatIfCard = { remove() { removeCount += 1; } };
window.__NVS_LAST_RECOMMENDATIONS__ = undefined;
listeners["nvs-recommendations-cleared"]();
assert.equal(removeCount, 1, "clearing recommendations must synchronously remove a stale What-if card");
listeners["nvs-recommendations-cleared"]();
assert.equal(removeCount, 2, "repeated clear events must stay safe and idempotent from the UI perspective");

assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage/, "what-if preview must stay local and ephemeral");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "what-if preview must never add location tracking");
assert.match(source, /does not change, save, or share the real meetup plan/i);
assert.match(source, /does not fetch an alternative route/i, "simulator must disclose that it is a timing stress test, not a reroute prediction");
assert.match(source, /Recovery takes priority/);
assert.match(source, /Meetup complete/);
assert.match(source, /nvs-shared-live-change/, "fresh shared state changes should immediately refresh the simulator");
assert.match(source, /nvs-recommendations-cleared/, "empty recommendation transitions must immediately refresh the simulator");
assert.match(source, /Simulation only/);
assert.match(css, /min-height:44px/, "mobile simulator controls should meet touch-target guidance");
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /forced-colors/);
assert.match(release, /loadWhatIf0111/, "v0.11.1 release owner should load the simulator");
assert.match(release, /what-if-v0111\.js/);
assert.match(release, /what-if-v0111\.css/);
assert.match(sw, /what-if-v0111\.js/, "what-if runtime should be available to installed/offline PWA copies");
assert.match(sw, /what-if-v0111\.css/);

console.log("what-if: local-only +5/+10 timing stress test, recommendation-clear teardown, recovery/completion quiet states, immutable routes, mobile accessibility, offline wiring and no-GPS behavior passed");