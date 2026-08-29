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
assert.match(runtime, /let requestGeneration = 0/, "health probes should own a generation token");
assert.match(runtime, /let activeController = null/, "health probes should retain the active request controller for lifecycle cancellation");
assert.match(runtime, /function cancelActiveCheck\(\)/, "network and visibility lifecycle changes should invalidate the current health probe");
assert.match(runtime, /requestGeneration \+= 1;\s*activeController\?\.abort\(\)/s, "cancellation must invalidate generation before aborting the old probe");
assert.match(runtime, /const generation = \+\+requestGeneration/, "each fresh health probe should claim a new generation");
assert.match(runtime, /if \(generation !== requestGeneration\) return;/, "stale health responses must be rejected before updating UI state");
assert.match(runtime, /\["online", "offline"\][\s\S]*cancelActiveCheck\(\)[\s\S]*void check\(\)/, "network transitions should cancel stale probes before starting a fresh health check");
assert.match(runtime, /if \(document\.hidden\) \{[\s\S]*cancelActiveCheck\(\)/, "hidden pages should cancel in-flight diagnostics work as well as periodic timers");
assert.match(runtime, /document\.hidden/, "hidden pages should suspend periodic diagnostics work");
assert.match(runtime, /no location data is sent by this check/i, "diagnostics UI should state the privacy boundary");
assert.doesNotMatch(runtime, /geolocation|watchPosition|getCurrentPosition/, "health diagnostics must never access location APIs");

assert.doesNotMatch(runtime, /body\.innerHTML\s*=/, "backend/provider-derived diagnostics must never be inserted as dynamic HTML");
assert.match(runtime, /strong\.textContent\s*=\s*routing/, "routing-provider text should use textContent");
assert.match(runtime, /detailLine\.textContent\s*=\s*state\.detail/, "backend health detail should use textContent");
assert.match(runtime, /meta\.textContent\s*=/, "backend release metadata should use textContent");
assert.match(runtime, /body\.replaceChildren\(routingLine, detailLine, meta\)/, "safe diagnostic rows should replace the old content atomically");

assert.match(release, /loadProviderHealth0111/, "release owner should load provider diagnostics");
assert.match(release, /provider-health-v0111\.js/, "provider diagnostics runtime must be wired");
assert.match(release, /provider-health-v0111\.css/, "provider diagnostics styles must be wired");
assert.match(sw, /^const CACHE_NAME = "meet-schwerin-v0\.11\.1-r19";/, "provider diagnostics should follow the current offline app shell revision");
assert.match(sw, /provider-health-v0111\.js/, "provider diagnostics runtime must be cached for the PWA");
assert.match(sw, /provider-health-v0111\.css/, "provider diagnostics styles must be cached for the PWA");
assert.match(sw, /test-lab-v0111\.js/, "hardened Test Lab should remain available in the current PWA shell");
assert.match(sw, /test-lab-journey-v0111\.js/, "journey simulation should be available in the current offline Test Lab shell");
assert.match(styles, /min-height:44px/, "system status disclosure should preserve a mobile-sized touch target");
assert.match(styles, /forced-colors:active/, "provider diagnostics should support high-contrast mode");

console.log("provider-health: backend drift, stale-probe isolation, safe text rendering, lifecycle, privacy and PWA r19 wiring look consistent");
