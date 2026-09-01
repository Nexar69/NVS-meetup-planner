const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../share-v010.js'), 'utf8');

assert.match(source, /let lifecycleFrozen = false;/,
  'secure organizer sharing should own an explicit page lifecycle boundary');
assert.match(source, /function ownsLifecycle\(\) \{\s*return !lifecycleFrozen && !document\.hidden;\s*\}/,
  'organizer network work must require both bfcache and visibility ownership');
assert.match(source, /function cancelScheduledSync\(\) \{\s*clearTimeout\(syncTimer\);\s*syncTimer = null;\s*\}/,
  'the debounced organizer sync must have one explicit cancellation owner');
assert.match(source, /function invalidatePlanSync\(\) \{\s*activePlanSync\?\.controller\?\.abort\?\.\(\);\s*syncGeneration \+= 1;/,
  'invalidating plan sync should abort an owned request when AbortController is available');
assert.match(source, /async function syncExistingPlan[\s\S]*if \(!ownsLifecycle\(\) \|\| !secureCache\?\.id/,
  'direct organizer sync entry must fail closed while hidden or page-frozen');
assert.match(source, /const controller = typeof AbortController === "function" \? new AbortController\(\) : null;/,
  'organizer plan sync should use an abortable request where supported');
assert.match(source, /\/api\/live\/\$\{session\.id\}\/plan[\s\S]*\.\.\.\(controller \? \{ signal: controller\.signal \} : \{\}\)/,
  'the organizer plan POST should be bound to the owned abort controller');
assert.match(source, /const response = await fetch[\s\S]*if \(!ownsLifecycle\(\) \|\| secureCache !== session \|\| generation !== syncGeneration/,
  'a late network completion must not mutate organizer state after lifecycle ownership is lost');
assert.match(source, /function scheduleSync\(\) \{\s*cancelScheduledSync\(\);\s*if \(!ownsLifecycle\(\) \|\| !secureCache\) return;/,
  'debounced sync scheduling must be inert without visible lifecycle ownership');
assert.match(source, /syncTimer = setTimeout\(\(\) => \{\s*syncTimer = null;\s*if \(!ownsLifecycle\(\)\) return;/,
  'an already-queued debounce callback must re-check ownership before starting network work');
assert.match(source, /function suspendPlanSync\(\) \{\s*cancelScheduledSync\(\);\s*invalidatePlanSync\(\);\s*\}/,
  'page and visibility suspension should share one sync cancellation path');
assert.match(source, /addEventListener\("pagehide", \(\) => \{\s*lifecycleFrozen = true;\s*suspendPlanSync\(\);/,
  'pagehide must freeze ownership before cancelling queued/in-flight organizer sync');
assert.match(source, /addEventListener\("pageshow", \(\) => \{\s*lifecycleFrozen = false;\s*if \(!document\.hidden\) scheduleSync\(\);/,
  'pageshow should reconcile the current plan rather than replay stale queued work');
assert.match(source, /document\.addEventListener\("visibilitychange", \(\) => \{\s*if \(document\.hidden\) \{\s*suspendPlanSync\(\);/,
  'hidden transitions must cancel pending and in-flight organizer sync even without pagehide');
assert.match(source, /if \(error\?\.name !== "AbortError"\) console\.warn/,
  'expected lifecycle aborts should not be reported as sync failures');

assert.doesNotMatch(source, /watchPosition|getCurrentPosition/i,
  'organizer sync lifecycle hardening must not add location access');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
  'organizer sync lifecycle state should remain memory-only');

console.log('share-v010-plan-sync-lifecycle: organizer sync is visibility-owned, abortable and restore-safe');
