const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('shared-live-freshness-v0111.js', 'utf8');

let pending = true;
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
    getState: () => null,
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
assert.equal(api.hasPendingPlanUpdate(), true);

for (const [id, element] of elements) {
  assert.equal(element.hidden, true, `${id} must be hidden while a newer shared plan is pending`);
  assert.equal(element.dataset.nvsPlanTrustHidden, 'true', `${id} should record trust-boundary ownership`);
  assert.equal(element.getAttribute('aria-hidden'), 'true', `${id} should be hidden from assistive technology too`);
}
assert.equal(documentElement.dataset.nvsPlanUpdatePending, 'true');
assert.ok(observerInstance?.observing, 'pending-plan guard should watch for late stale intelligence inserts');

const late = makeElement('v0111TripGuidance');
elements.set('v0111TripGuidance', late);
const lateWhatIf = makeElement('v0111WhatIf');
elements.set('v0111WhatIf', lateWhatIf);
observerInstance.trigger();
assert.equal(late.hidden, true, 'late stale route guidance must be suppressed immediately');
assert.equal(late.dataset.nvsPlanTrustHidden, 'true');
assert.equal(lateWhatIf.hidden, true, 'late What-if previews derived from the superseded route must also stay suppressed');
assert.equal(lateWhatIf.dataset.nvsPlanTrustHidden, 'true');

listeners.get('pagehide')?.();
assert.equal(observerInstance.observing, false, 'pagehide must suspend the trust observer for Safari/bfcache freezing');

listeners.get('pageshow')?.({ persisted: true });
assert.equal(observerInstance.observing, true, 'restoring while a plan update is still pending must resume stale-intelligence suppression');
assert.equal(lateWhatIf.hidden, true, 'bfcache restore must not revive a stale What-if preview');

pending = false;
listeners.get('online')?.();
for (const [id, element] of elements) {
  assert.equal(element.hidden, false, `${id} should be restored only after the pending-plan boundary clears`);
  assert.equal(element.dataset.nvsPlanTrustHidden, undefined, `${id} trust-boundary marker should be removed after recovery`);
  assert.equal(element.getAttribute('aria-hidden'), null, `${id} should return to the accessibility tree after recovery`);
}
assert.equal(documentElement.dataset.nvsPlanUpdatePending, undefined);
assert.equal(observerInstance.observing, false, 'clearing the pending revision should stop watching for stale inserts');

pending = true;
listeners.get('online')?.();
assert.equal(lateWhatIf.hidden, true, 'offline/online oscillation must re-apply the trust boundary if the newer plan is still pending');
assert.equal(observerInstance.observing, true, 'pending-plan observer should resume after reconnect');

pending = false;
listeners.get('nvs-live-plan-synced')?.();
assert.equal(lateWhatIf.hidden, false, 'a genuinely synchronized replacement plan may restore What-if previews');
assert.equal(observerInstance.observing, false);

const unrelated = makeElement('unrelatedCard');
unrelated.hidden = true;
unrelated.dataset.nvsPlanTrustHidden = 'true';
elements.set('unrelatedCard', unrelated);
api.applyPlanTrustBoundary();
assert.equal(unrelated.hidden, true, 'guard must not alter unrelated UI');

assert.doesNotMatch(source, /watchPosition\s*\(/, 'plan trust boundary must not add continuous GPS tracking');
assert.doesNotMatch(source, /getCurrentPosition\s*\(/, 'plan trust boundary does not need location access');
assert.doesNotMatch(source, /localStorage\b|indexedDB\b/i, 'plan trust boundary must not add durable personal state');

console.log('shared pending-plan intelligence boundary regression passed');