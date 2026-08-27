const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('test-lab-scenarios-v0111.js', 'utf8');
const assignments = [
  {
    member: { name: 'Person A' },
    route: {
      departure: '2026-08-27T12:00:00Z',
      arrival: '2026-08-27T12:30:00Z',
      segments: [
        { departure: '2026-08-27T12:00:00Z', arrival: '2026-08-27T12:10:00Z' },
        { departure: '2026-08-27T12:12:00Z', arrival: '2026-08-27T12:30:00Z' },
      ],
    },
  },
  {
    member: { name: 'Person B' },
    route: {
      departure: '2026-08-27T12:05:00Z',
      arrival: '2026-08-27T12:40:00Z',
      segments: [{ departure: '2026-08-27T12:05:00Z', arrival: '2026-08-27T12:40:00Z' }],
    },
  },
];

let now = Date.parse('2026-08-27T11:50:00Z');
let liveReady = true;
let network = 'slow-2';
const statuses = new Map([[1, 'on-vehicle']]);
const delays = new Map([[1, 10]]);
const dispatched = [];
const listeners = new Map();

const journey = {
  active: true,
  getOverrides: () => Object.fromEntries(statuses),
  getRouteDelays: () => Object.fromEntries(delays),
  setMemberStatus(index, status) {
    if (!liveReady) return false;
    if (status === 'timetable') statuses.delete(Number(index));
    else statuses.set(Number(index), status);
    return true;
  },
  resetMembers() { statuses.clear(); },
  setRouteDelay(index, minutes) {
    const memberIndex = Number(index);
    if (!assignments[memberIndex]?.route) return false;
    if (Number(minutes) === 0) delays.delete(memberIndex);
    else delays.set(memberIndex, Number(minutes));
    return true;
  },
  resetRouteDelays() { delays.clear(); },
};

class FakeCustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }

const window = {
  NVSTestLab: {
    active: true,
    now: () => now,
    setNow(value) {
      const next = Number(value);
      if (!Number.isFinite(next)) return false;
      now = next;
      return true;
    },
    getNetwork: () => network,
    setNetwork(value) {
      const allowed = ['normal', 'slow-2', 'slow-5', 'vmv-fail', 'transit-fail', 'all-fail', 'offline-api'];
      if (!allowed.includes(String(value))) return false;
      network = String(value);
      return true;
    },
  },
  NVSTestJourney: journey,
  NVSSharedLive: { getState: () => liveReady ? { members: { '0': {}, '1': {} } } : null },
  __NVS_LAST_RECOMMENDATIONS__: { primary: { assignments } },
  addEventListener(type, fn) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  },
  dispatchEvent(event) {
    dispatched.push(event);
    for (const fn of listeners.get(event.type) || []) fn(event);
    return true;
  },
};
const document = {
  body: null,
  readyState: 'loading',
  addEventListener() {},
  getElementById() { return null; },
};
const context = vm.createContext({
  window, document, Date, CustomEvent: FakeCustomEvent, Object, String, Number, Boolean, Math, Array, Map,
  queueMicrotask: (fn) => fn(), console,
});
vm.runInContext(source, context, { filename: 'test-lab-scenarios-v0111.js' });

const api = window.NVSTestScenarios;
assert(api?.active, 'scenario presets should activate only on top of the hardened Test Lab journey API');
assert.deepStrictEqual(Array.from(api.presets, (item) => item.id), [
  'transfer-window', 'delayed-rider', 'missed-transfer', 'all-arrived', 'routing-fallback', 'api-offline',
]);
assert.strictEqual(api.availability('transfer-window').available, true);
assert.strictEqual(api.availability('missed-transfer').available, true);
assert.strictEqual(api.availability('routing-fallback').available, true);
assert.strictEqual(api.availability('bogus').available, false);

// Transfer-window is deliberately time-only: whole-route delay overlays do not tighten an internal connection.
assert(api.applyPreset('transfer-window'));
assert.strictEqual(delays.size, 0, 'transfer-window must not pretend a whole-route delay changes the internal transfer gap');
assert.strictEqual(statuses.size, 0, 'transfer-window should clear older member-state overlays');
assert.strictEqual(network, 'normal');
assert.strictEqual(now, Date.parse('2026-08-27T12:09:00Z'), 'transfer-window should jump three minutes before the onward departure');

assert(api.applyPreset('delayed-rider'));
assert.strictEqual(delays.get(0), 5, 'delayed-rider should locally delay the first loaded rider route');
assert.strictEqual(now, Date.parse('2026-08-27T12:25:00Z'), 'delayed-rider should jump five minutes before that rider original arrival');
assert.strictEqual(network, 'normal');

assert(api.applyPreset('missed-transfer'));
assert.strictEqual(delays.size, 0, 'missed-transfer should not retain unrelated delay overlays');
assert.strictEqual(statuses.get(0), 'missed');
assert.strictEqual(now, Date.parse('2026-08-27T12:12:30Z'));

assert(api.applyPreset('all-arrived'));
assert.strictEqual(statuses.get(0), 'arrived');
assert.strictEqual(statuses.get(1), 'arrived');
assert.strictEqual(now, Date.parse('2026-08-27T12:41:00Z'), 'everyone-arrived should jump one minute past the latest planned arrival');

assert(api.applyPreset('routing-fallback'));
assert.strictEqual(network, 'vmv-fail', 'routing-fallback should fail only VMV so refresh/replan exercises Transitous fallback');
assert.strictEqual(statuses.size, 0);
assert.strictEqual(delays.size, 0);

assert(api.applyPreset('api-offline'));
assert.strictEqual(network, 'offline-api', 'api-offline should use the existing backend+transit API failure mode');

// A preset that cannot apply must preserve the previous local simulation atomically, including network mode.
statuses.clear();
statuses.set(1, 'on-vehicle');
delays.clear();
delays.set(1, 10);
network = 'slow-5';
now = Date.parse('2026-08-27T11:55:00Z');
const originalSegments = assignments[0].route.segments;
assignments[0].route.segments = [originalSegments[0]];
liveReady = false;
const unavailable = api.availability('missed-transfer');
assert.strictEqual(unavailable.available, false);
assert(/Shared Live/.test(unavailable.reason), 'unavailable missed-transfer should explain its missing live-state prerequisite');
assert.strictEqual(api.availability('routing-fallback').available, true, 'network-only scenarios should remain usable without route/live prerequisites');
assert.strictEqual(api.applyPreset('missed-transfer'), false);
assert.strictEqual(statuses.get(1), 'on-vehicle', 'failed preset should preserve prior status overlay');
assert.strictEqual(delays.get(1), 10, 'failed preset should preserve prior route-delay overlay');
assert.strictEqual(network, 'slow-5', 'failed preset should preserve prior network simulation');
assert.strictEqual(now, Date.parse('2026-08-27T11:55:00Z'), 'failed preset should preserve prior simulated clock');
assignments[0].route.segments = originalSegments;
liveReady = true;

assert.strictEqual(api.applyPreset('bogus'), false, 'unknown scenario IDs must be rejected');
assert(api.resetScenario());
assert.strictEqual(statuses.size, 0);
assert.strictEqual(delays.size, 0);
assert.strictEqual(network, 'normal', 'clearing scenarios should restore normal network behavior');
assert(dispatched.some((event) => event.type === 'nvs-test-scenario-change'));

assert(!/localStorage|sessionStorage/.test(source), 'scenario presets must remain memory-only');
assert(!/\bfetch\s*\(/.test(source), 'scenario presets must not add a network path');
assert(!/getCurrentPosition|watchPosition|geolocation/.test(source), 'scenario presets must not use location APIs');
assert(!/setInterval\s*\(/.test(source), 'scenario presets must not add a background polling loop');
assert(source.includes('Atomic local stress tests · never shared'), 'scenario UI must keep its safety boundary visible');
assert(source.includes('aria-disabled'), 'unavailable scenarios should expose disabled semantics');
assert(source.includes('aria-live="polite"'), 'scenario prerequisite guidance should be announced politely');

console.log('Test Lab scenario preset tests passed.');