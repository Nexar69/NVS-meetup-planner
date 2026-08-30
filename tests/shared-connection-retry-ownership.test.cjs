'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('shared-connection-v0111.js', 'utf8');
const listeners = new Map();
const elements = new Map();
const timers = new Map();
let nextTimer = 1;
let hidden = false;
let online = true;
const refreshes = [];

function element(id = '') {
  const handlers = new Map();
  const node = {
    id,
    dataset: {},
    textContent: '',
    title: '',
    hidden: false,
    disabled: false,
    className: '',
    parentElement: null,
    setAttribute(name, value) { this[name] = value; },
    addEventListener(name, fn) { handlers.set(name, fn); },
    insertAdjacentElement(_where, child) { child.parentElement = this.parentElement; elements.set(child.id, child); },
  };
  if (id) elements.set(id, node);
  return node;
}

const sync = element('v010Sync');
sync.parentElement = { appendChild(child) { elements.set(child.id, child); } };
const window = {
  NVSSharedLive: {
    refresh() {
      return new Promise((resolve, reject) => refreshes.push({ resolve, reject }));
    },
  },
  addEventListener(name, fn) { listeners.set(name, fn); },
};
const document = {
  get hidden() { return hidden; },
  addEventListener(name, fn) { listeners.set(`document:${name}`, fn); },
  getElementById(id) { return elements.get(id) || null; },
  createElement() { return element(); },
};
const navigator = {};
Object.defineProperty(navigator, 'onLine', { get: () => online });

vm.runInNewContext(source, {
  window,
  document,
  navigator,
  Date,
  Math,
  Number,
  String,
  Boolean,
  Object,
  setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, { fn, delay }); return id; },
  clearTimeout(id) { timers.delete(id); },
});

async function run() {
  const api = window.NVSSharedConnection0111;
  const retry = elements.get('v0111SharedConnectionRetry');
  assert.ok(api && retry, 'connection runtime should expose its manual recovery control');

  api.markSuccess(Date.now() - 31_000);
  const first = api.retryNow();
  await Promise.resolve();
  assert.equal(refreshes.length, 1);
  assert.equal(retry.textContent, 'Checking…');

  listeners.get('pagehide')();
  assert.equal(retry.disabled, true, 'pagehide may leave frozen DOM untouched until restore');

  listeners.get('pageshow')();
  const second = api.retryNow();
  await Promise.resolve();
  assert.equal(refreshes.length, 2, 'a restored page must be able to own a fresh explicit retry');
  assert.equal(retry.textContent, 'Checking…');

  const successAt = Date.now();
  api.markSuccess(successAt);
  refreshes[1].resolve();
  assert.equal(await second, true, 'the restored retry should accept its own fresh acknowledgement');
  assert.equal(api.getRetryCooldownUntil(), 0);
  assert.equal(retry.hidden, true, 'confirmed recovery should return to the healthy state');

  refreshes[0].resolve();
  assert.equal(await first, false, 'the pre-pagehide completion must remain superseded');
  assert.equal(api.getRetryCooldownUntil(), 0, 'a stale completion must not impose a cooldown over newer success');
  assert.equal(api.getLastSuccessAt(), successAt, 'stale retry completion must not roll back acknowledged state');

  api.markSuccess(Date.now() - 31_000);
  const hiddenAttempt = api.retryNow();
  await Promise.resolve();
  assert.equal(refreshes.length, 3);
  hidden = true;
  listeners.get('document:visibilitychange')();
  refreshes[2].resolve();
  assert.equal(await hiddenAttempt, false, 'a retry completed after the page became hidden must be ignored');
  assert.equal(api.getRetryCooldownUntil(), 0, 'background cancellation must not punish the user with a retry cooldown');

  hidden = false;
  listeners.get('document:visibilitychange')();
  assert.notEqual(retry.textContent, 'Checking…', 'restoring the page must not retain stale checking UI');

  assert.match(source, /retryGeneration/, 'manual recovery should use generation ownership');
  assert.match(source, /pagehide/, 'Safari\/bfcache pagehide must invalidate manual retry ownership');
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|sendBeacon/, 'connection recovery must keep using the existing Shared Live network path');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/, 'connection recovery must remain memory-only');
  assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, 'connection recovery must not add location tracking');

  console.log('shared-connection retry lifecycle ownership passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
