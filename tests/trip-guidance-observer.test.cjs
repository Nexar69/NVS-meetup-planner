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
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "observer optimization must not introduce location tracking");

console.log("trip-guidance-observer: scoped results/personal/shared observation, hidden-page suspension, Safari resume and no-GPS boundary passed");
