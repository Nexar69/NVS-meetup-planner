const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../journey.js"), "utf8");
const personal = fs.readFileSync(path.resolve(__dirname, "../personal-v074.js"), "utf8");

assert.doesNotMatch(source, /setInterval\(/, "journey departure board must not keep a fixed interval alive in hidden tabs");
assert.match(source, /let recommendationsActive = false;/,
  "journey lifecycle should track whether authoritative recommendations are active");
assert.match(source, /function scheduleClock\([\s\S]*document\.hidden \|\| !recommendationsActive[\s\S]*setTimeout/,
  "journey departure board should use a one-shot clock scheduler only while visible and active");
assert.match(source, /function scheduleRefresh\([\s\S]*document\.hidden \|\| !recommendationsActive[\s\S]*setTimeout/,
  "journey enrichment should not re-arm while hidden or recommendations are empty");
assert.match(source, /function clearAuthoritativeJourneyState[\s\S]*recommendationsActive = false[\s\S]*clearTimeout\(clockTimer\)[\s\S]*clearJourneyState\(\)/,
  "authoritative recommendation clearing should stop journey clocks and drop cached journey state");
assert.match(source, /addEventListener\("nvs-recommendations-cleared", clearAuthoritativeJourneyState\)/,
  "journey should consume the authoritative recommendation-cleared boundary");
assert.match(source, /addEventListener\("nvs-group-recommendations-rendered"[\s\S]*recommendationsActive = true[\s\S]*currentRecommendations = detail\.recommendations[\s\S]*scheduleClock\(\)/,
  "fresh authoritative recommendations should reactivate the journey board clock");
assert.match(source, /function resumeJourney\(\)[\s\S]*document\.hidden \|\| !recommendationsActive[\s\S]*return;/,
  "journey resume paths must remain inert after an empty transition");
assert.match(source, /document\.addEventListener\("visibilitychange"/, "journey should suspend and resume with page visibility");
assert.match(source, /clearTimeout\(clockTimer\)/, "hidden journey views should cancel the departure-board clock timer");
assert.match(source, /clearTimeout\(refreshTimer\)/, "hidden journey views should cancel pending route enrichment work");
assert.match(source, /window\.addEventListener\("pageshow", resumeJourney\)/, "Safari bfcache restores should use the lifecycle-guarded journey resume path");
assert.match(source, /window\.addEventListener\("nvs-shared-view-resumed", resumeJourney\)/, "shared-view Safari resume should use the lifecycle-guarded journey resume path");
assert.doesNotMatch(source, /ensureDepartureBoard\(\);\s*scheduleClock\(\);\s*scheduleRefresh\(350\);/,
  "empty startup must not arm journey timers before authoritative recommendations exist");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
  "journey scheduler lifecycle must not introduce location tracking");

assert.doesNotMatch(personal, /setInterval\(/, "personal itinerary must not keep a fixed interval alive in hidden tabs");
assert.match(personal, /function scheduleClock\(/, "personal itinerary should use a one-shot clock scheduler");
assert.match(personal, /if \(document\.hidden\) return;/, "personal itinerary render/scheduler should avoid hidden work");
assert.match(personal, /document\.addEventListener\("visibilitychange"/, "personal itinerary should suspend and resume with visibility");
assert.match(personal, /clearTimeout\(clockTimer\)/, "hidden personal views should cancel their clock timer");
assert.match(personal, /clearTimeout\(refreshTimer\)/, "hidden personal views should cancel pending render work");
assert.match(personal, /window\.addEventListener\("pageshow", resumePersonalItinerary\)/, "Safari bfcache restores should resume personal itinerary timing");
assert.match(personal, /window\.addEventListener\("nvs-shared-view-resumed", resumePersonalItinerary\)/, "shared-view Safari resume should refresh personal itinerary timing");

console.log("journey-scheduler: authoritative empty-state lifecycle, Safari resume guards, hidden suspension and personal-itinerary timers passed");
