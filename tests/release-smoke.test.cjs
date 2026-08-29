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
  "test-lab-v012.js",
  "test-lab-v012.css",
  "release-v012.js",
  "service-worker.js",
  "v05.js",
  "worker/src/vmv-rest.js",
].forEach((file) => assert.equal(fs.existsSync(path.join(root, file)), true, `${file} should exist`));

const loader = read("v05.js");
assert.match(loader, /loadMeetupIntelligence\(\)/, "v05 must invoke the v0.11 intelligence loader");
assert.match(loader, /intelligence-core\.js/, "v0.11 core must be loaded");
assert.match(loader, /intelligence-v011\.js/, "v0.11 UI must be loaded");
assert.match(loader, /release-v011\.js/, "v0.11 release owner must remain loaded");
assert.match(loader, /loadTestLab\(\)/, "v05 must invoke the v0.12 Test Lab loader");
assert.match(loader, /test-lab-v012\.js/, "v0.12 Test Lab must be loaded");
assert.match(loader, /release-v012\.js/, "v0.12 release owner must be loaded");

const intelligenceRelease = read("release-v011.js");
assert.match(intelligenceRelease, /v0\.11\.0 · Meetup Intelligence/, "v0.11 intelligence release copy must remain available");

const release = read("release-v012.js");
assert.match(release, /v0\.12\.0 · Test Lab/, "release copy must identify v0.12");
assert.match(release, /dataset\.nvsRelease = "012"/, "v0.12 must own the release marker");

const serviceWorker = read("service-worker.js");
assert.match(serviceWorker, /meet-schwerin-v0\.12\.0-r3/, "service worker cache must be v0.12 r3");
for (const asset of [
  "intelligence-core.js",
  "intelligence-v011.js",
  "intelligence-v011.css",
  "release-v011.js",
  "test-lab-v012.js",
  "test-lab-v012.css",
  "release-v012.js",
]) {
  assert.match(serviceWorker, new RegExp(asset.replaceAll(".", "\\.")), `${asset} must be in the app shell`);
}
assert.match(serviceWorker, /SKIP_WAITING/, "service worker must support explicit update activation");

const vmv = read("worker/src/vmv-rest.js");
assert.match(vmv, /plannedPlatformFrom/, "VMV adapter must preserve planned platform");
assert.match(vmv, /cancelled/, "VMV adapter must preserve cancellation state");
assert.match(vmv, /remarks/, "VMV adapter must preserve disruption remarks");

console.log("release-smoke: v0.12 Test Lab + v0.11 Meetup Intelligence wiring looks consistent");
