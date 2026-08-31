const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../accessibility-v0111.js'), 'utf8');
const windowListeners = new Map();
const documentListeners = new Map();
let mutations = 0;
let focusCount = 0;
let rafCallback = null;
let rafCancelled = false;

function element(id) {
  return {
    id,
    hidden: false,
    disabled: false,
    isConnected: true,
    dataset: {},
    open: false,
    attrs: new Map(),
    listeners: new Map(),
    setAttribute(name, value) { this.attrs.set(name, value); mutations += 1; },
    getAttribute(name) { return this.attrs.get(name) || null; },
    addEventListener(name, handler) { this.listeners.set(name, handler); },
    closest() { return null; },
    querySelector() { return closeButton; },
    querySelectorAll() { return []; },
    focus() { focusCount += 1; },
  };
}

const closeButton = element('close');
const statusList = element('v010StatusList');
const tripDialog = element('v011TripDialog');
const tripButton = element('v011TripModeButton');
const nodes = new Map([
  ['v011TripDialog', tripDialog],
  ['v011TripModeButton', tripButton],
  ['v010StatusList', statusList],
]);

const document = {
  hidden: false,
  getElementById(id) { return nodes.get(id) || null; },
  addEventListener(name, handler) { documentListeners.set(name, handler); },
};
const window = {
  addEventListener(name, handler) { windowListeners.set(name, handler); },
};

vm.runInNewContext(source, {
  window,
  document,
  Object,
  Map,
  queueMicrotask: (callback) => Promise.resolve().then(callback),
  requestAnimationFrame: (callback) => { rafCallback = callback; return 1; },
  cancelAnimationFrame: () => { rafCancelled = true; rafCallback = null; },
});

const api = window.NVSAccessibility0111;
assert.ok(api, 'accessibility API should initialize');
assert.ok(mutations > 0, 'initial enhancement should own and update the live DOM');

const beforeFreeze = mutations;
windowListeners.get('pagehide')?.({ persisted: true });
windowListeners.get('nvs-shared-live-change')?.();
api.refresh();
assert.equal(mutations, beforeFreeze, 'late app events and direct refresh must not mutate frozen DOM');

const clickHandler = documentListeners.get('click');
clickHandler?.({ target: { closest: () => tripButton } });
assert.equal(rafCallback, null, 'direct dialog entry must not queue focus work while frozen');

windowListeners.get('pageshow')?.({ persisted: true });
assert.ok(mutations >= beforeFreeze, 'restore should safely reconcile accessibility state');

tripDialog.open = true;
clickHandler?.({ target: { closest: () => tripButton } });
assert.equal(typeof rafCallback, 'function', 'active document should queue dialog focus work');
windowListeners.get('pagehide')?.({ persisted: true });
assert.equal(rafCancelled, true, 'pagehide should cancel queued focus animation work');
assert.equal(focusCount, 0, 'cancelled focus work must not focus into a suspended document');

assert.match(source, /let lifecycleFrozen = false/);
assert.match(source, /let focusGeneration = 0/);
assert.match(source, /window\.addEventListener\("pagehide", freezeLifecycle\)/);
assert.match(source, /window\.addEventListener\("pageshow", resumeLifecycle\)/);
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
  'accessibility hardening must not add location access');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/i,
  'accessibility ownership must remain storage- and network-free');

console.log('accessibility-bfcache-ownership: frozen events and queued focus stay inert');
