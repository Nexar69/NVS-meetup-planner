const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('test-lab-scenarios-v0111.js', 'utf8');

const assignments = [{
  member: { name: 'Person A' },
  route: {
    departure: '2026-08-28T10:00:00Z',
    arrival: '2026-08-28T10:30:00Z',
    segments: [
      { mode: 'TRAM', departure: '2026-08-28T10:00:00Z', arrival: '2026-08-28T10:10:00Z' },
      { mode: 'BUS', departure: '2026-08-28T10:12:00Z', arrival: '2026-08-28T10:30:00Z' },
    ],
  },
}];

let liveReady = true;
const window = {
  NVSTestLab: {
    active: true,
    now: () => Date.parse('2026-08-28T09:50:00Z'),
    getNetwork: () => 'normal',
    setNetwork: () => true,
    setNow: () => true,
  },
  NVSTestJourney: {
    active: true,
    getOverrides: () => ({}),
    getRouteDelays: () => ({}),
    getDisruptions: () => ({}),
    resetMembers() {},
    resetRouteDelays() {},
    resetDisruptions() {},
    setRouteDelay: () => true,
    setSegmentDisruption: () => true,
    setMemberStatus: () => true,
  },
  NVSSharedLive: { getState: () => liveReady ? { members: { '0': {} } } : null },
  __NVS_LAST_RECOMMENDATIONS__: { primary: { assignments } },
  addEventListener() {},
  dispatchEvent() { return true; },
};
const document = { body: null, readyState: 'loading', addEventListener() {}, getElementById() { return null; } };
const context = vm.createContext({
  window, document, Date, CustomEvent: class {}, Object, String, Number, Boolean, Math, Array,
  queueMicrotask: (fn) => fn(), console,
});
vm.runInContext(source, context, { filename: 'test-lab-scenarios-v0111.js' });

const api = window.NVSTestScenarios;
assert(api?.active);
assert.strictEqual(api.availability('transfer-window').available, true, 'tram -> bus should remain a direct transit transfer');

const baseline = assignments[0].route.segments;
const nonTransitModes = ['WALK', 'BIKE', 'BICYCLE', 'CAR', ''];
for (const mode of nonTransitModes) {
  assignments[0].route.segments = [
    { mode: 'TRAM', departure: '2026-08-28T10:00:00Z', arrival: '2026-08-28T10:10:00Z' },
    { mode, departure: '2026-08-28T10:10:00Z', arrival: '2026-08-28T10:11:00Z' },
    { mode: 'BUS', departure: '2026-08-28T10:12:00Z', arrival: '2026-08-28T10:30:00Z' },
  ];
  assert.strictEqual(
    api.availability('transfer-window').available,
    false,
    `${mode || 'missing mode'} must not masquerade as a direct public-transit transfer`,
  );
  assert.strictEqual(api.availability('incoming-delay').available, false);
  assert.strictEqual(api.availability('platform-change').available, false);
  assert.strictEqual(api.availability('cancelled-transfer').available, false);
}
assignments[0].route.segments = baseline;

// Unknown future MOTIS transit modes remain usable rather than being rejected by an over-tight allowlist.
assignments[0].route.segments = [
  { mode: 'TRAM', departure: '2026-08-28T10:00:00Z', arrival: '2026-08-28T10:10:00Z' },
  { mode: 'FUNICULAR', departure: '2026-08-28T10:12:00Z', arrival: '2026-08-28T10:30:00Z' },
];
assert.strictEqual(api.availability('transfer-window').available, true, 'unknown-but-named transit modes should remain forward compatible');

assert(!/getCurrentPosition|watchPosition|geolocation/.test(source));
assert(!/localStorage|sessionStorage/.test(source));
assert(!/\bfetch\s*\(/.test(source));
console.log('Test Lab transfer-mode classification tests passed.');
