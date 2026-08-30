const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../shared-live-v010.js'), 'utf8');
const listeners = new Map();
const events = [];
let now = 1_000;
let resolveStalePoll;
let fetchStep = 0;

const stalePollResponse = new Promise((resolve) => { resolveStalePoll = resolve; });

function response(payload) {
  return {
    ok: true,
    status: 200,
    async json() { return payload; },
  };
}

async function fakeFetch(input) {
  const url = String(input);
  assert.match(url, /\/api\/live\/ABC234$/);
  fetchStep += 1;

  if (fetchStep === 1) {
    return response({
      revision: 3,
      expiresAt: 10_000,
      updatedAt: 1_000,
      members: { 0: { status: 'left', at: 1_000 } },
    });
  }

  if (fetchStep === 2) return stalePollResponse;

  if (fetchStep === 3) {
    return response({
      revision: 4,
      expiresAt: 2_000,
      updatedAt: 2_000,
      members: { 0: { status: 'arrived', at: 2_000 } },
    });
  }

  throw new Error(`Unexpected fetch step ${fetchStep}`);
}

const window = {
  location: {
    pathname: '/p/ABC234',
    search: '',
    hash: '',
    origin: 'https://meet.example',
  },
  NVSShare: {
    getSharedPlan() { return null; },
    getFocusIndex() { return 0; },
  },
  addEventListener(name, handler) { listeners.set(`window:${name}`, handler); },
  dispatchEvent(event) { events.push(event); return true; },
  history: { state: null, replaceState() {} },
};

const document = {
  hidden: false,
  addEventListener(name, handler) { listeners.set(`document:${name}`, handler); },
};

class FakeCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

const sessionStorage = {
  getItem(key) {
    return key === 'meet-schwerin-checkin-capability:ABC234'
      ? 'abcdefghijklmnopqrstuvwxyz123456'
      : null;
  },
  setItem() {},
  removeItem() {},
};

class FakeDate extends Date {
  static now() { return now; }
}

vm.runInNewContext(source, {
  window,
  document,
  sessionStorage,
  fetch: fakeFetch,
  URLSearchParams,
  AbortController,
  CustomEvent: FakeCustomEvent,
  console,
  Date: FakeDate,
  Math,
  Number,
  Object,
  String,
  Promise,
  setTimeout() { return 1; },
  clearTimeout() {},
});

(async () => {
  const api = window.NVSSharedLive;
  assert.ok(api, 'Shared Live API should initialize');

  await api.refresh();
  assert.equal(api.getState()?.revision, 3);
  assert.equal(api.canCheckIn(), true,
    'a fresh, unexpired state with a private capability should allow voluntary check-in');

  const baselineEvents = events.filter((event) => event.type === 'nvs-shared-live-change').length;
  assert.equal(baselineEvents, 1);

  // Begin another GET, then freeze the page before it returns. The request may
  // still resolve in a browser/network stack, but its result no longer owns UI state.
  const stalePoll = api.refresh();
  listeners.get('window:pagehide')?.({ persisted: true });

  resolveStalePoll(response({
    revision: 99,
    expiresAt: 50_000,
    updatedAt: 50_000,
    members: { 0: { status: 'missed', at: 50_000 } },
  }));
  await stalePoll;

  assert.equal(api.getState()?.revision, 3,
    'a poll invalidated by pagehide must not publish a late organizer revision');
  assert.equal(events.filter((event) => event.type === 'nvs-shared-live-change').length, baselineEvents,
    'a stale post-pagehide completion must not emit a Shared Live change');

  // While frozen, the previously authoritative session expires. Restoring the
  // page triggers a fresh poll; the organizer revision is accepted, but the
  // expired session must remain non-writable and marked as a pending plan update.
  now = 3_000;
  document.hidden = false;
  const restoreHandler = listeners.get('document:visibilitychange');
  restoreHandler?.();

  // visibilitychange starts refresh asynchronously; yield until its response is consumed.
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(api.getState()?.revision, 4,
    'restoration should accept only the fresh reconnect response');
  assert.equal(api.hasPendingPlanUpdate(), true,
    'a newer organizer revision discovered during reconnect should block stale-route writes');
  assert.equal(api.canCheckIn(), false,
    'authoritative expiry must keep voluntary check-in disabled after restoration');

  const liveEvents = events.filter((event) => event.type === 'nvs-shared-live-change');
  assert.equal(liveEvents.length, 2,
    'only the initial state and fresh reconnect state should be published');
  assert.equal(liveEvents.at(-1)?.detail?.revision, 4);
  assert.notEqual(liveEvents.at(-1)?.detail?.revision, 99,
    'the stale pre-freeze response must never revive after reconnect');

  assert.doesNotMatch(source, /watchPosition\s*\(/,
    'lifecycle recovery must not add hidden or continuous location tracking');
  assert.doesNotMatch(source, /localStorage|indexedDB/i,
    'voluntary Shared Live state must remain non-durable');

  console.log('shared-live-reconnect-expiry-chaos: stale pre-freeze poll suppressed; reconnect revision accepted; expired session remains read-only');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
