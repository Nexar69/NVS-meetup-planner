const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-freshness-v011.js"), "utf8");

assert.match(source, /const REFRESH_MS = 30_000;/, "stale-status freshness should retain its 30-second foreground cadence");
assert.doesNotMatch(source, /setInterval\(/, "stale-status freshness must not keep a fixed background interval");
assert.match(source, /let lifecycleFrozen = false;/, "freshness UI should explicitly own bfcache suspension state");
assert.match(source, /function schedule\([\s\S]*!ownsDocument\(\) \|\| document\.hidden[\s\S]*setTimeout/, "freshness timer should only arm while the visible document owns lifecycle work");
assert.match(source, /pagehide[\s\S]*freezeLifecycle/, "pagehide should revoke stale-status DOM and timer ownership");
assert.match(source, /function freezeLifecycle\([\s\S]*lifecycleFrozen = true;[\s\S]*clearTimeout\(timer\)/, "freezing should cancel pending freshness work");
assert.match(source, /pageshow[\s\S]*resumeLifecycle/, "bfcache restoration should reacquire stale-state ownership");
assert.match(source, /function resumeLifecycle\([\s\S]*lifecycleFrozen = false;[\s\S]*refresh\(\)/, "restore should reconcile from current shared-live state");
assert.match(source, /visibilitychange[\s\S]*document\.hidden \|\| lifecycleFrozen[\s\S]*clearTimeout\(timer\)[\s\S]*else[\s\S]*refresh\(\)/, "Safari visibility changes must not bypass frozen-document ownership");
assert.match(source, /nvs-shared-view-resumed/, "Safari shared-view restoration should immediately refresh stale-state semantics");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "freshness scheduling must remain no-GPS");

console.log("shared-freshness-scheduler: one-shot cadence, explicit bfcache ownership, Safari resume and no-GPS boundary passed");
