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

const nodes = {
  results: node({ innerHTML: '<article>stale result</article>' }),
  summary: node({ innerHTML: '<strong>old summary</strong>' }),
  personA: node({ selectedOptions: [{ textContent: 'Lankow <A>' }] }),
  personB: node({ selectedOptions: [{ textContent: 'Friend & B' }] }),
  destination: node({ selectedOptions: [{ textContent: 'Dreescher > Markt' }] }),
  versionLabel: node(),
  'results-title': node(),
  plannerForm: node(),
};

const recommendation = {
  primary: null,
  backup: null,
  mode: 'together',
  timingMode: 'asap',
  pairs: [],
};

const context = {
  console,
  Date,
  Intl,
  Number,
  String,
  Math,
  Object,
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

const rendered = context.window.renderConnections([], [], new Date('2026-08-28T10:00:00+02:00'));
assert.strictEqual(rendered, true, 'ASAP all-stale results should be handled as an explicit rendered state');
assert.ok(nodes.results.innerHTML.includes('No fresh ASAP connection found'), 'stale/loading result cards should be replaced with a truthful empty state');
assert.ok(nodes.results.innerHTML.includes('already arrived'), 'empty state should explain why stale provider journeys were rejected');
assert.ok(!nodes.results.innerHTML.includes('stale result'), 'previous recommendation cards must not linger after all ASAP candidates go stale');
assert.strictEqual(context.window.__NVS_LAST_RECOMMENDATIONS__, null, 'stale recommendation state must be cleared when no fresh ASAP pair exists');
assert.ok(nodes.summary.innerHTML.includes('<strong>ASAP</strong> · no fresh connection yet'), 'summary should remain in ASAP semantics instead of falling back to the hidden anchor time');
assert.ok(nodes.summary.innerHTML.includes('Lankow &lt;A&gt;'), 'summary labels must remain HTML-escaped');
assert.ok(nodes.summary.innerHTML.includes('Friend &amp; B'), 'friend label must remain HTML-escaped');
assert.ok(nodes.summary.innerHTML.includes('Dreescher &gt; Markt'), 'destination label must remain HTML-escaped');
assert.match(serviceWorker, /^const CACHE_NAME = "meet-schwerin-v0\.11\.1-r16";/, 'the installed PWA shell must advance to r16 with the cached ASAP renderer fix');
assert.ok(!source.includes('watchPosition'), 'ASAP empty-state rendering must not introduce continuous location tracking');

console.log('ASAP empty-state regression tests passed.');
