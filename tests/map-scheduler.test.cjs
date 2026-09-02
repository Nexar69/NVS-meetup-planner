const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../map.js"), "utf8");

assert.match(source, /refreshPending:\s*false/,
  "map scheduler should remember deferred work while suspended");
assert.match(source, /refreshGeneration:\s*0/,
  "map scheduler should invalidate stale in-flight refresh results");
assert.match(source, /function scheduleRefresh[\s\S]*isSuspended\(\)[\s\S]*refreshPending = true[\s\S]*return;/,
  "map refresh scheduling should not arm a timer while hidden or bfcache-frozen");
assert.match(source, /function suspendRefresh[\s\S]*clearTimeout\(state\.refreshTimer\)[\s\S]*refreshGeneration \+= 1/,
  "suspending page ownership should cancel pending work and invalidate in-flight work");
assert.match(source, /const refreshId = \+\+state\.refreshGeneration/,
  "each live map refresh should have a generation token");
assert.match(source, /isSuspended\(\) \|\| refreshId !== state\.refreshGeneration/,
  "in-flight route responses must not repaint a hidden, frozen, or superseded map");
assert.match(source, /function showRoutePreview\(\) \{[\s\S]*state\.recommendations = null;[\s\S]*state\.context = null;[\s\S]*state\.selectedType = "primary";[\s\S]*if \(isSuspended\(\)\)[\s\S]*updateTabs\(\);[\s\S]*tagResultCards\(\);[\s\S]*renderPreview\(\);/,
  "preview fallback must clear stale recommendation/context state without touching suspended DOM");
assert.match(source, /if \(!context\.target \|\| !window\.NVSTransit\?\.fetchRoutes \|\| !window\.NVSRecommend\?\.recommendGroup\) \{ showRoutePreview\(\); return; \}/,
  "invalid planner inputs or unavailable route machinery must drop stale live map state before showing the preview");
assert.match(source, /if \(!dataBadge\?\.classList\.contains\("live"\)\) \{[\s\S]*showRoutePreview\(\);[\s\S]*return;/,
  "non-live provider state must not retain an older live map recommendation");
assert.match(source, /if \(context\.members\.some\(\(member\) => !member\.originKey\)\) \{[\s\S]*showRoutePreview\(\);[\s\S]*return;/,
  "incomplete group origins must not retain an older route selection");
assert.match(source, /if \(routeSets\.some\(\(routes\) => !routes\.length\)\) \{ showRoutePreview\(\); return; \}/,
  "empty provider route sets must clear stale map recommendations");
assert.match(source, /if \(!recommendations\.primary\) \{ showRoutePreview\(\); return; \}/,
  "an empty recommendation result must clear stale map recommendations");
assert.match(source, /console\.warn\("Group map refresh failed:", error\);[\s\S]*showRoutePreview\(\);/,
  "failed live refreshes must leave the visible preview and internal map state consistent");
assert.match(source, /function clearRecommendationState[\s\S]*clearTimeout\(state\.refreshTimer\)[\s\S]*refreshGeneration \+= 1[\s\S]*state\.recommendations = null[\s\S]*state\.context = null[\s\S]*renderPreview\(\)/,
  "authoritative recommendation clearing must invalidate async work and use the same stale-state-safe preview transition");
assert.match(source, /addEventListener\("nvs-recommendations-cleared", clearRecommendationState\)/,
  "map lifecycle must consume the explicit recommendation-cleared boundary");
assert.match(source, /nvs-group-change", \(\) => \{ clearRecommendationState\(\); scheduleRefresh\(40\); \}/,
  "group edits should immediately clear obsolete map state before intentionally requesting a fresh planner route");
assert.match(source, /visibilitychange/,
  "map scheduler should react to foreground/background transitions");
assert.match(source, /pagehide/,
  "map scheduler should explicitly freeze across Safari bfcache suspension");
assert.match(source, /pageshow/,
  "map scheduler should resume after Safari bfcache restoration");
assert.match(source, /nvs-shared-view-resumed/,
  "map scheduler should resume with the shared-view lifecycle");
assert.match(source, /invalidateSize/,
  "foreground resume should refresh Leaflet sizing before route redraw");
assert.doesNotMatch(source, /setInterval\(/,
  "map lifecycle must remain one-shot/debounced rather than fixed polling");
assert.doesNotMatch(source, /watchPosition/,
  "map recommendation lifecycle must not add continuous location tracking");

console.log("map-scheduler: suspension, generation isolation, stale-map cleanup, planner refresh and Safari resume contracts passed");
