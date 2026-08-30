'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('trip-tools-v0111.js', 'utf8');

assert.match(source, /const outcome = await window\.NVSSharedLive\.checkIn\(status\)/, 'Trip Tools must consume the Shared Live structured outcome directly');
assert.match(source, /outcome\?\.reason === "plan_updated"/, 'plan revision rejection needs explicit user feedback');
assert.match(source, /outcome\?\.reason === "expired"/, 'authoritative expiry needs explicit user feedback');
assert.match(source, /outcome\?\.reason === "capability_revoked"/, 'capability revocation needs explicit user feedback');
assert.match(source, /outcome\?\.status === "uncertain"/, 'weak-network ambiguity must remain distinct from definite rejection');
assert.match(source, /outcome\?\.status === "aborted"/, 'lifecycle cancellation must remain distinct from network uncertainty');
assert.match(source, /if \(outcome\.status === "sent"\) window\.NVSSharedLive\.refresh\?\.\(\)/, 'only confirmed sends should trigger the extra refresh');
assert.match(source, /const hasOutcome = Boolean\(outcome && typeof outcome === "object" && typeof outcome\.status === "string"\)/, 'mixed-cache compatibility should be explicit and bounded');
assert.match(source, /if \(!hasOutcome\)[\s\S]*statusWasApplied\(status, beforeAt\)/, 'legacy state inference may only be used when no structured outcome exists');
assert.match(source, /let checkinUiGeneration = 0;/, 'Trip Tools check-in UI needs its own lifecycle generation');
assert.match(source, /window\.addEventListener\("pagehide", invalidateCheckinUi\)/, 'pagehide must invalidate stale check-in UI ownership');
assert.match(source, /if \(document\.hidden\) \{\s*invalidateCheckinUi\(\)/, 'hidden pages must invalidate stale check-in UI ownership');
assert.match(source, /dialog\.addEventListener\("close", async \(\) => \{\s*invalidateCheckinUi\(\)/, 'closing Trip Mode must invalidate stale check-in UI ownership');

const directFetches = (source.match(/\bfetch\s*\(/g) || []).length;
assert.strictEqual(directFetches, 0, 'Trip Tools must not create a second check-in network path');
assert.doesNotMatch(source, /watchPosition\s*\(/, 'Trip Tools must not add continuous/background GPS tracking');
assert.doesNotMatch(source, /localStorage\s*\./, 'Trip Tools check-in state must not become durable local storage');

console.log('Trip Tools structured check-in outcome contract passed.');
