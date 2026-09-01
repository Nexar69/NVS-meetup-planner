const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../journey.js"), "utf8");

assert.match(source, /let refreshGeneration = 0;/, "journey enrichment should keep a generation token for async isolation");
assert.match(source, /function clearJourneyState\(\) \{[\s\S]*refreshGeneration \+= 1;[\s\S]*clearTimeout\(refreshTimer\);[\s\S]*currentRecommendations = null;[\s\S]*currentContext = null;[\s\S]*if \(frozenDocument\) return;/, "clearing journey data should invalidate pending work and clear cached journey state before touching owned DOM");
assert.match(source, /results\?\.querySelectorAll\("\.journey-v05"\)\.forEach\(\(details\) => details\.remove\(\)\);/, "clearing recommendations should remove stale journey timeline enrichments when DOM ownership is active");
assert.match(source, /function clearAuthoritativeJourneyState\(\) \{[\s\S]*recommendationsActive = false;[\s\S]*clearTimeout\(clockTimer\);[\s\S]*clearJourneyState\(\);/, "authoritative clearing should stop the journey clock before dropping cached data");
assert.match(source, /window\.addEventListener\("nvs-recommendations-cleared", clearAuthoritativeJourneyState\);/, "journey UI should consume the shared recommendation-cleared lifecycle event");
assert.match(source, /const generation = \+\+refreshGeneration;/, "each async journey refresh should capture a new generation");
assert.match(source, /await Promise\.all\([\s\S]*if \(isSuspended\(\) \|\| generation !== refreshGeneration \|\| !recommendationsActive\) return;/, "route responses from a hidden, frozen, invalidated or cleared generation must not repaint journey state");
assert.match(source, /window\.addEventListener\("nvs-group-recommendations-rendered", \(event\) => \{[\s\S]*if \(frozenDocument\) return;[\s\S]*recommendationsActive = true;[\s\S]*refreshGeneration \+= 1;/, "authoritative rendered recommendations should only reactivate owned state and invalidate older in-flight enrichment work before rehydrating");
assert.match(source, /function cancelJourneyWork\(\)[\s\S]*clearTimeout\(clockTimer\)[\s\S]*clearTimeout\(refreshTimer\)[\s\S]*refreshGeneration \+= 1;/, "backgrounding or freezing should invalidate in-flight journey refreshes as well as cancel scheduled work");
assert.match(source, /function suspendDocument\(\)[\s\S]*frozenDocument = true;[\s\S]*cancelJourneyWork\(\);[\s\S]*disconnectObservers\(\);/, "pagehide should revoke journey timers, async work and observer ownership");
assert.match(source, /function restoreDocument\(\)[\s\S]*recommendationsActive = Boolean\(window\.__NVS_LAST_RECOMMENDATIONS__\?\.primary\)[\s\S]*currentRecommendations = recommendationsActive \? window\.__NVS_LAST_RECOMMENDATIONS__ : null;/, "pageshow should rebuild journey authority from the current shared recommendation snapshot");
assert.doesNotMatch(source, /watchPosition\s*\(/, "journey lifecycle hardening must not introduce continuous location tracking");

console.log("journey-recommendation-lifecycle: clear transitions, bfcache ownership and async route isolation passed without adding GPS tracking");
