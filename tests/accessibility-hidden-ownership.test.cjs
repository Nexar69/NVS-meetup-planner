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
let cancelled = 0;

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
    setAttribute(name, value) { this.attrs.set(name, String(value)); mutations += 1; },
    getAttribute(name) { return this.attrs.get(name) || null; },
    addEventListener(name, handler) { this.listeners.set(name, handler); },
    closest(selector) {
      if (selector === '[inert]') return null;
      return selector.split(',').some((part) => part.trim() === `#${this.id}`) ? this : null;
    },
    querySelector() { return closeButton; },
    querySelectorAll() { return []; },
    focus() { focusCount += 1; },
  };
}

const closeButton = element('close');
const tripButton = element('v011TripModeButton');
const tripDialog = element('v011TripDialog');
const statusList = element('v010StatusList');
const nodes = new Map([
  [tripButton.id, tripButton],
  [tripDialog.id, tripDialog],
  [statusList.id, statusList],
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
  queueMicrotask: (callback) => callback(),
  requestAnimationFrame: (callback) => { rafCallback = callback; return 1; },
  cancelAnimationFrame: () => { cancelled += 1; },
});

const click = documentListeners.get('click');
const visibility = documentListeners.get('visibilitychange');
const api = window.NVSAccessibility0111;
assert.ok(api, 'accessibility API should initialize');

tripDialog.open = true;
click({ target: tripButton });
assert.equal(typeof rafCallback, 'function', 'visible dialog entry should queue focus work');
const staleVisibleCallback = rafCallback;

document.hidden = true;
visibility();
assert.equal(cancelled, 1, 'hiding should cancel queued focus work');
const hiddenMutationBaseline = mutations;
staleVisibleCallback();
api.refresh();
windowListeners.get('nvs-shared-live-change')?.();
click({ target: tripButton });
assert.equal(focusCount, 0, 'stale or direct hidden work must never focus the document');
assert.equal(mutations, hiddenMutationBaseline, 'hidden accessibility work must not mutate live DOM');

tripDialog.listeners.get('close')?.({ target: tripDialog });
assert.equal(focusCount, 0, 'close microtasks must not restore focus while hidden');

document.hidden = false;
visibility();
assert.ok(mutations >= hiddenMutationBaseline, 'returning visible should safely reconcile accessibility semantics');

click({ target: tripButton });
const restoredCallback = rafCallback;
restoredCallback();
assert.equal(focusCount, 1, 'fresh visible focus work should resume after reconciliation');

assert.match(source, /!lifecycleFrozen && !document\.hidden/,
  'foreground ownership must include ordinary visibility');
assert.match(source, /function suspendFocusOwnership\(\)/,
  'hidden and bfcache suspension should share focus invalidation');
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
  'accessibility lifecycle hardening must not add location access');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/i,
  'accessibility lifecycle hardening must remain storage- and network-free');

console.log('accessibility-hidden-ownership: stale focus and hidden DOM work stay inert');
