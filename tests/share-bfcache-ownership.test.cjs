const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../share-v072.js'), 'utf8');

assert.match(source, /let lifecycleFrozen = false;/,
  'sharing should own an explicit frozen-document lifecycle boundary');
assert.match(source, /let resultsObserver = null;/,
  'sharing should retain explicit ownership of its results MutationObserver');
assert.match(source, /window\.addEventListener\("pagehide", freezeLifecycle\)/,
  'pagehide must freeze share UI ownership');
assert.match(source, /window\.addEventListener\("pageshow", restoreLifecycle\)/,
  'pageshow must reconcile share UI ownership');
assert.match(source, /function freezeLifecycle\(\)[\s\S]*lifecycleFrozen = true;[\s\S]*clearTimeout\(toastTimer\);[\s\S]*clearTimeout\(decorationTimer\);[\s\S]*invalidateShortPlan\(\);[\s\S]*disconnectResultsObserver\(\);/,
  'freeze must cancel queued DOM work, revoke short-link ownership and disconnect the observer');
assert.match(source, /function restoreLifecycle\(event\)[\s\S]*event\?\.persisted[\s\S]*lifecycleFrozen = false;[\s\S]*connectResultsObserver\(\);[\s\S]*viewerBanner\(\);[\s\S]*decorate\(\);/,
  'persisted restore must reconnect ownership and recompute current decorations instead of replaying frozen work');
assert.match(source, /function decorate\(\) \{\s*if \(lifecycleFrozen\) return;[\s\S]*setTimeout\(\(\) => \{\s*if \(lifecycleFrozen\) return;/,
  'both decoration scheduling and queued timer completion must fail closed while frozen');
assert.match(source, /new MutationObserver\(\(\) => \{\s*if \(!lifecycleFrozen\) decorate\(\);/,
  'queued MutationObserver callbacks must not repaint a frozen document');
assert.match(source, /function confirmShare\(focus = -1\) \{\s*if \(lifecycleFrozen \|\| sharedPlan\) return;/,
  'direct share dialog entry must be inert while frozen');
assert.match(source, /async function deliver\(focus = -1\) \{\s*if \(lifecycleFrozen\) return;/,
  'direct delivery entry must be inert while frozen');
assert.match(source, /navigator\.clipboard\?\.writeText[\s\S]*!lifecycleFrozen && generation === deliveryGeneration/,
  'late clipboard completion must not announce into a frozen document');
assert.match(source, /navigator\.share[\s\S]*!lifecycleFrozen && generation === deliveryGeneration && error\?\.name !== "AbortError"/,
  'late native share failure must not announce into a frozen document');
assert.match(source, /async function ensureShortPlan[\s\S]*if \(lifecycleFrozen \|\| !config\.backendUrl \|\| !payload\) return null;/,
  'frozen share ownership must not start short-link network work');

assert.doesNotMatch(source, /watchPosition|getCurrentPosition/i,
  'bfcache hardening must not add location access');
assert.doesNotMatch(source, /indexedDB/i,
  'share lifecycle ownership must remain ephemeral');

console.log('share-bfcache-ownership: timers, observer, dialogs and async delivery freeze safely');
