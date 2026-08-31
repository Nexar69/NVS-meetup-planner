const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(name) {
  return fs.readFileSync(path.resolve(__dirname, `../${name}`), "utf8");
}

const sources = {
  connection: read("shared-connection-v0111.js"),
  freshness: read("shared-live-freshness-v0111.js"),
  queue: read("shared-checkin-queue-v0111.js"),
  tripTools: read("trip-tools-v0111.js"),
  voluntarySync: read("intelligence-voluntary-sync-v0111.js"),
};

const joined = Object.values(sources).join("\n");

// Safari/PWA ownership: every UI/stateful consumer in this combined path must
// explicitly freeze on pagehide and reconcile from current state on pageshow.
for (const [name, source] of Object.entries(sources)) {
  assert.match(source, /lifecycleFrozen/,
    `${name} must own an explicit in-memory lifecycle freeze boundary`);
  assert.match(source, /addEventListener\(["']pagehide["']/,
    `${name} must freeze work on pagehide`);
  assert.match(source, /addEventListener\(["']pageshow["']/,
    `${name} must reconcile current state on pageshow`);
}

// Organizer revision: recovery and voluntary-write owners must fail closed
// once a newer organizer plan is known. Read-only recovery is intentionally
// still allowed by the connection layer after the ownership boundary moves.
assert.match(sources.connection, /hasPendingPlanUpdate/,
  "connection recovery must reconcile organizer revision ownership");
assert.match(sources.queue, /hasPendingPlanUpdate/,
  "pending voluntary status must not send across an organizer revision");
assert.match(sources.freshness, /hasPendingPlanUpdate/,
  "route-derived intelligence must hide while an organizer revision is pending");

// Authoritative expiry must outrank stale/mixed-cache writability in every
// component that can expose or preserve voluntary status.
assert.match(sources.freshness, /isAuthoritativelyExpired/,
  "freshness must prefer authoritative expiry over stale Shared Live state");
assert.match(sources.queue, /authoritativelyExpired/,
  "voluntary queue must discard/block work after authoritative expiry");
assert.match(sources.tripTools, /isAuthoritativelyExpired/,
  "Trip Tools must hide voluntary writes after authoritative expiry");

// Offline/reconnect must remain explicit-user-action territory. A pending
// status may remain memory-only for review, but connectivity events must not
// automatically call the write path.
assert.doesNotMatch(sources.queue, /addEventListener\(["']online["'][\s\S]{0,400}sendPending\s*\(/,
  "online recovery must never automatically resend a pending voluntary status");
assert.doesNotMatch(sources.queue, /addEventListener\(["']pageshow["'][\s\S]{0,400}sendPending\s*\(/,
  "bfcache restoration must never automatically resend a pending voluntary status");

// Route-derived voluntary intelligence must not mutate while frozen and must
// rely on the fresh Shared Live entry rather than introducing a second source.
assert.match(sources.voluntarySync, /if \(lifecycleFrozen\) return false;/,
  "voluntary intelligence sync must fail closed while the document is frozen");
assert.match(sources.voluntarySync, /NVSSharedLive\?\.getState/,
  "voluntary intelligence must derive from the canonical Shared Live state");

// The combined boundary is deliberately ephemeral and privacy-preserving.
assert.doesNotMatch(joined, /localStorage|sessionStorage|indexedDB/i,
  "combined trust-boundary owners must not persist voluntary/lifecycle state");
assert.doesNotMatch(joined, /watchPosition/i,
  "combined trust-boundary owners must never add continuous location tracking");
assert.doesNotMatch(joined, /geolocation|getCurrentPosition/i,
  "these background/event consumers must not initiate location lookup");

// There must remain one canonical check-in network path: Trip Tools and the
// queue may invoke Shared Live, but neither may issue its own fetch/XHR write.
assert.doesNotMatch(sources.tripTools, /\bfetch\s*\(|XMLHttpRequest/,
  "Trip Tools must not create a duplicate check-in transport path");
assert.doesNotMatch(sources.queue, /\bfetch\s*\(|XMLHttpRequest/,
  "voluntary queue must not create a duplicate check-in transport path");
assert.match(sources.tripTools, /NVSSharedLive\.checkIn/,
  "Trip Tools must delegate voluntary writes to Shared Live");
assert.match(sources.queue, /NVSSharedLive\.checkIn/,
  "voluntary queue must delegate reviewed retries to Shared Live");

console.log("shared-trust-boundary-combined: revision + expiry + offline + bfcache contracts locked across Shared Live consumers");
