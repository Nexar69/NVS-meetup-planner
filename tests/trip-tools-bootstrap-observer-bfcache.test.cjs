const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../trip-tools-v0111.js'), 'utf8');

let pagehide = null;
let pageshow = null;
let visibilitychange = null;
let observeCalls = 0;
let disconnectCalls = 0;
let observerCallback = null;
let tripPresent = false;

const tripDialog = {
  open: false,
  dataset: {},
  querySelector() { return null; },
};

const document = {
  hidden: false,
  documentElement: {},
  getElementById(id) {
    if (id === 'v011TripDialog' && tripPresent) return tripDialog;
    return null;
  },
  addEventListener(name, handler) {
    if (name === 'visibilitychange') visibilitychange = handler;
  },
  createElement() {
    throw new Error('Trip Tools must not create UI before the Trip dialog exists');
  },
};

const window = {
  addEventListener(name, handler) {
    if (name === 'pagehide') pagehide = handler;
    if (name === 'pageshow') pageshow = handler;
  },
  NVSSharedLive: null,
  NVSSharedExpiry0111: null,
  NVSShare: null,
};

class MutationObserver {
  constructor(callback) { observerCallback = callback; }
  observe(target, options) {
    assert.equal(target, document.documentElement);
    assert.equal(options?.childList, true, 'bootstrap observer should watch child-list changes');
    assert.equal(options?.subtree, true, 'bootstrap observer should watch the document subtree');
    observeCalls += 1;
  }
  disconnect() { disconnectCalls += 1; }
}

vm.runInNewContext(source, {
  window,
  document,
  navigator: { onLine: true },
  MutationObserver,
  Object,
  Number,
  Boolean,
  Date,
  Math,
  String,
  setTimeout() { return 1; },
  clearTimeout() {},
});

assert.equal(typeof pagehide, 'function');
assert.equal(typeof pageshow, 'function');
assert.equal(typeof visibilitychange, 'function');
assert.equal(typeof observerCallback, 'function');
assert.equal(observeCalls, 1, 'bootstrap observer should watch for a lazily-created Trip dialog while active');
assert.equal(disconnectCalls, 0);

pagehide({ persisted: true });
assert.equal(window.NVSTripTools0111.isLifecycleFrozen(), true);
assert.equal(disconnectCalls, 1, 'pagehide must disconnect the document-wide bootstrap observer');

observerCallback([]);
assert.equal(observeCalls, 1, 'a late observer callback must not reacquire work while the page is frozen');

pageshow({ persisted: true });
assert.equal(window.NVSTripTools0111.isLifecycleFrozen(), false);
assert.equal(observeCalls, 2, 'pageshow should reconnect the bootstrap observer when Trip Mode is still absent');

pagehide({ persisted: true });
assert.equal(disconnectCalls, 2);
tripPresent = true;
pageshow({ persisted: true });
assert.equal(observeCalls, 2, 'restoration must not reconnect the bootstrap observer once the Trip dialog already exists');

assert.doesNotMatch(source, /watchPosition|getCurrentPosition|geolocation/i,
  'observer lifecycle hardening must not add hidden/background location tracking');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
  'observer lifecycle state should remain memory-only');

console.log('trip-tools-bootstrap-observer-bfcache: document-wide bootstrap observation sleeps during bfcache and reconnects only when needed');
