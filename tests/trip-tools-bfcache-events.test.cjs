const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../trip-tools-v0111.js'), 'utf8');

assert.match(source, /let lifecycleFrozen = false;/,
  'Trip Tools should explicitly own a pagehide/pageshow lifecycle freeze');
assert.match(source, /function render\(\) \{\s*if \(lifecycleFrozen\) return;/,
  'direct render requests must not repaint a bfcache-frozen document');
assert.match(source, /function scheduleRender\(\) \{[\s\S]*if \(lifecycleFrozen \|\| document\.hidden\) return;/,
  'route-age timers must not restart while the document is frozen');
assert.match(source, /async function acquireWakeLock\(\) \{\s*if \(lifecycleFrozen \|\|/,
  'wake-lock reacquisition must be suppressed during bfcache suspension');
assert.match(source, /async function sendStatus\(status\) \{\s*if \(lifecycleFrozen \|\|/,
  'new voluntary check-ins must fail closed while frozen');
assert.match(source, /if \(lifecycleFrozen \|\| generation !== checkinUiGeneration \|\| document\.hidden\) return;/,
  'a check-in completion begun before pagehide must lose UI ownership');
assert.match(source, /addEventListener\("nvs-shared-live-change", \(\) => \{\s*if \(!lifecycleFrozen\) render\(\);\s*\}\)/,
  'late Shared Live events must not repaint Trip Tools during the freeze');
assert.match(source, /addEventListener\("nvs-shared-session-expired", \(\) => \{\s*invalidateCheckinUi\(\);\s*if \(!lifecycleFrozen\) \{[\s\S]*reconcileCheckinUiMessage\(\);[\s\S]*render\(\);[\s\S]*\}\s*\}\)/,
  'authoritative expiry must invalidate unsafe work and reconcile transient UI only when owned');
assert.match(source, /addEventListener\("pagehide", \(\) => \{[\s\S]*lifecycleFrozen = true;[\s\S]*clearTimeout\(timer\);[\s\S]*wakeRequestGeneration \+= 1;/,
  'pagehide should cross check-in, timer, and wake-lock ownership boundaries');
assert.match(source, /addEventListener\("pageshow", \(\) => \{\s*lifecycleFrozen = false;\s*reconcileCheckinUiMessage\(\);\s*start\(\);/,
  'pageshow should reopen lifecycle ownership, clear stale transient UI, and reconcile fresh state');
assert.match(source, /if \(lifecycleFrozen\) return;\s*if \(document\.hidden\)/,
  'visibility events must not independently mutate a bfcache-frozen document');

assert.doesNotMatch(source, /\bfetch\s*\(/,
  'Trip Tools must continue reusing Shared Live rather than creating a duplicate network path');
assert.doesNotMatch(source, /watchPosition|getCurrentPosition|geolocation/i,
  'bfcache hardening must not add hidden/background or continuous location tracking');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
  'Trip Tools voluntary/lifecycle state should remain memory-only');

console.log('trip-tools-bfcache-events: frozen direct events fail closed and restore through pageshow');
