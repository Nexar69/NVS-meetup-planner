const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../update-safety-v0111.js'), 'utf8');
const documentListeners = new Map();
const windowListeners = new Map();
let now = Date.UTC(2026, 7, 31, 12, 0, 0);
let timerId = 0;
const timers = new Map();

const strong = { textContent: 'Meet Schwerin update ready' };
const small = { textContent: 'A newer app shell has finished downloading.' };
const banner = {
  hidden: false,
  attrs: {},
  querySelector(selector) {
    if (selector === 'strong') return strong;
    if (selector === 'small') return small;
    if (selector === 'button') return button;
    return null;
  },
  setAttribute(name, value) { this.attrs[name] = value; },
  removeAttribute(name) { delete this.attrs[name]; },
};
const button = {
  textContent: 'Reload update',
  matches(selector) { return selector === '#v011UpdateBanner button'; },
  closest(selector) { return selector === '#v011UpdateBanner' ? banner : null; },
};

const document = {
  hidden: false,
  getElementById(id) {
    if (id === 'v011TripDialog') return { open: false };
    if (id === 'v011UpdateBanner') return banner;
    return null;
  },
  addEventListener(name, handler) { documentListeners.set(name, handler); },
};
const window = {
  __NVS_LAST_RECOMMENDATIONS__: {
    primary: { assignments: [{ route: { segments: [{ departure: now - 60_000, arrival: now + 10 * 60_000 }] } }] },
  },
  NVSShare: { getFocusIndex: () => 0 },
  addEventListener(name, handler) { windowListeners.set(name, handler); },
};
class FakeDate extends Date { static now() { return now; } }

vm.runInNewContext(source, {
  window,
  document,
  Date: FakeDate,
  Number,
  Array,
  Math,
  Object,
  setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
  clearTimeout(id) { timers.delete(id); },
});

const api = window.NVSUpdateSafety0111;
const click = {
  target: button,
  preventDefault() {},
  stopPropagation() {},
  stopImmediatePropagation() {},
};
assert.equal(api.handleUpdateClick(click, now), true, 'active-trip update should enter explicit confirmation state');
assert.equal(banner.attrs['data-update-deferred'], 'true');
assert.equal(timers.size, 1);

windowListeners.get('pagehide')?.({ persisted: true });
assert.equal(timers.size, 0, 'pagehide should drop the pending confirmation timer');

window.__NVS_LAST_RECOMMENDATIONS__ = null;
windowListeners.get('nvs-group-recommendations-rendered')?.();
api.restoreBanner();
assert.equal(banner.attrs['data-update-deferred'], 'true',
  'late recommendation events and direct refreshes must not mutate the frozen update banner');
assert.equal(strong.textContent, 'Trip active — update deferred');
assert.equal(button.textContent, 'Update now anyway');

windowListeners.get('pageshow')?.({ persisted: true });
assert.equal(banner.attrs['data-update-deferred'], undefined,
  'restored document ownership should reconcile the banner to a safe default state');
assert.equal(strong.textContent, 'Meet Schwerin update ready');
assert.equal(button.textContent, 'Reload update');
assert.equal(timers.size, 0);

assert.match(source, /pagehide/);
assert.match(source, /lifecycleFrozen/);
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
  'update lifecycle hardening must not add location tracking');
assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(|XMLHttpRequest/i,
  'update lifecycle hardening must remain storage- and network-free');

console.log('update-safety-bfcache-ownership: frozen update UI stays inert and reconciles on restore');
