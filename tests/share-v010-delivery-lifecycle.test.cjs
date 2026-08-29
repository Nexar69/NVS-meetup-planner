const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "share-v010.js"), "utf8");

assert.match(source, /let deliveryGeneration = 0;/, "organizer share delivery should own a generation counter");
assert.match(source, /let activeDeliverySignature = null;/, "active organizer delivery should retain its planner signature");
assert.match(source, /function beginDelivery\(expectedSignature\)/, "deliveries should claim explicit ownership before async work");
assert.match(source, /function deliveryIsCurrent\(token\)/, "late organizer share completions should be checked against active ownership");
assert.match(source, /currentPlanSignature\(\) === token\.signature/, "delivery ownership must include the current planner state");
assert.match(source, /function invalidateDelivery/, "organizer share lifecycle should support explicit invalidation");
assert.match(source, /window\.addEventListener\("pagehide", \(\) => invalidateDelivery/, "navigation should invalidate pending organizer delivery work");
assert.match(source, /pendingShare = \{ type, index, signature: signature\(plan\) \}/, "the share dialog target should be bound to the plan it described");
assert.match(source, /if \(currentPlanSignature\(\) !== action\.signature\)/, "confirming a stale share dialog must be rejected");
assert.match(source, /if \(!deliveryIsCurrent\(token\)\) return false;[\s\S]*navigator\.share/, "Web Share must not start for superseded planner state");
assert.match(source, /await navigator\.clipboard\.writeText\(url\);[\s\S]*if \(!deliveryIsCurrent\(token\)\) return false;[\s\S]*window\.alert\("Link copied\."\)/, "late clipboard success must not announce stale delivery");
assert.match(source, /if \(error\?\.name === "AbortError" \|\| !deliveryIsCurrent\(token\)\) return;/, "late secure-share failures must not trigger fallback delivery");
assert.match(source, /const session = secureCache;[\s\S]*if \(secureCache !== session/, "async organizer session mutations should be identity-guarded");
assert.match(source, /confirm\.setAttribute\("aria-busy", "true"\)/, "share controls should expose busy state accessibly while delivery is active");
assert.doesNotMatch(source, /watchPosition\s*\(/, "organizer sharing must not introduce continuous location tracking");

console.log("share-v010 delivery lifecycle tests passed");
