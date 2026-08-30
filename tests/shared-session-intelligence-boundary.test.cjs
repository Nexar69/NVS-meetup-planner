const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('shared-live-freshness-v0111.js', 'utf8');

let pending = false;
let expiresAt = Date.now() - 1_000;
let observerInstance = null;
const elements = new Map();
const listeners = new Map();

function makeElement(id) {
  const attributes = new Map();
  return {
    id,
    hidden: false,
    dataset: {},
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name) ?? null; },
  };
}

for (const id of [
  'v0111TripGuidance',
  'v0111StopAwareness',
  'v0111TransferWatch',
  'v0111MeetupRadar',
  'v0111WhatIf',
]) elements.set(id, makeElement(id));

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.observing = false;
    observerInstance = this;
  }
  observe() { this.observing = true; }
  disconnect() { this.observing = false; }
  trigger() { this.callback([]); }
}

const documentElement = { dataset: {} };
const document = {
  hidden: false,
  body: {},
  documentElement,
  getElementById(id) { return elements.get(id) || null; },
  addEventListener() {},
};

const window = {
  NVSSharedLive: {
    hasPendingPlanUpdate: () => pending,
    getState: () => ({ expiresAt, members: {} }),
  },
  addEventListener(name, fn) { listeners.set(name, fn); },
  MutationObserver: FakeMutationObserver,
};

const context = {
  window,
  document,
  MutationObserver: FakeMutationObserver,
  Date,
  Number,
  Boolean,
  Object,
  Math,
  Infinity,
  setTimeout: () => 1,
  clearTimeout: () => {},
};

vm.runInNewContext(source, context, { filename: 'shared-live-freshness-v0111.js' });
const api = window.NVSSharedLiveFreshness0111;
assert.ok(api, 'freshness guard should expose its API');
assert.equal(api.hasPendingPlanUpdate(), false, 'expiry guard must work independently from plan revisions');
assert.equal(api.authoritativeExpiresAt(), expiresAt);
assert.equal(api.sharedSessionExpired(), true);
assert.equal(api.routeIntelligenceBlocked(), true);

for (const [id, element] of elements) {
  assert.equal(element.hidden, true, `${id} must be hidden after authoritative shared-session expiry`);
  assert.equal(element.dataset.nvsPlanTrustHidden, 'true', `${id} should record central trust-boundary ownership`);
  assert.equal(element.getAttribute('aria-hidden'), 'true', `${id} should leave the accessibility tree after expiry`);
}
assert.equal(documentElement.dataset.nvsSharedSessionExpired, 'true');
assert.equal(documentElement.dataset.nvsPlanUpdatePending, undefined);
assert.ok(observerInstance?.observing, 'expired-session guard should watch for late stale intelligence inserts');

const late = makeElement('v0111TransferWatch');
elements.set('v0111TransferWatch', late);
observerInstance.trigger();
assert.equal(late.hidden, true, 'late route intelligence must remain suppressed after expiry');
assert.equal(late.getAttribute('aria-hidden'), 'true');

listeners.get('pagehide')?.();
assert.equal(observerInstance.observing, false, 'pagehide must suspend the trust observer for bfcache freezing');
listeners.get('pageshow')?.({ persisted: true });
assert.equal(observerInstance.observing, true, 'bfcache restore of an expired session must re-arm stale-intelligence suppression');
assert.equal(late.hidden, true, 'bfcache restore must not revive route advice from an expired shared session');

expiresAt = Date.now() + 60_000;
listeners.get('nvs-shared-live-change')?.();
assert.equal(api.sharedSessionExpired(), false, 'fresh authoritative state may clear a previously expired fixture');
assert.equal(api.routeIntelligenceBlocked(), false);
for (const [id, element] of elements) {
  assert.equal(element.hidden, false, `${id} may return only after authoritative state is non-expired and no revision is pending`);
  assert.equal(element.dataset.nvsPlanTrustHidden, undefined);
  assert.equal(element.getAttribute('aria-hidden'), null);
}
assert.equal(documentElement.dataset.nvsSharedSessionExpired, undefined);
assert.equal(observerInstance.observing, false, 'trust observer should stop once route intelligence is authoritative again');

pending = true;
listeners.get('nvs-shared-live-change')?.();
assert.equal(api.routeIntelligenceBlocked(), true, 'pending plan revision must still block route intelligence independently');
assert.equal(elements.get('v0111TripGuidance').hidden, true);
assert.equal(documentElement.dataset.nvsPlanUpdatePending, 'true');

pending = false;
expiresAt = Date.now() - 1;
listeners.get('nvs-shared-session-expired')?.();
assert.equal(elements.get('v0111TripGuidance').hidden, true, 'explicit expiry event must immediately enforce the boundary');
assert.equal(documentElement.dataset.nvsSharedSessionExpired, 'true');

assert.doesNotMatch(source, /watchPosition\s*\(/, 'shared-session trust boundary must not add continuous GPS tracking');
assert.doesNotMatch(source, /getCurrentPosition\s*\(/, 'shared-session trust boundary does not need location access');
assert.doesNotMatch(source, /localStorage\b|indexedDB\b/i, 'shared-session trust boundary must not add durable personal state');

console.log('shared session expiry intelligence boundary regression passed');
