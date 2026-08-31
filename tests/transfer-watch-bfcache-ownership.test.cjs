const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../transfer-watch-v0111.js"), "utf8");

assert.match(source, /let lifecycleFrozen = false;/, "Transfer Watch should own an explicit memory-only lifecycle freeze flag");
assert.match(source, /function render\(now = Date\.now\(\)\) \{\s*if \(lifecycleFrozen\) return null;/s, "direct renders must be inert while bfcache owns the document");
assert.match(source, /function refresh\(\) \{\s*if \(lifecycleFrozen\) return;/s, "late live and plan refresh events must be inert while frozen");
assert.match(source, /if \(lifecycleFrozen \|\| document\.hidden \|\| !recommendationsActive\) return;/, "timers must stay stopped while frozen");
assert.match(source, /timer = setTimeout\(\(\) => \{\s*if \(lifecycleFrozen\) return;/s, "an already queued timer callback must lose authority after pagehide");
assert.match(source, /function clearRecommendationState\(\) \{\s*if \(lifecycleFrozen\) return;/s, "late recommendation-clear events must not mutate frozen state or DOM");
assert.match(source, /function activateRecommendationState\(\) \{\s*if \(lifecycleFrozen\) return;/s, "late recommendation-rendered events must not restart frozen work");
assert.match(source, /function freezeLifecycle\(\) \{\s*lifecycleFrozen = true;\s*clearTimeout\(timer\);\s*timer = null;\s*\}/s, "pagehide should invalidate timer ownership without repainting the frozen DOM");
assert.match(source, /function resumeLifecycle\(\) \{\s*lifecycleFrozen = false;\s*recommendationsActive = Boolean\(window\.__NVS_LAST_RECOMMENDATIONS__\?\.primary\?\.assignments\?\.length\);\s*refresh\(\);\s*\}/s, "pageshow should reconcile current recommendation state instead of replaying frozen events");
assert.match(source, /addEventListener\("pagehide", freezeLifecycle\)/, "Transfer Watch should freeze explicitly on pagehide");
assert.match(source, /addEventListener\("pageshow", resumeLifecycle\)/, "Transfer Watch should resume explicitly on pageshow");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, "lifecycle ownership must remain memory-only");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "bfcache hardening must not introduce location tracking");

console.log("transfer-watch-bfcache-ownership: freeze, queued timer invalidation, fresh pageshow reconcile and privacy boundary passed");