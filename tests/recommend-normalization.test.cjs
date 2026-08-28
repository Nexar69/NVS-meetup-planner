const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('recommend.js', 'utf8');

function makeContext() {
  const noopNode = {
    classList: { toggle() {} },
    setAttribute() {},
    toggleAttribute() {},
    querySelectorAll() { return []; },
    insertAdjacentElement() {},
  };
  const context = {
    console,
    Date,
    Math,
    Number,
    String,
    Set,
    Object,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
    document: {
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createElement() { return { ...noopNode, id: '', className: '', innerHTML: '' }; },
    },
    window: {
      dispatchEvent() {},
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'recommend.js' });
  return context.window.NVSRecommend;
}

function route(overrides = {}) {
  return {
    departure: new Date('2026-08-28T08:00:00+02:00'),
    arrival: new Date('2026-08-28T08:30:00+02:00'),
    duration: 30,
    transfers: 1,
    description: 'fixture',
    segments: [
      { mode: 'TRAM', duration: 10 },
      { mode: 'WALK', duration: 5 },
      { mode: 'BUS', duration: 15 },
    ],
    ...overrides,
  };
}

const recommend = makeContext();
const target = new Date('2026-08-28T08:30:00+02:00');

{
  const pair = recommend.createPairs(
    [route({ duration: -10, transfers: -3, segments: [{ mode: 'TRAM' }, { mode: 'BUS' }] })],
    [route({ duration: 'not-a-number', transfers: 1.5, segments: [{ mode: 'TRAM' }, { mode: 'CAR' }, { mode: 'BUS' }] })],
    target,
  )[0];
  assert.strictEqual(pair.travelA, 30, 'negative route duration should fall back to timetable duration');
  assert.strictEqual(pair.travelB, 30, 'malformed route duration should fall back to timetable duration');
  assert.strictEqual(pair.totalTransfers, 2, 'malformed transfer counts should fall back to actual transit legs');
}

{
  const pair = recommend.createPairs(
    [route({ duration: '42', transfers: '0', segments: [{ mode: 'TRAM' }] })],
    [route({ duration: 28, transfers: 2 })],
    target,
  )[0];
  assert.strictEqual(pair.travelA, 42, 'positive numeric-string route duration should remain compatible');
  assert.strictEqual(pair.totalTransfers, 2, 'numeric-string zero transfers should remain authoritative');
}

{
  const pair = recommend.createPairs(
    [route({ segments: [
      { mode: 'WALK', duration: -5 },
      { mode: 'WALK', duration: '7' },
      { mode: 'WALK', duration: true },
      { mode: 'TRAM', duration: 18 },
    ] })],
    [route({ segments: [] })],
    target,
  )[0];
  assert.strictEqual(pair.walkA, 7, 'walking cost should ignore negative, boolean and malformed durations');
}

{
  const pairs = recommend.createPairs(
    [route({ arrival: new Date('invalid') })],
    [route()],
    target,
  );
  assert.strictEqual(pairs.length, 0, 'invalid route timestamps should be rejected instead of creating NaN scores');
}

{
  const pairs = recommend.createPairs(
    [route({ departure: new Date('2026-08-28T09:00:00+02:00'), arrival: new Date('2026-08-28T08:30:00+02:00') })],
    [route()],
    target,
  );
  assert.strictEqual(pairs.length, 0, 'arrival-before-departure routes should be rejected');
}

{
  const pair = recommend.createPairs(
    [route({ transfers: '', segments: [
      { mode: 'TRAM' },
      { mode: 'WALK' },
      { mode: 'BIKE' },
      { mode: 'BICYCLE' },
      { mode: 'CAR' },
      { mode: '' },
      { mode: 'FUTURE_RAIL' },
    ] })],
    [route({ transfers: 0, segments: [] })],
    target,
  )[0];
  assert.strictEqual(pair.totalTransfers, 1, 'fallback transfer counting should exclude known non-transit and missing modes');
}

assert.ok(!source.includes('watchPosition'), 'recommendation normalization must not introduce continuous location tracking');
console.log('Recommendation normalization regression tests passed.');
