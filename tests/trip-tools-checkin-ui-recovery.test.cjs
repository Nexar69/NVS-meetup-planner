const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../trip-tools-v0111.js'), 'utf8');

assert.match(source, /const CHECKIN_IDLE_TEXT = "Only what you tap is shared\. No GPS\.";/,
  'Trip Tools should keep one privacy-preserving idle check-in message');
assert.match(source, /function reconcileCheckinUiMessage\(\)\s*{[\s\S]*state\?\.textContent === "Updating…"[\s\S]*CHECKIN_IDLE_TEXT;/,
  'Trip Tools should explicitly reconcile an abandoned transient Updating state');
assert.match(source, /addEventListener\("pageshow",[\s\S]*lifecycleFrozen = false;[\s\S]*reconcileCheckinUiMessage\(\);[\s\S]*start\(\);/,
  'pageshow must clear stale transient check-in UI before normal restored rendering');
assert.match(source, /addEventListener\("visibilitychange",[\s\S]*if \(document\.hidden\)[\s\S]*invalidateCheckinUi\(\);[\s\S]*return;[\s\S]*reconcileCheckinUiMessage\(\);/,
  'foreground visibility restoration must clear stale Updating text after hidden cancellation');
assert.match(source, /addEventListener\("nvs-shared-session-expired",[\s\S]*invalidateCheckinUi\(\);[\s\S]*reconcileCheckinUiMessage\(\);/,
  'authoritative expiry should not leave an abandoned Updating indicator behind');
assert.doesNotMatch(source, /watchPosition\s*\(/,
  'Trip Tools must not introduce continuous/background location tracking');
assert.doesNotMatch(source, /localStorage|indexedDB/i,
  'Trip Tools voluntary UI state must remain non-durable');

console.log('trip-tools-checkin-ui-recovery: stale Updating state is reconciled after bfcache/visibility/expiry cancellation');
