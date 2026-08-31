const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../instructions-v083.js'), 'utf8');

assert.match(source, /let lifecycleFrozen = false;/,
  'journey instruction decorator should own an explicit frozen-document boundary');
assert.match(source, /window\.addEventListener\("pagehide", freezeLifecycle\)/,
  'pagehide must freeze instruction decoration');
assert.match(source, /window\.addEventListener\("pageshow", restoreLifecycle\)/,
  'pageshow must restore instruction decoration from current state');
assert.match(source, /function freezeLifecycle\(\)[\s\S]*lifecycleFrozen = true;[\s\S]*clearTimeout\(timer\);[\s\S]*disconnectObservers\(\);/,
  'freeze must cancel queued timer work and disconnect observers');
assert.match(source, /function restoreLifecycle\(event\)[\s\S]*lifecycleFrozen = false;[\s\S]*connectObservers\(\);[\s\S]*decorate\(\);/,
  'restore must reconnect observers and recompute current instructions');
assert.match(source, /function decorate\(\)[\s\S]*if \(lifecycleFrozen\) return;[\s\S]*if \(lifecycleFrozen\) return;/,
  'both scheduling and queued timer completion must fail closed while frozen');
assert.match(source, /function decorateFullTimeline\(timeline, assignment\) \{\s*if \(lifecycleFrozen\) return;/,
  'direct full-timeline decoration must not mutate frozen DOM');
assert.match(source, /function decoratePersonalPlan\(\) \{\s*if \(lifecycleFrozen\) return;/,
  'direct personal-plan decoration must not mutate frozen DOM');
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
  'instruction lifecycle hardening must not add location access');
assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(|XMLHttpRequest/i,
  'instruction decorator must remain storage- and network-free');

console.log('instructions-bfcache-ownership: timers, observers and direct decorators freeze safely');
