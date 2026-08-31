const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../intelligence-voluntary-sync-v0111.js'), 'utf8');
const listeners = new Map();
const timers = [];
let now = Date.UTC(2026, 7, 31, 9, 0, 0);
let liveEntry = { status: 'arrived', at: now - 5_000 };

const currentAction = { innerHTML: '' };
const tripPill = { textContent: '' };
const tripAction = { textContent: '' };
const tripDetail = { textContent: '' };
const nextBox = { innerHTML: '' };
const dialog = {
  open: true,
  querySelector(selector) {
    return {
      '#v011TripPill': tripPill,
      '#v011TripAction': tripAction,
      '#v011TripDetail': tripDetail,
      '#v011TripNext': nextBox,
    }[selector] || null;
  },
  close() { this.open = false; },
};

const window = {
  NVSShare: { getFocusIndex: () => 0 },
  NVSSharedLive: { getState: () => ({ members: { '0': liveEntry } }) },
  NVSIntelligenceCore: { checkinFreshness: () => ({ fresh: true }) },
  NVSTripGuidance0111: {
    guidanceForRoute(_route, _at, entry) {
      return { title: entry.status === 'arrived' ? "You're at the meetup" : 'Changed', detail: 'Voluntary state is authoritative.' };
    },
  },
  __NVS_LAST_RECOMMENDATIONS__: { primary: { assignments: [{ route: { segments: [] } }] } },
  addEventListener(name, handler) { listeners.set(name, handler); },
};
const document = {
  hidden: false,
  body: null,
  addEventListener(name, handler) { listeners.set(`document:${name}`, handler); },
  getElementById(id) {
    return { v011CurrentAction: currentAction, v011TripDialog: dialog }[id] || null;
  },
};

vm.runInNewContext(source, {
  window, document, Date, Number, String, Boolean, Object, Set, Math,
  setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
  clearTimeout() {},
});

const api = window.NVSIntelligenceVoluntarySync0111;
assert.ok(api);
assert.equal(api.sync(now), true);
assert.match(currentAction.innerHTML, /at the meetup/i);

listeners.get('pagehide')({ type: 'pagehide', persisted: true });
assert.equal(api.isLifecycleFrozen(), true);
const frozenMarkup = currentAction.innerHTML;
liveEntry = { status: 'missed', at: now };
assert.equal(api.sync(now), false, 'direct sync calls must lose DOM ownership while bfcache-frozen');
listeners.get('nvs-shared-live-change')({ type: 'nvs-shared-live-change' });
assert.equal(currentAction.innerHTML, frozenMarkup, 'late live events must not repaint frozen intelligence surfaces');
const timersWhileFrozen = timers.length;
api.schedule();
assert.equal(timers.length, timersWhileFrozen, 'frozen voluntary intelligence must not arm reconciliation timers');

listeners.get('pageshow')({ type: 'pageshow', persisted: true });
assert.equal(api.isLifecycleFrozen(), false);
assert.ok(timers.length > timersWhileFrozen, 'pageshow should re-arm fresh reconciliation when recommendations remain active');
const latest = timers.at(-1);
if (latest.delay === 60) latest.callback();
assert.match(currentAction.innerHTML, /missed connection|Changed/i, 'restored lifecycle should reconcile the latest voluntary state');

assert.doesNotMatch(source, /watchPosition|getCurrentPosition|geolocation/i,
  'lifecycle ownership must not add hidden/background location tracking');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
  'voluntary intelligence lifecycle state must remain memory-only');
assert.doesNotMatch(source, /MutationObserver/,
  'voluntary intelligence should remain event-driven rather than observing DOM mutations');

console.log('intelligence-voluntary-sync-bfcache: frozen voluntary intelligence stays inert and reconciles after restore');
