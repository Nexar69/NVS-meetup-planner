const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../release-v080.js'), 'utf8');

assert.match(source, /let lifecycleFrozen = false;/,
  'release/display compatibility layer should own an explicit frozen-document boundary');
assert.match(source, /window\.addEventListener\("pagehide", freezeLifecycle\)/,
  'pagehide must freeze display/provider ownership');
assert.match(source, /window\.addEventListener\("pageshow", restoreLifecycle\)/,
  'pageshow must reconcile display/provider ownership');
assert.match(source, /function freezeLifecycle\(\)[\s\S]*lifecycleFrozen = true;[\s\S]*cancelProviderDecoration\(\);[\s\S]*disconnectObservers\(\);/,
  'freeze must cancel timers and disconnect MutationObservers');
assert.match(source, /function restoreLifecycle\(event\)[\s\S]*recommendationsActive = Boolean\(window\.__NVS_LAST_RECOMMENDATIONS__\);[\s\S]*readDisplayState\(\);[\s\S]*connectObservers\(\);[\s\S]*decorateProviders\(\);/,
  'restore must reconcile current recommendation and display state rather than replay frozen work');
assert.match(source, /function decorateProviders\(\)[\s\S]*if \(lifecycleFrozen \|\| !recommendationsActive\) return;[\s\S]*if \(lifecycleFrozen \|\| !recommendationsActive\) return;/,
  'both scheduling and queued timer completions must fail closed while frozen');
assert.match(source, /function setIntermediateStops\(next\) \{\s*if \(lifecycleFrozen\) return false;/,
  'direct display-setting API calls must not mutate state/storage while frozen');
assert.match(source, /window\.addEventListener\("nvs-routing-provider", \(event\) => \{\s*if \(lifecycleFrozen\) return;/,
  'late provider events must not repaint the frozen document');
assert.match(source, /function activateRecommendations\(\) \{\s*if \(lifecycleFrozen\) return;/,
  'late recommendation-rendered events must not restart work while frozen');
assert.match(source, /function clearRecommendations\(\) \{\s*if \(lifecycleFrozen\) return;/,
  'late recommendation-clear events must not mutate frozen DOM');
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
  'display lifecycle hardening must not add location access');
assert.doesNotMatch(source, /fetch\(|XMLHttpRequest/i,
  'display compatibility layer must remain network-free');

console.log('release-v080-bfcache-ownership: timers, observers and direct events freeze safely');
