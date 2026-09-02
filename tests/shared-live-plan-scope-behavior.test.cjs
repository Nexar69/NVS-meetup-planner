const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../shared-live-v010.js'), 'utf8');
const events = [];
const listeners = new Map();
let resolveOldResponse;

const oldResponse = new Promise((resolve) => { resolveOldResponse = resolve; });

function response(payload) {
  return {
    ok: true,
    status: 200,
    async json() { return payload; },
  };
}

async function fakeFetch(input) {
  const url = String(input);
  if (url.endsWith('/api/live/ABC234')) return oldResponse;
  if (url.endsWith('/api/live/DEF567')) {
    return response({ revision: 4, updatedAt: 222, members: { 0: { status: 'arrived', at: 222 } } });
  }
  throw new Error(`Unexpected URL: ${url}`);
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
    getFocusIndex() { return -1; },
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
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};

vm.runInNewContext(source, {
  window,
  document,
  sessionStorage,
  fetch: fakeFetch,
  URLSearchParams,
  AbortController,
  CustomEvent: FakeCustomEvent,
  console,
  Date,
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

  const stalePoll = api.refresh();
  assert.equal(api.getPlanId(), 'ABC234');

  // Same-document navigation changes the authoritative plan scope while the
  // old GET is still in flight. Even a successful old response must fail closed.
  window.location.pathname = '/p/DEF567';
  resolveOldResponse(response({
    revision: 3,
    updatedAt: 111,
    members: { 0: { status: 'missed', at: 111 } },
  }));
  await stalePoll;

  assert.equal(api.getState(), null,
    'a response started for the previous plan must not become Shared Live state');
  assert.equal(events.filter((event) => event.type === 'nvs-shared-live-change').length, 0,
    'an old-plan response must not publish a Shared Live change event');

  // Once the current plan starts its own request, that response remains valid.
  await api.refresh();
  assert.equal(api.getPlanId(), 'DEF567');
  assert.equal(api.getState()?.revision, 4,
    'the current plan should still be able to publish a fresh Shared Live state');
  assert.equal(api.getState()?.members?.['0']?.status, 'arrived');

  const liveEvents = events.filter((event) => event.type === 'nvs-shared-live-change');
  assert.equal(liveEvents.length, 1,
    'only the current-plan response should publish Shared Live state');
  assert.equal(liveEvents[0].detail?.revision, 4);

  assert.doesNotMatch(source, /watchPosition\s*\(/,
    'plan-scope hardening must not add hidden or continuous location tracking');
  assert.doesNotMatch(source, /localStorage|indexedDB/i,
    'plan-scope hardening must not add durable voluntary-state storage');

  console.log('shared-live-plan-scope-behavior: old-plan GET rejected before liveState publication; current-plan GET accepted');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
