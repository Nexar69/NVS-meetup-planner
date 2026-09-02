const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const timeoutSource = fs.readFileSync(path.resolve(__dirname, "../shared-live-timeout-v0111.js"), "utf8");
const connectionSource = fs.readFileSync(path.resolve(__dirname, "../shared-connection-v0111.js"), "utf8");

// The timeout wrapper owns transport health, not UI. Safari may freeze or hide the page while
// a bounded request is still settling, so late timeout/degraded signals must fail closed before
// they can wake lifecycle-aware consumers or transient UI.
assert.match(timeoutSource, /nvs-shared-live-timeout/);
assert.match(timeoutSource, /nvs-shared-live-degraded/);
assert.match(timeoutSource, /let lifecycleFrozen = false/);
assert.match(timeoutSource, /function ownsForegroundLifecycle\(\) \{[\s\S]*?return !lifecycleFrozen && \(typeof document === "undefined" \|\| !document\.hidden\);[\s\S]*?\}/,
  "transport notices must require visible, non-bfcache-frozen lifecycle ownership while remaining safe in non-DOM harnesses");
assert.match(timeoutSource, /function shouldAnnounceForRequest\(input\) \{[\s\S]*?if \(!ownsForegroundLifecycle\(\)\) return false/,
  "late timeout/degraded completions must fail closed before dispatching transient events");
assert.match(timeoutSource, /addEventListener\?\.\("pagehide", \(\) => \{ lifecycleFrozen = true; \}\)/,
  "pagehide must close transport-notice ownership before in-flight requests can settle");
assert.match(timeoutSource, /addEventListener\?\.\("pageshow", \(\) => \{ lifecycleFrozen = false; \}\)/,
  "pageshow must reopen transport-notice ownership for foreground reconciliation");
assert.match(timeoutSource, /if \(typeof document !== "undefined"\) \{[\s\S]*?visibilitychange/,
  "visibility ownership hook must be guarded so transport-only harnesses stay valid");
assert.doesNotMatch(timeoutSource, /innerHTML|textContent|classList|dataset/,
  "transport timeout layer must remain DOM-mutation-free");

assert.match(connectionSource, /let lifecycleFrozen = false/);
assert.match(connectionSource, /function onLiveTimeout\(\) \{ if \(!lifecycleFrozen && !document\.hidden\) markFailure/,
  "timeout consumers must independently ignore events while frozen or hidden");
assert.match(connectionSource, /function onLiveDegraded\(\) \{ if \(!lifecycleFrozen && !document\.hidden\) markFailure/,
  "HTTP-overload/degraded consumers must independently ignore events while frozen or hidden");
assert.match(connectionSource, /addEventListener\("pagehide",[\s\S]*?lifecycleFrozen = true/,
  "pagehide must close Shared Connection UI ownership before late transport completions can arrive");
assert.match(connectionSource, /function onPageShow\(\) \{[\s\S]*?lifecycleFrozen = false;[\s\S]*?!document\.hidden[\s\S]*?reconcileLifecycle\(\)/,
  "pageshow must reopen ownership only when visible and reconcile current state rather than replaying suspended transport events");
assert.match(connectionSource, /function markFailure[\s\S]*?if \(lifecycleFrozen \|\| document\.hidden\) return lastFailureAt/,
  "direct failure bookkeeping must also fail closed during bfcache suspension or hidden-tab ownership loss");

// Reconnect ownership is the other half of this boundary: old GETs can settle for their
// original callers, but they cannot become authoritative health signals after recovery.
assert.match(timeoutSource, /getGenerationEpoch \+= 1/);
assert.match(timeoutSource, /pendingGets\.clear\(\)/);
assert.match(timeoutSource, /isCurrentGetGeneration\(options\.getGeneration\)/);

for (const [name, source] of [["timeout", timeoutSource], ["connection", connectionSource]]) {
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|watchPosition|getCurrentPosition|geolocation/,
    `${name} lifecycle boundary must remain memory-only and must not add location tracking`);
}

console.log("shared-live-timeout-bfcache-contract: transport/UI ownership, reconnect generation isolation, frozen/hidden suppression, and no-storage/no-GPS boundaries passed");
