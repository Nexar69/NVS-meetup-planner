const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../live-v090.js"), "utf8");

assert.match(source, /const TICK_MS = 5_000;/, "ordinary live-meetup rendering should not wake every second");
assert.match(source, /const AUTO_CHECK_MS = 30_000;/, "pre-departure auto-refresh checks should retain their 30-second cadence");
assert.doesNotMatch(source, /setInterval\(/, "live meetup must not use permanent intervals");
assert.doesNotMatch(source, /clearInterval\(/, "live meetup scheduler should use one-shot timers consistently");
assert.match(source, /function scheduleTick\([\s\S]*if \(document\.hidden\) return;[\s\S]*setTimeout/, "render scheduling must stop while hidden");
assert.match(source, /function scheduleAutoRefresh\([\s\S]*document\.hidden \|\| !enabled[\s\S]*setTimeout/, "automatic routing checks must stop while hidden or disabled");
assert.match(source, /function autoRefresh\(\)[\s\S]*document\.hidden/, "automatic replanning must independently refuse hidden-page work");
assert.match(source, /function scheduleRender\(\)[\s\S]*if \(document\.hidden\) return;/, "DOM-triggered render work must also stay suspended while hidden");
assert.match(source, /visibilitychange[\s\S]*if \(document\.hidden\)[\s\S]*stopTimers\(\)[\s\S]*autoRefresh\(\)[\s\S]*scheduleTimers\(\)/, "visibility lifecycle should stop timers in background and resume safely in foreground");
assert.match(source, /pageshow[\s\S]*scheduleTimers\(\)/, "Safari bfcache restore should re-arm live timers");
assert.match(source, /load[\s\S]*scheduleTimers\(\)/, "normal load should re-arm live timers");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "live scheduler changes must not introduce location tracking");

console.log("live-meetup-scheduler: 5s foreground cadence, hidden-page suspension, Safari resume and no-GPS boundary passed");
