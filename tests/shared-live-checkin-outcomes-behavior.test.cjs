'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('shared-live-v010.js', 'utf8');

function makeElement() {
  return {
    hidden: false,
    disabled: false,
    dataset: {},
    className: '',
    textContent: '',
    innerHTML: '',
    style: {},
    querySelector() { return makeElement(); },
    querySelectorAll() { return []; },
    addEventListener() {},
    insertAdjacentElement() {},
    appendChild() {},
    remove() {},
  };
}

function makeHarness(fetchImpl) {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const dispatched = [];
  const storage = new Map([['meet-schwerin-checkin-capability:ABCDEF', 'x'.repeat(24)]]);
  const panel = makeElement();
  const document = {
    hidden: false,
    documentElement: makeElement(),
    getElementById(id) {
      if (id === 'sharedLiveV010') return panel;
      return makeElement();
    },
    createElement() { return makeElement(); },
    querySelector() { return makeElement(); },
    addEventListener(name, fn) { documentListeners.set(name, fn); },
  };
  const window = {
    location: {
      pathname: '/p/ABCDEF',
      search: '',
      hash: '',
      origin: 'https://meet.example',
      reload() {},
    },
    history: { state: null, replaceState() {} },
    NVSShare: {
      getSharedPlan() { return { members: [{ name: 'A' }], destination: { label: 'Meetup' } }; },
      getFocusIndex() { return 0; },
    },
    NVSConfig: { backendUrl: 'https://meet.example' },
    addEventListener(name, fn) { windowListeners.set(name, fn); },
    dispatchEvent(event) { dispatched.push(event); return true; },
  };
  class FakeCustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  }
  const timers = [];
  const context = {
    window,
    document,
    fetch: fetchImpl,
    sessionStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    URLSearchParams,
    CustomEvent: FakeCustomEvent,
    AbortController,
    Date,
    Math,
    Number,
    Object,
    String,
    console: { warn() {} },
    setTimeout(fn, delay) { const t = { fn, delay }; timers.push(t); return t; },
    clearTimeout() {},
  };
  vm.runInNewContext(source, context);
  return { window, document, windowListeners, documentListeners, dispatched, storage };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

async function run() {
  {
    let method = null;
    const h = makeHarness(async (_url, init = {}) => {
      method = init.method || 'GET';
      if (method === 'GET') return response(200, { revision: 1, members: {}, updatedAt: 10, expiresAt: Date.now() + 60_000 });
      return response(200, { revision: 1, members: { '0': { status: 'left', at: 20 } }, updatedAt: 20, expiresAt: Date.now() + 60_000 });
    });
    await h.window.NVSSharedLive.refresh();
    const outcome = await h.window.NVSSharedLive.checkIn('left');
    assert.equal(outcome.status, 'sent');
    assert.equal(outcome.reason, 'confirmed');
    assert.equal(h.window.NVSSharedLive.getState().members['0'].status, 'left');
    assert.ok(h.dispatched.some((event) => event.type === 'nvs-shared-checkin-outcome' && event.detail.status === 'sent'));
  }

  {
    const h = makeHarness(async (_url, init = {}) => {
      if ((init.method || 'GET') === 'GET') return response(200, { revision: 3, members: {}, updatedAt: 10, expiresAt: Date.now() + 60_000 });
      return response(403, { error: 'forbidden' });
    });
    await h.window.NVSSharedLive.refresh();
    const outcome = await h.window.NVSSharedLive.checkIn('left');
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.reason, 'capability_revoked');
    assert.equal(h.storage.has('meet-schwerin-checkin-capability:ABCDEF'), false, '403 must revoke the tab-scoped capability');
    assert.equal(h.window.NVSSharedLive.canCheckIn(), false);
  }

  {
    const expiresAt = Date.now() + 60_000;
    const h = makeHarness(async (_url, init = {}) => {
      if ((init.method || 'GET') === 'GET') return response(200, { revision: 4, members: {}, updatedAt: 10, expiresAt });
      return response(409, { error: 'plan_updated', revision: 5, expiresAt });
    });
    await h.window.NVSSharedLive.refresh();
    const outcome = await h.window.NVSSharedLive.checkIn('left');
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.reason, 'plan_updated');
    assert.equal(outcome.revision, 5);
    assert.equal(h.window.NVSSharedLive.hasPendingPlanUpdate(), true);
    assert.equal(h.window.NVSSharedLive.canCheckIn(), false);
  }

  {
    const h = makeHarness(async (_url, init = {}) => {
      if ((init.method || 'GET') === 'GET') return response(200, { revision: 1, members: {}, updatedAt: 10, expiresAt: Date.now() + 60_000 });
      throw new TypeError('network down');
    });
    await h.window.NVSSharedLive.refresh();
    const outcome = await h.window.NVSSharedLive.checkIn('left');
    assert.equal(outcome.status, 'uncertain');
    assert.equal(outcome.reason, 'network_error');
  }

  {
    let postSignal;
    let settlePost;
    const h = makeHarness((_url, init = {}) => {
      if ((init.method || 'GET') === 'GET') return Promise.resolve(response(200, { revision: 1, members: {}, updatedAt: 10, expiresAt: Date.now() + 60_000 }));
      postSignal = init.signal;
      return new Promise((resolve, reject) => {
        settlePost = { resolve, reject };
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      });
    });
    await h.window.NVSSharedLive.refresh();
    const pending = h.window.NVSSharedLive.checkIn('left');
    await Promise.resolve();
    assert.equal(postSignal.aborted, false);
    h.windowListeners.get('pagehide')();
    assert.equal(postSignal.aborted, true, 'pagehide must abort the voluntary POST');
    const outcome = await pending;
    assert.equal(outcome.status, 'aborted');
    assert.equal(outcome.reason, 'cancelled');
    assert.ok(settlePost);
  }

  assert.doesNotMatch(source, /watchPosition\s*\(/, 'Shared Live must remain free of continuous/background GPS');
  assert.doesNotMatch(source, /localStorage|indexedDB/i, 'Shared Live must not persist voluntary state durably');
  console.log('Shared Live structured check-in outcome behavior passed.');
}

run().catch((error) => { console.error(error); process.exit(1); });
