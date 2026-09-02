const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../shared-live-v010.js'), 'utf8');
const listeners = new Map();
const events = [];
let now = 1_000;
let fetchStep = 0;
let resolveStalePoll;

const stalePollResponse = new Promise((resolve) => { resolveStalePoll = resolve; });

function response(payload) {
  return {
    ok: true,
    status: 200,
    async json() { return payload; },
  };
}

async function fakeFetch(input) {
  assert.match(String(input), /\/api\/live\/ABC234$/);
  fetchStep += 1;
  if (fetchStep === 1) {
    return response({
      revision: 3,
      expiresAt: 2_000,
      updatedAt: 1_000,
      members: { 0: { status: 'left', at: 1_000 } },
    });
  }
  if (fetchStep === 2) return stalePollResponse;
  if (fetchStep === 3) {
    return response({
      revision: 3,
      expiresAt: 50_000,
      updatedAt: 3_000,
      members: { 0: { status: 'arrived', at: 3_000 } },
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
  getElementById() { return null; },
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
    'the initial unexpired authoritative state should allow voluntary check-in');

  const baselineEvents = events.filter((event) => event.type === 'nvs-shared-live-change').length;
  const stalePoll = api.refresh();

  now = 2_500;
  listeners.get('window:nvs-shared-session-expired')?.(new FakeCustomEvent('nvs-shared-session-expired'));
  assert.equal(api.canCheckIn(), false,
    'authoritative expiry must immediately make the session read-only');

  resolveStalePoll(response({
    revision: 99,
    expiresAt: 50_000,
    updatedAt: 4_000,
    members: { 0: { status: 'missed', at: 4_000 } },
  }));
  await stalePoll;

  assert.equal(api.getState()?.revision, 3,
    'a GET that began before authoritative expiry must not publish afterward');
  assert.equal(events.filter((event) => event.type === 'nvs-shared-live-change').length, baselineEvents,
    'the invalidated pre-expiry GET must not emit a Shared Live change');

  await api.refresh();
  assert.equal(fetchStep, 3,
    'read-only Shared Live polling may continue after expiry');
  assert.equal(api.getState()?.updatedAt, 3_000,
    'a fresh post-expiry GET may refresh read-only status information');
  assert.equal(api.canCheckIn(), false,
    'once authoritative expiry is announced, a later response must never revive writes even if it reports a future expiresAt');

  assert.match(source, /nvs-shared-session-expired[\s\S]*invalidatePoll\(\)/,
    'the authoritative expiry boundary should explicitly invalidate in-flight GET ownership');
  assert.doesNotMatch(source, /watchPosition\s*\(/,
    'expiry ownership must not add hidden or continuous location tracking');
  assert.doesNotMatch(source, /localStorage|indexedDB/i,
    'the expiry latch must remain memory-only');

  console.log('shared-live-expiry-ownership: pre-expiry GET invalidated; authoritative expiry remains sticky across later read-only polls');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
