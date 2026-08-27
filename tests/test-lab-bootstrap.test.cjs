const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('config.js', 'utf8');

function runCase({ search, readyState }) {
  const writes = [];
  const appended = [];
  const windowListeners = new Map();
  const documentListeners = new Map();

  const window = {
    location: {
      search,
      href: `https://nexar69.github.io/NVS-meetup-planner/${search}`,
      origin: 'https://nexar69.github.io',
    },
    addEventListener(type, fn) { windowListeners.set(type, fn); },
  };

  function makeNode(tagName) {
    const listeners = new Map();
    return {
      tagName: String(tagName).toUpperCase(),
      dataset: {},
      addEventListener(type, fn) { listeners.set(type, fn); },
      dispatch(type) { listeners.get(type)?.(); },
    };
  }

  const document = {
    readyState,
    hidden: false,
    head: { appendChild(node) { appended.push(node); } },
    body: {
      appendChild(node) {
        appended.push(node);
        if (node.src === './test-lab-v0111.js') {
          window.NVSTestLab = { active: true };
          node.dispatch?.('load');
        }
      },
    },
    documentElement: { dataset: {} },
    querySelector() { return null; },
    createElement: makeNode,
    addEventListener(type, fn) { documentListeners.set(type, fn); },
    write(html) {
      writes.push(html);
      if (html.includes('test-lab-v0111.js')) window.NVSTestLab = { active: true };
    },
  };

  const context = vm.createContext({
    window,
    document,
    URL,
    URLSearchParams,
    Set,
    WeakMap,
    Object,
    String,
    Boolean,
    Number,
    Math,
    Date,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console,
  });

  vm.runInContext(source, context, { filename: 'config.js' });
  return { window, document, writes, appended };
}

const loading = runCase({ search: '?test=1', readyState: 'loading' });
const coreWrite = loading.writes.findIndex((entry) => entry.includes('test-lab-v0111.js'));
const journeyWrite = loading.writes.findIndex((entry) => entry.includes('test-lab-journey-v0111.js'));
assert(coreWrite >= 0, 'loading bootstrap must inject Test Lab core');
assert(journeyWrite > coreWrite, 'journey simulator must load after Test Lab core during parser bootstrap');

const dynamic = runCase({ search: '?test=true', readyState: 'complete' });
const coreIndex = dynamic.appended.findIndex((node) => node.src === './test-lab-v0111.js');
const journeyIndex = dynamic.appended.findIndex((node) => node.src === './test-lab-journey-v0111.js');
assert(coreIndex >= 0, 'dynamic bootstrap must append Test Lab core');
assert(journeyIndex > coreIndex, 'dynamic journey simulator must wait for the Test Lab core load event');

const inactive = runCase({ search: '', readyState: 'loading' });
assert.equal(inactive.writes.length, 0, 'normal mode must not inject any Test Lab assets');
assert.equal(inactive.appended.length, 0, 'normal mode must not append any Test Lab assets');

assert(source.includes('data-test-lab-journey-v0111'), 'bootstrap should tag the journey simulator for duplicate prevention');
assert(!/localStorage|sessionStorage/.test(source), 'Test Lab bootstrap must not add persistent simulation state');
assert(!/getCurrentPosition|watchPosition|geolocation/.test(source), 'Test Lab bootstrap must not add location access');

console.log('Test Lab bootstrap tests passed.');
