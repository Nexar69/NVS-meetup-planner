const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const browserRuntimeFiles = fs.readdirSync(root)
  .filter((name) => name.endsWith(".js"))
  .map((name) => path.join(root, name));
const runtimeFiles = [...browserRuntimeFiles];
const workerDir = path.join(root, "worker", "src");
if (fs.existsSync(workerDir)) {
  runtimeFiles.push(...fs.readdirSync(workerDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(workerDir, name)));
}

assert.ok(runtimeFiles.length >= 20, "privacy guard should scan the full app/Worker runtime, not a tiny hand-picked subset");

const locationApiPattern = /\b(?:navigator\s*\.\s*geolocation|geolocation\s*\.\s*(?:getCurrentPosition|watchPosition)|getCurrentPosition\s*\(|watchPosition\s*\()/i;
const allowedExplicitLocationFile = "places.js";
for (const file of runtimeFiles) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const source = fs.readFileSync(file, "utf8");
  if (relative === allowedExplicitLocationFile) continue;
  assert.doesNotMatch(source, locationApiPattern, `${relative} must not add location APIs; the only allowed location access is the explicit planner My location action`);
}

const places = fs.readFileSync(path.join(root, allowedExplicitLocationFile), "utf8");
assert.match(places, /gpsButton\.addEventListener\("click"[\s\S]*useCurrentLocation\(gpsButton\)/, "location access must remain behind an explicit My location button click");
assert.match(places, /function useCurrentLocation\(button\)[\s\S]*navigator\.geolocation\.getCurrentPosition\(/, "planner may use one-shot geolocation only inside the explicit action");
assert.doesNotMatch(places, /watchPosition\s*\(/, "planner must never introduce continuous/background GPS watching");
assert.match(places, /source:\s*"gps"[\s\S]*persist:\s*false/, "one-shot current position must not be persisted as a saved custom place");

// Keep browser-side networking on the single fetch transport. Test Lab, Shared Live timeout/backoff,
// coalescing and weak-network safety all wrap fetch deliberately; a new XHR/sendBeacon path could
// otherwise bypass those reviewed write-isolation and lifecycle guarantees.
const alternateWriteTransportPattern = /\b(?:XMLHttpRequest|sendBeacon)\b/;
for (const file of browserRuntimeFiles) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const source = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(source, alternateWriteTransportPattern, `${relative} must keep browser networking on fetch; update the safety layers and this contract before introducing XHR/sendBeacon`);
}

const sw = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
assert.match(sw, /pathname\.startsWith\("\/api\/"\)\) return;/, "service worker must continue bypassing shared-live/API responses");
assert.doesNotMatch(sw, /APP_SHELL[\s\S]*"\.\/api\//, "API/capability responses must never enter the offline app shell");

const sharedLive = fs.readFileSync(path.join(root, "shared-live-v010.js"), "utf8");
assert.match(sharedLive, /sessionStorage\.setItem/, "personal write capability must stay tab-scoped after opening");
assert.match(sharedLive, /params\.delete\("k"\)/, "private capability must be removed from the address bar");
assert.doesNotMatch(sharedLive, /localStorage\.setItem\([^\n]*(?:capability|CAPABILITY_PREFIX)/i, "personal write capabilities must not be persisted in long-lived localStorage");

const diagnostics = fs.readFileSync(path.join(root, "diagnostics-v0111.js"), "utf8");
assert.match(diagnostics, /No names, coordinates, route geometry, capability keys, plan IDs, or location readings/i, "diagnostic export must retain its explicit privacy boundary");

const whatIf = fs.readFileSync(path.join(root, "what-if-v0111.js"), "utf8");
assert.doesNotMatch(whatIf, /fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage/, "What if? must remain ephemeral and local-only");

const tripTools = fs.readFileSync(path.join(root, "trip-tools-v0111.js"), "utf8");
assert.match(tripTools, /addEventListener\("nvs-recommendations-cleared"[\s\S]*wakeWanted\s*=\s*false[\s\S]*releaseWakeLock\(\)/, "recommendation clearing must immediately drop Trip Tools wake-lock intent and release any screen wake lock");
assert.match(tripTools, /addEventListener\("nvs-recommendations-cleared"[\s\S]*lastRouteUpdate\s*=\s*0/, "recommendation clearing must invalidate stale Trip Tools route-age state");
assert.match(tripTools, /let wakeRequestGeneration\s*=\s*0/, "Trip Tools must generation-track asynchronous wake-lock acquisition");
assert.match(tripTools, /const generation\s*=\s*\+\+wakeRequestGeneration[\s\S]*await navigator\.wakeLock\.request\("screen"\)[\s\S]*generation\s*!==\s*wakeRequestGeneration/, "late wake-lock resolutions must be rejected when their acquisition generation is stale");
assert.match(tripTools, /generation\s*!==\s*wakeRequestGeneration[\s\S]*!wakeWanted[\s\S]*document\.hidden[\s\S]*!tripDialog\(\)\?\.open[\s\S]*await lock\?\.release\?\.\(\)/, "a late wake lock must be released instead of adopted after clear, backgrounding, or dialog close");
assert.match(tripTools, /async function releaseWakeLock\(\)[\s\S]*wakeRequestGeneration\s*\+=\s*1/, "every release must invalidate an in-flight wake-lock request before touching the active lock");
assert.doesNotMatch(tripTools, /geolocation|getCurrentPosition|watchPosition/i, "Trip Tools must remain voluntary and GPS-free");

console.log(`privacy-boundary: scanned ${runtimeFiles.length} app/Worker scripts; browser networking stays on fetch, Trip Tools invalidates stale wake-lock requests and clears wake intent with recommendation state, and only explicit one-shot My location access is allowed, with no background GPS, API caching, persistent capability storage or What-if network/storage writes`);
