const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../what-if-v0111.js"), "utf8");

assert.match(source, /let lifecycleFrozen = false;/, "What-if should own an explicit memory-only lifecycle freeze flag");
assert.match(source, /function render\(now = Date\.now\(\)\) \{\s*if \(lifecycleFrozen\) return null;/s, "direct renders and live-event renders must be inert while bfcache owns the document");
assert.match(source, /function ensureCard\(\) \{\s*if \(lifecycleFrozen\) return null;/s, "frozen lifecycle work must not create UI");
assert.match(source, /function renderStateCard\([^)]*\) \{\s*if \(lifecycleFrozen \|\| !card\) return;/s, "state-card repaint helpers must fail closed while frozen");
assert.match(source, /function freezeLifecycle\(\) \{\s*lifecycleFrozen = true;\s*\}/s, "pagehide should revoke render ownership without mutating the frozen DOM");
assert.match(source, /function resumeLifecycle\(\) \{\s*lifecycleFrozen = false;\s*lastMarkup = "";\s*render\(\);\s*\}/s, "pageshow should reconcile current state rather than replay frozen event work");
assert.match(source, /document\.addEventListener\("change", \(event\) => \{\s*if \(lifecycleFrozen\) return;/s, "late change events must not mutate hypothetical controls while frozen");
assert.match(source, /document\.addEventListener\("click", \(event\) => \{\s*if \(lifecycleFrozen\) return;/s, "late click events must not mutate hypothetical controls while frozen");
assert.match(source, /addEventListener\("pagehide", freezeLifecycle\)/, "What-if should freeze explicitly on pagehide");
assert.match(source, /addEventListener\("pageshow", resumeLifecycle\)/, "What-if should resume explicitly on pageshow");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, "hypothetical and lifecycle state must remain memory-only");
assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|sendBeacon/i, "What-if must remain a local simulation with no write or alternative-route transport");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "bfcache hardening must not introduce location tracking");

console.log("what-if-bfcache-ownership: frozen render/input isolation, fresh pageshow reconcile, local-only and privacy boundaries passed");