const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../diagnostics-v0111.js"), "utf8");
const release = fs.readFileSync(path.resolve(__dirname, "../release-v011.js"), "utf8");
const sw = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

const window = {
  NVSShare: {
    getSharedPlan: () => ({ members: [{ name: "Secret Person", origin: { lat: 53.6, lon: 11.4 } }] }),
    getFocusIndex: () => 0,
  },
  NVSSharedLive: {
    getState: () => ({
      planId: "secret-plan-id",
      revision: 7,
      expiresAt: Date.now() + 60_000,
      members: { "0": { status: "on-vehicle", at: Date.now(), key: "secret-key" } },
    }),
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

vm.runInNewContext(source, { window, document, navigator, Date, Number, String, Boolean, Object, Array, JSON });
const snapshot = window.NVSDiagnostics0111.buildSnapshot(new Date("2026-08-25T18:00:00.000Z"));

assert.equal(snapshot.schema, "meet-schwerin-diagnostics-v1");
assert.equal(snapshot.view, "personal-shared");
assert.equal(snapshot.route.assignmentCount, 1);
assert.equal(snapshot.route.focusedSegmentCount, 1);
assert.equal(snapshot.shared.revision, 7);
assert.equal(snapshot.shared.hasAuthoritativeExpiry, true);
assert.equal(snapshot.provider.backendRelease, "v0.11.1");
assert.equal(snapshot.pwa.serviceWorkerControlled, true);
assert.equal(snapshot.pwa.standalone, true);

const serialized = JSON.stringify(snapshot);
for (const forbiddenValue of ["Secret Person", "Secret Home", "Secret Stop", "secret-plan-id", "secret-key", "53.6", "11.4"]) {
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
for (const forbiddenKey of ["geometry", "planId", "capabilityKey", "key", "name", "origin", "lat", "lon", "longitude", "latitude", "members"]) {
  assert.equal(keys.includes(forbiddenKey), false, `diagnostics must exclude sensitive field: ${forbiddenKey}`);
}

assert.match(snapshot.privacy, /No names, coordinates, route geometry, capability keys, plan IDs, or location readings/);
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "diagnostics must never request location");
assert.match(release, /diagnostics-v0111\.js/);
assert.match(release, /diagnostics-v0111\.css/);
assert.match(sw, /diagnostics-v0111\.js/);
assert.match(sw, /diagnostics-v0111\.css/);

console.log("diagnostics-privacy: sanitized bug snapshot excludes sensitive values and structural fields");
