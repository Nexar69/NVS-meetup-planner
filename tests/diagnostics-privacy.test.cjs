const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../diagnostics-v0111.js"), "utf8");
const release = fs.readFileSync(path.resolve(__dirname, "../release-v011.js"), "utf8");
const sw = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

let sharedExpiry = Date.now() + 60_000;
const diagnosticNow = new Date("2026-08-25T18:00:00.000Z");
const offlineSnapshot = {
  scope: "secret-scope",
  capturedAt: new Date(diagnosticNow.getTime() - 9 * 60_000).toISOString(),
  expiresAt: "2026-08-28T18:00:00.000Z",
  segments: [
    { from: "Secret Home", to: "Secret Stop", geometry: [[53.6, 11.4]], capabilityKey: "secret-capability" },
    { from: "Secret Stop", to: "Secret Destination", key: "secret-key" },
  ],
};
const window = {
  NVSShare: {
    getSharedPlan: () => ({ members: [{ name: "Secret Person", origin: { lat: 53.6, lon: 11.4 } }] }),
    getFocusIndex: () => 0,
  },
  NVSSharedLive: {
    getState: () => ({
      planId: "secret-plan-id",
      revision: 7,
      expiresAt: sharedExpiry,
      members: { "0": { status: "on-vehicle", at: Date.now(), key: "secret-key" } },
    }),
  },
  NVSOfflineJourney0111: {
    readSnapshot: () => offlineSnapshot,
    snapshotAgeMs: (_snapshot, now) => Number(now) - new Date(offlineSnapshot.capturedAt).getTime(),
    realtimeContextFresh: () => true,
  },
  NVSTransit: { getProviderStatus: () => ({ provider: "VMV", fallback: false }) },
  NVSProviderHealth0111: {
    getState: () => ({
      status: "good",
      health: {
        release: "v0.11.1",
        capabilities: {
          sharedCheckins: true,
          organizerReplan: true,
          capabilityRevocation: true,
          realtimeDisruptions: true,
          authoritativeExpiry: true,
        },
      },
    }),
  },
  __NVS_LAST_RECOMMENDATIONS__: {
    primary: {
      assignments: [{ member: { name: "Secret Person" }, route: { geometry: [[53.6, 11.4]], segments: [{ from: "Secret Home", to: "Secret Stop" }] } }],
    },
  },
  addEventListener() {},
  matchMedia: () => ({ matches: true }),
};

const document = {
  documentElement: { dataset: { nvsRelease: "011" } },
  getElementById(id) {
    if (id === "versionLabel") return { textContent: "v0.11.1 · Meetup Intelligence" };
    return null;
  },
};
const navigator = {
  onLine: true,
  standalone: false,
  serviceWorker: { controller: {} },
  clipboard: { async writeText() {} },
};

vm.runInNewContext(source, { window, document, navigator, Date, Number, String, Boolean, Object, Array, JSON, Math });
const snapshot = window.NVSDiagnostics0111.buildSnapshot(diagnosticNow);

assert.equal(snapshot.schema, "meet-schwerin-diagnostics-v1");
assert.equal(snapshot.view, "personal-shared");
assert.equal(snapshot.route.assignmentCount, 1);
assert.equal(snapshot.route.focusedSegmentCount, 1);
assert.equal(snapshot.shared.revision, 7);
assert.equal(snapshot.shared.hasAuthoritativeExpiry, true);
assert.equal(snapshot.provider.backendRelease, "v0.11.1");
assert.equal(snapshot.pwa.serviceWorkerControlled, true);
assert.equal(snapshot.pwa.standalone, true);
assert.equal(snapshot.offlineJourney.available, true);
assert.equal(snapshot.offlineJourney.saved, true);
assert.equal(snapshot.offlineJourney.segmentCount, 2);
assert.equal(snapshot.offlineJourney.ageMinutes, 9);
assert.equal(snapshot.offlineJourney.realtimeContextFresh, true);
assert.equal(snapshot.offlineJourney.hasAuthoritativeExpiry, true);

sharedExpiry = "2026-08-28T18:00:00.000Z";
assert.equal(window.NVSDiagnostics0111.buildSnapshot().shared.hasAuthoritativeExpiry, true, "ISO backend expiry must be recognized");
sharedExpiry = null;
assert.equal(window.NVSDiagnostics0111.buildSnapshot().shared.hasAuthoritativeExpiry, false, "missing expiry must not masquerade as authoritative");
sharedExpiry = "not-a-date";
assert.equal(window.NVSDiagnostics0111.buildSnapshot().shared.hasAuthoritativeExpiry, false, "invalid expiry must not masquerade as authoritative");

const serialized = JSON.stringify(snapshot);
for (const forbiddenValue of ["Secret Person", "Secret Home", "Secret Stop", "Secret Destination", "secret-plan-id", "secret-key", "secret-capability", "secret-scope", "53.6", "11.4"]) {
  assert.equal(serialized.includes(forbiddenValue), false, `diagnostics must exclude sensitive value: ${forbiddenValue}`);
}

function collectKeys(value, keys = []) {
  if (!value || typeof value !== "object") return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    collectKeys(child, keys);
  }
  return keys;
}
const keys = collectKeys(snapshot);
for (const forbiddenKey of ["geometry", "planId", "capabilityKey", "key", "name", "origin", "lat", "lon", "longitude", "latitude", "members", "scope", "segments", "from", "to"]) {
  assert.equal(keys.includes(forbiddenKey), false, `diagnostics must exclude sensitive field: ${forbiddenKey}`);
}

assert.match(snapshot.privacy, /No names, coordinates, route geometry, capability keys, plan IDs, or location readings/);
assert.match(source, /offlineSummary/, "debug snapshots should report sanitized offline-fallback health for real-device bug reports");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "diagnostics must never request location");
assert.match(release, /diagnostics-v0111\.js/);
assert.match(release, /diagnostics-v0111\.css/);
assert.match(sw, /diagnostics-v0111\.js/);
assert.match(sw, /diagnostics-v0111\.css/);

console.log("diagnostics-privacy: sanitized bug snapshot excludes sensitive values, reports offline fallback health, and validates authoritative expiry formats");
