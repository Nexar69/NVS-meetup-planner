const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const expirySource = fs.readFileSync(path.resolve(__dirname, '../shared-expiry-v0111.js'), 'utf8');
const tripToolsSource = fs.readFileSync(path.resolve(__dirname, '../trip-tools-v0111.js'), 'utf8');

assert.match(expirySource, /function isAuthoritativelyExpired\(\)\s*\{\s*return expiredAnnounced;\s*\}/,
  'the expiry layer should expose its sticky in-memory authoritative expiry predicate');
assert.match(expirySource, /isAuthoritativelyExpired,/,
  'the authoritative expiry predicate should be part of the public ancillary API');
assert.match(expirySource, /getAuthoritativeExpiryAt:\s*\(\)\s*=>\s*authoritativeExpiryAt/,
  'ancillary consumers should be able to inspect the in-memory authoritative deadline for diagnostics/UI');

assert.match(tripToolsSource, /NVSSharedExpiry0111\?\.isAuthoritativelyExpired\?\.\(\)/,
  'Trip Tools should fail closed when the newer expiry layer has already latched authoritative expiry');
assert.match(tripToolsSource, /addEventListener\("nvs-shared-session-expired",\s*\(\)\s*=>\s*\{\s*invalidateCheckinUi\(\);\s*render\(\);\s*\}\)/,
  'authoritative expiry should invalidate an in-flight Trip Tools check-in UI generation immediately');

assert.doesNotMatch(expirySource + tripToolsSource, /watchPosition\s*\(/,
  'mixed-cache expiry hardening must not add continuous or hidden location tracking');
assert.doesNotMatch(expirySource, /localStorage|sessionStorage|indexedDB/i,
  'the authoritative expiry predicate must remain memory-only');

console.log('trip-tools-authoritative-expiry: mixed-cache Trip Tools fail closed after authoritative expiry');
