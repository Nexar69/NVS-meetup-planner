const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('shared-live-v010.js', 'utf8');

// The directly-loaded Shared Live owner must not let an older GET replace a
// newer POST-confirmed state. Polls therefore own a generation, controller,
// and the exact shared-plan scope they started under. Voluntary writes explicitly
// invalidate any poll already in flight.
assert.match(source, /let pollGeneration = 0;/,
  'shared live should track poll generations');
assert.match(source, /let pollTask = null;/,
  'shared live should retain the active poll identity');
assert.match(source, /let documentFrozen = false;/,
  'shared live should track explicit pagehide ownership independently of document.hidden');
assert.match(source, /function documentOwned\(\)[\s\S]*!documentFrozen[\s\S]*!document\.hidden/,
  'network and DOM ownership should require both an unfrozen and visible document');
assert.match(source, /function invalidatePoll\(\)[\s\S]*pollGeneration \+= 1;[\s\S]*pollTask = null;[\s\S]*\.abort\(\)/,
  'poll invalidation should advance ownership and abort the old request');
assert.match(source, /function pollStillCurrent\(task\)[\s\S]*pollTask === task[\s\S]*task\.generation === pollGeneration[\s\S]*documentOwned\(\)[\s\S]*!sending[\s\S]*planId\(\) === task\.planId/,
  'GET completion should fail closed when its shared-plan or document lifecycle no longer owns the page');
assert.match(source, /const currentPlanId = planId\(\);[\s\S]*const task = \{ generation, controller, planId: currentPlanId, promise: null \};/,
  'each poll should capture the plan ID it was created for');
assert.match(source, /const response = await fetch\([^\n]+[\s\S]*if \(!response\.ok \|\| !pollStillCurrent\(task\)\) return;[\s\S]*const next = await response\.json\(\);[\s\S]*if \(!pollStillCurrent\(task\)\) return;[\s\S]*liveState = next;/,
  'GET ownership must be checked before body parsing and again before liveState assignment');
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
assert.match(source, /function sendStillCurrent\(task\)[\s\S]*sendTask === task[\s\S]*task\.generation === sendGeneration[\s\S]*documentOwned\(\)[\s\S]*pendingRevision == null[\s\S]*!sessionExpired\(\)[\s\S]*planId\(\) === task\.planId[\s\S]*focusIndex\(\) === task\.focus/,
  'POST completion should fail closed across lifecycle, revision, expiry, and personal-scope boundaries');
assert.match(source, /if \(!documentOwned\(\)\) return checkinOutcome\("blocked", "suspended"\);[\s\S]*if \(!url \|\| focus < 0 \|\| !key\) return checkinOutcome\("blocked", "unavailable"\);[\s\S]*if \(pendingRevision != null\) return checkinOutcome\("rejected", "plan_updated"[\s\S]*if \(sessionExpired\(\)\) return checkinOutcome\("rejected", "expired"/,
  'new voluntary writes should fail closed while suspended and report explicit blocked/rejected outcomes for invalid scope, revision, or expiry');
assert.match(source, /function checkinOutcome\([\s\S]*if \(documentOwned\(\)\)[\s\S]*nvs-shared-checkin-outcome/,
  'terminal check-in events must stay DOM/event-inert while the document is frozen or hidden');
assert.match(source, /body: JSON\.stringify\([^\n]*revision: loadedRevision[^\n]*\)/,
  'voluntary writes should carry the loaded plan revision for server-side stale-write hardening');
assert.match(source, /signal: controller\.signal/,
  'owned GET and POST requests should be cancellable');
assert.match(source, /const next = await response\.json\(\);[\s\S]*if \(!sendStillCurrent\(task\)\)[\s\S]*liveState =/,
  'a POST must re-check ownership after async body parsing before publishing state');
assert.match(source, /catch \(error\) \{[\s\S]*if \(!sendStillCurrent\(task\)\)[\s\S]*return checkinOutcome\("aborted"[\s\S]*console\.warn/,
  'late transport errors must lose ownership before warning, DOM mutation, or UI-facing outcome publication');
assert.match(source, /addEventListener\("nvs-shared-session-expired"[\s\S]*invalidateSend\(\)/,
  'authoritative expiry should invalidate an in-flight voluntary write');
assert.match(source, /addEventListener\("pagehide"[\s\S]*documentFrozen = true;[\s\S]*invalidatePoll\(\);[\s\S]*invalidateSend\(\);/,
  'pagehide should freeze ownership before invalidating both read and write work');
assert.match(source, /addEventListener\("pageshow"[\s\S]*documentFrozen = false;[\s\S]*invalidatePoll\(\)[\s\S]*void poll\(\)/,
  'pageshow should reacquire ownership before replacing stale lifecycle work');
assert.match(source, /visibilitychange[\s\S]*invalidatePoll\(\);[\s\S]*document\.hidden\) invalidateSend\(\)[\s\S]*if \(documentOwned\(\)\)/,
  'visibility transitions should invalidate writes and only resume work if explicit lifecycle ownership is also active');

// Repeated refresh triggers should join the same request while it is current,
// but a replacement generation must be free to start immediately after
// invalidation even if the older promise has not settled yet.
assert.match(source, /if \(pollTask\) return pollTask\.promise;/,
  'overlapping current-generation polls should coalesce');
assert.match(source, /const generation = \+\+pollGeneration;/,
  'each fresh poll should receive a new generation');
assert.match(source, /if \(!response\.ok \|\| !pollStillCurrent\(task\)\) return;/,
  'poll completion should be rejected when superseded, suspended, racing a POST, or owned by another plan');
assert.match(source, /if \(pollTask === task\) pollTask = null;/,
  'an older poll must never clear the identity of its replacement');

// Navigation, bfcache/visibility transitions, and reconnects are all ownership
// boundaries. A response started for an older lifecycle must not repaint the
// resumed page.
assert.match(source, /function render\(\) \{\s*if \(!documentOwned\(\)\) return;/,
  'Shared Live rendering itself must be inert while page ownership is frozen');
assert.match(source, /function poll\(\)[\s\S]*!documentOwned\(\)/,
  'direct refresh calls must not start network work while suspended');
assert.match(source, /function schedulePoll\([\s\S]*!documentOwned\(\)/,
  'poll timers must not restart while suspended');
assert.match(source, /addEventListener\("online"[\s\S]*if \(!documentOwned\(\)\) return;[\s\S]*invalidatePoll\(\)[\s\S]*void poll\(\)/,
  'reconnect should remain inert while frozen and start from a fresh generation only when owned');

// Preserve the explicit privacy boundary while touching Shared Live code.
assert.doesNotMatch(source, /watchPosition\s*\(/,
  'Shared Live must not introduce continuous/background GPS tracking');
assert.doesNotMatch(source, /localStorage|indexedDB/i,
  'Shared Live check-in ownership must not add durable personal state storage');

console.log('shared live v010 document/read/write ownership contracts OK');