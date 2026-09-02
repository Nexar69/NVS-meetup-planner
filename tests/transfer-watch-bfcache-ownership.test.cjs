const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../transfer-watch-v0111.js"), "utf8");

assert.match(source, /let lifecycleFrozen = false;/, "Transfer Watch should own an explicit memory-only lifecycle freeze flag");
assert.match(source, /function render\(now = Date\.now\(\)\) \{\s*if \(lifecycleFrozen \|\| document\.hidden\) return null;/s, "direct renders must be inert while bfcache owns the document or the tab is hidden");
assert.match(source, /function refresh\(\) \{\s*if \(lifecycleFrozen \|\| document\.hidden\) return;/s, "late live and plan refresh events must be inert while frozen or hidden");
assert.match(source, /if \(lifecycleFrozen \|\| document\.hidden \|\| !recommendationsActive\) return;/, "timers must stay stopped while frozen, hidden, or without recommendation ownership");
assert.match(source, /timer = setTimeout\(\(\) => \{\s*timer = null;\s*if \(lifecycleFrozen \|\| document\.hidden \|\| !recommendationsActive\) return;/s, "an already queued timer callback must revalidate lifecycle, visibility, and recommendation ownership before DOM work");
assert.match(source, /function clearRecommendationState\(\) \{\s*if \(lifecycleFrozen\) return;/s, "late recommendation-clear events must not mutate frozen state or DOM");
assert.match(source, /recommendationsActive = false;\s*clearTimeout\(timer\);\s*timer = null;\s*if \(!document\.hidden\) removeCard\(\);/s, "authoritative recommendation clear should always cancel state/timers while deferring card removal until the document is visible");
assert.match(source, /function activateRecommendationState\(\) \{\s*if \(lifecycleFrozen\) return;/s, "late recommendation-rendered events must not restart frozen work");
assert.match(source, /function freezeLifecycle\(\) \{\s*lifecycleFrozen = true;\s*clearTimeout\(timer\);\s*timer = null;\s*\}/s, "pagehide should invalidate timer ownership without repainting the frozen DOM");
assert.match(source, /function resumeLifecycle\(\) \{\s*lifecycleFrozen = false;\s*recommendationsActive = Boolean\(window\.__NVS_LAST_RECOMMENDATIONS__\?\.primary\?\.assignments\?\.length\);\s*refresh\(\);\s*\}/s, "pageshow should reconcile current recommendation state instead of replaying frozen events");
assert.match(source, /addEventListener\("pagehide", freezeLifecycle\)/, "Transfer Watch should freeze explicitly on pagehide");
assert.match(source, /addEventListener\("pageshow", resumeLifecycle\)/, "Transfer Watch should resume explicitly on pageshow");
assert.match(source, /if \(document\.hidden\) \{\s*clearTimeout\(timer\);\s*timer = null;\s*\} else refresh\(\);/s, "hidden transitions should cancel queued periodic work and visible recovery should reconcile fresh state");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, "lifecycle ownership must remain memory-only");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "bfcache hardening must not introduce location tracking");

console.log("transfer-watch-bfcache-ownership: frozen/hidden work suppression, timer revalidation, fresh restore and privacy boundary passed");