const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../map.js"), "utf8");

assert.match(source, /refreshPending:\s*false/,
  "map scheduler should remember deferred work while hidden");
assert.match(source, /refreshGeneration:\s*0/,
  "map scheduler should invalidate stale in-flight refresh results");
assert.match(source, /function scheduleRefresh[\s\S]*document\.hidden[\s\S]*refreshPending = true[\s\S]*return;/,
  "map refresh scheduling should not arm a timer while hidden");
assert.match(source, /function suspendRefresh[\s\S]*clearTimeout\(state\.refreshTimer\)[\s\S]*refreshGeneration \+= 1/,
  "hiding the page should cancel pending work and invalidate in-flight work");
assert.match(source, /const refreshId = \+\+state\.refreshGeneration/,
  "each live map refresh should have a generation token");
assert.match(source, /document\.hidden \|\| refreshId !== state\.refreshGeneration/,
  "in-flight route responses must not repaint a hidden or superseded map");
assert.match(source, /visibilitychange/,
  "map scheduler should react to foreground/background transitions");
assert.match(source, /pageshow/,
  "map scheduler should resume after Safari bfcache restoration");
assert.match(source, /nvs-shared-view-resumed/,
  "map scheduler should resume with the shared-view lifecycle");
assert.match(source, /invalidateSize/,
  "foreground resume should refresh Leaflet sizing before route redraw");
assert.doesNotMatch(source, /setInterval\(/,
  "map lifecycle must remain one-shot/debounced rather than fixed polling");

console.log("map-scheduler: hidden-tab suspension, stale-response invalidation and Safari resume contracts passed");
