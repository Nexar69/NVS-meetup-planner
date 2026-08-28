const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('results-v052.js', 'utf8');
const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');

function node(overrides = {}) {
  return {
    innerHTML: '',
    textContent: '',
    classList: {
      add() {},
      remove() {},
    },
    selectedOptions: [],
    requestSubmit() {},
    ...overrides,
  };
}

let tripCloseCount = 0;
const dispatched = [];
const nodes = {
  results: node({ innerHTML: '<article>stale result</article>' }),
  summary: node({ innerHTML: '<strong>old summary</strong>' }),
  personA: node({ selectedOptions: [{ textContent: 'Lankow <A>' }] }),
  personB: node({ selectedOptions: [{ textContent: 'Friend & B' }] }),
  destination: node({ selectedOptions: [{ textContent: 'Dreescher > Markt' }] }),
  versionLabel: node(),
  'results-title': node(),
  plannerForm: node(),
  v011TripDialog: node({ open: true, close() { this.open = false; tripCloseCount += 1; } }),
};

const recommendation = {
  primary: null,
  backup: null,
  mode: 'together',
  timingMode: 'asap',
  pairs: [],
};

class CustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}

const context = {
  console,
  Date,
  Intl,
  Number,
  String,
  Math,
  Object,
  CustomEvent,
  setTimeout(callback) { callback(); return 1; },
  document: {
    getElementById(id) { return nodes[id] || null; },
    querySelector() { return null; },
  },
  window: {
    NVSRecommend: {
      recommend() { return recommendation; },
      explain() { return ''; },
    },
    dispatchEvent(event) { dispatched.push(event); },
    __NVS_LAST_RECOMMENDATIONS__: { stale: true },
  },
};

vm.createContext(context);
vm.runInContext(source, context, { filename: 'results-v052.js' });

const rendered = context.window.renderConnections([], [], new Date('2026-08-28T10:00:00+02:00'));
assert.strictEqual(rendered, true, 'ASAP all-stale results should be handled as an explicit rendered state');
assert.ok(nodes.results.innerHTML.includes('No fresh ASAP connection found'), 'stale/loading result cards should be replaced with a truthful empty state');
assert.ok(nodes.results.innerHTML.includes('already arrived'), 'empty state should explain why stale provider journeys were rejected');
assert.ok(!nodes.results.innerHTML.includes('stale result'), 'previous recommendation cards must not linger after all ASAP candidates go stale');
assert.strictEqual(context.window.__NVS_LAST_RECOMMENDATIONS__, null, 'stale recommendation state must be cleared when no fresh ASAP pair exists');
assert.strictEqual(tripCloseCount, 1, 'an open Trip Mode dialog must close when its backing recommendation disappears');
assert.strictEqual(nodes.v011TripDialog.open, false, 'Trip Mode must not remain visibly backed by a stale journey');
assert.ok(dispatched.some((event) => event.type === 'nvs-recommendations-cleared' && event.detail?.timingMode === 'asap'), 'downstream surfaces should receive an explicit recommendation-cleared lifecycle event');
assert.ok(nodes.summary.innerHTML.includes('<strong>ASAP</strong> · no fresh connection yet'), 'summary should remain in ASAP semantics instead of falling back to the hidden anchor time');
assert.ok(nodes.summary.innerHTML.includes('Lankow &lt;A&gt;'), 'summary labels must remain HTML-escaped');
assert.ok(nodes.summary.innerHTML.includes('Friend &amp; B'), 'friend label must remain HTML-escaped');
assert.ok(nodes.summary.innerHTML.includes('Dreescher &gt; Markt'), 'destination label must remain HTML-escaped');
assert.match(serviceWorker, /^const CACHE_NAME = "meet-schwerin-v0\.11\.1-r17";/, 'runtime-only empty-state cleanup should retain the validated r17 shell identity');
assert.ok(!source.includes('watchPosition'), 'ASAP empty-state rendering must not introduce continuous location tracking');

console.log('ASAP empty-state regression tests passed.');
