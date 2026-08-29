const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../share-v010.js"), "utf8");
const legacyShareSource = fs.readFileSync(path.resolve(__dirname, "../share-v072.js"), "utf8");

assert.match(source, /function cacheExpiresAt\(\)/, "organizer sharing should expose authoritative cached expiry");
assert.match(source, /function cacheExpired\(now = Date\.now\(\)\)/, "organizer sharing should detect an expired cached session");
assert.match(source, /if \(cacheExpired\(\)\) clearSecureCache\("expired"\)/, "sharing should evict an expired session before cache reuse");
assert.match(source, /secureCache\?\.signature === sig && !cacheExpired\(\)/, "same-plan reuse must be gated by expiry");
assert.match(source, /response\.status === 404 \|\| response\.status === 409/, "plan sync should evict missing\/expired backend sessions");
assert.match(source, /response\.status === 404[\s\S]*clearSecureCache\("missing-or-expired"\)/, "capability rotation should evict an expired backend session");
assert.match(source, /expiresAt: Number\.isFinite\(expiry\) && expiry > 0 \? expiry : null/, "new secure sessions should remember backend expiresAt");
assert.match(source, /getExpiresAt: \(\) => cacheExpiresAt\(\)/, "expiry should be inspectable for diagnostics/tests");
assert.match(source, /isSessionExpired: \(\) => cacheExpired\(\)/, "cache expiry state should be inspectable");
assert.doesNotMatch(source, /expires automatically after about 72 hours/i, "share copy must not guess the configured backend TTL");
assert.match(source, /exact automatic expiry is set by the Meet Schwerin backend/, "group share copy should describe backend-authoritative expiry");

assert.match(legacyShareSource, /let shortPlanInflight = null;/, "legacy short-link sharing should track an in-flight request");
assert.match(legacyShareSource, /let shortPlanGeneration = 0;/, "legacy short-link sharing should own a generation token");
assert.match(legacyShareSource, /shortPlanInflight\?\.signature === signature && shortPlanInflight\.generation === shortPlanGeneration/, "same-plan short-link requests should coalesce within one generation");
assert.match(legacyShareSource, /if \(generation === shortPlanGeneration\) shortPlanCache = stored;/, "a superseded request must not repopulate the short-link cache");
assert.match(legacyShareSource, /generation !== shortPlanGeneration \|\| !latest \|\| planSignature\(latest\) !== signature/, "share delivery should reject a short link if planner state changed while it was being created");
assert.match(legacyShareSource, /return buildShareUrl\(focus\) \|\| fallback;/, "a stale short-link completion should fall back to the latest encoded plan");
assert.match(legacyShareSource, /function invalidateShortPlan\(\)/, "planner-state changes should explicitly invalidate short-link ownership");
assert.doesNotMatch(legacyShareSource, /watchPosition\s*\(/, "share hardening must not add continuous location tracking");

console.log("share-expiry-cache: expired organizer sessions cannot be silently reused and legacy short-link work is generation-owned");
