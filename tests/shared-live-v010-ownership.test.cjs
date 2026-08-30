const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('shared-live-v010.js', 'utf8');

// The directly-loaded Shared Live owner must not let an older GET replace a
// newer POST-confirmed state. Polls therefore own a generation and controller,
// and voluntary writes explicitly invalidate any poll already in flight.
assert.match(source, /let pollGeneration = 0;/,
  'shared live should track poll generations');
assert.match(source, /let pollTask = null;/,
  'shared live should retain the active poll identity');
assert.match(source, /function invalidatePoll\(\)[\s\S]*pollGeneration \+= 1;[\s\S]*pollTask = null;[\s\S]*\.abort\(\)/,
  'poll invalidation should advance ownership and abort the old request');
assert.match(source, /sending = true;\s*invalidatePoll\(\);/,
  'a voluntary POST should invalidate any older GET before it can overwrite the confirmed state');

// Voluntary POSTs own their own lifecycle too. A completion from an older page,
// expired session, different personal scope, or superseded plan must not repaint
// the page or publish a stale route-derived note.
assert.match(source, /let sendGeneration = 0;/,
  'shared live should track voluntary POST generations');
assert.match(source, /let sendTask = null;/,
  'shared live should retain the active voluntary POST identity');
assert.match(source, /function invalidateSend\(\)[\s\S]*sendGeneration \+= 1;[\s\S]*sendTask = null;[\s\S]*sending = false;[\s\S]*\.abort\(\)/,
  'POST invalidation should advance ownership, clear busy state, and abort old work');
assert.match(source, /function sendStillCurrent\(task\)[\s\S]*sendTask === task[\s\S]*task\.generation === sendGeneration[\s\S]*!document\.hidden[\s\S]*pendingRevision == null[\s\S]*!sessionExpired\(\)[\s\S]*planId\(\) === task\.planId[\s\S]*focusIndex\(\) === task\.focus/,
  'POST completion should fail closed across lifecycle, revision, expiry, and personal-scope boundaries');
assert.match(source, /if \(!url \|\| focus < 0 \|\| !key \|\| sending \|\| pendingRevision != null \|\| sessionExpired\(\)\) return;/,
  'new voluntary writes should be blocked once the route is superseded or the session expires');
assert.match(source, /body: JSON\.stringify\([^\n]*revision: loadedRevision[^\n]*\)/,
  'voluntary writes should carry the loaded plan revision for server-side stale-write hardening');
assert.match(source, /signal: controller\.signal/,
  'owned GET and POST requests should be cancellable');
assert.match(source, /const next = await response\.json\(\);\s*if \(!sendStillCurrent\(task\)\) return;\s*liveState =/,
  'a POST must re-check ownership after async body parsing before publishing state');
assert.match(source, /addEventListener\("nvs-shared-session-expired"[\s\S]*invalidateSend\(\)/,
  'authoritative expiry should invalidate an in-flight voluntary write');
assert.match(source, /addEventListener\("pagehide"[\s\S]*invalidatePoll\(\);[\s\S]*invalidateSend\(\);/,
  'pagehide should invalidate both read and write work');
assert.match(source, /visibilitychange[\s\S]*invalidatePoll\(\);[\s\S]*document\.hidden\) invalidateSend\(\)/,
  'hidden-page transitions should invalidate an in-flight voluntary write');

// Repeated refresh triggers should join the same request while it is current,
// but a replacement generation must be free to start immediately after
// invalidation even if the older promise has not settled yet.
assert.match(source, /if \(pollTask\) return pollTask\.promise;/,
  'overlapping current-generation polls should coalesce');
assert.match(source, /const generation = \+\+pollGeneration;/,
  'each fresh poll should receive a new generation');
assert.match(source, /generation !== pollGeneration[^\n]*document\.hidden[^\n]*sending/,
  'poll completion should be rejected when superseded, hidden, or racing a POST');
assert.match(source, /if \(pollTask === task\) pollTask = null;/,
  'an older poll must never clear the identity of its replacement');

// Navigation, bfcache/visibility transitions, and reconnects are all ownership
// boundaries. A response started for an older lifecycle must not repaint the
// resumed page.
assert.match(source, /addEventListener\("pagehide"[\s\S]*invalidatePoll\(\)/,
  'pagehide should invalidate an in-flight poll');
assert.match(source, /addEventListener\("pageshow"[\s\S]*invalidatePoll\(\)[\s\S]*void poll\(\)/,
  'pageshow should replace stale lifecycle work before refreshing');
assert.match(source, /visibilitychange[\s\S]*invalidatePoll\(\)[\s\S]*if \(!document\.hidden\)/,
  'visibility changes should invalidate stale poll ownership');
assert.match(source, /addEventListener\("online"[\s\S]*invalidatePoll\(\)[\s\S]*void poll\(\)/,
  'reconnect should start from a fresh poll generation');

// Preserve the explicit privacy boundary while touching Shared Live code.
assert.doesNotMatch(source, /watchPosition\s*\(/,
  'Shared Live must not introduce continuous/background GPS tracking');
assert.doesNotMatch(source, /localStorage|indexedDB/i,
  'Shared Live check-in ownership must not add durable personal state storage');

console.log('shared live v010 read/write ownership contracts OK');