const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../stop-awareness-v0111.js"), "utf8");

assert.match(source, /let lifecycleFrozen = false;/, "Stop Awareness should own an explicit memory-only lifecycle freeze flag");
assert.match(source, /function render\(\) \{\s*if \(lifecycleFrozen\) return;/s, "direct renders must be inert while bfcache owns the document");
assert.match(source, /function refresh\(\) \{\s*if \(lifecycleFrozen\) return;/s, "live and plan refresh events must be inert while frozen");
assert.match(source, /if \(lifecycleFrozen \|\| document\.hidden \|\| queued \|\| !recommendationsActive\) return;/, "MutationObserver work must not queue after pagehide or while hidden");
assert.match(source, /if \(lifecycleFrozen \|\| document\.hidden \|\| !recommendationsActive\) return;/, "already queued observer work must lose authority after pagehide or a hidden transition");
assert.match(source, /if \(lifecycleFrozen \|\| document\.hidden \|\| !recommendationsActive/, "timers and observers must stay stopped while frozen or hidden");
assert.match(source, /function cancelQueuedRender\(\) \{[\s\S]*clearTimeout\(queuedTimer\);[\s\S]*queuedTimer = null;[\s\S]*queued = false;[\s\S]*\}/, "queued MutationObserver work should have one explicit cancellation owner");
assert.match(source, /function freezeLifecycle\(\) \{[\s\S]*lifecycleFrozen = true;[\s\S]*clearTimeout\(timer\);[\s\S]*cancelQueuedRender\(\);[\s\S]*observer\?\.disconnect\?\.\(\);[\s\S]*\}/, "pagehide should invalidate timer, queued render, and observer ownership without repainting the frozen DOM");
assert.match(source, /function resumeLifecycle\(\) \{\s*lifecycleFrozen = false;\s*recommendationsActive = Boolean\(window\.__NVS_LAST_RECOMMENDATIONS__\?\.primary\?\.assignments\?\.length\);\s*refresh\(\);\s*\}/s, "pageshow should reconcile current recommendation state instead of replaying frozen events");
assert.match(source, /addEventListener\("pagehide", freezeLifecycle\)/, "Stop Awareness should freeze explicitly on pagehide");
assert.match(source, /addEventListener\("pageshow", resumeLifecycle\)/, "Stop Awareness should resume explicitly on pageshow");
assert.match(source, /document\.addEventListener\("visibilitychange", \(\) => \{[\s\S]*if \(document\.hidden\) \{[\s\S]*cancelQueuedRender\(\);[\s\S]*observer\?\.disconnect\?\.\(\);/, "hidden transitions should actively cancel queued observer work instead of only guarding its callback");
assert.match(source, /function clearRecommendationState\(\) \{\s*if \(lifecycleFrozen\) return;/s, "late recommendation-clear events must not mutate frozen state or DOM");
assert.match(source, /function activateRecommendationState\(\) \{\s*if \(lifecycleFrozen\) return;/s, "late recommendation-rendered events must not restart frozen work");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, "lifecycle ownership must remain memory-only");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "bfcache hardening must not introduce location tracking");

console.log("stop-awareness-bfcache-ownership: freeze, hidden queued-work cancellation, fresh pageshow reconcile and privacy boundary passed");
