const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('recovery-v0111.js', 'utf8');

assert.match(
  source,
  /let recommendationsActive = Boolean\(window\.__NVS_LAST_RECOMMENDATIONS__\?\.primary\);/,
  'Recovery Desk should derive its initial polling state from an authoritative recommendation',
);
assert.match(
  source,
  /function shouldPoll\(\) \{[\s\S]*recommendationsActive \|\| Boolean\(window\.NVSSharedLive\?\.hasPendingPlanUpdate\?\.\(\)\);[\s\S]*\}/,
  'Recovery Desk should poll only while a route is active or a pending shared-plan update still needs attention',
);
assert.match(
  source,
  /function suspend\(\) \{[\s\S]*clearTimeout\(timer\);[\s\S]*timer = null;[\s\S]*\}/,
  'Recovery Desk should have one explicit timer-suspension path for hidden/pagehide lifecycle boundaries',
);
assert.match(
  source,
  /function schedule\(\) \{[\s\S]*suspend\(\);[\s\S]*if \(document\.hidden \|\| !shouldPoll\(\)\) return;/,
  'Scheduling must clear older work and stay stopped when the page is hidden or recovery context is absent',
);
assert.match(
  source,
  /addEventListener\("nvs-recommendations-cleared", \(\) => \{[\s\S]*recommendationsActive = false;[\s\S]*render\(\);[\s\S]*schedule\(\);/,
  'An authoritative clear must disable polling immediately',
);
assert.match(
  source,
  /addEventListener\("nvs-group-recommendations-rendered", \(\) => \{[\s\S]*recommendationsActive = Boolean\(window\.__NVS_LAST_RECOMMENDATIONS__\?\.primary\);[\s\S]*schedule\(\);/,
  'Only a fresh authoritative recommendation render should reactivate route polling',
);
assert.match(
  source,
  /window\.addEventListener\("pagehide", suspend\);/,
  'Safari/bfcache navigation must explicitly stop Recovery Desk timers before the page is frozen',
);
assert.match(
  source,
  /window\.addEventListener\("pageshow", start\);/,
  'Safari/bfcache resume should continue through the guarded start path',
);
assert.doesNotMatch(source, /watchPosition\s*\(/, 'Recovery Desk must not introduce continuous GPS tracking');

console.log('Recovery Desk lifecycle regression checks passed.');