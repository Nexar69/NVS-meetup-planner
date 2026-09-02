const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../share-v010.js'), 'utf8');

assert.match(source, /let createGeneration = 0;[\s\S]*let activeSecureCreate = null;/,
  'secure plan creation should own an explicit request generation');
assert.match(source, /let rotateGeneration = 0;[\s\S]*let activeCapabilityRotation = null;/,
  'capability rotation should own an explicit request generation');
assert.match(source, /function invalidateSecureCreate\(\) \{\s*activeSecureCreate\?\.controller\?\.abort\?\.\(\);\s*createGeneration \+= 1;/,
  'suspending secure plan creation should abort and invalidate late completions');
assert.match(source, /function invalidateCapabilityRotation\(\) \{\s*activeCapabilityRotation\?\.controller\?\.abort\?\.\(\);\s*rotateGeneration \+= 1;/,
  'suspending capability rotation should abort and invalidate late completions');
assert.match(source, /async function createSecurePlan[\s\S]*if \(!ownsLifecycle\(\)\) return null;/,
  'secure plan creation must fail closed without visible lifecycle ownership');
assert.match(source, /\/api\/plans[\s\S]*\.\.\.\(controller \? \{ signal: controller\.signal \} : \{\}\)/,
  'secure plan creation POST should be tied to an AbortController when available');
assert.match(source, /const response = await fetch\(`\$\{String\(config\.backendUrl\)[\s\S]*\/api\/plans[\s\S]*if \(!ownsLifecycle\(\) \|\| generation !== createGeneration\) return null;/,
  'late secure-plan responses must be ignored after lifecycle ownership loss');
assert.match(source, /const data = await response\.json\(\);\s*if \(!ownsLifecycle\(\) \|\| generation !== createGeneration\) return null;/,
  'late secure-plan JSON completion must be lifecycle checked before capability state is accepted');
assert.match(source, /async function rotateCapabilities[\s\S]*if \(!ownsLifecycle\(\) \|\| !secureCache\?\.id/,
  'capability rotation must fail closed while hidden or page-frozen');
assert.match(source, /\/capabilities[\s\S]*\.\.\.\(controller \? \{ signal: controller\.signal \} : \{\}\)/,
  'capability rotation POST should be tied to an AbortController when available');
assert.match(source, /if \(!ownsLifecycle\(\) \|\| generation !== rotateGeneration \|\| secureCache !== session\) return false;/,
  'capability rotation must reject stale lifecycle generations before mutating organizer capabilities');
assert.match(source, /function suspendOrganizerControls\(\) \{\s*invalidateSecureCreate\(\);\s*invalidateCapabilityRotation\(\);\s*\}/,
  'organizer control-plane requests should share a single suspension path');
assert.match(source, /addEventListener\("pagehide", \(\) => \{\s*lifecycleFrozen = true;[\s\S]*suspendOrganizerControls\(\);/,
  'pagehide must abort organizer control-plane work after freezing lifecycle ownership');
assert.match(source, /document\.addEventListener\("visibilitychange", \(\) => \{\s*if \(document\.hidden\) \{[\s\S]*suspendOrganizerControls\(\);/,
  'ordinary hidden-tab transitions must also abort organizer control-plane work');
assert.match(source, /catch \(error\) \{\s*if \(error\?\.name === "AbortError" \|\| !ownsLifecycle\(\)\) return;/,
  'expected lifecycle aborts from capability rotation should stay silent');

assert.doesNotMatch(source, /watchPosition|getCurrentPosition/i,
  'control-plane lifecycle hardening must not add location access');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
  'control-plane lifecycle ownership should remain memory-only');

console.log('share-v010-control-plane-lifecycle: organizer create/rotate POSTs are visibility-owned and abortable');
