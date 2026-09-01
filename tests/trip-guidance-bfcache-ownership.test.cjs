const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../trip-guidance-v0111.js"), "utf8");

assert.match(source, /let lifecycleFrozen = false;/, "Trip Guidance should own an explicit memory-only lifecycle freeze flag");
assert.match(source, /let mutationRefreshTimer = null;/, "queued mutation refreshes should have explicit timer ownership");
assert.match(source, /function freezeLifecycle\(\) \{\s*lifecycleFrozen = true;\s*clearTimeout\(timer\);\s*cancelMutationRefresh\(\);\s*stopObserving\(\);\s*\}/s,
  "pagehide should cancel countdown and already queued MutationObserver work before disconnecting observation");
assert.match(source, /function resumeLifecycle\(\) \{\s*lifecycleFrozen = false;\s*refresh\(\);\s*\}/s, "pageshow should reconcile current guidance instead of replaying frozen work");
assert.match(source, /addEventListener\("pagehide", freezeLifecycle\)/, "Trip Guidance should freeze explicitly on pagehide");
assert.match(source, /addEventListener\("pageshow", resumeLifecycle\)/, "Trip Guidance should resume explicitly on pageshow");
assert.match(source, /function renderGuidance\(\) \{\s*if \(lifecycleFrozen\) return;/s, "direct renders must be inert while bfcache owns the document");
assert.match(source, /function refresh\(\) \{ if \(lifecycleFrozen\) return;/, "direct live/recommendation refresh events must be inert while frozen");
assert.match(source, /if \(lifecycleFrozen \|\| mutationRefreshQueued\) return;/, "MutationObserver callbacks must not queue new render work while frozen");
assert.match(source, /mutationRefreshTimer = null;\s*mutationRefreshQueued = false;\s*if \(lifecycleFrozen \|\| document\.hidden\) return;/s,
  "a mutation callback that somehow runs late must release ownership and remain DOM-inert while frozen or hidden");
assert.match(source, /function cancelMutationRefresh\(\) \{[\s\S]*clearTimeout\(mutationRefreshTimer\);[\s\S]*mutationRefreshQueued = false;/,
  "cancellation should clear both the timer and queued latch so fresh post-restore work can proceed");
assert.match(source, /if \(lifecycleFrozen \|\| document\.hidden \|\| !isPersonalSharedView\(\)\) return;/, "countdown scheduling must stay stopped while frozen");
assert.match(source, /function clearRecommendationGuidance\(\) \{\s*cancelMutationRefresh\(\);\s*if \(lifecycleFrozen\) return;/s,
  "recommendation clear must cancel queued work even while frozen, without mutating the frozen DOM");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, "lifecycle ownership must remain memory-only");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "bfcache hardening must not introduce location tracking");

console.log("trip-guidance-bfcache-ownership: pagehide timer cancellation, late-work invalidation, pageshow reconcile and privacy boundary passed");
