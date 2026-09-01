const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../ux-v051.js'), 'utf8');

assert.match(source, /let lifecycleFrozen = false;/,
  'v0.5.1 UX should own an explicit frozen-document boundary');
assert.match(source, /let lifecycleGeneration = 0;/,
  'async UX work should be generation-owned across lifecycle transitions');
assert.match(source, /window\.addEventListener\("pagehide", freezeLifecycle\)/,
  'pagehide must freeze v0.5.1 UX ownership');
assert.match(source, /window\.addEventListener\("pageshow", restoreLifecycle\)/,
  'pageshow must reconcile current v0.5.1 UX state');
assert.match(source, /function freezeLifecycle\(\)[\s\S]*lifecycleFrozen = true;[\s\S]*lifecycleGeneration \+= 1;[\s\S]*controllerState\.forEach\(\(state\) => cancelOriginSearch\(state\)\);[\s\S]*destinationDialog\?\.cancelSearch\?\.\(\);[\s\S]*cancelDestinationFocus\(\);[\s\S]*disconnectResultsObserver\(\);/,
  'freeze must cancel origin/destination search, focus timers and observer ownership');
assert.match(source, /async function photonSearch\([\s\S]*ensureLifecycleActive\(\);[\s\S]*const lifecycle = lifecycleGeneration;[\s\S]*signal: controller\.signal,[\s\S]*ensureLifecycleActive\(lifecycle\);[\s\S]*const data = await response\.json\(\);[\s\S]*ensureLifecycleActive\(lifecycle\);/,
  'Photon search must reject late response and JSON completions after lifecycle ownership changes');
assert.match(source, /credentials: "omit"/,
  'Photon search must continue omitting ambient credentials');
assert.match(source, /function runOriginSearch\(state, value\) \{\s*if \(lifecycleFrozen\) return;[\s\S]*lifecycle !== lifecycleGeneration/,
  'origin debounce work must fail closed while frozen or generation-stale');
assert.match(source, /dialog\.openSearch = \(\) => \{\s*if \(lifecycleFrozen\) return;[\s\S]*destinationFocusTimer = setTimeout\([\s\S]*lifecycleFrozen \|\| lifecycle !== lifecycleGeneration \|\| !dialog\.open/,
  'destination dialog entry and delayed focus must be lifecycle-owned');
assert.match(source, /function connectResultsObserver\(\) \{\s*if \(!results \|\| lifecycleFrozen \|\| resultsObserver\) return;[\s\S]*new MutationObserver\(\(\) => \{\s*if \(lifecycleFrozen\) return;/,
  'results MutationObserver must not mutate a suspended document');
assert.match(source, /function restoreLifecycle\(event\)[\s\S]*lifecycleFrozen = false;[\s\S]*lifecycleGeneration \+= 1;[\s\S]*state\.syncFromSelect\?\.\(\);[\s\S]*connectResultsObserver\(\);[\s\S]*bindJourneyFocus\(\);[\s\S]*decorateViewingState\(\);/,
  'restore must close stale search UI and reconcile current select/results state');
assert.doesNotMatch(source, /getCurrentPosition|watchPosition|geolocation/i,
  'UX lifecycle hardening must not introduce location access');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
  'UX lifecycle ownership must remain memory-only');

console.log('ux-v051-bfcache-ownership: search, focus, observer and direct UI ownership freeze safely');
