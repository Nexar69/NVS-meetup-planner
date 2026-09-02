const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../shared-live-v010.js'), 'utf8');
const listeners = new Map();
const events = [];
let now = 1_000;
let resolveLateCheckin;
let getCount = 0;
let postCount = 0;

const lateCheckinResponse = new Promise((resolve) => { resolveLateCheckin = resolve; });

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
    assert.equal(postCount, 1, 'a voluntary check-in must never be replayed automatically');
    const body = JSON.parse(init.body);
    assert.equal(body.member, 0);
    assert.equal(body.status, 'left');
    assert.equal(body.revision, 7, 'the write must be scoped to the revision the user actually reviewed');
    return lateCheckinResponse;
  }

  getCount += 1;
  if (getCount === 1) {
    return response({
      revision: 7,
      expiresAt: 10_000,
      updatedAt: 1_000,
      members: { 0: { status: 'at-stop', at: 1_000 } },
    });
  }

  if (getCount === 2) {
    return response({
      revision: 8,
      expiresAt: 2_000,
      updatedAt: 2_000,
      members: { 0: { status: 'arrived', at: 2_000 } },
    });
  }

  throw new Error(`Unexpected GET ${getCount}`);
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
  assert.equal(api.getState()?.revision, 7);
  assert.equal(api.canCheckIn(), true);

  const baselineLiveEvents = events.filter((event) => event.type === 'nvs-shared-live-change').length;
  assert.equal(baselineLiveEvents, 1);

  // The user explicitly starts one voluntary write against revision 7. Safari then
  // freezes the document before the backend response becomes observable locally.
  const pendingCheckin = api.checkIn('left');
  assert.equal(postCount, 1);
  listeners.get('window:pagehide')?.({ persisted: true });

  // Even if the transport still hands a successful response to JavaScript after
  // pagehide, the old lifecycle generation no longer owns state or confirmation UI.
  resolveLateCheckin(response({
    revision: 7,
    expiresAt: 10_000,
    updatedAt: 1_500,
    members: { 0: { status: 'left', at: 1_500 } },
  }));

  const outcome = await pendingCheckin;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, 'aborted');
  assert.equal(outcome.reason, 'superseded');
  assert.equal(api.getState()?.members?.[0]?.status, 'at-stop',
    'a late pre-freeze POST response must not overwrite the last authoritative state');
  assert.equal(events.filter((event) => event.type === 'nvs-shared-live-change').length, baselineLiveEvents,
    'a late pre-freeze write completion must not publish a Shared Live change');
  assert.equal(events.filter((event) => event.type === 'nvs-shared-checkin-outcome').length, 0,
    'a late terminal check-in result must not emit UI-facing outcome events while the document is frozen');

  // During suspension the organizer revises the plan and the authoritative live
  // session expires. Restoration may refresh read-only state, but must never replay
  // the user's old POST against the new revision.
  now = 3_000;
  document.hidden = false;
  listeners.get('window:pageshow')?.({ persisted: true });

  for (let i = 0; i < 8 && api.getState()?.revision !== 8; i += 1) {
    await Promise.resolve();
  }

  assert.equal(getCount, 2, 'restoration should make exactly one fresh authoritative GET');
  assert.equal(postCount, 1, 'restoration must not retry an interrupted voluntary check-in');
  assert.equal(api.getState()?.revision, 8);
  assert.equal(api.getState()?.members?.[0]?.status, 'arrived');
  assert.equal(api.hasPendingPlanUpdate(), true,
    'a newer organizer revision must require explicit plan reload before future writes');
  assert.equal(api.canCheckIn(), false,
    'an expired revised session must remain read-only after restoration');

  const liveEvents = events.filter((event) => event.type === 'nvs-shared-live-change');
  assert.equal(liveEvents.length, 2,
    'only the initial and freshly revalidated states may be published');
  assert.equal(liveEvents.at(-1)?.detail?.revision, 8);

  const outcomes = events.filter((event) => event.type === 'nvs-shared-checkin-outcome');
  assert.equal(outcomes.length, 0,
    'frozen interrupted actions stay event-inert; restoration must not synthesize or replay an outcome');

  assert.doesNotMatch(source, /watchPosition\s*\(/,
    'reconnect recovery must not introduce hidden or continuous location tracking');
  assert.doesNotMatch(source, /localStorage|indexedDB/i,
    'voluntary Shared Live state must remain tab-scoped and non-durable');

  console.log('shared-live-checkin-reconnect-revision-chaos: interrupted write is event-inert and never replayed; revised expired state wins after restore');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});