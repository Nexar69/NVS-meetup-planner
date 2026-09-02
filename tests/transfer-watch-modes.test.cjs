const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('transfer-watch-v0111.js', 'utf8');
const listeners = new Map();
const window = {
  addEventListener(name, handler) { listeners.set(name, handler); },
  NVSInstructions: { instructionFor: (segment) => ({ title: `${segment.mode || 'Transit'} ${segment.line || ''}`.trim() }) },
  NVSShare: { getFocusIndex: () => -1 },
};
const document = {
  hidden: true,
  addEventListener() {},
  getElementById() { return null; },
};
const context = vm.createContext({
  window, document, Date, Intl, Object, String, Number, Boolean, Math, Array, Set,
  setTimeout() { throw new Error('hidden-page test should not arm timers'); },
  clearTimeout() {},
  console,
});
vm.runInContext(source, context, { filename: 'transfer-watch-v0111.js' });

const api = window.NVSTransferWatch0111;
assert(api, 'Connection Protection API should initialize');
assert.strictEqual(typeof listeners.get('nvs-recommendations-cleared'), 'function', 'Connection Protection must react immediately when recommendations are cleared');
listeners.get('nvs-recommendations-cleared')();

const now = Date.parse('2026-08-28T10:00:00Z');
const segment = (mode, departure, arrival) => ({ mode, departure, arrival, from: 'A', to: 'B' });

const directTransit = {
  segments: [
    segment('TRAM', '2026-08-28T09:50:00Z', '2026-08-28T10:10:00Z'),
    segment('BUS', '2026-08-28T10:12:00Z', '2026-08-28T10:30:00Z'),
  ],
};
assert.strictEqual(api.transferCandidates(directTransit, now).length, 1, 'tram -> bus should remain a protected direct transit transfer');

for (const mode of ['WALK', 'BIKE', 'BICYCLE', 'CAR', '']) {
  const route = {
    segments: [
      segment('TRAM', '2026-08-28T09:50:00Z', '2026-08-28T10:08:00Z'),
      segment(mode, '2026-08-28T10:08:00Z', '2026-08-28T10:10:00Z'),
      segment('BUS', '2026-08-28T10:12:00Z', '2026-08-28T10:30:00Z'),
    ],
  };
  assert.strictEqual(
    api.transferCandidates(route, now).length,
    0,
    `${mode || 'missing mode'} must break direct public-transit Connection Protection`,
  );
}

const futureTransit = {
  segments: [
    segment('TRAM', '2026-08-28T09:50:00Z', '2026-08-28T10:10:00Z'),
    segment('FUNICULAR', '2026-08-28T10:12:00Z', '2026-08-28T10:30:00Z'),
  ],
};
assert.strictEqual(api.transferCandidates(futureTransit, now).length, 1, 'named future transit modes should remain forward compatible');

assert(!/getCurrentPosition|watchPosition|geolocation/.test(source));
assert(!/localStorage|sessionStorage/.test(source));
console.log('Connection Protection transfer-mode and empty-recommendation lifecycle tests passed.');
