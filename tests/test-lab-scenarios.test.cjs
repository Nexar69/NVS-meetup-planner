const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('test-lab-scenarios-v0111.js', 'utf8');
const assignments = [
  {
    member: { name: 'Person A' },
    route: {
      departure: '2026-08-27T12:00:00Z', arrival: '2026-08-27T12:30:00Z',
      segments: [
        { mode: 'TRAM', departure: '2026-08-27T12:00:00Z', arrival: '2026-08-27T12:10:00Z' },
        { mode: 'TRAM', departure: '2026-08-27T12:12:00Z', arrival: '2026-08-27T12:30:00Z' },
      ],
    },
  },
  {
    member: { name: 'Person B' },
    route: {
      departure: '2026-08-27T12:05:00Z', arrival: '2026-08-27T12:40:00Z',
      segments: [{ mode: 'TRAM', departure: '2026-08-27T12:05:00Z', arrival: '2026-08-27T12:40:00Z' }],
    },
  },
];

let now = Date.parse('2026-08-27T11:50:00Z');
let liveReady = true;
let network = 'slow-2';
const statuses = new Map([[1, 'on-vehicle']]);
const delays = new Map([[1, 10]]);
const disruptions = new Map([['1:0', 'delay-5']]);
const dispatched = [];
const listeners = new Map();

const journey = {
  active: true,
  getOverrides: () => Object.fromEntries(statuses),
  getRouteDelays: () => Object.fromEntries(delays),
  getDisruptions: () => Object.fromEntries(disruptions),
  setMemberStatus(index, status) {
    if (!liveReady) return false;
    if (status === 'timetable') statuses.delete(Number(index)); else statuses.set(Number(index), status);
    return true;
  },
  resetMembers() { statuses.clear(); },
  setRouteDelay(index, minutes) {
    const memberIndex = Number(index);
    if (!assignments[memberIndex]?.route) return false;
    if (Number(minutes) === 0) delays.delete(memberIndex); else delays.set(memberIndex, Number(minutes));
    return true;
  },
  resetRouteDelays() { delays.clear(); },
  setSegmentDisruption(index, segmentIndex, kind) {
    const memberIndex = Number(index);
    const legIndex = Number(segmentIndex);
    if (!assignments[memberIndex]?.route?.segments?.[legIndex]) return false;
    disruptions.set(`${memberIndex}:${legIndex}`, String(kind));
    return true;
  },
  resetDisruptions() { disruptions.clear(); },
};

class FakeCustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
const window = {
  NVSTestLab: {
    active: true, now: () => now,
    setNow(value) { const next = Number(value); if (!Number.isFinite(next)) return false; now = next; return true; },
    getNetwork: () => network,
    setNetwork(value) {
      const allowed = ['normal', 'slow-2', 'slow-5', 'vmv-fail', 'transit-fail', 'all-fail', 'offline-api'];
      if (!allowed.includes(String(value))) return false;
      network = String(value); return true;
    },
  },
  NVSTestJourney: journey,
  NVSSharedLive: { getState: () => liveReady ? { members: { '0': {}, '1': {} } } : null },
  __NVS_LAST_RECOMMENDATIONS__: { primary: { assignments } },
  addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
  dispatchEvent(event) { dispatched.push(event); for (const fn of listeners.get(event.type) || []) fn(event); return true; },
};
const document = { body: null, readyState: 'loading', addEventListener() {}, getElementById() { return null; } };
const context = vm.createContext({
  window, document, Date, CustomEvent: FakeCustomEvent, Object, String, Number, Boolean, Math, Array, Map,
  queueMicrotask: (fn) => fn(), console,
});
vm.runInContext(source, context, { filename: 'test-lab-scenarios-v0111.js' });

const api = window.NVSTestScenarios;
assert(api?.active, 'scenario presets should activate only on top of the hardened Test Lab journey API');
assert.deepStrictEqual(Array.from(api.presets, (item) => item.id), [
  'transfer-window', 'delayed-rider', 'delayed-transfer', 'platform-change', 'cancelled-transfer', 'missed-transfer', 'all-arrived', 'routing-fallback', 'api-offline',
]);
assert.strictEqual(api.availability('transfer-window').available, true);
assert.strictEqual(api.availability('delayed-transfer').available, true);
assert.strictEqual(api.availability('platform-change').available, true);
assert.strictEqual(api.availability('cancelled-transfer').available, true);
assert.strictEqual(api.availability('missed-transfer').available, true);
assert.strictEqual(api.availability('routing-fallback').available, true);
assert.strictEqual(api.availability('bogus').available, false);

assert(api.applyPreset('transfer-window'));
assert.strictEqual(delays.size, 0, 'transfer-window must not pretend a whole-route delay changes the internal transfer gap');
assert.strictEqual(disruptions.size, 0, 'transfer-window should clear old disruption overlays');
assert.strictEqual(statuses.size, 0);
assert.strictEqual(network, 'normal');
assert.strictEqual(now, Date.parse('2026-08-27T12:09:00Z'));

assert(api.applyPreset('delayed-rider'));
assert.strictEqual(delays.get(0), 5);
assert.strictEqual(now, Date.parse('2026-08-27T12:25:00Z'));

assert(api.applyPreset('delayed-transfer'));
assert.strictEqual(delays.size, 0, 'realtime transfer delay must not become a whole-route delay');
assert.strictEqual(disruptions.get('0:1'), 'delay-5', 'realtime delay scenario should target the onward transfer leg');
assert.strictEqual(now, Date.parse('2026-08-27T12:07:00Z'), 'realtime delay scenario should jump five minutes before onward departure');

assert(api.applyPreset('platform-change'));
assert.strictEqual(delays.size, 0, 'platform preset should replace unrelated delay overlays');
assert.strictEqual(disruptions.get('0:1'), 'platform-change', 'platform scenario should target the onward transfer leg');
assert.strictEqual(now, Date.parse('2026-08-27T12:07:00Z'), 'platform scenario should jump five minutes before onward departure');

assert(api.applyPreset('cancelled-transfer'));
assert.strictEqual(disruptions.get('0:1'), 'cancelled', 'cancellation scenario should target the onward transfer leg');
assert.strictEqual(now, Date.parse('2026-08-27T12:07:00Z'));

assert(api.applyPreset('missed-transfer'));
assert.strictEqual(disruptions.size, 0, 'missed-transfer should clear disruption overlays');
assert.strictEqual(statuses.get(0), 'missed');
assert.strictEqual(now, Date.parse('2026-08-27T12:12:30Z'));

assert(api.applyPreset('all-arrived'));
assert.strictEqual(statuses.get(0), 'arrived');
assert.strictEqual(statuses.get(1), 'arrived');
assert.strictEqual(now, Date.parse('2026-08-27T12:41:00Z'));

assert(api.applyPreset('routing-fallback'));
assert.strictEqual(network, 'vmv-fail');
assert.strictEqual(statuses.size, 0);
assert.strictEqual(delays.size, 0);
assert.strictEqual(disruptions.size, 0);

assert(api.applyPreset('api-offline'));
assert.strictEqual(network, 'offline-api');

// Failed preflight preserves every local simulation dimension atomically.
statuses.clear(); statuses.set(1, 'on-vehicle');
delays.clear(); delays.set(1, 10);
disruptions.clear(); disruptions.set('1:0', 'delay-5');
network = 'slow-5';
now = Date.parse('2026-08-27T11:55:00Z');
const originalSegments = assignments[0].route.segments;
assignments[0].route.segments = [originalSegments[0]];
liveReady = false;
assert.strictEqual(api.availability('delayed-transfer').available, false);
assert(/transit transfer/.test(api.availability('delayed-transfer').reason));
assert.strictEqual(api.availability('cancelled-transfer').available, false);
assert(/transit transfer/.test(api.availability('cancelled-transfer').reason));
assert.strictEqual(api.availability('routing-fallback').available, true);
assert.strictEqual(api.applyPreset('delayed-transfer'), false);
assert.strictEqual(api.applyPreset('cancelled-transfer'), false);
assert.strictEqual(statuses.get(1), 'on-vehicle');
assert.strictEqual(delays.get(1), 10);
assert.strictEqual(disruptions.get('1:0'), 'delay-5', 'failed preset should preserve prior disruption overlay');
assert.strictEqual(network, 'slow-5');
assert.strictEqual(now, Date.parse('2026-08-27T11:55:00Z'));
assignments[0].route.segments = originalSegments;
liveReady = true;

assert.strictEqual(api.applyPreset('bogus'), false);
assert(api.resetScenario());
assert.strictEqual(statuses.size, 0);
assert.strictEqual(delays.size, 0);
assert.strictEqual(disruptions.size, 0);
assert.strictEqual(network, 'normal');
assert(dispatched.some((event) => event.type === 'nvs-test-scenario-change'));

assert(!/localStorage|sessionStorage/.test(source), 'scenario presets must remain memory-only');
assert(!/\bfetch\s*\(/.test(source), 'scenario presets must not add a network path');
assert(!/getCurrentPosition|watchPosition|geolocation/.test(source), 'scenario presets must not use location APIs');
assert(!/setInterval\s*\(/.test(source), 'scenario presets must not add a background polling loop');
assert(source.includes('Atomic local stress tests · never shared'), 'scenario UI must keep its safety boundary visible');
assert(source.includes('aria-disabled'), 'unavailable scenarios should expose disabled semantics');
assert(source.includes('aria-live="polite"'), 'scenario prerequisite guidance should be announced politely');

console.log('Test Lab scenario preset tests passed.');
