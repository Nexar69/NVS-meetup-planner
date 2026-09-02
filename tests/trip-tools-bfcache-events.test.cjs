const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../trip-tools-v0111.js'), 'utf8');

assert.match(source, /let lifecycleFrozen = false;/,
  'Trip Tools should explicitly own a pagehide/pageshow lifecycle freeze');
assert.match(source, /function ownsForeground\(\) \{\s*return !lifecycleFrozen && !document\.hidden;\s*\}/,
  'Trip Tools should centralize visible lifecycle ownership');
assert.match(source, /function render\(\) \{\s*if \(!ownsForeground\(\)\) return;/,
  'direct render requests must not repaint a suspended document');
assert.match(source, /function scheduleRender\(\) \{[\s\S]*if \(!ownsForeground\(\) \|\| !recommendationsActive\) return;/,
  'route-age timers must not restart while the document is suspended');
assert.match(source, /timer = setTimeout\(\(\) => \{\s*if \(!ownsForeground\(\)\) return;/,
  'route-age callbacks must re-check foreground ownership at execution time');
assert.match(source, /async function acquireWakeLock\(\) \{\s*if \(!ownsForeground\(\) \|\|/,
  'wake-lock reacquisition must be suppressed during lifecycle suspension');
assert.match(source, /async function sendStatus\(status\) \{\s*if \(!ownsForeground\(\) \|\|/,
  'new voluntary check-ins must fail closed while suspended');
assert.match(source, /if \(!ownsForeground\(\) \|\| generation !== checkinUiGeneration\) return;/,
  'a check-in completion begun before suspension must lose UI ownership');
assert.match(source, /addEventListener\("nvs-shared-live-change", \(\) => \{\s*if \(ownsForeground\(\)\) render\(\);\s*\}\)/,
  'late Shared Live events must not repaint Trip Tools during suspension');
assert.match(source, /addEventListener\("nvs-shared-session-expired", \(\) => \{\s*invalidateCheckinUi\(\);\s*if \(ownsForeground\(\)\) \{[\s\S]*reconcileCheckinUiMessage\(\);[\s\S]*render\(\);[\s\S]*\}\s*\}\)/,
  'authoritative expiry must invalidate unsafe work and reconcile transient UI only when owned');
assert.match(source, /addEventListener\("pagehide", \(\) => \{[\s\S]*lifecycleFrozen = true;[\s\S]*disconnectBootstrapObserver\(\);[\s\S]*clearTimeout\(timer\);[\s\S]*wakeRequestGeneration \+= 1;/,
  'pagehide should cross observer, check-in, timer, and wake-lock ownership boundaries');
assert.match(source, /addEventListener\("pageshow", \(\) => \{\s*lifecycleFrozen = false;\s*reconcileCheckinUiMessage\(\);\s*start\(\);/,
  'pageshow should reopen lifecycle ownership and reconcile only if visible');
assert.match(source, /if \(lifecycleFrozen\) return;\s*if \(document\.hidden\) \{[\s\S]*disconnectBootstrapObserver\(\);[\s\S]*invalidateCheckinUi\(\);/,
  'ordinary hidden transitions should release observer and transient UI ownership');

assert.doesNotMatch(source, /\bfetch\s*\(/,
  'Trip Tools must continue reusing Shared Live rather than creating a duplicate network path');
assert.doesNotMatch(source, /watchPosition|getCurrentPosition|geolocation/i,
  'lifecycle hardening must not add hidden/background or continuous location tracking');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
  'Trip Tools voluntary/lifecycle state should remain memory-only');

console.log('trip-tools-bfcache-events: visible lifecycle ownership fails closed and restores through current state');
