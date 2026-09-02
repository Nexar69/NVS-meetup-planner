const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../shared-expiry-v0111.js'), 'utf8');
const listeners = new Map();
const events = [];
let now = 1_000;
let liveState = { expiresAt: 2_000 };

function classList() {
  const values = new Set();
  return {
    toggle(name, force) {
      if (force === undefined ? !values.has(name) : force) values.add(name);
      else values.delete(name);
    },
    remove(...names) { names.forEach((name) => values.delete(name)); },
    contains(name) { return values.has(name); },
  };
}

const note = { textContent: '' };
const buttons = [{ disabled: false }, { disabled: false }];
let indicator = null;
const panel = {
  classList: classList(),
  querySelector(selector) {
    if (selector === '#v0111SharedExpiry') return indicator;
    if (selector === '#v010CheckinNote') return note;
    return null;
  },
  querySelectorAll(selector) {
    return selector === '[data-v010-status]' ? buttons : [];
  },
  prepend(node) { indicator = node; },
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
      setAttribute() {},
    };
  },
  addEventListener(name, handler) { listeners.set(`document:${name}`, handler); },
};

const window = {
  NVSSharedLive: { getState: () => liveState },
  addEventListener(name, handler) { listeners.set(`window:${name}`, handler); },
  dispatchEvent(event) { events.push(event); return true; },
};

class FakeDate extends Date {
  static now() { return now; }
}

class FakeCustomEvent {
  constructor(type) { this.type = type; }
}

class FakeMutationObserver {
  observe() {}
  disconnect() {}
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
  setTimeout() { return 1; },
  clearTimeout() {},
});

const api = window.NVSSharedExpiry0111;
assert.ok(api, 'shared expiry API should initialize');
assert.equal(panel.classList.contains('v0111-session-expired'), false,
  'an unexpired session should begin writable-looking');

now = 2_500;
api.refresh();
assert.equal(panel.classList.contains('v0111-session-expired'), true,
  'crossing the authoritative deadline should latch expired UI');
assert.equal(events.filter((event) => event.type === 'nvs-shared-session-expired').length, 1,
  'authoritative expiry should be announced exactly once');
assert.ok(buttons.every((button) => button.disabled),
  'voluntary status controls must be disabled after expiry');
assert.match(note.textContent, /expired/i);
assert.match(indicator.innerHTML, /Shared session expired/);

now = 3_000;
liveState = { expiresAt: 50_000 };
listeners.get('window:nvs-shared-live-change')?.();
assert.equal(panel.classList.contains('v0111-session-expired'), true,
  'a later read-only refresh with a future-looking expiresAt must not revive writable-looking UI');
assert.equal(panel.classList.contains('v0111-session-expiring'), false,
  'sticky expiry must not regress into an expiring-soon state');
assert.match(indicator.innerHTML, /Shared session expired/,
  'the visible and accessible expiry indicator must remain authoritative');
assert.equal(events.filter((event) => event.type === 'nvs-shared-session-expired').length, 1,
  'later refreshes must not emit duplicate expiry announcements');

liveState = null;
api.refresh();
assert.equal(panel.classList.contains('v0111-session-expired'), true,
  'temporary loss of Shared Live state must not clear an already-authoritative expiry latch');
assert.match(indicator.innerHTML, /Shared session expired/);

assert.doesNotMatch(source, /watchPosition\s*\(/,
  'expiry UI hardening must not add continuous or hidden location tracking');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
  'the authoritative UI latch must remain memory-only');

console.log('shared-expiry-sticky-ui: authoritative expiry remains visually and accessibly read-only across later refreshes');
