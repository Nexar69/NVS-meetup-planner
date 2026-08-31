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
assert.match(legacyShareSource, /if \(!lifecycleFrozen && generation === shortPlanGeneration\) shortPlanCache = stored;/, "a superseded or frozen request must not repopulate the short-link cache");
assert.match(legacyShareSource, /generation !== shortPlanGeneration \|\| !latest \|\| planSignature\(latest\) !== signature/, "share delivery should reject a short link if planner state changed while it was being created");
assert.match(legacyShareSource, /return buildShareUrl\(focus\) \|\| fallback;/, "a stale short-link completion should fall back to the latest encoded plan");
assert.match(legacyShareSource, /function invalidateShortPlan\(\)/, "planner-state changes should explicitly invalidate short-link ownership");
assert.match(legacyShareSource, /let deliveryInflight = null;/, "legacy delivery should own a single in-flight Web Share or clipboard operation");
assert.match(legacyShareSource, /let deliveryGeneration = 0;/, "legacy delivery should own a lifecycle generation token");
assert.match(legacyShareSource, /if \(deliveryInflight\) return deliveryInflight\.promise;/, "rapid repeated share taps should coalesce instead of opening overlapping native share surfaces");
assert.match(legacyShareSource, /if \(lifecycleFrozen \|\| generation !== deliveryGeneration\) return;/, "a frozen or superseded delivery must stop before invoking Web Share, clipboard, or prompt UI");
assert.match(legacyShareSource, /!lifecycleFrozen && generation === deliveryGeneration\) showToast\(/, "late clipboard completion must not repaint toast UI after delivery invalidation or page freeze");
assert.match(legacyShareSource, /!lifecycleFrozen && generation === deliveryGeneration && error\?\.name !== "AbortError"/, "late native-share failures must not repaint superseded or frozen UI");
assert.match(legacyShareSource, /window\.addEventListener\("pagehide", invalidateDelivery\)/, "page lifecycle teardown should invalidate pending share delivery");
assert.match(legacyShareSource, /nvs-group-change[\s\S]*invalidateDelivery\(\)/, "group changes should invalidate an in-flight legacy share delivery");
assert.match(legacyShareSource, /nvs-priority-change[\s\S]*invalidateDelivery\(\)/, "priority changes should invalidate an in-flight legacy share delivery");
assert.match(legacyShareSource, /nvs-timing-change[\s\S]*invalidateDelivery\(\)/, "timing changes should invalidate an in-flight legacy share delivery");
assert.doesNotMatch(legacyShareSource, /watchPosition\s*\(/, "share hardening must not add continuous location tracking");

console.log("share-expiry-cache: expired organizer sessions cannot be silently reused and legacy short-link/delivery work is lifecycle-owned");
