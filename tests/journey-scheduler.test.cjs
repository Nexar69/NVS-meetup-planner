const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../journey.js"), "utf8");

assert.doesNotMatch(source, /setInterval\(/, "journey departure board must not keep a fixed interval alive in hidden tabs");
assert.match(source, /function scheduleClock\(/, "journey departure board should use a one-shot clock scheduler");
assert.match(source, /if \(document\.hidden\) return;/, "journey schedulers should avoid arming work while hidden");
assert.match(source, /document\.addEventListener\("visibilitychange"/, "journey should suspend and resume with page visibility");
assert.match(source, /clearTimeout\(clockTimer\)/, "hidden journey views should cancel the departure-board clock timer");
assert.match(source, /clearTimeout\(refreshTimer\)/, "hidden journey views should cancel pending route enrichment work");
assert.match(source, /window\.addEventListener\("pageshow", resumeJourney\)/, "Safari bfcache restores should resume journey timing");
assert.match(source, /window\.addEventListener\("nvs-shared-view-resumed", resumeJourney\)/, "shared-view Safari resume should refresh journey timing");
assert.match(source, /scheduleClock\(\);\n  scheduleRefresh\(350\);/, "initial visible journey lifecycle should arm one-shot timers");

console.log("journey-scheduler: departure-board and enrichment timers suspend while hidden and resume for Safari lifecycle restores");
