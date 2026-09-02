const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../update-safety-v0111.js'), 'utf8');
const documentListeners = new Map();
const windowListeners = new Map();
let now = Date.UTC(2026, 8, 2, 4, 30, 0);
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

assert.equal(api.handleUpdateClick(click, now), true, 'visible active-trip update should enter confirmation state');
assert.equal(banner.attrs['data-update-deferred'], 'true');
assert.equal(timers.size, 1);
const staleTimer = [...timers.values()][0].fn;

// Ordinary tab hiding must release timer ownership.
document.hidden = true;
documentListeners.get('visibilitychange')?.();
assert.equal(timers.size, 0, 'hidden transition must cancel the confirmation timer');

const hiddenStrong = strong.textContent;
const hiddenSmall = small.textContent;
const hiddenButton = button.textContent;
const hiddenAttrs = { ...banner.attrs };

// Even callbacks already dequeued before cancellation must fail closed.
now += 9_000;
staleTimer();
api.restoreBanner();
windowListeners.get('nvs-group-recommendations-rendered')?.();
assert.equal(api.handleUpdateClick(click, now), false, 'hidden programmatic click must not acquire update ownership');
assert.equal(strong.textContent, hiddenStrong, 'hidden stale callbacks must not rewrite the banner headline');
assert.equal(small.textContent, hiddenSmall, 'hidden stale callbacks must not rewrite the banner detail');
assert.equal(button.textContent, hiddenButton, 'hidden stale callbacks must not rewrite the update button');
assert.deepEqual(banner.attrs, hiddenAttrs, 'hidden stale callbacks must not alter update banner state');
assert.equal(timers.size, 0, 'hidden stale callbacks must not rearm timers');

// Returning visible reconciles expired confirmation state to the safe default.
document.hidden = false;
documentListeners.get('visibilitychange')?.();
assert.equal(banner.attrs['data-update-deferred'], undefined, 'visible restore must clear an expired confirmation state');
assert.equal(strong.textContent, 'Meet Schwerin update ready');
assert.equal(small.textContent, 'A newer app shell has finished downloading.');
assert.equal(button.textContent, 'Reload update');
assert.equal(timers.size, 0);

assert.match(source, /function ownsForeground\(\)/, 'update safety should centralize visible lifecycle ownership');
assert.match(source, /if \(!ownsForeground\(\)\) return false;/, 'click entrypoint must reject hidden ownership');
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
  'update lifecycle hardening must not introduce location tracking');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/i,
  'update lifecycle hardening must remain memory-only and network-free');

console.log('update-safety-hidden-ownership: hidden stale callbacks stay inert; visible restore reconciles safely');
