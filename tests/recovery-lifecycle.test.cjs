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
  /let lifecycleFrozen = false;/,
  'Recovery Desk should own an explicit memory-only lifecycle freeze boundary',
);
assert.match(
  source,
  /function shouldPoll\(\) \{[\s\S]*recommendationsActive \|\| Boolean\(window\.NVSSharedLive\?\.hasPendingPlanUpdate\?\.\(\)\);[\s\S]*\}/,
  'Recovery Desk should poll only while a route is active or a pending shared-plan update still needs attention',
);
assert.match(
  source,
  /function suspendWork\(\) \{[\s\S]*clearTimeout\(timer\);[\s\S]*timer = null;[\s\S]*\}/,
  'Recovery Desk should have one explicit timer-suspension path',
);
assert.match(
  source,
  /function schedule\(\) \{[\s\S]*suspendWork\(\);[\s\S]*if \(lifecycleFrozen \|\| document\.hidden \|\| !shouldPoll\(\)\) return;/,
  'Scheduling must clear older work and stay stopped when the page is frozen, hidden, or recovery context is absent',
);
assert.match(
  source,
  /function render\(\) \{\s*if \(lifecycleFrozen\) return;/s,
  'direct and event-driven Recovery Desk renders must be inert while the document is frozen',
);
assert.match(
  source,
  /function ensureDesk\(\) \{\s*if \(lifecycleFrozen\) return null;/s,
  'late lifecycle work must not create Recovery Desk DOM while frozen',
);
assert.match(
  source,
  /addEventListener\("nvs-recommendations-cleared", \(\) => \{\s*if \(lifecycleFrozen\) return;[\s\S]*recommendationsActive = false;[\s\S]*render\(\);[\s\S]*schedule\(\);/,
  'an authoritative recommendation clear must be ignored while frozen and disable polling immediately when active',
);
assert.match(
  source,
  /addEventListener\("nvs-group-recommendations-rendered", \(\) => \{\s*if \(lifecycleFrozen\) return;[\s\S]*recommendationsActive = Boolean\(window\.__NVS_LAST_RECOMMENDATIONS__\?\.primary\);[\s\S]*schedule\(\);/,
  'only an active-lifecycle authoritative recommendation render should reactivate route polling',
);
assert.match(
  source,
  /function freezeLifecycle\(\) \{\s*lifecycleFrozen = true;\s*suspendWork\(\);\s*\}/s,
  'pagehide should revoke Recovery Desk ownership before cancelling its timer',
);
assert.match(
  source,
  /window\.addEventListener\("pagehide", freezeLifecycle\);/,
  'Safari/bfcache navigation must explicitly freeze Recovery Desk ownership before the page is suspended',
);
assert.match(
  source,
  /function resumeLifecycle\(event\) \{\s*if \(!event\?\.persisted\) return;\s*suspendWork\(\);\s*lifecycleFrozen = false;\s*start\(\);\s*\}/s,
  'persisted pageshow should invalidate frozen timers before reconciling current recovery state',
);
assert.match(
  source,
  /window\.addEventListener\("pageshow", resumeLifecycle\);/,
  'Safari/bfcache resume should continue through the explicit ownership-reopen path',
);
assert.doesNotMatch(source, /window\.addEventListener\("pageshow", start\)/, 'ordinary pageshow must not duplicate initial Recovery Desk startup');
assert.match(source, /visibilitychange[\s\S]*if \(lifecycleFrozen\) return;/, 'visibility changes must not reopen frozen Recovery Desk work');
assert.match(source, /reloadPendingPlan\(\) \{\s*if \(lifecycleFrozen\) return false;/s, 'reload actions must not execute from a frozen lifecycle');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, 'Recovery Desk lifecycle state must remain memory-only');
assert.doesNotMatch(source, /watchPosition\s*\(/, 'Recovery Desk must not introduce continuous GPS tracking');

console.log('Recovery Desk lifecycle and bfcache ownership regression checks passed.');