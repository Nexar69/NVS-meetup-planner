const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../release-v012.js'), 'utf8');

assert.match(source, /let lifecycleFrozen = false;/,
  'release copy should own an explicit frozen-document boundary');
assert.match(source, /let lifecycleGeneration = 0;/,
  'queued release-copy work should be generation-owned');
assert.match(source, /const timers = new Set\(\);/,
  'all release-copy timers should be tracked for lifecycle cancellation');
assert.match(source, /function freezeLifecycle\(\)[\s\S]*lifecycleFrozen = true;[\s\S]*lifecycleGeneration \+= 1;[\s\S]*cancelTimers\(\);/,
  'pagehide must invalidate and cancel queued release-copy work');
assert.match(source, /function restoreLifecycle\(event\)[\s\S]*lifecycleFrozen = false;[\s\S]*lifecycleGeneration \+= 1;[\s\S]*applyReleaseCopy\(\);/,
  'pageshow must reconcile current release copy once ownership returns');
assert.match(source, /function applyReleaseCopy\(\) \{\s*if \(lifecycleFrozen\) return;/,
  'direct events must not mutate release copy while frozen');
assert.match(source, /function scheduleReleaseCopy\(delay\) \{\s*if \(lifecycleFrozen\) return;[\s\S]*if \(lifecycleFrozen \|\| generation !== lifecycleGeneration\) return;/,
  'scheduled callbacks must fail closed after lifecycle transitions');
assert.match(source, /window\.addEventListener\("pagehide", freezeLifecycle\)/,
  'release copy must freeze on pagehide');
assert.match(source, /window\.addEventListener\("pageshow", restoreLifecycle\)/,
  'release copy must reconcile on pageshow');
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
  'release-copy hardening must not add location access');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/i,
  'release copy must remain storage- and network-free');

console.log('release-v012-bfcache-ownership: queued release copy freezes and reconciles safely');
