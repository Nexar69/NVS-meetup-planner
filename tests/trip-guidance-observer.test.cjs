const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../trip-guidance-v0111.js"), "utf8");

assert.match(source, /function observeGuidanceSurfaces\(\)/, "trip guidance should own an explicit observer lifecycle");
assert.match(source, /if \(!ownsForeground\(\) \|\| !\("MutationObserver" in window\)\) return;/,
  "observer acquisition should require visible, non-frozen foreground ownership");
assert.match(source, /const resultsRoot = document\.getElementById\("results"\)/, "trip guidance should scope discovery to the planner results root");
assert.match(source, /\[resultsRoot, personalPlan, sharedPanel\]/, "only relevant guidance/shared-plan surfaces should be observed");
assert.doesNotMatch(source, /\.observe\(document\.body\s*,/, "trip guidance must not observe the entire document body on mobile Safari");
assert.match(source, /if \(document\.hidden\) \{\s*clearTimeout\(timer\);\s*timer = null;\s*cancelMutationRefresh\(\);\s*stopObserving\(\);\s*\}/s,
  "hidden pages should release countdown work, queued mutation refreshes, and mutation observation");
assert.match(source, /nvs-shared-view-resumed/, "Safari/bfcache shared-view resumes should re-arm guidance cleanly");
assert.match(source, /observer\.disconnect\(\)/, "observer targets should be replaced instead of accumulated across rerenders");
assert.match(source, /function cancelMutationRefresh\(\)/, "queued mutation work should have an explicit cancellation path");
assert.match(source, /function clearRecommendationGuidance\(\) \{\s*cancelMutationRefresh\(\);\s*clearTimeout\(timer\);\s*timer = null;\s*stopObserving\(\);\s*if \(!ownsForeground\(\)\) return;\s*removeGuidance\(\);/s,
  "recommendation teardown should always release queued ownership while deferring hidden/frozen DOM removal until foreground reconciliation");
assert.match(source, /function freezeLifecycle\(\) \{[\s\S]*clearTimeout\(timer\);\s*timer = null;\s*cancelMutationRefresh\(\);\s*stopObserving\(\);/,
  "pagehide should release queued mutation/countdown work before the frozen document can be woken by it");
assert.match(source, /addEventListener\("nvs-recommendations-cleared", clearRecommendationGuidance\)/, "Trip Guidance should consume the authoritative recommendation-cleared lifecycle event");
assert.match(source, /nvs-group-recommendations-rendered/, "fresh recommendation renders should remain able to re-arm Trip Guidance after a clear");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "observer and recommendation lifecycle hardening must not introduce location tracking");

console.log("trip-guidance-observer: scoped foreground-owned observation, deferred hidden teardown, fresh-render re-arm, Safari suspension and no-GPS boundary passed");
