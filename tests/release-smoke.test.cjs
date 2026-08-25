const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

[
  "intelligence-core.js",
  "intelligence-v011.js",
  "intelligence-v011.css",
  "trip-tools-v0111.js",
  "trip-tools-v0111.css",
  "recovery-v0111.js",
  "recovery-v0111.css",
  "accessibility-v0111.js",
  "accessibility-v0111.css",
  "routing-coalesce-v0111.js",
  "share-v010.js",
  "shared-live-v010.js",
  "release-v011.js",
  "service-worker.js",
  "v05.js",
  "worker/src/entry.js",
  "worker/src/vmv-rest.js",
].forEach((file) => assert.equal(fs.existsSync(path.join(root, file)), true, `${file} should exist`));

const loader = read("v05.js");
assert.match(loader, /loadMeetupIntelligence\(\)/, "v05 must invoke the v0.11 loader");
assert.match(loader, /intelligence-core\.js/, "v0.11 core must be loaded");
assert.match(loader, /intelligence-v011\.js/, "v0.11 UI must be loaded");
assert.match(loader, /release-v011\.js/, "v0.11 release owner must be loaded");
assert.match(loader, /loadTripTools0111\(\)/, "v0.11.1 Trip Mode tools must be loaded");
assert.match(loader, /trip-tools-v0111\.js/, "Trip Mode tool runtime must be referenced");
assert.match(loader, /loadRecovery0111\(\)/, "v0.11.1 recovery desk must be loaded");
assert.match(loader, /recovery-v0111\.js/, "recovery runtime must be referenced");

const release = read("release-v011.js");
assert.match(release, /v0\.11\.1 · Meetup Intelligence/, "release copy must identify v0.11.1");
assert.match(release, /dataset\.nvsRelease = "011"/, "v0.11 must own the release marker");
assert.match(release, /reset private personal check-in links/i, "release copy should mention organizer revocation control");
assert.match(release, /loadAccessibility0111/, "v0.11.1 release owner should load accessibility hardening");
assert.match(release, /accessibility-v0111\.js/, "accessibility runtime must be wired by the release owner");
assert.match(release, /accessibility-v0111\.css/, "accessibility styles must be wired by the release owner");
assert.match(release, /loadRoutingCoalescer0111/, "v0.11.1 release owner should load routing request coalescing");
assert.match(release, /routing-coalesce-v0111\.js/, "routing coalescer must be wired by the release owner");

const serviceWorker = read("service-worker.js");
assert.match(serviceWorker, /meet-schwerin-v0\.11\.1-r6/, "service worker cache must be the latest v0.11.1 revision");
for (const asset of [
  "intelligence-core.js",
  "intelligence-v011.js",
  "intelligence-v011.css",
  "trip-tools-v0111.js",
  "trip-tools-v0111.css",
  "recovery-v0111.js",
  "recovery-v0111.css",
  "accessibility-v0111.js",
  "accessibility-v0111.css",
  "routing-coalesce-v0111.js",
  "share-v010.js",
  "shared-live-v010.js",
  "release-v011.js",
]) {
  assert.match(serviceWorker, new RegExp(asset.replaceAll(".", "\\.")), `${asset} must be in the app shell`);
}
assert.match(serviceWorker, /SKIP_WAITING/, "service worker must support explicit update activation");
assert.match(serviceWorker, /notificationclick/, "PWA notifications should focus or reopen Meet Schwerin when tapped");
assert.match(serviceWorker, /clients\.matchAll/, "notification clicks should prefer an existing app window");
assert.match(serviceWorker, /pathname\.startsWith\("\/api\/"\)/, "the service worker must explicitly bypass API requests");
assert.doesNotMatch(serviceWorker, /APP_SHELL[\s\S]*"\.\/api\//, "API endpoints must never be part of the offline app shell");

const intelligence = read("intelligence-v011.js");
assert.match(intelligence, /serviceWorker\.ready/, "system notifications should prefer the active PWA service worker");
assert.match(intelligence, /showNotification/, "system notifications should support mobile\/home-screen PWAs");
assert.match(intelligence, /function scheduleTick/, "intelligence should use an adaptive render scheduler");
assert.match(intelligence, /open \? 1_000 : 5_000/, "Trip Mode should retain 1-second guidance while the normal planner refreshes less aggressively");
assert.match(intelligence, /function nextTickDelay[\s\S]*if \(document\.hidden\) return null;/, "hidden pages should suspend periodic intelligence rendering");
assert.doesNotMatch(intelligence, /setInterval\(render,\s*1_000\)/, "the command center must not render every second indefinitely outside Trip Mode");

const tripTools = read("trip-tools-v0111.js");
assert.match(tripTools, /NVSSharedLive\.checkIn/, "Trip Mode should expose voluntary personal check-ins");
assert.match(tripTools, /wakeLock\.request\("screen"\)/, "Trip Mode should support optional screen wake lock");
assert.match(tripTools, /No GPS/, "Trip Mode check-ins must keep the no-GPS privacy copy");
assert.match(tripTools, /function scheduleRender/, "Trip Mode utilities should use a visibility-aware refresh scheduler");
assert.match(tripTools, /if \(document\.hidden\) return;/, "hidden pages should stop periodic Trip Mode utility refreshes");
assert.doesNotMatch(tripTools, /setInterval\(render/, "Trip Mode utilities must not keep a fixed render interval alive while hidden");

const recovery = read("recovery-v0111.js");
assert.match(recovery, /getAlerts/, "recovery desk should consume the existing intelligence alert model");
assert.match(recovery, /hasPendingPlanUpdate/, "recovery desk should prioritize organizer plan updates");
assert.match(recovery, /No background location/, "recovery UI must state its location privacy boundary");
assert.match(recovery, /navigator\.onLine/, "recovery actions should degrade safely while offline");
assert.match(recovery, /Known timetable anchor:/, "impossible transfers should explain the known timetable transfer point");
assert.match(recovery, /No current stop is inferred/, "voluntary missed-connection recovery must explicitly avoid inferring a current stop");
assert.doesNotMatch(recovery, /navigator\.geolocation|watchPosition|getCurrentPosition/, "recovery guidance must never introduce location tracking");

const routingCoalescer = read("routing-coalesce-v0111.js");
assert.match(routingCoalescer, /pending\.get\(key\)/, "routing coalescer should reuse an identical in-flight request");
assert.match(routingCoalescer, /finally\(\(\) => pending\.delete\(key\)\)/, "settled routing requests must leave the pending registry");
assert.match(routingCoalescer, /return cloneValue\(routes\)/, "coalesced route consumers should not share mutable route objects");
assert.doesNotMatch(routingCoalescer, /geolocation|watchPosition|getCurrentPosition/, "routing request coalescing must not introduce location tracking");

const secureShare = read("share-v010.js");
assert.match(secureShare, /\/capabilities/, "organizer sharing should call the capability rotation endpoint");
assert.match(secureShare, /Reset all private links/, "group sharing should expose all-member private-link revocation");
assert.match(secureShare, /Reset \$\{target\.name\}'s private link/, "personal sharing should expose member-scoped private-link revocation");
assert.match(secureShare, /window\.confirm/, "private-link reset must require an explicit confirmation");
assert.match(secureShare, /resetPrivateLinks/, "organizer share API should expose all-member revocation");
assert.match(secureShare, /resetPersonLink/, "organizer share API should support single-member rotation");

const sharedLive = read("shared-live-v010.js");
assert.match(sharedLive, /sessionStorage\.setItem/, "personal check-in capability should move into tab-scoped storage after opening");
assert.match(sharedLive, /sessionStorage\.removeItem/, "a revoked personal capability should be removed from the current tab");
assert.match(sharedLive, /CHECKIN_CAPABILITY_REVOKED/, "revoked personal links should downgrade themselves to read-only after authorization failure");
assert.match(sharedLive, /history\.replaceState/, "opened personal links should remove the write capability from the address bar");
assert.match(sharedLive, /params\.delete\("k"\)/, "URL sanitization must remove only the private capability parameter");
assert.match(sharedLive, /sessionStorage\.getItem/, "reloads in the same tab should retain the check-in capability");
assert.doesNotMatch(sharedLive, /localStorage\.setItem\([^\n]*capability/i, "personal write capabilities should not be persisted in long-lived localStorage");
assert.match(sharedLive, /function schedulePoll/, "shared-live should use a visibility-aware polling scheduler");
assert.match(sharedLive, /document\.hidden \|\| !planId\(\)/, "hidden shared pages should not schedule background polling wakeups");
assert.doesNotMatch(sharedLive, /setInterval\(poll/, "shared-live must not keep a fixed poll interval running while hidden");

const workerEntry = read("worker/src/entry.js");
assert.match(workerEntry, /rotateCapabilitiesApi/, "Worker must expose organizer-controlled capability rotation");
assert.match(workerEntry, /capability_rotation_not_authorized/, "capability rotation must require the organizer key");
assert.match(workerEntry, /capabilityRevocation:\s*true/, "health diagnostics should advertise revocation support");

const vmv = read("worker/src/vmv-rest.js");
assert.match(vmv, /plannedPlatformFrom/, "VMV adapter must preserve planned platform");
assert.match(vmv, /cancelled/, "VMV adapter must preserve cancellation state");
assert.match(vmv, /remarks/, "VMV adapter must preserve disruption remarks");

console.log("release-smoke: v0.11.1 wiring looks consistent");
