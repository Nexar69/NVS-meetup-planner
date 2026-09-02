const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../release-v074.js'), 'utf8');

assert.match(source, /let lifecycleFrozen = false;/,
  'release shim should own an explicit frozen-document boundary');
assert.match(source, /let lifecycleGeneration = 0;/,
  'queued timer work should be generation-owned across lifecycle transitions');
assert.match(source, /window\.addEventListener\("pagehide", freezeLifecycle\)/,
  'pagehide must freeze release-shim ownership');
assert.match(source, /window\.addEventListener\("pageshow", restoreLifecycle\)/,
  'pageshow must reconcile release-shim ownership');
assert.match(source, /function freezeLifecycle\(\)[\s\S]*lifecycleFrozen = true;[\s\S]*lifecycleGeneration \+= 1;[\s\S]*cancelVersionTimer\(\);[\s\S]*disconnectVersionObserver\(\);/,
  'freeze must invalidate queued work, cancel timers and disconnect the MutationObserver');
assert.match(source, /function restoreLifecycle\(event\)[\s\S]*lifecycleFrozen = false;[\s\S]*lifecycleGeneration \+= 1;[\s\S]*connectVersionObserver\(\);[\s\S]*updateVersion\(\);[\s\S]*loadTestJourneyIfActive\(\);/,
  'restore must reacquire observer ownership and reconcile current DOM/test-lab state');
assert.match(source, /function scheduleVersion\(\) \{\s*if \(lifecycleFrozen\) return;[\s\S]*const generation = lifecycleGeneration;[\s\S]*if \(lifecycleFrozen \|\| generation !== lifecycleGeneration\) return;/,
  'both version scheduling and queued timer completion must fail closed while frozen');
assert.match(source, /function loadTestJourneyIfActive\(\) \{\s*if \(lifecycleFrozen\) return;/,
  'late load/test-lab events must not append scripts into a frozen document');
assert.match(source, /new MutationObserver\(\(\) => \{\s*if \(lifecycleFrozen\) return;/,
  'MutationObserver callbacks must stay DOM-inert while frozen');
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
  'release lifecycle hardening must not add location access');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/i,
  'release shim must remain storage- and network-free');

console.log('release-v074-bfcache-ownership: timer, observer and script injection ownership freeze safely');
