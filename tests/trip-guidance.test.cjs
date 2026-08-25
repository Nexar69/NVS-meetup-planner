const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../trip-guidance-v0111.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../trip-guidance-v0111.css"), "utf8");
const release = fs.readFileSync(path.resolve(__dirname, "../release-v011.js"), "utf8");

assert.match(source, /personalSharedPlan/);
assert.match(source, /sharedLiveV010/);
assert.match(source, /insertAdjacentElement\("afterend", sharedPanel\)/, "voluntary shared-live controls should be moved directly below the personal plan");
assert.match(source, /Next important stop/);
assert.match(source, /Keep an eye on your surroundings so you're ready to get off/);
assert.match(source, /aria-live/);
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "guidance must remain timetable-only and never introduce location tracking");
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /forced-colors/);
assert.match(release, /trip-guidance-v0111\.js/);
assert.match(release, /trip-guidance-v0111\.css/);

console.log("trip-guidance: personal placement, next-stop copy, accessibility and no-GPS boundaries passed");
