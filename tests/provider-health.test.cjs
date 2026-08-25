const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const runtime = fs.readFileSync(path.join(root, "provider-health-v0111.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "provider-health-v0111.css"), "utf8");
const release = fs.readFileSync(path.join(root, "release-v011.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");

assert.match(runtime, /\/api\/health/, "diagnostics should use the Worker health endpoint");
assert.match(runtime, /EXPECTED_RELEASE = "v0\.11\.1"/, "diagnostics should verify the expected Worker release");
for (const capability of ["sharedCheckins", "organizerReplan", "capabilityRevocation", "realtimeDisruptions", "authoritativeExpiry"]) {
  assert.match(runtime, new RegExp(capability), `diagnostics should verify ${capability}`);
}
assert.match(runtime, /shared-session lifecycle support/i, "matched health copy should acknowledge lifecycle compatibility");
assert.match(runtime, /credentials: "omit"/, "health probes must not send ambient credentials");
assert.match(runtime, /cache: "no-store"/, "health probes must not use stale health responses");
assert.match(runtime, /AbortController/, "health probes should have a bounded timeout");
assert.match(runtime, /document\.hidden/, "hidden pages should suspend periodic diagnostics work");
assert.match(runtime, /no location data is sent by this check/i, "diagnostics UI should state the privacy boundary");
assert.doesNotMatch(runtime, /geolocation|watchPosition|getCurrentPosition/, "health diagnostics must never access location APIs");
assert.match(release, /loadProviderHealth0111/, "release owner should load provider diagnostics");
assert.match(release, /provider-health-v0111\.js/, "provider diagnostics runtime must be wired");
assert.match(release, /provider-health-v0111\.css/, "provider diagnostics styles must be wired");
assert.match(sw, /meet-schwerin-v0\.11\.1-r9/, "provider diagnostics should follow the current offline app shell revision");
assert.match(sw, /provider-health-v0111\.js/, "provider diagnostics runtime must be cached for the PWA");
assert.match(sw, /provider-health-v0111\.css/, "provider diagnostics styles must be cached for the PWA");
assert.match(styles, /min-height:44px/, "system status disclosure should preserve a mobile-sized touch target");
assert.match(styles, /forced-colors:active/, "provider diagnostics should support high-contrast mode");

console.log("provider-health: backend drift, lifecycle, privacy and PWA wiring looks consistent");
