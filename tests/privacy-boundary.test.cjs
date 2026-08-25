const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const runtimeFiles = fs.readdirSync(root)
  .filter((name) => name.endsWith(".js"))
  .map((name) => path.join(root, name));
const workerDir = path.join(root, "worker", "src");
if (fs.existsSync(workerDir)) {
  runtimeFiles.push(...fs.readdirSync(workerDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(workerDir, name)));
}

assert.ok(runtimeFiles.length >= 20, "privacy guard should scan the full app/Worker runtime, not a tiny hand-picked subset");

const forbiddenLocationApis = /\b(?:navigator\s*\.\s*geolocation|geolocation\s*\.\s*(?:getCurrentPosition|watchPosition)|getCurrentPosition\s*\(|watchPosition\s*\()/i;
for (const file of runtimeFiles) {
  const source = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(source, forbiddenLocationApis, `${path.relative(root, file)} must not add hidden/background location APIs`);
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

console.log(`privacy-boundary: scanned ${runtimeFiles.length} app/Worker scripts; no location APIs, API caching, persistent capability storage or What-if network/storage writes detected`);
