const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../shared-expiry-v0111.js'), 'utf8');
const listeners = new Map();
const events = [];
const scheduled = new Map();
let nextTimer = 1;
let now = 1_000;
let liveState = { expiresAt: 2_000 };
let observerActive = false;
let observerCallback = null;
let domWrites = 0;

function classList() {
  const values = new Set();
  return {
    toggle(name, force) {
      domWrites += 1;
      if (force === undefined ? !values.has(name) : force) values.add(name);
      else values.delete(name);
    },
    remove(...names) {
      domWrites += 1;
      names.forEach((name) => values.delete(name));
    },
    contains(name) { return values.has(name); },
  };
}

const note = {
  _text: '',
  set textContent(value) { domWrites += 1; this._text = value; },
  get textContent() { return this._text; },
};
const buttons = [{ disabled: false }];
let indicator = null;
const panel = {
  classList: classList(),
  querySelector(selector) {
    if (selector === '#v0111SharedExpiry') return indicator;
    if (selector === '#v010CheckinNote') return note;
    return null;
  },
  querySelectorAll(selector) { return selector === '[data-v010-status]' ? buttons : []; },
  prepend(node) { domWrites += 1; indicator = node; },
};

const document = {
  hidden: false,
  documentElement: {},
  getElementById(id) { return id === 'sharedLiveV010' ? panel : null; },
  createElement() {
    return {
      id: '',
      className: '',
      hidden: false,
      innerHTML: '',
      title: '',
      setAttribute() { domWrites += 1; },
    };
  },
  addEventListener(name, handler) { listeners.set(`document:${name}`, handler); },
};

const window = {
  NVSSharedLive: { getState: () => liveState },
  addEventListener(name, handler) { listeners.set(`window:${name}`, handler); },
  dispatchEvent(event) { events.push(event); return true; },
};

class FakeDate extends Date { static now() { return now; } }
class FakeCustomEvent { constructor(type) { this.type = type; } }
class FakeMutationObserver {
  constructor(callback) { observerCallback = callback; }
  observe() { observerActive = true; }
  disconnect() { observerActive = false; }
}

vm.runInNewContext(source, {
  window,
  document,
  Date: FakeDate,
  CustomEvent: FakeCustomEvent,
  MutationObserver: FakeMutationObserver,
  Intl,
  Number,
  Math,
  setTimeout(callback) {
    const id = nextTimer++;
    scheduled.set(id, callback);
    return id;
  },
  clearTimeout(id) { scheduled.delete(id); },
});

const api = window.NVSSharedExpiry0111;
assert.ok(api, 'shared expiry API should initialize');
assert.equal(observerActive, true, 'visible document should own the bootstrap observer');
assert.ok(scheduled.size > 0, 'visible document should own the expiry timer');

const staleTimer = [...scheduled.values()][0];
document.hidden = true;
listeners.get('document:visibilitychange')?.();
assert.equal(observerActive, false, 'hiding the document should disconnect expiry DOM observation');
assert.equal(scheduled.size, 0, 'hiding the document should cancel the visible expiry timer');

const writesBeforeHiddenWork = domWrites;
now = 2_500;
liveState = { expiresAt: 2_000 };
api.refresh();
listeners.get('window:nvs-shared-live-change')?.();
observerCallback?.([], null);
staleTimer?.();
assert.equal(domWrites, writesBeforeHiddenWork,
  'direct refreshes, live events, stale observer callbacks, and stale timers must perform zero hidden DOM work');
assert.equal(events.filter((event) => event.type === 'nvs-shared-session-expired').length, 0,
  'authoritative expiry should not be announced while the document is hidden');
assert.ok(buttons.every((button) => button.disabled === false),
  'hidden expiry work must not mutate voluntary controls');

document.hidden = false;
listeners.get('document:visibilitychange')?.();
assert.equal(observerActive, true, 'visibility restore should reacquire bootstrap observation');
assert.equal(panel.classList.contains('v0111-session-expired'), true,
  'visibility restore should reconcile an expiry that elapsed while hidden');
assert.equal(events.filter((event) => event.type === 'nvs-shared-session-expired').length, 1,
  'restored visible ownership should announce authoritative expiry exactly once');
assert.ok(buttons.every((button) => button.disabled),
  'restored expired state must disable voluntary controls');

assert.match(source, /function documentOwned\(\)/);
assert.match(source, /observer\?\.disconnect\(\)/);
assert.doesNotMatch(source, /watchPosition\s*\(/,
  'hidden lifecycle hardening must not add continuous location tracking');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
  'authoritative expiry ownership must remain memory-only');

console.log('shared-expiry-hidden-ownership: hidden documents release timers/observers and reconcile expiry on restore');