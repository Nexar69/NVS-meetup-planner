const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('test-lab-journey-v0111.js', 'utf8');
const realDate = Date;
let jumpedTo = null;
const dispatched = [];
const live = { members: { '0': { status: 'left', note: 'real', at: 1000 } } };
const listeners = new Map();
const assignment = {
  member: { name: '<img src=x onerror=boom()>' },
  route: {
    departure: '2026-08-27T12:00:00Z',
    arrival: '2026-08-27T12:30:00Z',
    segments: [
      {
        mode: 'TRAM', platformFrom: '1', departure: '2026-08-27T12:00:00Z', arrival: '2026-08-27T12:10:00Z',
        intermediateStops: [{ name: 'A', arrival: '2026-08-27T12:05:00Z', departure: '2026-08-27T12:06:00Z' }],
      },
      { mode: 'TRAM', platformFrom: '2', departure: '2026-08-27T12:10:00Z', arrival: '2026-08-27T12:30:00Z' },
    ],
  },
};

class FakeCustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
class FakeEvent { constructor(type) { this.type = type; } }

const window = {
  NVSTestLab: { active: true, setNow(value) { jumpedTo = value; return true; } },
  NVSSharedLive: { getState: () => live },
  NVSConvergence: { analyze: () => ({ events: [{ time: '2026-08-27T12:15:00Z', title: 'Join' }] }) },
  __NVS_LAST_RECOMMENDATIONS__: { primary: { assignments: [assignment] } },
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
const document = { body: null, readyState: 'loading', addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
const context = {
  window, document, Date: realDate, CustomEvent: FakeCustomEvent, Event: FakeEvent, Intl,
  Map, Set, Object, Number, String, Array, Boolean, Math, queueMicrotask: (fn) => fn(), console,
};
vm.createContext(context);
vm.runInContext(source, context);

const api = window.NVSTestJourney;
assert(api?.active, 'Test journey API should activate only under Test Lab');
const events = api.collectEvents();
assert(events.some((event) => event.kind === 'departure'));
assert(events.some((event) => event.kind === 'transfer'));
assert(events.some((event) => event.kind === 'arrival'));
assert(events.some((event) => event.kind === 'join'));
assert(events.every((event) => !event.label.includes('<img')), 'event jump labels must not expose user-controlled member names');
assert(api.jumpToEvent(0));
assert.strictEqual(jumpedTo, events[0].time);

assert(api.setMemberStatus(0, 'missed'));
assert.strictEqual(live.members['0'].status, 'missed');
assert.strictEqual(live.members['0'].note, 'Test Lab simulation');
assert.strictEqual(live.members['0'].simulated, true);
assert(dispatched.some((event) => event.type === 'nvs-shared-live-change'));
assert(api.clearMemberStatus(0));
assert.strictEqual(live.members['0'].status, 'left', 'clearing simulation should restore the read-only baseline');
assert.strictEqual(live.members['0'].note, 'real');
assert.strictEqual(api.setMemberStatus(0, 'bogus'), false);

const originalRoute = assignment.route;
assert(api.setRouteDelay(0, 10), 'approved route delay should apply');
assert.strictEqual(assignment.route.departure, '2026-08-27T12:10:00.000Z');
assert.strictEqual(assignment.route.arrival, '2026-08-27T12:40:00.000Z');
assert.strictEqual(assignment.route.segments[0].arrival, '2026-08-27T12:20:00.000Z');
assert.strictEqual(assignment.route.segments[0].intermediateStops[0].arrival, '2026-08-27T12:15:00.000Z');
assert.strictEqual(originalRoute.departure, '2026-08-27T12:00:00Z', 'delay overlay must not mutate the loaded baseline route');
assert.strictEqual(api.getRouteDelays()['0'], 10);
assert(dispatched.some((event) => event.type === 'nvs-test-route-delay-change'));

// Realtime disruption overlays compose with timing overlays without mutating the baseline.
assert.strictEqual(api.firstTransitSegment(0, true), 1, 'transfer-target helper should prefer the onward transit leg');
assert(api.setSegmentDisruption(0, 1, 'platform-change'));
assert.strictEqual(assignment.route.segments[1].plannedPlatformFrom, '2');
assert.strictEqual(assignment.route.segments[1].platformFrom, 'TEST');
assert.strictEqual(originalRoute.segments[1].platformFrom, '2', 'platform simulation must not mutate provider baseline');
assert.strictEqual(api.getDisruptions()['0:1'], 'platform-change');
assert(dispatched.some((event) => event.type === 'nvs-test-route-disruption-change'));

assert(api.setSegmentDisruption(0, 1, 'cancelled'));
assert.strictEqual(assignment.route.segments[1].cancelled, true);
assert.strictEqual(assignment.route.segments[1].isCancelled, true);
assert.strictEqual(originalRoute.segments[1].cancelled, undefined, 'cancellation simulation must remain local');

assert(api.setSegmentDisruption(0, 1, 'delay-10'));
assert.strictEqual(assignment.route.segments[1].departureDelay, 10);
assert.strictEqual(assignment.route.segments[1].arrivalDelay, 10);
assert.strictEqual(api.setSegmentDisruption(0, 1, 'bogus'), false, 'unapproved disruption must be rejected');

// Ordinary UI rerenders must not stack timing or disruption overlays.
window.dispatchEvent(new FakeEvent('nvs-group-recommendations-rendered'));
assert.strictEqual(assignment.route.departure, '2026-08-27T12:10:00.000Z', 'rerender must not double-apply delay');
assert.strictEqual(assignment.route.segments[1].departureDelay, 10, 'rerender must not stack realtime delay');

// Fresh route data becomes the new baseline while overlays stay visible.
assignment.route = {
  departure: '2026-08-27T12:05:00Z', arrival: '2026-08-27T12:35:00Z',
  segments: [
    { mode: 'TRAM', platformFrom: 'A', departure: '2026-08-27T12:05:00Z', arrival: '2026-08-27T12:15:00Z' },
    { mode: 'TRAM', platformFrom: 'C', departure: '2026-08-27T12:16:00Z', arrival: '2026-08-27T12:35:00Z' },
  ],
};
window.dispatchEvent(new FakeEvent('nvs-group-recommendations-rendered'));
assert.strictEqual(assignment.route.departure, '2026-08-27T12:15:00.000Z');
assert.strictEqual(assignment.route.arrival, '2026-08-27T12:45:00.000Z');
assert.strictEqual(assignment.route.segments[1].departureDelay, 10, 'disruption should rebase over fresh provider route');

assert(api.clearSegmentDisruption(0, 1));
assert.strictEqual(assignment.route.segments[1].departureDelay, undefined, 'clearing disruption should reveal fresh provider values beneath it');
assert.strictEqual(assignment.route.segments[1].platformFrom, 'C');
assert(api.clearRouteDelay(0));
assert.strictEqual(assignment.route.departure, '2026-08-27T12:05:00Z', 'clearing delay should reveal the newest real route baseline');
assert.strictEqual(assignment.route.arrival, '2026-08-27T12:35:00Z');
assert.strictEqual(api.setRouteDelay(0, 7), false, 'unapproved delay should be rejected');

assert(!/localStorage|sessionStorage/.test(source), 'journey simulation must remain memory-only');
assert(!/geolocation|getCurrentPosition|watchPosition/.test(source), 'journey simulation must not use location APIs');
assert(!/\bfetch\s*\(/.test(source), 'journey simulation must not add a network path');
assert(source.includes('esc('), 'test-only UI must escape interpolated text');
assert(source.includes('window.NVSTestLab?.active'), 'journey simulator must remain Test-Lab-gated');

console.log('Test Lab journey simulation tests passed.');
