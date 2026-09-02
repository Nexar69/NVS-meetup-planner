const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../journey.js"), "utf8");

assert.match(source, /let frozenDocument = false;/,
  "journey enrichment should own an explicit frozen-document boundary");
assert.match(source, /let dataBadgeObserver = null;[\s\S]*let resultsObserver = null;/,
  "journey enrichment should retain observer ownership for bfcache suspension");
assert.match(source, /function isSuspended\(\) \{[\s\S]*frozenDocument \|\| document\.hidden/,
  "journey work should treat visibility and bfcache ownership as separate suspension signals");
assert.match(source, /function suspendDocument\(\)[\s\S]*frozenDocument = true[\s\S]*cancelJourneyWork\(\)[\s\S]*disconnectObservers\(\)/,
  "pagehide should revoke timers, in-flight generations and observer ownership");
assert.match(source, /function restoreDocument\(\)[\s\S]*frozenDocument = false[\s\S]*recommendationsActive = Boolean\(window\.__NVS_LAST_RECOMMENDATIONS__\?\.primary\)[\s\S]*connectObservers\(\)[\s\S]*resumeJourney\(\)/,
  "pageshow should rebuild from current authoritative recommendation state rather than replay frozen work");
assert.match(source, /addEventListener\("pagehide", suspendDocument\)/,
  "journey enrichment must explicitly suspend on pagehide");
assert.match(source, /addEventListener\("pageshow", restoreDocument\)/,
  "journey enrichment must explicitly reconcile on pageshow");
assert.match(source, /await Promise\.all\([\s\S]*if \(isSuspended\(\) \|\| generation !== refreshGeneration \|\| !recommendationsActive\) return;/,
  "late route responses must not repaint a hidden, frozen, superseded or cleared journey");
assert.match(source, /function clearJourneyState\(\)[\s\S]*currentRecommendations = null;[\s\S]*currentContext = null;[\s\S]*if \(frozenDocument\) return;/,
  "authoritative clears should update memory while leaving frozen DOM untouched");
assert.match(source, /nvs-group-recommendations-rendered", \(event\) => \{[\s\S]*if \(frozenDocument\) return;/,
  "late recommendation-rendered events must not become authoritative while suspended");
assert.match(source, /function connectObservers\(\)[\s\S]*new MutationObserver[\s\S]*dataBadgeObserver\.observe[\s\S]*new MutationObserver[\s\S]*resultsObserver\.observe/,
  "journey observers should be explicitly reacquired after restoration");
assert.match(source, /recalculate: \(\) => \{[\s\S]*if \(!frozenDocument\) plannerForm\?\.requestSubmit\(\);/,
  "direct journey recalculation must remain inert while the document is frozen");
assert.doesNotMatch(source, /watchPosition\s*\(/,
  "journey bfcache hardening must not add continuous location tracking");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/,
  "journey lifecycle ownership should remain memory-only");

console.log("journey-bfcache-ownership: timers, observers, async generation, authoritative clear and privacy contracts passed");
