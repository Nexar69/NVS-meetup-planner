const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../shared-live-v010.js'), 'utf8');
const listeners = new Map();
const events = [];
let getCount = 0;
let postCount = 0;

function response(payload) {
  return {
    ok: true,
    status: 200,
    async json() { return payload; },
  };
}

async function fakeFetch(input, init = {}) {
  const url = String(input);
  assert.match(url, /\/api\/live\/ABC234$/);

  if ((init.method || 'GET') === 'POST') {
    postCount += 1;
    const body = JSON.parse(init.body);
    assert.equal(body.member, 0);
    assert.equal(body.status, 'left');
    assert.equal(body.revision, 7);
    return response({
      revision: 7,
      expiresAt: 20_000,
      updatedAt: 3_000,
      members: { 0: { status: 'left', at: 3_000 } },
    });
  }

  getCount += 1;
  assert.ok(getCount <= 2, `unexpected authoritative GET ${getCount}`);
  return response({
    revision: 7,
    expiresAt: 20_000,
    updatedAt: getCount === 1 ? 1_000 : 2_000,
    members: { 0: { status: 'at-stop', at: getCount === 1 ? 1_000 : 2_000 } },
  });
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
  static now() { return 2_500; }
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
  assert.equal(getCount, 1);
  assert.equal(api.canCheckIn(), true);

  const baselineEvents = events.length;
  listeners.get('window:pagehide')?.({ persisted: true });

  const suspendedOutcome = await api.checkIn('left');
  assert.equal(suspendedOutcome.ok, false);
  assert.equal(suspendedOutcome.status, 'blocked');
  assert.equal(suspendedOutcome.reason, 'suspended');
  assert.equal(postCount, 0,
    'a check-in API call made after pagehide must not start a voluntary POST');
  assert.equal(events.length, baselineEvents,
    'a suspended check-in attempt must not emit any UI-facing event');
  assert.equal(api.getState()?.members?.[0]?.status, 'at-stop',
    'a suspended entrypoint must not mutate authoritative state');

  document.hidden = false;
  listeners.get('window:pageshow')?.({ persisted: true });
  for (let i = 0; i < 8 && getCount < 2; i += 1) await Promise.resolve();

  assert.equal(getCount, 2,
    'pageshow should reacquire ownership with one fresh authoritative GET');
  assert.equal(postCount, 0,
    'restoration must not replay the blocked voluntary action');
  assert.equal(api.canCheckIn(), true,
    'freshly revalidated unchanged state may allow a new explicit action');

  const restoredBaselineOutcomes = events.filter((event) => event.type === 'nvs-shared-checkin-outcome').length;
  const explicitOutcome = await api.checkIn('left');
  assert.equal(postCount, 1,
    'only the new explicit post-restore action may start a voluntary POST');
  assert.equal(explicitOutcome.ok, true);
  assert.equal(explicitOutcome.status, 'sent');
  assert.equal(api.getState()?.members?.[0]?.status, 'left');

  const outcomes = events.filter((event) => event.type === 'nvs-shared-checkin-outcome');
  assert.equal(outcomes.length, restoredBaselineOutcomes + 1,
    'only the post-restore explicit action should emit a terminal check-in outcome');
  assert.equal(outcomes.at(-1)?.detail?.status, 'sent');

  assert.doesNotMatch(source, /watchPosition\s*\(/,
    'entrypoint hardening must not introduce continuous location tracking');
  assert.doesNotMatch(source, /localStorage|indexedDB/i,
    'voluntary Shared Live state must remain tab-scoped and non-durable');

  console.log('shared-live-suspended-checkin-entrypoint: frozen entrypoint performs zero POSTs/events; fresh explicit post-restore action succeeds once');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
