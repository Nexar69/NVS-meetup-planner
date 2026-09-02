const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../live-v090.js"), "utf8");

assert.match(source, /const TICK_MS = 5_000;/, "ordinary live-meetup rendering should not wake every second");
assert.match(source, /const AUTO_CHECK_MS = 30_000;/, "pre-departure auto-refresh checks should retain their 30-second cadence");
assert.doesNotMatch(source, /setInterval\(/, "live meetup must not use permanent intervals");
assert.doesNotMatch(source, /clearInterval\(/, "live meetup scheduler should use one-shot timers consistently");
assert.match(source, /let recommendationsActive = false;/,
  "live meetup should track authoritative recommendation lifecycle state");
assert.match(source, /function scheduleTick[\s\S]*document\.hidden \|\| !recommendationsActive[\s\S]*setTimeout/,
  "render scheduling must stop while hidden or recommendations are inactive");
assert.match(source, /function scheduleAutoRefresh[\s\S]*document\.hidden \|\| !enabled \|\| !recommendationsActive[\s\S]*setTimeout/,
  "automatic routing checks must stop while hidden, disabled, or recommendations are inactive");
assert.match(source, /function autoRefresh\(\)[\s\S]*!recommendationsActive[\s\S]*document\.hidden/,
  "automatic replanning must independently refuse empty-recommendation and hidden-page work");
assert.match(source, /function scheduleRender\(\)[\s\S]*document\.hidden \|\| !recommendationsActive[\s\S]*return;/,
  "DOM-triggered render work must also stay suspended while hidden or recommendations are inactive");
assert.match(source, /function clearRecommendationState[\s\S]*recommendationsActive = false[\s\S]*clearTimeout\(renderTimer\)[\s\S]*stopTimers\(\)[\s\S]*classList\.remove\("visible"\)/,
  "authoritative recommendation clearing must cancel pending live work and hide stale UI immediately");
assert.match(source, /addEventListener\("nvs-recommendations-cleared", clearRecommendationState\)/,
  "live meetup must consume the authoritative recommendation-cleared lifecycle event");
assert.match(source, /function activateRecommendationState[\s\S]*recommendationsActive = assignments[\s\S]*scheduleRender\(\)[\s\S]*scheduleTimers\(\)/,
  "fresh authoritative recommendations should reactivate rendering and periodic live work");
assert.match(source, /addEventListener\("nvs-group-recommendations-rendered", activateRecommendationState\)/,
  "live meetup should only rehydrate from the authoritative recommendation-rendered event");
assert.match(source, /visibilitychange[\s\S]*if \(document\.hidden\)[\s\S]*stopTimers\(\)[\s\S]*if \(!recommendationsActive\) return;[\s\S]*autoRefresh\(\)[\s\S]*scheduleTimers\(\)/,
  "visibility lifecycle should stop timers in background and remain inert after an empty transition");
assert.match(source, /pageshow[\s\S]*if \(!recommendationsActive\) return;[\s\S]*scheduleTimers\(\)/,
  "Safari bfcache restore must not resurrect live timers while recommendations are empty");
assert.match(source, /load[\s\S]*if \(!recommendationsActive\) return;[\s\S]*scheduleTimers\(\)/,
  "normal load should only arm live timers when a recommendation is already active");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "live scheduler changes must not introduce location tracking");

console.log("live-meetup-scheduler: recommendation lifecycle, hidden-page suspension, Safari resume and no-GPS boundary passed");
