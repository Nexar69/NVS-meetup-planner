const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

[
  "intelligence-core.js",
  "intelligence-v011.js",
  "intelligence-v011.css",
  "release-v011.js",
  "service-worker.js",
  "v05.js",
  "worker/src/vmv-rest.js",
].forEach((file) => assert.equal(fs.existsSync(path.join(root, file)), true, `${file} should exist`));

const loader = read("v05.js");
assert.match(loader, /loadMeetupIntelligence\(\)/, "v05 must invoke the v0.11 loader");
assert.match(loader, /intelligence-core\.js/, "v0.11 core must be loaded");
assert.match(loader, /intelligence-v011\.js/, "v0.11 UI must be loaded");
assert.match(loader, /release-v011\.js/, "v0.11 release owner must be loaded");

const release = read("release-v011.js");
assert.match(release, /v0\.11\.0 · Meetup Intelligence/, "release copy must identify v0.11");
assert.match(release, /dataset\.nvsRelease = "011"/, "v0.11 must own the release marker");

const serviceWorker = read("service-worker.js");
assert.match(serviceWorker, /meet-schwerin-v0\.11\.0-r1/, "service worker cache must be v0.11");
for (const asset of ["intelligence-core.js", "intelligence-v011.js", "intelligence-v011.css", "release-v011.js"]) {
  assert.match(serviceWorker, new RegExp(asset.replaceAll(".", "\\.")), `${asset} must be in the app shell`);
}
assert.match(serviceWorker, /SKIP_WAITING/, "service worker must support explicit update activation");

const vmv = read("worker/src/vmv-rest.js");
assert.match(vmv, /plannedPlatformFrom/, "VMV adapter must preserve planned platform");
assert.match(vmv, /cancelled/, "VMV adapter must preserve cancellation state");
assert.match(vmv, /remarks/, "VMV adapter must preserve disruption remarks");

console.log("release-smoke: v0.11 wiring looks consistent");
