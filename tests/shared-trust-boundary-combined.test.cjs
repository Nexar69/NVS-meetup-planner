const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(name) {
  return fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8');
}

const sources = {
  sharedLive: read('shared-live-v010.js'),
  freshness: read('shared-live-freshness-v0111.js'),
  queue: read('shared-checkin-queue-v0111.js'),
  tripTools: read('trip-tools-v0111.js'),
  voluntarySync: read('intelligence-voluntary-sync-v0111.js'),
};
const joined = Object.values(sources).join('\n');

// One authoritative Shared Live session should own voluntary state. Ancillary
// modules may consume it, but they must not invent a second durable status store.
assert.match(sources.sharedLive, /let liveState = null;/,
  'Shared Live must remain the canonical in-memory voluntary state owner');
assert.match(sources.freshness, /NVSSharedLive\?\.getState/,
  'freshness must consume canonical Shared Live state');
assert.match(sources.queue, /NVSSharedLive\?\.getState/,
  'queued voluntary status must reconcile against canonical Shared Live state');
assert.match(sources.voluntarySync, /NVSSharedLive\?\.getState/,
  'voluntary intelligence must consume canonical Shared Live state');

// Organizer revision ownership: a newer plan revision must block stale
// route-derived UI/status assumptions until the current plan is rendered.
assert.match(sources.queue, /nvs-live-plan-synced/,
  'voluntary queue must observe organizer plan revisions');
assert.match(sources.tripTools, /nvs-live-plan-synced/,
  'Trip Tools must observe organizer plan revisions');
assert.match(sources.freshness, /nvs-live-plan-synced/,
  'freshness must observe organizer plan revisions');
assert.match(sources.queue, /pendingPlanRevision/,
  'queued check-ins must fail closed while a newer organizer revision is pending');
assert.match(sources.tripTools, /pendingPlanRevision/,
  'Trip Tools must fail closed while a newer organizer revision is pending');
assert.match(sources.freshness, /pendingPlanRevision/,
  'route-derived intelligence must hide while an organizer revision is pending');

// Authoritative expiry must outrank stale/mixed-cache writability in every
// component that can expose or preserve voluntary status.
assert.match(sources.freshness, /isAuthoritativelyExpired/,
  'freshness must prefer authoritative expiry over stale Shared Live state');
assert.match(sources.queue, /authoritativelyExpired/,
  'voluntary queue must discard/block work after authoritative expiry');
assert.match(sources.tripTools, /isAuthoritativelyExpired/,
  'Trip Tools must hide voluntary writes after authoritative expiry');

// Offline/reconnect must remain explicit-user-action territory. A pending
// status may remain memory-only for review, but connectivity events must not
// automatically call the write path.
assert.doesNotMatch(sources.queue, /addEventListener\(["']online["'][\s\S]{0,400}sendPending\s*\(/,
  'online recovery must never automatically resend a pending voluntary status');
assert.doesNotMatch(sources.queue, /addEventListener\(["']pageshow["'][\s\S]{0,400}sendPending\s*\(/,
  'bfcache restoration must never automatically resend a pending voluntary status');

// Route-derived voluntary intelligence must not mutate while frozen or hidden
// and must rely on the fresh Shared Live entry rather than introducing a second source.
assert.match(sources.voluntarySync, /function ownsLifecycle\(\) \{\s*return !lifecycleFrozen && !document\.hidden;/,
  'voluntary intelligence sync must fail closed while the document is frozen or hidden');
assert.match(sources.voluntarySync, /if \(!ownsLifecycle\(\)\) return false;/,
  'direct voluntary intelligence sync must enforce the shared visible lifecycle boundary');
assert.match(sources.voluntarySync, /NVSSharedLive\?\.getState/,
  'voluntary intelligence must derive from the canonical Shared Live state');

// The combined boundary is deliberately ephemeral and privacy-preserving.
assert.doesNotMatch(joined, /localStorage|sessionStorage|indexedDB/i,
  'combined trust-boundary owners must not persist voluntary/lifecycle state');
assert.doesNotMatch(joined, /watchPosition/i,
  'combined trust-boundary owners must never add continuous location tracking');
assert.doesNotMatch(joined, /geolocation|getCurrentPosition/i,
  'these background/event consumers must not initiate location lookup');

// There must remain one canonical check-in network path: Trip Tools and the
// queue may invoke Shared Live, but neither may issue its own fetch/XHR write.
assert.doesNotMatch(sources.tripTools, /\bfetch\s*\(|XMLHttpRequest/,
  'Trip Tools must not create a duplicate check-in transport path');
assert.doesNotMatch(sources.queue, /\bfetch\s*\(|XMLHttpRequest/,
  'voluntary queue must not create a duplicate check-in transport path');
assert.match(sources.tripTools, /NVSSharedLive\.checkIn/,
  'Trip Tools must delegate check-ins to Shared Live');
assert.match(sources.queue, /NVSSharedLive\.checkIn/,
  'queued voluntary status must delegate explicit sends to Shared Live');

console.log('shared-trust-boundary-combined: revision, expiry, reconnect, lifecycle and privacy ownership remain aligned across Shared Live consumers');
