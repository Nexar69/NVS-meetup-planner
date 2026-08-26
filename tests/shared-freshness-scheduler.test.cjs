const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-freshness-v011.js"), "utf8");

assert.match(source, /const REFRESH_MS = 30_000;/, "stale-status freshness should retain its 30-second foreground cadence");
assert.doesNotMatch(source, /setInterval\(/, "stale-status freshness must not keep a fixed background interval");
assert.match(source, /function schedule\([\s\S]*if \(document\.hidden\) return;[\s\S]*setTimeout/, "freshness timer should only arm while visible");
assert.match(source, /visibilitychange[\s\S]*if \(document\.hidden\) clearTimeout\(timer\)[\s\S]*else refresh\(\)/, "Safari backgrounding should suspend freshness work and resume on foreground");
assert.match(source, /nvs-shared-view-resumed/, "Safari shared-view restoration should immediately refresh stale-state semantics");
assert.match(source, /pageshow/, "bfcache restoration should refresh stale-state semantics");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "freshness scheduling must remain no-GPS");

console.log("shared-freshness-scheduler: foreground one-shot cadence, hidden suspension, Safari resume and no-GPS boundary passed");
