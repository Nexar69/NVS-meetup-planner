const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../shared-reload-v0111.js'), 'utf8');

let clickHandler;
let visibilityHandler;
let pagehideHandler;
let pageshowHandler;
let reloads = 0;
let assigns = 0;
let sharedRefreshes = 0;
let intelligenceRefreshes = 0;
let resumed = 0;
let nextTimerId = 1;
const timers = new Map();

const button = {
  disabled: false,
  textContent: 'Reload updated plan',
  dataset: {},
  attrs: {},
  setAttribute(name, value) { this.attrs[name] = value; },
  removeAttribute(name) { delete this.attrs[name]; },
};

const document = {
  hidden: false,
  addEventListener(name, handler) {
    if (name === 'click') clickHandler = handler;
    if (name === 'visibilitychange') visibilityHandler = handler;
  },
  getElementById(id) { return id === 'v010ReloadPlan' ? button : null; },
};
const window = {
  location: {
    href: 'https://example.test/p/Test12?me=0',
    reload() { reloads += 1; },
    assign() { assigns += 1; },
  },
  NVSSharedLive: { refresh() { sharedRefreshes += 1; } },
  NVSIntelligence: { refresh() { intelligenceRefreshes += 1; } },
  addEventListener(name, handler) {
    if (name === 'pagehide') pagehideHandler = handler;
    if (name === 'pageshow') pageshowHandler = handler;
  },
  dispatchEvent(event) { if (event.type === 'nvs-shared-view-resumed') resumed += 1; },
};
class CustomEvent { constructor(type) { this.type = type; } }

function runTimer(id) {
  const callback = timers.get(id);
  assert.equal(typeof callback, 'function', `timer ${id} should still be scheduled`);
  timers.delete(id);
  callback();
}

vm.runInNewContext(source, {
  window,
  document,
  CustomEvent,
  Object,
  String,
  Boolean,
  setTimeout(callback) {
    const id = nextTimerId++;
    timers.set(id, callback);
    return id;
  },
  clearTimeout(id) { timers.delete(id); },
});

assert.equal(typeof visibilityHandler, 'function');
assert.equal(typeof pagehideHandler, 'function');
assert.equal(typeof pageshowHandler, 'function');
assert.equal(window.NVSSharedReload0111.isLifecycleFrozen(), false);

assert.equal(window.NVSSharedReload0111.reloadUpdatedPlan(button), true, 'visible explicit reload may start navigation');
assert.equal(reloads, 1);
assert.equal(timers.size, 1, 'visible navigation should arm exactly one Safari fallback');
const hiddenFallback = [...timers.values()][0];

document.hidden = true;
visibilityHandler();
assert.equal(timers.size, 0, 'ordinary tab hiding must cancel Safari fallback navigation');
assert.equal(window.NVSSharedReload0111.isNavigating(), false, 'hidden transition must release the navigation latch without repainting');
assert.equal(window.NVSSharedReload0111.reloadUpdatedPlan(button), false, 'direct hidden reload calls must fail closed');
hiddenFallback();
assert.equal(assigns, 0, 'an already-dequeued fallback callback must re-check visibility before navigating');

let prevented = 0;
let stopped = 0;
clickHandler({
  target: { closest() { return button; } },
  preventDefault() { prevented += 1; },
  stopImmediatePropagation() { stopped += 1; },
});
assert.equal(prevented, 1, 'hidden delegated clicks should still be consumed');
assert.equal(stopped, 1, 'hidden delegated clicks must not fall through to stale per-node handlers');
assert.equal(reloads, 1, 'hidden clicks must not navigate');

document.hidden = false;
visibilityHandler();
assert.equal(button.disabled, false, 'visible restoration should recover a button left busy by a hidden navigation interruption');
assert.equal(button.attrs['aria-busy'], undefined);

pagehideHandler({ persisted: true });
assert.equal(window.NVSSharedReload0111.isLifecycleFrozen(), true, 'pagehide must freeze reload ownership');
assert.equal(window.NVSSharedReload0111.reloadUpdatedPlan(button), false, 'direct reload calls must fail closed while frozen');
assert.equal(reloads, 1);
assert.equal(assigns, 0);

prevented = 0;
stopped = 0;
clickHandler({
  target: { closest() { return button; } },
  preventDefault() { prevented += 1; },
  stopImmediatePropagation() { stopped += 1; },
});
assert.equal(prevented, 1, 'frozen delegated clicks should still be consumed');
assert.equal(stopped, 1, 'frozen delegated clicks must not fall through to stale per-node handlers');
assert.equal(reloads, 1, 'frozen clicks must not navigate');

pageshowHandler({ persisted: true });
assert.equal(window.NVSSharedReload0111.isLifecycleFrozen(), false, 'pageshow must reopen lifecycle ownership');
assert.equal(timers.size, 1, 'persisted restore should queue exactly one subsystem reconciliation');
const firstResumeTimer = [...timers.keys()][0];

pagehideHandler({ persisted: true });
assert.equal(window.NVSSharedReload0111.isLifecycleFrozen(), true, 'a second pagehide must reacquire the frozen boundary');
assert.equal(timers.has(firstResumeTimer), false, 'a second pagehide must cancel the queued resume reconciliation');
assert.equal(sharedRefreshes, 0, 'cancelled resume work must not refresh Shared Live while frozen');
assert.equal(intelligenceRefreshes, 0, 'cancelled resume work must not refresh intelligence while frozen');
assert.equal(resumed, 0, 'cancelled resume work must not emit a resumed event while frozen');

pageshowHandler({ persisted: true });
assert.equal(window.NVSSharedReload0111.isLifecycleFrozen(), false);
assert.equal(timers.size, 1, 'fresh restore should queue one replacement reconciliation');
runTimer([...timers.keys()][0]);
assert.equal(sharedRefreshes, 1);
assert.equal(intelligenceRefreshes, 1);
assert.equal(resumed, 1);
assert.equal(timers.size, 0, 'resume timer should release ownership after it runs');

assert.equal(window.NVSSharedReload0111.reloadUpdatedPlan(button), true, 'fresh explicit action after restore may navigate');
assert.equal(reloads, 2);
assert.equal(timers.size, 1, 'fresh navigation should arm exactly one Safari fallback');

pagehideHandler({ persisted: true });
assert.equal(timers.size, 0, 'pagehide must cancel Safari fallback navigation timers');
assert.equal(assigns, 0, 'cancelled fallback must not navigate while frozen');

assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, 'reload lifecycle ownership must stay memory-only');
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, 'reload lifecycle hardening must not add location access');

console.log('shared-reload-bfcache-ownership: hidden and frozen transitions cancel stale navigation/reconciliation work');