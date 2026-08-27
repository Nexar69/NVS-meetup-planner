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
assert.deepStrictEqual(Array.from(api.presets, (item) => item.id), ['tight-transfer', 'missed-transfer', 'all-arrived']);

assert(api.applyPreset('tight-transfer'));
assert.strictEqual(delays.get(0), 5, 'tight-transfer should locally delay the member with the first transfer');
assert.strictEqual(delays.has(1), false, 'preset should replace older local delay overlays');
assert.strictEqual(statuses.size, 0, 'tight-transfer should clear older member-state overlays');
assert.strictEqual(now, Date.parse('2026-08-27T12:09:00Z'), 'tight-transfer should jump three minutes before the onward departure');

assert(api.applyPreset('missed-transfer'));
assert.strictEqual(delays.size, 0, 'missed-transfer should not retain unrelated delay overlays');
assert.strictEqual(statuses.get(0), 'missed');
assert.strictEqual(now, Date.parse('2026-08-27T12:12:30Z'));

assert(api.applyPreset('all-arrived'));
assert.strictEqual(statuses.get(0), 'arrived');
assert.strictEqual(statuses.get(1), 'arrived');
assert.strictEqual(now, Date.parse('2026-08-27T12:41:00Z'), 'everyone-arrived should jump one minute past the latest planned arrival');

// A preset that cannot apply must restore the previous local simulation atomically.
statuses.clear();
statuses.set(1, 'on-vehicle');
delays.clear();
delays.set(1, 10);
now = Date.parse('2026-08-27T11:55:00Z');
const originalSegments = assignments[0].route.segments;
assignments[0].route.segments = [originalSegments[0]];
liveReady = false;
assert.strictEqual(api.applyPreset('missed-transfer'), false);
assert.strictEqual(statuses.get(1), 'on-vehicle', 'failed preset should restore prior status overlay');
assert.strictEqual(delays.get(1), 10, 'failed preset should restore prior route-delay overlay');
assert.strictEqual(now, Date.parse('2026-08-27T11:55:00Z'), 'failed preset should restore prior simulated clock');
assignments[0].route.segments = originalSegments;
liveReady = true;

assert.strictEqual(api.applyPreset('bogus'), false, 'unknown scenario IDs must be rejected');
assert(api.resetScenario());
assert.strictEqual(statuses.size, 0);
assert.strictEqual(delays.size, 0);
assert(dispatched.some((event) => event.type === 'nvs-test-scenario-change'));

assert(!/localStorage|sessionStorage/.test(source), 'scenario presets must remain memory-only');
assert(!/\bfetch\s*\(/.test(source), 'scenario presets must not add a network path');
assert(!/getCurrentPosition|watchPosition|geolocation/.test(source), 'scenario presets must not use location APIs');
assert(!/setInterval\s*\(/.test(source), 'scenario presets must not add a background polling loop');
assert(source.includes('Atomic local stress tests · never shared'), 'scenario UI must keep its safety boundary visible');

console.log('Test Lab scenario preset tests passed.');
