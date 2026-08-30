const fs = require('fs');
const assert = require('assert');

const live = fs.readFileSync('shared-live-v010.js', 'utf8');
const queue = fs.readFileSync('shared-checkin-queue-v0111.js', 'utf8');

assert.match(live, /function checkinOutcome\(status, reason, extra = null\)/,
  'Shared Live should expose a single structured voluntary check-in outcome path');
assert.match(live, /CustomEvent\("nvs-shared-checkin-outcome", \{ detail: outcome \}\)/,
  'every structured check-in result should be observable by the pending queue');
assert.match(live, /return checkinOutcome\("sent", "confirmed"/,
  'confirmed server writes should return an explicit successful result');
assert.match(live, /return checkinOutcome\("uncertain", "network_error"\)/,
  'network ambiguity should stay distinct from a definite server rejection');
assert.match(live, /response\.status === 409[\s\S]*problem\?\.error === "plan_updated"[\s\S]*pendingRevision = revision[\s\S]*checkinOutcome\("rejected", "plan_updated"/,
  'stale plan writes should immediately establish the pending revision and report a definite rejection');
assert.match(live, /response\.status === 403[\s\S]*forgetCapability\(\)[\s\S]*checkinOutcome\("rejected", "capability_revoked"/,
  'revoked capability responses should be definite and remove the tab-scoped key');
assert.match(live, /AbortError"\) return checkinOutcome\("aborted", "cancelled"\)/,
  'lifecycle cancellation should remain separate from both rejection and network uncertainty');

assert.match(queue, /addEventListener\("nvs-shared-checkin-outcome", handleCheckinOutcome\)/,
  'the memory-only queue should consume structured outcomes from the existing sender');
assert.match(queue, /outcome\.status === "sent" \|\| outcome\.status === "uncertain" \|\| outcome\.status === "aborted"/,
  'online attempts should keep confirmation polling only for sent or genuinely uncertain/cancelled work');
assert.match(queue, /outcome\?\.reason === "plan_updated"[\s\S]*server rejected the stale status/,
  'queued stale-plan writes should remain reviewable without being misreported as uncertain');
assert.match(queue, /outcome\?\.reason === "capability_revoked" \|\| outcome\?\.reason === "expired"[\s\S]*pending = null/,
  'definitively impossible queued writes should be removed instead of inviting a misleading retry');
assert.match(queue, /outcome\?\.status === "blocked" \|\| outcome\?\.status === "rejected"[\s\S]*pending status remains only in this tab/,
  'other definite non-success results may remain for explicit user review without automatic retry');

assert.doesNotMatch(queue, /fetch\s*\(/,
  'the queue must continue using the single Shared Live network path');
assert.doesNotMatch(queue, /localStorage|sessionStorage/,
  'voluntary pending intent must remain memory-only');
assert.doesNotMatch(`${live}\n${queue}`, /watchPosition\s*\(/,
  'structured outcomes must not expand location tracking');

console.log('shared-checkin-outcomes: definitive rejection, uncertainty and queue handoff contracts passed');
