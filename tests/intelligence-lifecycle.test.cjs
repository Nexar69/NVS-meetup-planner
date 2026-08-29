const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../intelligence-v011.js"), "utf8");

assert.match(source, /let recommendationsActive = Boolean\(assignments\(\)\.length\);/, "base intelligence should track whether authoritative recommendations are active");
assert.match(source, /function clearRecommendationState\(\) \{[\s\S]*recommendationsActive = false;[\s\S]*clearTick\(\);[\s\S]*clearTimeout\(renderTimer\);[\s\S]*renderTimer = null;[\s\S]*classList\.remove\("visible"\)/, "recommendation clearing should synchronously stop base timers and hide stale command-center UI");
assert.match(source, /window\.addEventListener\("nvs-recommendations-cleared", clearRecommendationState\);/, "base intelligence should consume the authoritative cleared lifecycle event");
assert.match(source, /window\.addEventListener\("nvs-group-recommendations-rendered", \(\) => \{[\s\S]*recommendationsActive = Boolean\(assignments\(\)\.length\);[\s\S]*scheduleRender\(\);/, "fresh authoritative recommendations should reactivate base intelligence scheduling");
assert.match(source, /function nextTickDelay\(\) \{[\s\S]*if \(document\.hidden\) return null;[\s\S]*if \(!recommendationsActive\) return null;/, "the periodic tick should remain stopped while recommendations are inactive");
assert.match(source, /function scheduleRender\(delay = 20\) \{[\s\S]*clearTimeout\(renderTimer\);[\s\S]*renderTimer = null;[\s\S]*if \(!recommendationsActive\) return;/, "generic foreground and mutation-driven renders should not resurrect work during an empty state");
assert.match(source, /document\.addEventListener\("visibilitychange", \(\) => \{[\s\S]*if \(document\.hidden\) clearTick\(\);[\s\S]*else scheduleRender\(\);/, "foreground resume should stay routed through the recommendation-aware scheduler");
assert.match(source, /window\.addEventListener\("pageshow", \(\) => scheduleRender\(\)\);/, "pageshow recovery should stay routed through the recommendation-aware scheduler");
assert.doesNotMatch(source, /watchPosition\s*\(/, "base intelligence lifecycle hardening must not introduce continuous location tracking");

console.log("intelligence-lifecycle: authoritative empty state stops base command-center timers and only fresh recommendations reactivate them");
