const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../trip-guidance-v0111.js"), "utf8");

assert.match(source, /let lifecycleFrozen = false;/, "Trip Guidance should own an explicit memory-only lifecycle freeze flag");
assert.match(source, /function ownsForeground\(\) \{ return !lifecycleFrozen && !document\.hidden; \}/,
  "Trip Guidance should centralize ordinary-hidden and bfcache foreground ownership");
assert.match(source, /let mutationRefreshTimer = null;/, "queued mutation refreshes should have explicit timer ownership");
assert.match(source, /function freezeLifecycle\(\) \{\s*lifecycleFrozen = true;\s*clearTimeout\(timer\);\s*timer = null;\s*cancelMutationRefresh\(\);\s*stopObserving\(\);\s*\}/s,
  "pagehide should release countdown ownership and already queued MutationObserver work before disconnecting observation");
assert.match(source, /function resumeLifecycle\(\) \{\s*lifecycleFrozen = false;\s*refresh\(\);\s*\}/s,
  "pageshow should reconcile current guidance instead of replaying frozen work");
assert.match(source, /addEventListener\("pagehide", freezeLifecycle\)/, "Trip Guidance should freeze explicitly on pagehide");
assert.match(source, /addEventListener\("pageshow", resumeLifecycle\)/, "Trip Guidance should resume explicitly on pageshow");
assert.match(source, /function renderGuidance\(\) \{\s*if \(!ownsForeground\(\)\) return;/s,
  "direct renders must be inert whenever the document does not own the visible foreground");
assert.match(source, /function refresh\(\) \{\s*if \(!ownsForeground\(\)\) return;/s,
  "direct live/recommendation refresh events must be inert while hidden or frozen");
assert.match(source, /if \(!ownsForeground\(\) \|\| mutationRefreshQueued\) return;/,
  "MutationObserver callbacks must not queue new render work while hidden or frozen");
assert.match(source, /mutationRefreshTimer = null;\s*mutationRefreshQueued = false;\s*if \(!ownsForeground\(\)\) return;/s,
  "a mutation callback that somehow runs late must release ownership and remain DOM-inert while hidden or frozen");
assert.match(source, /function cancelMutationRefresh\(\) \{[\s\S]*clearTimeout\(mutationRefreshTimer\);[\s\S]*mutationRefreshQueued = false;/,
  "cancellation should clear both the timer and queued latch so fresh post-restore work can proceed");
assert.match(source, /if \(!ownsForeground\(\) \|\| !isPersonalSharedView\(\)\) return;/,
  "countdown scheduling must stay stopped without foreground ownership");
assert.match(source, /timer = setTimeout\(\(\) => \{\s*timer = null;\s*if \(!ownsForeground\(\)\) return;/s,
  "a countdown callback that already escaped cancellation must re-check foreground ownership before rendering or rearming");
assert.match(source, /function clearRecommendationGuidance\(\) \{\s*cancelMutationRefresh\(\);\s*clearTimeout\(timer\);\s*timer = null;\s*stopObserving\(\);\s*if \(!ownsForeground\(\)\) return;\s*removeGuidance\(\);\s*\}/s,
  "recommendation clear must release queued ownership even while suspended without mutating hidden/frozen DOM");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, "lifecycle ownership must remain memory-only");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "bfcache hardening must not introduce location tracking");

console.log("trip-guidance-bfcache-ownership: unified foreground ownership, late-work invalidation, pageshow reconcile and privacy boundary passed");
