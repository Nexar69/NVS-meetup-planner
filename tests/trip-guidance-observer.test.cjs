const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../trip-guidance-v0111.js"), "utf8");

assert.match(source, /function observeGuidanceSurfaces\(\)/, "trip guidance should own an explicit observer lifecycle");
assert.match(source, /const resultsRoot = document\.getElementById\("results"\)/, "trip guidance should scope discovery to the planner results root");
assert.match(source, /\[resultsRoot, personalPlan, sharedPanel\]/, "only relevant guidance/shared-plan surfaces should be observed");
assert.doesNotMatch(source, /\.observe\(document\.body\s*,/, "trip guidance must not observe the entire document body on mobile Safari");
assert.match(source, /if \(document\.hidden\) \{ clearTimeout\(timer\); stopObserving\(\); \}/, "hidden pages should stop both countdown work and mutation observation");
assert.match(source, /nvs-shared-view-resumed/, "Safari/bfcache shared-view resumes should re-arm guidance cleanly");
assert.match(source, /observer\.disconnect\(\)/, "observer targets should be replaced instead of accumulated across rerenders");
assert.match(source, /function clearRecommendationGuidance\(\)/, "empty recommendation transitions should have an explicit Trip Guidance teardown path");
assert.match(source, /clearTimeout\(timer\);\s*stopObserving\(\);\s*removeGuidance\(\);/, "Trip Guidance teardown should cancel countdown work, stop mutation observation and remove stale guidance immediately");
assert.match(source, /addEventListener\("nvs-recommendations-cleared", clearRecommendationGuidance\)/, "Trip Guidance should consume the authoritative recommendation-cleared lifecycle event");
assert.match(source, /nvs-group-recommendations-rendered/, "fresh recommendation renders should remain able to re-arm Trip Guidance after a clear");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "observer and recommendation lifecycle hardening must not introduce location tracking");

console.log("trip-guidance-observer: scoped observation, authoritative clear teardown, fresh-render re-arm, Safari suspension and no-GPS boundary passed");
