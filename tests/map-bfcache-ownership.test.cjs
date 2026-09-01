const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../map.js"), "utf8");

assert.match(source, /frozen:\s*false/,
  "map lifecycle should own an explicit in-memory frozen-document boundary");
assert.match(source, /function isSuspended\(\) \{ return state\.frozen \|\| document\.hidden; \}/,
  "map work should treat bfcache suspension and document visibility as separate ownership signals");
assert.match(source, /function suspendDocument\(\)[\s\S]*state\.frozen = true[\s\S]*suspendRefresh\(\)[\s\S]*dataBadgeObserver\?\.disconnect\(\)[\s\S]*resultsObserver\?\.disconnect\(\)/,
  "pagehide should cancel refresh ownership and disconnect map observers");
assert.match(source, /function resumeDocument\(\)[\s\S]*state\.frozen = false[\s\S]*observeMapDom\(\)[\s\S]*resumeRefresh\(\)/,
  "pageshow should reacquire observer and refresh ownership rather than replay frozen work");
assert.match(source, /addEventListener\("pagehide", suspendDocument\)/,
  "map lifecycle must explicitly suspend on pagehide");
assert.match(source, /addEventListener\("pageshow", resumeDocument\)/,
  "map lifecycle must explicitly resume on pageshow");
assert.match(source, /if \(isSuspended\(\) \|\| refreshId !== state\.refreshGeneration\)/,
  "late route fetch completions must not repaint a frozen or superseded map");
assert.match(source, /nvs-group-recommendations-rendered", \(event\) => \{[\s\S]*if \(isSuspended\(\)\)[\s\S]*refreshPending = true[\s\S]*return;/,
  "late recommendation events must not become authoritative while the document is frozen");
assert.match(source, /addEventListener\("resize", \(\) => \{[\s\S]*if \(!isSuspended\(\)\) state\.map\?\.invalidateSize/,
  "resize invalidation must not touch Leaflet while the page is suspended");
assert.match(source, /function clearRecommendationState\(\)[\s\S]*state\.recommendations = null[\s\S]*state\.context = null[\s\S]*if \(isSuspended\(\)\)[\s\S]*return;/,
  "authoritative clears should update memory while keeping frozen DOM untouched");
assert.doesNotMatch(source, /watchPosition\s*\(/,
  "map lifecycle hardening must not add continuous location tracking");
assert.doesNotMatch(source, /localStorage|indexedDB/,
  "map lifecycle ownership should remain memory-only");

console.log("map-bfcache-ownership: pagehide freeze, observer disconnect, async generation isolation and privacy contracts passed");
