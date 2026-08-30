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

function makeHarness(fetchImpl, initialNow = 1_000_000) {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const dispatched = [];
  const storage = new Map([['meet-schwerin-checkin-capability:ABCDEF', 'x'.repeat(24)]]);
  const panel = makeElement();
  const clock = { now: initialNow };

  class HarnessDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock.now]));
    }
    static now() { return clock.now; }
  }

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
    Date: HarnessDate,
    Math,
    Number,
    Object,
    String,
    console: { warn() {} },
    setTimeout(fn, delay) { const timer = { fn, delay }; timers.push(timer); return timer; },
    clearTimeout() {},
  };

  vm.runInNewContext(source, context);
  return { window, document, windowListeners, documentListeners, dispatched, storage, clock };
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
    let postSignal;
    const h = makeHarness((_url, init = {}) => {
      if ((init.method || 'GET') === 'GET') {
        return Promise.resolve(response(200, { revision: 1, members: {}, updatedAt: 10, expiresAt: 1_060_000 }));
      }
      postSignal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      });
    });

    await h.window.NVSSharedLive.refresh();
    const pending = h.window.NVSSharedLive.checkIn('left');
    await Promise.resolve();
    assert.equal(postSignal.aborted, false);

    h.document.hidden = true;
    h.documentListeners.get('visibilitychange')();
    assert.equal(postSignal.aborted, true, 'becoming hidden must abort an in-flight voluntary POST');

    const outcome = await pending;
    assert.equal(outcome.status, 'aborted');
    assert.equal(outcome.reason, 'cancelled');
    assert.equal(h.window.NVSSharedLive.getState().members['0'], undefined, 'hidden-page cancellation must not publish a stale check-in');
  }

  {
    let settlePost;
    const expiresAt = 1_001_000;
    const h = makeHarness((_url, init = {}) => {
      if ((init.method || 'GET') === 'GET') {
        return Promise.resolve(response(200, { revision: 7, members: {}, updatedAt: 10, expiresAt }));
      }
      return new Promise((resolve) => { settlePost = resolve; });
    });

    await h.window.NVSSharedLive.refresh();
    const pending = h.window.NVSSharedLive.checkIn('left');
    await Promise.resolve();

    h.clock.now = expiresAt;
    settlePost(response(200, {
      revision: 7,
      members: { '0': { status: 'left', at: expiresAt } },
      updatedAt: expiresAt,
      expiresAt,
    }));

    const outcome = await pending;
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.reason, 'expired', 'the exact authoritative expiry instant must fail closed');
    assert.equal(outcome.expiresAt, expiresAt);
    assert.equal(h.window.NVSSharedLive.getState().members['0'], undefined, 'a response completing at expiry must not repaint live state');
    assert.ok(!h.dispatched.some((event) => event.type === 'nvs-shared-live-change' && event.detail?.members?.['0']), 'expired completion must not emit a successful live-state mutation');
  }

  assert.doesNotMatch(source, /watchPosition\s*\(/, 'Shared Live must remain free of continuous/background GPS');
  assert.doesNotMatch(source, /localStorage|indexedDB/i, 'Shared Live must not persist voluntary state durably');
  console.log('Shared Live check-in lifecycle/expiry boundary behavior passed.');
}

run().catch((error) => { console.error(error); process.exit(1); });
