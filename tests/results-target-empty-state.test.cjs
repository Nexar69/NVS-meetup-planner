const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('results-v052.js', 'utf8');

function node(overrides = {}) {
  return {
    innerHTML: '',
    textContent: '',
    classList: { add() {}, remove() {} },
    selectedOptions: [],
    requestSubmit() {},
    ...overrides,
  };
}

const nodes = {
  results: node({ innerHTML: '<article>old target recommendation</article>' }),
  summary: node({ innerHTML: '<strong>old summary</strong>' }),
  personA: node({ selectedOptions: [{ textContent: 'Weststadt <A>' }] }),
  personB: node({ selectedOptions: [{ textContent: 'Friend & B' }] }),
  destination: node({ selectedOptions: [{ textContent: 'Marienplatz > Mitte' }] }),
  versionLabel: node(),
  'results-title': node(),
  plannerForm: node(),
};

const recommendation = {
  primary: null,
  backup: null,
  mode: 'easy',
  timingMode: 'target',
  pairs: [],
};

const context = {
  console, Date, Intl, Number, String, Math, Object,
  CustomEvent: class CustomEvent {},
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
    dispatchEvent() {},
    __NVS_LAST_RECOMMENDATIONS__: { stale: true },
  },
};

vm.createContext(context);
vm.runInContext(source, context, { filename: 'results-v052.js' });

const target = new Date('2026-08-28T16:30:00+02:00');
const rendered = context.window.renderConnections([], [], target);
assert.strictEqual(rendered, true, 'target-time empty results should render an explicit terminal state');
assert.ok(nodes.results.innerHTML.includes('No connection found for this target time'), 'target-time search should render a truthful empty state');
assert.ok(nodes.results.innerHTML.includes('adjust the target time'), 'empty state should provide a useful recovery action');
assert.ok(!nodes.results.innerHTML.includes('old target recommendation'), 'previous recommendation cards must not survive an empty target search');
assert.strictEqual(context.window.__NVS_LAST_RECOMMENDATIONS__, null, 'downstream recommendation state must clear with the cards');
assert.ok(nodes.summary.innerHTML.includes('target <strong>16:30</strong> · no connection yet'), 'summary should preserve target-time semantics');
assert.ok(nodes.summary.innerHTML.includes('Weststadt &lt;A&gt;'), 'person label must remain HTML-escaped');
assert.ok(nodes.summary.innerHTML.includes('Friend &amp; B'), 'friend label must remain HTML-escaped');
assert.ok(nodes.summary.innerHTML.includes('Marienplatz &gt; Mitte'), 'destination label must remain HTML-escaped');

context.window.__NVS_LAST_RECOMMENDATIONS__ = { stale: true };
nodes.results.innerHTML = '<article>stale again</article>';
context.window.renderConnections([], [], new Date('invalid'));
assert.ok(nodes.summary.innerHTML.includes('target time unavailable · no connection yet'), 'invalid target metadata must not produce NaN/Invalid Date copy');
assert.strictEqual(context.window.__NVS_LAST_RECOMMENDATIONS__, null, 'invalid target empty state must still clear stale recommendation state');
assert.ok(!source.includes('watchPosition'), 'target empty-state rendering must not introduce continuous location tracking');

console.log('Target-time empty-state regression tests passed.');
