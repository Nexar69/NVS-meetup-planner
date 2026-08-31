const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const timeoutSource = fs.readFileSync(path.resolve(__dirname, "../shared-live-timeout-v0111.js"), "utf8");
const connectionSource = fs.readFileSync(path.resolve(__dirname, "../shared-connection-v0111.js"), "utf8");

// The timeout wrapper owns transport health, not UI. Safari may freeze the page while
// a bounded request is still settling, so any late timeout/degraded signal must terminate
// at a lifecycle-aware consumer rather than mutating frozen UI directly.
assert.match(timeoutSource, /nvs-shared-live-timeout/);
assert.match(timeoutSource, /nvs-shared-live-degraded/);
assert.doesNotMatch(timeoutSource, /\bdocument\b|innerHTML|textContent|classList|dataset/,
  "transport timeout layer must remain DOM-free so frozen documents cannot be repainted directly");

assert.match(connectionSource, /let lifecycleFrozen = false/);
assert.match(connectionSource, /function onLiveTimeout\(\) \{ if \(!lifecycleFrozen\) markFailure/,
  "timeout events must be ignored while the shared document is frozen");
assert.match(connectionSource, /function onLiveDegraded\(\) \{ if \(!lifecycleFrozen\) markFailure/,
  "HTTP-overload/degraded events must be ignored while the shared document is frozen");
assert.match(connectionSource, /addEventListener\("pagehide",[\s\S]*?lifecycleFrozen = true/,
  "pagehide must close Shared Connection UI ownership before late transport completions can arrive");
assert.match(connectionSource, /function onPageShow\(\) \{[\s\S]*?lifecycleFrozen = false;[\s\S]*?reconcileLifecycle\(\)/,
  "pageshow must reopen ownership by reconciling current state rather than replaying frozen transport events");
assert.match(connectionSource, /function markFailure[\s\S]*?if \(lifecycleFrozen\) return lastFailureAt/,
  "direct failure bookkeeping must also fail closed during bfcache suspension");

// Reconnect ownership is the other half of this boundary: old GETs can settle for their
// original callers, but they cannot become authoritative health signals after recovery.
assert.match(timeoutSource, /getGenerationEpoch \+= 1/);
assert.match(timeoutSource, /pendingGets\.clear\(\)/);
assert.match(timeoutSource, /isCurrentGetGeneration\(options\.getGeneration\)/);

for (const [name, source] of [["timeout", timeoutSource], ["connection", connectionSource]]) {
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|watchPosition|getCurrentPosition|geolocation/,
    `${name} lifecycle boundary must remain memory-only and must not add location tracking`);
}

console.log("shared-live-timeout-bfcache-contract: transport/UI ownership, reconnect generation isolation, Safari freeze suppression, and no-storage/no-GPS boundaries passed");
