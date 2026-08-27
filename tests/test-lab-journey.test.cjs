const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('test-lab-journey-v0111.js', 'utf8');
const realDate = Date;
let jumpedTo = null;
const dispatched = [];
const live = { members: { '0': { status: 'left', note: 'real', at: 1000 } } };
const listeners = new Map();

class FakeCustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
class FakeEvent { constructor(type) { this.type = type; } }

const window = {
  NVSTestLab: { active: true, setNow(value) { jumpedTo = value; return true; } },
  NVSSharedLive: { getState: () => live },
  NVSConvergence: { analyze: () => ({ events: [{ time: '2026-08-27T12:15:00Z', title: 'Join' }] }) },
  __NVS_LAST_RECOMMENDATIONS__: {
    primary: {
      assignments: [{
        member: { name: '<img src=x onerror=boom()>' },
        route: {
          departure: '2026-08-27T12:00:00Z',
          arrival: '2026-08-27T12:30:00Z',
          segments: [
            { departure: '2026-08-27T12:00:00Z' },
            { departure: '2026-08-27T12:10:00Z' },
          ],
        },
      }],
    },
  },
  addEventListener(type, fn) { listeners.set(type, fn); },
  dispatchEvent(event) { dispatched.push(event); return true; },
};
const document = {
  body: null,
  readyState: 'loading',
  addEventListener() {},
  querySelector() { return null; },
  getElementById() { return null; },
};
const context = { window, document, Date: realDate, CustomEvent: FakeCustomEvent, Event: FakeEvent, Intl, Map, Object, Number, String, Array, Boolean, Math, queueMicrotask: (fn) => fn(), console };
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
assert(!/localStorage|sessionStorage/.test(source), 'journey simulation must remain memory-only');
assert(!/geolocation|getCurrentPosition|watchPosition/.test(source), 'journey simulation must not use location APIs');
assert(!/\bfetch\s*\(/.test(source), 'journey simulation must not add a network path');
assert(source.includes('esc('), 'test-only UI must escape interpolated text');
assert(source.includes('window.NVSTestLab?.active'), 'journey simulator must remain Test-Lab-gated');

console.log('Test Lab journey simulation tests passed.');
