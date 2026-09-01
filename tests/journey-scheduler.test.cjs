const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../journey.js"), "utf8");
const personal = fs.readFileSync(path.resolve(__dirname, "../personal-v074.js"), "utf8");

assert.doesNotMatch(source, /setInterval\(/, "journey departure board must not keep a fixed interval alive in hidden tabs");
assert.match(source, /let recommendationsActive = false;/,
  "journey lifecycle should track whether authoritative recommendations are active");
assert.match(source, /function scheduleClock\([\s\S]*isSuspended\(\) \|\| !recommendationsActive[\s\S]*setTimeout/,
  "journey departure board should use a one-shot clock scheduler only while visible, owned and active");
assert.match(source, /function scheduleRefresh\([\s\S]*isSuspended\(\) \|\| !recommendationsActive[\s\S]*setTimeout/,
  "journey enrichment should not re-arm while hidden, bfcache-frozen or recommendations are empty");
assert.match(source, /function clearAuthoritativeJourneyState[\s\S]*recommendationsActive = false[\s\S]*clearTimeout\(clockTimer\)[\s\S]*clearJourneyState\(\)/,
  "authoritative recommendation clearing should stop journey clocks and drop cached journey state");
assert.match(source, /addEventListener\("nvs-recommendations-cleared", clearAuthoritativeJourneyState\)/,
  "journey should consume the authoritative recommendation-cleared boundary");
assert.match(source, /addEventListener\("nvs-group-recommendations-rendered"[\s\S]*if \(frozenDocument\) return;[\s\S]*recommendationsActive = true[\s\S]*currentRecommendations = detail\.recommendations[\s\S]*scheduleClock\(\)/,
  "fresh authoritative recommendations should reactivate the journey board clock only while the document owns UI work");
assert.match(source, /function resumeJourney\(\)[\s\S]*isSuspended\(\) \|\| !recommendationsActive[\s\S]*return;/,
  "journey resume paths must remain inert after an empty transition or while suspended");
assert.match(source, /document\.addEventListener\("visibilitychange"/, "journey should suspend transient work with page visibility");
assert.match(source, /function cancelJourneyWork\(\)[\s\S]*clearTimeout\(clockTimer\)[\s\S]*clearTimeout\(refreshTimer\)[\s\S]*refreshGeneration \+= 1/,
  "journey suspension should cancel clocks, route scheduling and invalidate in-flight work");
assert.match(source, /window\.addEventListener\("pagehide", suspendDocument\)/,
  "Safari bfcache suspension should explicitly revoke journey ownership");
assert.match(source, /window\.addEventListener\("pageshow", restoreDocument\)/,
  "Safari bfcache restores should reconcile journey state from current authority");
assert.match(source, /window\.addEventListener\("nvs-shared-view-resumed", resumeJourney\)/, "shared-view Safari resume should use the lifecycle-guarded journey resume path");
assert.doesNotMatch(source, /ensureDepartureBoard\(\);\s*scheduleClock\(\);\s*scheduleRefresh\(350\);/,
  "empty startup must not arm journey timers before authoritative recommendations exist");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
  "journey scheduler lifecycle must not introduce location tracking");

assert.doesNotMatch(personal, /setInterval\(/, "personal itinerary must not keep a fixed interval alive in hidden tabs");
assert.match(personal, /function isSuspended\(\)[\s\S]*frozenDocument \|\| document\.hidden/,
  "personal itinerary should treat visibility and bfcache suspension as separate ownership signals");
assert.match(personal, /function scheduleClock\([\s\S]*isSuspended\(\) \|\| !isPersonalView\(\)[\s\S]*setTimeout/,
  "personal itinerary should use a one-shot clock scheduler only while visible, owned and scoped to a personal view");
assert.match(personal, /function render\(\)[\s\S]*if \(isSuspended\(\) \|\| !isPersonalView\(\)\) return;/,
  "personal itinerary rendering should avoid hidden, frozen or out-of-scope work");
assert.match(personal, /document\.addEventListener\("visibilitychange"/, "personal itinerary should suspend and resume transient work with visibility");
assert.match(personal, /function cancelTimers\(\)[\s\S]*clearTimeout\(clockTimer\)[\s\S]*clearTimeout\(refreshTimer\)/,
  "personal itinerary suspension should cancel both clock and render timers");
assert.match(personal, /window\.addEventListener\("pagehide", suspendDocument\)/,
  "personal itinerary should explicitly revoke ownership on pagehide");
assert.match(personal, /window\.addEventListener\("pageshow", restoreDocument\)/,
  "personal itinerary should reconcile current scope after Safari bfcache restoration");
assert.match(personal, /window\.addEventListener\("nvs-shared-view-resumed", resumePersonalItinerary\)/, "shared-view Safari resume should refresh personal itinerary timing");

console.log("journey-scheduler: authoritative empty-state lifecycle, bfcache ownership, hidden suspension and personal-itinerary timers passed");
