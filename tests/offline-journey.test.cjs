const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../offline-journey-v0111.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../offline-journey-v0111.css"), "utf8");
const release = fs.readFileSync(path.resolve(__dirname, "../release-v011.js"), "utf8");
const sw = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

const saved = new Map();
const sessionStorage = {
  setItem(key, value) { saved.set(key, String(value)); },
  getItem(key) { return saved.has(key) ? saved.get(key) : null; },
  removeItem(key) { saved.delete(key); },
};
const assignment = {
  member: { id: "secret-member-id", name: "Secret Person", color: "#000" },
  route: {
    arrival: "2026-08-26T07:40:00.000Z",
    geometry: [[53.6, 11.4]],
    capabilityKey: "secret-capability",
    segments: [
      {
        mode: "TRAM",
        modeLabel: "Tram",
        line: "2",
        from: "Marienplatz",
        to: "Krebsförden",
        headsign: "Hegelstraße",
        departure: "2026-08-26T07:10:00.000Z",
        arrival: "2026-08-26T07:28:00.000Z",
        platformFrom: "A",
        lat: 53.6,
        lon: 11.4,
        geometry: [[53.6, 11.4]],
        key: "secret-key",
      },
      {
        mode: "WALK",
        from: "Krebsförden",
        to: "Gymnasium",
        departure: "2026-08-26T07:28:00.000Z",
        arrival: "2026-08-26T07:40:00.000Z",
      },
    ],
  },
};
let sharedPlan = { view: "person", planId: "secret-plan-id" };
let focus = 0;
const listeners = {};
const window = {
  NVSShare: {
    getSharedPlan: () => sharedPlan,
    getFocusIndex: () => focus,
  },
  __NVS_LAST_RECOMMENDATIONS__: { primary: { assignments: [assignment] } },
  location: { pathname: "/p/example", search: "?me=0" },
  addEventListener(name, fn) { listeners[name] = fn; },
};
const document = {
  getElementById() { return null; },
  querySelector() { return null; },
};
const navigator = { onLine: true };

vm.runInNewContext(source, {
  window,
  document,
  navigator,
  sessionStorage,
  URLSearchParams,
  Intl,
  Date,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Object,
  JSON,
});

const api = window.NVSOfflineJourney0111;
assert.equal(typeof api?.buildSnapshot, "function");
assert.equal(typeof api?.readSnapshot, "function");
assert.equal(typeof api?.personalViewerHint, "function");

const now = new Date("2026-08-26T07:00:00.000Z");
const snapshot = api.buildSnapshot(assignment, now);
assert.equal(snapshot.schema, "meet-schwerin-offline-journey-v1");
assert.equal(snapshot.segments.length, 2);
assert.equal(snapshot.segments[0].line, "2");
assert.equal(snapshot.segments[0].platformFrom, "A");
assert.equal(snapshot.segments[1].mode, "WALK");

const serialized = JSON.stringify(snapshot);
for (const forbidden of [
  "Secret Person",
  "secret-member-id",
  "secret-plan-id",
  "secret-capability",
  "secret-key",
  "53.6",
  "11.4",
  "geometry",
  "capabilityKey",
]) {
  assert.equal(serialized.includes(forbidden), false, `offline snapshot must exclude ${forbidden}`);
}
assert.equal(serialized.includes("Marienplatz"), true, "planned stop names are required for an offline journey fallback");

sessionStorage.setItem("meet-schwerin-offline-journey-v1", JSON.stringify(snapshot));
assert.equal(api.readSnapshot(now.getTime() + 60_000)?.segments?.length, 2);
sharedPlan = null;
focus = -1;
assert.equal(api.personalViewerHint(), true, "personal shared URL must keep the offline fallback eligible if the live plan cannot be fetched");
window.location.search = "";
assert.equal(api.personalViewerHint(), false, "a generic shared URL must not expose a personal tab snapshot without a person hint");
window.location.search = "?me=0";
assert.equal(api.readSnapshot(now.getTime() + 13 * 60 * 60_000), null, "old tab snapshots must self-expire");
assert.equal(sessionStorage.getItem("meet-schwerin-offline-journey-v1"), null, "expired snapshot should be removed from the tab");

assert.match(source, /sessionStorage\.setItem/);
assert.match(source, /sessionStorage\.removeItem/);
assert.match(source, /URLSearchParams/);
assert.doesNotMatch(source, /localStorage|indexedDB/i, "offline journey data must remain tab-scoped, not durable");
assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|sendBeacon/i, "offline fallback must not make its own network requests");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "offline fallback must never request location");
assert.match(source, /Realtime updates are unavailable/);
assert.match(source, /No GPS, names, coordinates, plan IDs or private check-in keys/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /forced-colors/);
assert.match(release, /offline-journey-v0111\.js/);
assert.match(release, /offline-journey-v0111\.css/);
assert.match(sw, /offline-journey-v0111\.js/);
assert.match(sw, /offline-journey-v0111\.css/);

console.log("offline-journey: tab-scoped route fallback survives live-plan fetch loss while preserving expiry, privacy, accessibility and no-GPS contracts");
