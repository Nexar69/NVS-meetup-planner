const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../share-v010.js"), "utf8");

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

console.log("share-expiry-cache: expired organizer sessions cannot be silently reused");
