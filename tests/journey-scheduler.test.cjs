const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../journey.js"), "utf8");
const personal = fs.readFileSync(path.resolve(__dirname, "../personal-v074.js"), "utf8");

assert.doesNotMatch(source, /setInterval\(/, "journey departure board must not keep a fixed interval alive in hidden tabs");
assert.match(source, /function scheduleClock\(/, "journey departure board should use a one-shot clock scheduler");
assert.match(source, /if \(document\.hidden\) return;/, "journey schedulers should avoid arming work while hidden");
assert.match(source, /document\.addEventListener\("visibilitychange"/, "journey should suspend and resume with page visibility");
assert.match(source, /clearTimeout\(clockTimer\)/, "hidden journey views should cancel the departure-board clock timer");
assert.match(source, /clearTimeout\(refreshTimer\)/, "hidden journey views should cancel pending route enrichment work");
assert.match(source, /window\.addEventListener\("pageshow", resumeJourney\)/, "Safari bfcache restores should resume journey timing");
assert.match(source, /window\.addEventListener\("nvs-shared-view-resumed", resumeJourney\)/, "shared-view Safari resume should refresh journey timing");
assert.match(source, /scheduleClock\(\);\n  scheduleRefresh\(350\);/, "initial visible journey lifecycle should arm one-shot timers");

assert.doesNotMatch(personal, /setInterval\(/, "personal itinerary must not keep a fixed interval alive in hidden tabs");
assert.match(personal, /function scheduleClock\(/, "personal itinerary should use a one-shot clock scheduler");
assert.match(personal, /if \(document\.hidden\) return;/, "personal itinerary render/scheduler should avoid hidden work");
assert.match(personal, /document\.addEventListener\("visibilitychange"/, "personal itinerary should suspend and resume with visibility");
assert.match(personal, /clearTimeout\(clockTimer\)/, "hidden personal views should cancel their clock timer");
assert.match(personal, /clearTimeout\(refreshTimer\)/, "hidden personal views should cancel pending render work");
assert.match(personal, /window\.addEventListener\("pageshow", resumePersonalItinerary\)/, "Safari bfcache restores should resume personal itinerary timing");
assert.match(personal, /window\.addEventListener\("nvs-shared-view-resumed", resumePersonalItinerary\)/, "shared-view Safari resume should refresh personal itinerary timing");

console.log("journey-scheduler: departure-board, enrichment and personal-itinerary timers suspend while hidden and resume for Safari lifecycle restores");
