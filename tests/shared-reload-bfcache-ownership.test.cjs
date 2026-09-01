const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../shared-reload-v0111.js'), 'utf8');

let clickHandler;
let pagehideHandler;
let pageshowHandler;
let reloads = 0;
let assigns = 0;
let resumed = 0;
let timer = null;

const button = {
  disabled: false,
  textContent: 'Reload updated plan',
  dataset: {},
  attrs: {},
  setAttribute(name, value) { this.attrs[name] = value; },
  removeAttribute(name) { delete this.attrs[name]; },
};

const document = {
  addEventListener(name, handler) { if (name === 'click') clickHandler = handler; },
  getElementById(id) { return id === 'v010ReloadPlan' ? button : null; },
};
const window = {
  location: {
    href: 'https://example.test/p/Test12?me=0',
    reload() { reloads += 1; },
    assign() { assigns += 1; },
  },
  NVSSharedLive: { refresh() {} },
  NVSIntelligence: { refresh() {} },
  addEventListener(name, handler) {
    if (name === 'pagehide') pagehideHandler = handler;
    if (name === 'pageshow') pageshowHandler = handler;
  },
  dispatchEvent(event) { if (event.type === 'nvs-shared-view-resumed') resumed += 1; },
};
class CustomEvent { constructor(type) { this.type = type; } }

vm.runInNewContext(source, {
  window,
  document,
  CustomEvent,
  Object,
  String,
  Boolean,
  setTimeout(callback) { timer = callback; return 1; },
  clearTimeout() { timer = null; },
});

assert.equal(typeof pagehideHandler, 'function');
assert.equal(typeof pageshowHandler, 'function');
assert.equal(window.NVSSharedReload0111.isLifecycleFrozen(), false);

pagehideHandler({ persisted: true });
assert.equal(window.NVSSharedReload0111.isLifecycleFrozen(), true, 'pagehide must freeze reload ownership');
assert.equal(window.NVSSharedReload0111.reloadUpdatedPlan(button), false, 'direct reload calls must fail closed while frozen');
assert.equal(reloads, 0);
assert.equal(assigns, 0);

let prevented = 0;
let stopped = 0;
clickHandler({
  target: { closest() { return button; } },
  preventDefault() { prevented += 1; },
  stopImmediatePropagation() { stopped += 1; },
});
assert.equal(prevented, 1, 'frozen delegated clicks should still be consumed');
assert.equal(stopped, 1, 'frozen delegated clicks must not fall through to stale per-node handlers');
assert.equal(reloads, 0, 'frozen clicks must not navigate');

pageshowHandler({ persisted: true });
assert.equal(window.NVSSharedReload0111.isLifecycleFrozen(), false, 'pageshow must reopen lifecycle ownership');
assert.equal(typeof timer, 'function', 'persisted restore should queue subsystem reconciliation');
timer();
assert.equal(resumed, 1);

assert.equal(window.NVSSharedReload0111.reloadUpdatedPlan(button), true, 'fresh explicit action after restore may navigate');
assert.equal(reloads, 1);

pagehideHandler({ persisted: true });
assert.equal(timer, null, 'pagehide must cancel Safari fallback navigation timers');
assert.equal(assigns, 0, 'cancelled fallback must not navigate while frozen');

assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, 'reload lifecycle ownership must stay memory-only');
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, 'reload lifecycle hardening must not add location access');

console.log('shared-reload-bfcache-ownership: frozen reload entrypoints fail closed and restore explicitly');
