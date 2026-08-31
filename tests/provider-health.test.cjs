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
assert.match(runtime, /let lifecycleFrozen = false/, "provider health should own an explicit memory-only bfcache freeze boundary");
assert.match(runtime, /function cancelActiveCheck\(\)/, "network and visibility lifecycle changes should invalidate the current health probe");
assert.match(runtime, /requestGeneration \+= 1;\s*activeController\?\.abort\(\)/s, "cancellation must invalidate generation before aborting the old probe");
assert.match(runtime, /const generation = \+\+requestGeneration/, "each fresh health probe should claim a new generation");
assert.match(runtime, /if \(lifecycleFrozen \|\| generation !== requestGeneration\) return;/, "stale or frozen health responses must be rejected before updating UI state");
assert.match(runtime, /async function check\(\) \{\s*if \(lifecycleFrozen \|\| checking\) return;/s, "direct health checks must be inert while the document is frozen");
assert.match(runtime, /function render\(\) \{\s*if \(lifecycleFrozen\) return;/s, "late provider and network events must not repaint a frozen document");
assert.match(runtime, /function ensurePanel\(\) \{\s*if \(lifecycleFrozen\) return null;/s, "frozen work must not create diagnostics UI");
assert.match(runtime, /function schedule\(\) \{[\s\S]*if \(lifecycleFrozen \|\| document\.hidden\) return;/, "periodic diagnostics must not restart during bfcache suspension");
assert.match(runtime, /\["online", "offline"\][\s\S]*if \(lifecycleFrozen\) return;[\s\S]*cancelActiveCheck\(\)[\s\S]*void check\(\)/, "network transitions should be inert while frozen and otherwise replace stale probes");
assert.match(runtime, /function suspendWork\(\) \{[\s\S]*clearTimeout\(timer\)[\s\S]*cancelActiveCheck\(\)/, "suspending work should cancel both the periodic timer and in-flight probe");
assert.match(runtime, /function freezeLifecycle\(\) \{\s*lifecycleFrozen = true;\s*suspendWork\(\);\s*\}/s, "pagehide must revoke ownership before cancelling old asynchronous work");
assert.match(runtime, /window\.addEventListener\("pagehide", freezeLifecycle\)/, "pagehide must freeze diagnostics before Safari/bfcache can suspend it");
assert.match(runtime, /function resumeFromPageCache\(event\) \{[\s\S]*if \(!event\?\.persisted\) return;[\s\S]*suspendWork\(\);[\s\S]*lifecycleFrozen = false;[\s\S]*start\(\)/, "persisted pageshow should invalidate pre-cache work before reopening and reconciling fresh state");
assert.match(runtime, /window\.addEventListener\("pageshow", resumeFromPageCache\)/, "bfcache restore should have an explicit owned resume path");
assert.doesNotMatch(runtime, /window\.addEventListener\("pageshow", start\)/, "ordinary pageshow must not redundantly restart a probe already started during boot");
assert.match(runtime, /visibilitychange[\s\S]*if \(lifecycleFrozen\) return;[\s\S]*if \(document\.hidden\) suspendWork\(\)/, "visibility changes must not reopen a frozen lifecycle and hidden pages should suspend ordinary work");
assert.match(runtime, /no location data is sent by this check/i, "diagnostics UI should state the privacy boundary");
assert.doesNotMatch(runtime, /geolocation|watchPosition|getCurrentPosition/, "health diagnostics must never access location APIs");
assert.doesNotMatch(runtime, /localStorage|sessionStorage|indexedDB/i, "provider-health lifecycle ownership must stay memory-only");

assert.doesNotMatch(runtime, /body\.innerHTML\s*=/, "backend/provider-derived diagnostics must never be inserted as dynamic HTML");
assert.match(runtime, /strong\.textContent\s*=\s*routing/, "routing-provider text should use textContent");
assert.match(runtime, /detailLine\.textContent\s*=\s*state\.detail/, "backend health detail should use textContent");
assert.match(runtime, /meta\.textContent\s*=/, "backend release metadata should use textContent");
assert.match(runtime, /body\.replaceChildren\(routingLine, detailLine, meta\)/, "safe diagnostic rows should replace the old content atomically");

assert.match(release, /loadProviderHealth0111/, "release owner should load provider diagnostics");
assert.match(release, /provider-health-v0111\.js/, "provider diagnostics runtime must be wired");
assert.match(release, /provider-health-v0111\.css/, "provider diagnostics styles must be wired");
assert.match(sw, /^const CACHE_NAME = "meet-schwerin-v0\.11\.1-r20";/, "provider diagnostics should follow the current offline app shell revision");
assert.match(sw, /provider-health-v0111\.js/, "provider diagnostics runtime must be cached for the PWA");
assert.match(sw, /provider-health-v0111\.css/, "provider diagnostics styles must be cached for the PWA");
assert.match(sw, /test-lab-v0111\.js/, "hardened Test Lab should remain available in the current PWA shell");
assert.match(sw, /test-lab-journey-v0111\.js/, "journey simulation should be available in the current offline Test Lab shell");
assert.match(styles, /min-height:44px/, "system status disclosure should preserve a mobile-sized touch target");
assert.match(styles, /forced-colors:active/, "provider diagnostics should support high-contrast mode");

console.log("provider-health: backend drift, explicit bfcache ownership, stale-probe isolation, safe text rendering, privacy and PWA r20 wiring look consistent");
