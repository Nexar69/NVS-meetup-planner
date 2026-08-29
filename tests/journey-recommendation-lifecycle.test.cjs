const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../journey.js"), "utf8");

assert.match(source, /let refreshGeneration = 0;/, "journey enrichment should keep a generation token for async isolation");
assert.match(source, /function clearJourneyState\(\) \{[\s\S]*refreshGeneration \+= 1;[\s\S]*clearTimeout\(refreshTimer\);[\s\S]*currentRecommendations = null;[\s\S]*currentContext = null;/, "clearing journey data should invalidate pending work and clear cached journey state");
assert.match(source, /results\?\.querySelectorAll\("\.journey-v05"\)\.forEach\(\(details\) => details\.remove\(\)\);/, "clearing recommendations should remove stale journey timeline enrichments");
assert.match(source, /function clearAuthoritativeJourneyState\(\) \{[\s\S]*recommendationsActive = false;[\s\S]*clearTimeout\(clockTimer\);[\s\S]*clearJourneyState\(\);/, "authoritative clearing should stop the journey clock before dropping cached data");
assert.match(source, /window\.addEventListener\("nvs-recommendations-cleared", clearAuthoritativeJourneyState\);/, "journey UI should consume the shared recommendation-cleared lifecycle event");
assert.match(source, /const generation = \+\+refreshGeneration;/, "each async journey refresh should capture a new generation");
assert.match(source, /await Promise\.all\([\s\S]*if \(generation !== refreshGeneration \|\| !recommendationsActive\) return;/, "route responses from an invalidated or cleared generation must not repaint journey state");
assert.match(source, /window\.addEventListener\("nvs-group-recommendations-rendered", \(event\) => \{[\s\S]*recommendationsActive = true;[\s\S]*refreshGeneration \+= 1;/, "authoritative rendered recommendations should reactivate state and invalidate older in-flight enrichment work before rehydrating");
assert.match(source, /if \(document\.hidden\) \{[\s\S]*clearTimeout\(refreshTimer\);[\s\S]*refreshGeneration \+= 1;/, "backgrounding the page should invalidate an in-flight journey refresh as well as cancel scheduled work");
assert.doesNotMatch(source, /watchPosition\s*\(/, "journey lifecycle hardening must not introduce continuous location tracking");

console.log("journey-recommendation-lifecycle: clear transitions stop timers, tear down stale UI and invalidate older async route responses without adding GPS tracking");
