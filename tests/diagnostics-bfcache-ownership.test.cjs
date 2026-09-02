const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../diagnostics-v0111.js'), 'utf8');
const windowListeners = new Map();
let inserted = 0;
let clipboardResolve;
const clipboardPromise = new Promise((resolve) => { clipboardResolve = resolve; });
const status = { textContent: '' };
const button = { addEventListener() {} };
const panel = {
  id: '', className: '', innerHTML: '',
  querySelector(selector) {
    if (selector === '#v0111DiagnosticsStatus') return status;
    if (selector === '#v0111CopyDiagnostics') return button;
    return null;
  },
};
const health = { insertAdjacentElement(_where, element) { inserted += 1; document.panel = element; } };
const document = {
  panel: null,
  documentElement: { dataset: { nvsRelease: 'test' } },
  body: { appendChild() {} },
  getElementById(id) {
    if (id === 'v0111DiagnosticsExport') return this.panel;
    if (id === 'v0111ProviderHealth') return health;
    if (id === 'versionLabel') return { textContent: 'v0.11.1' };
    return null;
  },
  createElement(tag) {
    if (tag === 'details') return panel;
    return { style: {}, setAttribute() {}, select() {}, setSelectionRange() {}, remove() {} };
  },
  execCommand() { return true; },
};
const window = {
  addEventListener(name, handler) { windowListeners.set(name, handler); },
  NVSShare: { getFocusIndex: () => -1, getSharedPlan: () => null },
  matchMedia: () => ({ matches: false }),
};
const navigator = {
  onLine: true,
  clipboard: { writeText: () => clipboardPromise },
  serviceWorker: {},
};

vm.runInNewContext(source, { window, document, navigator, Date, Number, Array, Math, Object, String, Boolean, JSON });
const api = window.NVSDiagnostics0111;
assert.equal(inserted, 1, 'diagnostics panel should initialize while document owns the DOM');

const pendingCopy = api.copyDiagnostics();
windowListeners.get('pagehide')?.({ persisted: true });
windowListeners.get('nvs-shared-live-change')?.();
api.refresh();
assert.equal(inserted, 1, 'late refresh events must not create or replace diagnostics UI while frozen');

clipboardResolve();
pendingCopy.then((result) => {
  assert.equal(result, false, 'late clipboard completion should lose ownership after pagehide');
  assert.equal(status.textContent, '', 'late clipboard completion must not announce into frozen DOM');
  windowListeners.get('pageshow')?.({ persisted: true });
  assert.equal(inserted, 1, 'restore should reuse the existing diagnostics panel');

  assert.match(source, /let lifecycleFrozen = false/);
  assert.match(source, /let copyGeneration = 0/);
  assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
    'diagnostics lifecycle hardening must not add location access');
  assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(|XMLHttpRequest/i,
    'diagnostics must remain storage- and network-free');
  console.log('diagnostics-bfcache-ownership: frozen refresh/copy completions stay inert');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
