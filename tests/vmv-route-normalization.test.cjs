const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('vmv-v080.js', 'utf8');

function makeContext(routes) {
  const events = [];
  const context = {
    console: { warn() {} },
    Date,
    Math,
    Number,
    String,
    Set,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ routes }),
    }),
    window: {
      NVSConfig: {
        preferVmv: true,
        backendUrl: 'https://example.invalid',
      },
      NVSTransit: {
        LOCATIONS: {
          a: { lat: 53.62, lon: 11.41 },
          b: { lat: 53.64, lon: 11.43 },
        },
        fetchRoutes: async () => [],
      },
      dispatchEvent(event) {
        events.push(event);
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'vmv-v080.js' });
  return { transit: context.window.NVSTransit, events };
}

function rawRoute(overrides = {}) {
  return {
    departure: '2026-08-28T08:00:00+02:00',
    arrival: '2026-08-28T08:30:00+02:00',
    duration: 30,
    transfers: 1,
    segments: [
      { mode: 'TRAM' },
      { mode: 'CAR' },
      { mode: 'BUS' },
    ],
    ...overrides,
  };
}

(async () => {
  {
    const { transit } = makeContext([rawRoute({ transfers: -2, duration: -5 })]);
    const [route] = await transit.fetchRoutes('a', 'b', new Date('2026-08-28T08:15:00+02:00'));
    assert.strictEqual(route.transfers, 1, 'negative transfers should fall back to actual transit legs');
    assert.strictEqual(route.duration, 30, 'negative duration should fall back to timetable duration');
  }

  {
    const { transit } = makeContext([rawRoute({ transfers: 1.5, duration: 'not-a-number' })]);
    const [route] = await transit.fetchRoutes('a', 'b', new Date('2026-08-28T08:15:00+02:00'));
    assert.strictEqual(route.transfers, 1, 'fractional transfers should not be authoritative');
    assert.strictEqual(route.duration, 30, 'non-numeric duration should fall back to timestamps');
  }

  {
    const { transit } = makeContext([rawRoute({ transfers: '0', duration: '42' })]);
    const [route] = await transit.fetchRoutes('a', 'b', new Date('2026-08-28T08:15:00+02:00'));
    assert.strictEqual(route.transfers, 0, 'numeric-string zero should remain authoritative');
    assert.strictEqual(route.duration, 42, 'positive numeric-string duration should remain compatible');
  }

  {
    const { transit } = makeContext([rawRoute({ transfers: true, duration: true })]);
    const [route] = await transit.fetchRoutes('a', 'b', new Date('2026-08-28T08:15:00+02:00'));
    assert.strictEqual(route.transfers, 1, 'boolean transfers should be rejected');
    assert.strictEqual(route.duration, 30, 'boolean duration should be rejected');
  }

  {
    const { transit } = makeContext([rawRoute({
      transfers: '',
      segments: [
        { mode: 'TRAM' },
        { mode: 'WALK' },
        { mode: 'BIKE' },
        { mode: 'BICYCLE' },
        { mode: 'CAR' },
        { mode: '' },
        { mode: 'FUTURE_RAIL' },
      ],
    })]);
    const [route] = await transit.fetchRoutes('a', 'b', new Date('2026-08-28T08:15:00+02:00'));
    assert.strictEqual(route.transfers, 1, 'fallback should exclude known non-transit and missing modes while accepting future named transit modes');
  }

  assert.ok(!source.includes('watchPosition'), 'VMV normalization must not introduce continuous location tracking');
  console.log('VMV route normalization regression tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
