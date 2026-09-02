const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../offline-journey-v0111.js'), 'utf8');
const windowListeners = new Map();
const documentListeners = new Map();
const storage = new Map();
let timerId = 0;
const timers = new Map();
let createdCard = null;
let removed = 0;

function makeCard() {
  return {
    id: '',
    className: '',
    attrs: {},
    innerHTML: '',
    setAttribute(name, value) { this.attrs[name] = value; },
    remove() { removed += 1; createdCard = null; },
  };
}

const results = {
  prepend(card) { createdCard = card; },
};

const document = {
  hidden: false,
  getElementById(id) {
    if (id === 'offlineJourney0111') return createdCard;
    if (id === 'results') return results;
    return null;
  },
  createElement(tag) {
    assert.equal(tag, 'section');
    return makeCard();
  },
  querySelector() { return null; },
  addEventListener(name, handler) { documentListeners.set(name, handler); },
};

const window = {
  location: { pathname: '/p/example', search: '?me=0' },
  NVSShare: {
    getFocusIndex: () => 0,
    getSharedPlan: () => ({ members: [{}] }),
  },
  NVSSharedLive: {
    getState: () => ({ expiresAt: null }),
    hasPendingPlanUpdate: () => false,
  },
  addEventListener(name, handler) { windowListeners.set(name, handler); },
};

const navigator = { onLine: false };
const sessionStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
};

vm.runInNewContext(source, {
  window,
  document,
  navigator,
  sessionStorage,
  URLSearchParams,
  Date,
  Intl,
  Number,
  Array,
  Math,
  Object,
  String,
  Boolean,
  JSON,
  setTimeout(fn, delay) {
    const id = ++timerId;
    timers.set(id, { fn, delay });
    return id;
  },
  clearTimeout(id) { timers.delete(id); },
});

const api = window.NVSOfflineJourney0111;
assert.ok(createdCard, 'offline personal view should initially render the unavailable fallback card');
assert.match(createdCard.innerHTML, /No saved journey is available in this tab/);
const frozenMarkup = createdCard.innerHTML;
const frozenCard = createdCard;

windowListeners.get('pagehide')?.({ persisted: true });
assert.equal(timers.size, 0, 'pagehide should relinquish freshness timer ownership');

navigator.onLine = true;
windowListeners.get('online')?.();
windowListeners.get('nvs-shared-live-change')?.();
windowListeners.get('nvs-live-plan-synced')?.();
windowListeners.get('nvs-group-recommendations-rendered')?.();
documentListeners.get('visibilitychange')?.();
api.captureFreshRouteAndRender();
api.reconcileExpiryAndRender();
api.resumeRender({ type: 'nvs-shared-view-resumed' });

assert.equal(createdCard, frozenCard, 'late lifecycle/event work must not replace the frozen fallback DOM');
assert.equal(createdCard.innerHTML, frozenMarkup, 'late lifecycle/event work must not repaint the frozen fallback DOM');
assert.equal(timers.size, 0, 'frozen work must not restart freshness timers');

windowListeners.get('nvs-shared-session-expired')?.();
assert.equal(createdCard, frozenCard,
  'authoritative expiry may clear fallback state while frozen but must not mutate suspended DOM');
assert.equal(createdCard.innerHTML, frozenMarkup);

windowListeners.get('pageshow')?.({ type: 'pageshow', persisted: true });
assert.equal(createdCard, null,
  'restored ownership should reconcile current online/no-snapshot state instead of replaying frozen UI');
assert.equal(removed, 1);
assert.equal(timers.size, 0);

assert.match(source, /let lifecycleFrozen = false/);
assert.match(source, /window\.addEventListener\("pagehide", handlePageHide\)/);
assert.match(source, /window\.addEventListener\("pageshow", handlePageShow\)/);
assert.doesNotMatch(source, /watchPosition|getCurrentPosition|geolocation/i,
  'offline lifecycle hardening must not introduce location tracking');
assert.doesNotMatch(source, /localStorage/i,
  'offline fallback must remain tab-scoped rather than becoming durable cross-tab storage');

console.log('offline-journey-bfcache-ownership: frozen fallback stays inert and reconciles fresh on restore');
