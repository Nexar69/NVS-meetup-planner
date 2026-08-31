const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../meetup-radar-v0111.js"), "utf8");

assert.match(source, /let lifecycleFrozen = false;/, "Meetup Radar should own an explicit memory-only lifecycle freeze flag");
assert.match(source, /function render\(now = Date\.now\(\)\) \{\s*if \(lifecycleFrozen\) return null;/s, "direct renders must be inert while bfcache owns the document");
assert.match(source, /function refresh\(\) \{\s*if \(lifecycleFrozen\) return;/s, "live and plan refresh events must be inert while frozen");
assert.match(source, /if \(lifecycleFrozen \|\| document\.hidden \|\| !recommendationsActive\) return;/, "countdown scheduling must stay stopped while frozen");
assert.match(source, /timer = setTimeout\(\(\) => \{\s*if \(lifecycleFrozen\) return;/s, "already scheduled timer work must lose authority after pagehide");
assert.match(source, /function activateRecommendations\(\) \{\s*if \(lifecycleFrozen\) return;/s, "late recommendation-rendered events must not restart frozen work");
assert.match(source, /function clearRecommendations\(\) \{\s*if \(lifecycleFrozen\) return;/s, "late recommendation-clear events must not mutate the frozen DOM");
assert.match(source, /function freezeLifecycle\(\) \{\s*lifecycleFrozen = true;\s*clearTimeout\(timer\);\s*timer = null;\s*\}/s, "pagehide should stop timer ownership without repainting the frozen DOM");
assert.match(source, /function resumeLifecycle\(\) \{\s*lifecycleFrozen = false;\s*recommendationsActive = Boolean\(window\.__NVS_LAST_RECOMMENDATIONS__\?\.primary\);\s*refresh\(\);\s*\}/s, "pageshow should reconcile current recommendation state instead of replaying frozen events");
assert.match(source, /addEventListener\("pagehide", freezeLifecycle\)/, "Meetup Radar should freeze explicitly on pagehide");
assert.match(source, /addEventListener\("pageshow", resumeLifecycle\)/, "Meetup Radar should resume explicitly on pageshow");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, "lifecycle ownership must remain memory-only");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "bfcache hardening must not introduce location tracking");

console.log("meetup-radar-bfcache-ownership: freeze, timer invalidation, fresh pageshow reconcile and privacy boundary passed");
