const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../personal-v074.js"), "utf8");

assert.match(source, /let frozenDocument = false;/,
  "personal itinerary should own an explicit frozen-document boundary");
assert.match(source, /let resultsObserver = null;/,
  "personal itinerary should retain MutationObserver ownership across suspension");
assert.match(source, /function suspendDocument\(\)[\s\S]*frozenDocument = true;[\s\S]*cancelTimers\(\);[\s\S]*disconnectObserver\(\);/,
  "pagehide should cancel scheduled UI work and disconnect the results observer");
assert.match(source, /function restoreDocument\(\)[\s\S]*frozenDocument = false;[\s\S]*connectObserver\(\);[\s\S]*resumePersonalItinerary\(\);/,
  "pageshow should reacquire ownership and reconcile current personal-view scope fresh");
assert.match(source, /function resumePersonalItinerary\(\)[\s\S]*if \(isSuspended\(\)\) return;[\s\S]*if \(!isPersonalView\(\)\)[\s\S]*cancelTimers\(\);[\s\S]*clearPersonalUi\(\);/,
  "restore must fail closed when an organizer revision removes personal-view scope");
assert.match(source, /function clearRecommendations\(\)[\s\S]*cancelTimers\(\);[\s\S]*if \(frozenDocument\) return;[\s\S]*clearPersonalUi\(\);/,
  "authoritative recommendation clears should cancel work while deferring frozen DOM cleanup");
assert.match(source, /nvs-group-recommendations-rendered", \(\) => \{[\s\S]*if \(!frozenDocument\) render\(\);/,
  "late recommendation renders must not mutate a frozen personal itinerary");
assert.match(source, /function connectObserver\(\)[\s\S]*if \(frozenDocument \|\| !results \|\| resultsObserver\) return;[\s\S]*new MutationObserver/,
  "observer ownership should not be acquired while frozen");
assert.match(source, /window\.addEventListener\("pagehide", suspendDocument\)/,
  "personal itinerary must explicitly suspend on pagehide");
assert.match(source, /window\.addEventListener\("pageshow", restoreDocument\)/,
  "personal itinerary must explicitly restore on pageshow");
assert.doesNotMatch(source, /watchPosition\s*\(/,
  "personal itinerary lifecycle hardening must not add continuous location tracking");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/,
  "personal itinerary lifecycle ownership should remain memory-only");

console.log("personal-bfcache-ownership: timer, observer, plan-scope restore and privacy contracts passed");
