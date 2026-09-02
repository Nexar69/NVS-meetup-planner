const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../convergence-ui.js"), "utf8");

assert.match(source, /let frozenDocument = false/,
  "convergence UI should own an explicit in-memory frozen-document boundary");
assert.match(source, /let resultsObserver = null/,
  "convergence UI should retain observer ownership so it can disconnect on suspension");
assert.match(source, /function suspendDocument\(\)[\s\S]*frozenDocument = true[\s\S]*cancelDecoration\(\)[\s\S]*resultsObserver\?\.disconnect\(\)/,
  "pagehide should cancel queued decoration and disconnect the results observer");
assert.match(source, /function resumeDocument\(\)[\s\S]*frozenDocument = false[\s\S]*recommendationsActive = Boolean\(window\.__NVS_LAST_RECOMMENDATIONS__\)[\s\S]*observeResults\(\)[\s\S]*if \(recommendationsActive\) decorateExisting\(\)[\s\S]*else clearGeneratedDecoration\(\)/,
  "pageshow should reacquire observer ownership and reconcile current recommendation state fresh");
assert.match(source, /addEventListener\("pagehide", suspendDocument\)/,
  "convergence UI must explicitly suspend on pagehide");
assert.match(source, /addEventListener\("pageshow", resumeDocument\)/,
  "convergence UI must explicitly resume on pageshow");
assert.match(source, /function decorateExisting\(\)[\s\S]*if \(frozenDocument \|\| !recommendationsActive\) return;[\s\S]*setTimeout[\s\S]*if \(frozenDocument \|\| !recommendationsActive\) return;/,
  "both decoration scheduling and queued timer completion must fail closed while frozen");
assert.match(source, /function clearRecommendations\(\)[\s\S]*recommendationsActive = false[\s\S]*cancelDecoration\(\)[\s\S]*if \(frozenDocument\) return;[\s\S]*clearGeneratedDecoration\(\)/,
  "authoritative recommendation clears should update memory without touching frozen DOM");
assert.match(source, /function activateRecommendations\(\)[\s\S]*if \(frozenDocument\) return;[\s\S]*recommendationsActive = true/,
  "late recommendation-rendered events must not become authoritative while suspended");
assert.match(source, /function clearGeneratedDecoration\(\)[\s\S]*if \(frozenDocument \|\| !results\) return;/,
  "direct cleanup must not mutate a frozen results tree");
assert.doesNotMatch(source, /watchPosition\s*\(/,
  "convergence lifecycle hardening must not add continuous location tracking");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/,
  "convergence lifecycle ownership should remain memory-only");

console.log("convergence-ui-bfcache-ownership: timer, observer, event, restore and privacy contracts passed");
