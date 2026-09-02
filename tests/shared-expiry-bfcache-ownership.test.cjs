const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../shared-expiry-v0111.js'), 'utf8');
const listeners = new Map();
const events = [];
let now = 1_000;
let liveState = { expiresAt: 2_000 };
let observerActive = false;
let scheduled = 0;

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
  prepend(node) { indicator = node; },
};

const document = {
  hidden: false,
  documentElement: {},
  getElementById(id) { return id === 'sharedLiveV010' ? panel : null; },
  createElement() {
    return { id: '', className: '', hidden: false, innerHTML: '', title: '', setAttribute() {} };
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
  constructor(callback) { this.callback = callback; }
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
  setTimeout() { scheduled += 1; return scheduled; },
  clearTimeout() {},
});

const api = window.NVSSharedExpiry0111;
assert.ok(api, 'shared expiry API should initialize');
assert.equal(observerActive, true, 'expiry observer should own the live document initially');
assert.equal(panel.classList.contains('v0111-session-expired'), false);

listeners.get('window:pagehide')?.({ persisted: true });
assert.equal(observerActive, false, 'pagehide should disconnect DOM observation while the document is frozen');

now = 2_500;
liveState = { expiresAt: 2_000 };
listeners.get('window:nvs-shared-live-change')?.();
api.refresh();
assert.equal(panel.classList.contains('v0111-session-expired'), false,
  'late live events and direct refreshes must not repaint a frozen bfcache document');
assert.equal(events.filter((event) => event.type === 'nvs-shared-session-expired').length, 0,
  'expiry announcement should wait for restored document ownership');
assert.ok(buttons.every((button) => button.disabled === false),
  'frozen-page work must not mutate voluntary controls');

listeners.get('window:pageshow')?.({ persisted: true });
assert.equal(observerActive, true, 'pageshow should restore observer ownership');
assert.equal(panel.classList.contains('v0111-session-expired'), true,
  'restore should reconcile the authoritative deadline immediately');
assert.equal(events.filter((event) => event.type === 'nvs-shared-session-expired').length, 1,
  'restored ownership should announce authoritative expiry exactly once');
assert.ok(buttons.every((button) => button.disabled),
  'restored expired state must disable voluntary controls');

assert.match(source, /pagehide/);
assert.match(source, /lifecycleFrozen/);
assert.doesNotMatch(source, /watchPosition\s*\(/,
  'lifecycle hardening must not add continuous or hidden location tracking');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
  'the authoritative expiry latch must remain memory-only');

console.log('shared-expiry-bfcache-ownership: frozen documents stay inert and expiry reconciles on restore');
