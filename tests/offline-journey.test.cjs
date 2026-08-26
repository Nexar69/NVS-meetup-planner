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
        platformFrom: "C",
        plannedPlatformFrom: "A",
        cancelled: true,
        remarks: [{ text: "Service cancelled due to an operational issue near the depot." }],
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
assert.equal(typeof api?.clearSnapshot, "function");

const now = new Date("2026-08-26T07:00:00.000Z");
const snapshot = api.buildSnapshot(assignment, now);
assert.equal(snapshot.schema, "meet-schwerin-offline-journey-v1");
assert.equal(snapshot.segments.length, 2);
assert.equal(snapshot.segments[0].line, "2");
assert.equal(snapshot.segments[0].platformFrom, "C");
assert.equal(snapshot.segments[0].plannedPlatformFrom, "A");
assert.equal(snapshot.segments[0].platformChanged, true, "last-known realtime platform drift should survive connectivity loss");
assert.equal(snapshot.segments[0].cancelled, true, "last-known cancellation state should survive loss of connectivity");
assert.match(snapshot.segments[0].disruption, /operational issue/, "a bounded last-known provider disruption note should survive offline");
assert.ok(snapshot.segments[0].disruption.length <= 180, "offline disruption text must remain bounded for mobile UI safety");
assert.equal(snapshot.segments[1].mode, "WALK");
assert.equal(snapshot.segments[1].cancelled, false);
assert.equal(snapshot.segments[1].platformChanged, false);

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

const storageKey = "meet-schwerin-offline-journey-v1";
sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
assert.equal(api.readSnapshot(now.getTime() + 60_000)?.segments?.length, 2);
sharedPlan = null;
focus = -1;
assert.equal(api.personalViewerHint(), true, "personal shared URL must keep the offline fallback eligible if the live plan cannot be fetched");

window.location.search = "?me=1";
assert.equal(api.readSnapshot(now.getTime() + 60_000), null, "a personal snapshot must not cross into another member-scoped URL in the same tab");
assert.equal(sessionStorage.getItem(storageKey), null, "scope-mismatched snapshots should be evicted immediately");

window.location.search = "?me=0";
sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
listeners["nvs-shared-session-expired"]?.();
assert.equal(sessionStorage.getItem(storageKey), null, "authoritative shared-session expiry should clear the tab-only route snapshot immediately");

sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
window.location.search = "";
assert.equal(api.personalViewerHint(), false, "a generic shared URL must not expose a personal tab snapshot without a person hint");
window.location.search = "?me=0";
assert.equal(api.readSnapshot(now.getTime() + 13 * 60 * 60_000), null, "old tab snapshots must self-expire");
assert.equal(sessionStorage.getItem(storageKey), null, "expired snapshot should be removed from the tab");

assert.match(source, /sessionStorage\.setItem/);
assert.match(source, /sessionStorage\.removeItem/);
assert.match(source, /URLSearchParams/);
assert.match(source, /Cancelled when last online/, "offline UI should surface an already-known cancellation rather than showing the old leg as normal");
assert.match(source, /At least one saved leg was already cancelled/, "offline cancellation fallback should instruct the rider not to rely on the cancelled leg");
assert.match(source, /firstDisruptionText/, "offline snapshots should preserve a bounded last-known provider disruption note");
assert.match(source, /Last-known platform change/, "offline UI should retain a known realtime platform change instead of silently reverting to the planned platform");
assert.match(source, /plannedPlatformFrom/, "offline snapshot should keep the planned boarding platform only when needed to explain drift");
assert.match(source, /nvs-shared-session-expired/, "backend-authoritative session expiry should clear any tab-only saved personal route");
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

console.log("offline-journey: tab-scoped fallback preserves last-known disruption/platform context while enforcing member scope, authoritative expiry, age expiry, privacy, accessibility and no-GPS contracts");
