const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../trip-guidance-v0111.js"), "utf8");

assert.match(source, /function observeGuidanceSurfaces\(\)/, "trip guidance should own an explicit observer lifecycle");
assert.match(source, /const resultsRoot = document\.getElementById\("results"\)/, "trip guidance should scope discovery to the planner results root");
assert.match(source, /\[resultsRoot, personalPlan, sharedPanel\]/, "only relevant guidance/shared-plan surfaces should be observed");
assert.doesNotMatch(source, /\.observe\(document\.body\s*,/, "trip guidance must not observe the entire document body on mobile Safari");
assert.match(source, /if \(document\.hidden\) \{ clearTimeout\(timer\); cancelMutationRefresh\(\); stopObserving\(\); \}/,
  "hidden pages should stop countdown work, queued mutation refreshes, and mutation observation");
assert.match(source, /nvs-shared-view-resumed/, "Safari/bfcache shared-view resumes should re-arm guidance cleanly");
assert.match(source, /observer\.disconnect\(\)/, "observer targets should be replaced instead of accumulated across rerenders");
assert.match(source, /function cancelMutationRefresh\(\)/, "queued mutation work should have an explicit cancellation path");
assert.match(source, /function clearRecommendationGuidance\(\) \{\s*cancelMutationRefresh\(\);[\s\S]*clearTimeout\(timer\);\s*stopObserving\(\);\s*removeGuidance\(\);/,
  "Trip Guidance teardown should cancel queued mutation/countdown work, stop observation and remove stale guidance immediately");
assert.match(source, /function freezeLifecycle\(\) \{[\s\S]*clearTimeout\(timer\);\s*cancelMutationRefresh\(\);\s*stopObserving\(\);/,
  "pagehide should cancel queued mutation work before the frozen document can be woken by it");
assert.match(source, /addEventListener\("nvs-recommendations-cleared", clearRecommendationGuidance\)/, "Trip Guidance should consume the authoritative recommendation-cleared lifecycle event");
assert.match(source, /nvs-group-recommendations-rendered/, "fresh recommendation renders should remain able to re-arm Trip Guidance after a clear");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "observer and recommendation lifecycle hardening must not introduce location tracking");

console.log("trip-guidance-observer: scoped observation, queued-work cancellation, authoritative clear teardown, fresh-render re-arm, Safari suspension and no-GPS boundary passed");
