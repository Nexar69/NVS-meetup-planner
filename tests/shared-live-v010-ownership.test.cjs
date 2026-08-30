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

// Repeated refresh triggers should join the same request while it is current,
// but a replacement generation must be free to start immediately after
// invalidation even if the older promise has not settled yet.
assert.match(source, /if \(pollTask\) return pollTask\.promise;/,
  'overlapping current-generation polls should coalesce');
assert.match(source, /const generation = \+\+pollGeneration;/,
  'each fresh poll should receive a new generation');
assert.match(source, /signal: controller\.signal/,
  'owned polls should be cancellable');
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

console.log('shared live v010 poll ownership contracts OK');
