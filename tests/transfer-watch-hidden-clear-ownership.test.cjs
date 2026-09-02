const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../transfer-watch-v0111.js"), "utf8");
const windowListeners = new Map();
const documentListeners = new Map();
const elements = new Map();
let domMutations = 0;
let nextTimer = 1;
const timers = new Map();

function on(registry, name, fn) {
  if (!registry.has(name)) registry.set(name, []);
  registry.get(name).push(fn);
}
function emit(registry, name, event = {}) {
  for (const fn of registry.get(name) || []) fn(event);
}

function makeElement(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    id: "",
    className: "",
    dataset: {},
    parentElement: null,
    innerHTML: "",
    setAttribute() {},
    querySelector() { return null; },
    appendChild(child) {
      child.parentElement = this;
      if (child.id) elements.set(child.id, child);
      domMutations += 1;
      return child;
    },
    insertAdjacentElement(_where, child) { return this.appendChild(child); },
    remove() {
      if (this.id) elements.delete(this.id);
      domMutations += 1;
    },
  };
}

const personal = makeElement("section");
personal.id = "personalSharedPlan";
elements.set(personal.id, personal);

const document = {
  hidden: false,
  getElementById(id) { return elements.get(id) || null; },
  createElement: makeElement,
  addEventListener(name, fn) { on(documentListeners, name, fn); },
};

const now = Date.now();
const route = {
  segments: [
    { mode: "BUS", line: "1", to: "Marienplatz", arrival: new Date(now + 5 * 60_000).toISOString() },
    { mode: "TRAM", line: "2", from: "Marienplatz", departure: new Date(now + 8 * 60_000).toISOString() },
  ],
};
const window = {
  __NVS_LAST_RECOMMENDATIONS__: { primary: { assignments: [{ route }] } },
  NVSShare: { getFocusIndex: () => 0 },
  NVSSharedLive: { getState: () => ({ members: {} }) },
  addEventListener(name, fn) { on(windowListeners, name, fn); },
};

const context = {
  window,
  document,
  Date,
  Intl,
  console,
  setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
  clearTimeout(id) { timers.delete(id); },
};
vm.runInNewContext(source, context, { filename: "transfer-watch-v0111.js" });

assert.ok(elements.has("v0111TransferWatch"), "visible startup should render an eligible Transfer Watch card");
assert.ok(timers.size > 0, "visible startup should own periodic refresh work");

document.hidden = true;
emit(documentListeners, "visibilitychange");
assert.equal(timers.size, 0, "hiding should cancel periodic Transfer Watch work");
const beforeHiddenClear = domMutations;
emit(windowListeners, "nvs-recommendations-cleared");
assert.equal(domMutations, beforeHiddenClear, "authoritative recommendation clear must not mutate the hidden DOM");
assert.ok(elements.has("v0111TransferWatch"), "the stale card may remain physically present only while the document is hidden");
assert.equal(timers.size, 0, "hidden clear must not restart periodic work");

document.hidden = false;
emit(documentListeners, "visibilitychange");
assert.equal(elements.has("v0111TransferWatch"), false, "visible restoration should reconcile the hidden authoritative clear and remove stale guidance");
assert.equal(timers.size, 0, "cleared recommendation ownership must stay inactive after restore");

assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, "hidden ownership must remain memory-only");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "hidden ownership must not add location tracking");

console.log("transfer-watch-hidden-clear-ownership: hidden authoritative clear is DOM-inert and reconciles on visible restore");
