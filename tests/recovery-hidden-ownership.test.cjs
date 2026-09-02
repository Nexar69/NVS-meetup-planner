const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../recovery-v0111.js"), "utf8");
const windowListeners = new Map();
const documentListeners = new Map();
const elements = new Map();
const timers = new Map();
let nextTimer = 1;
let domMutations = 0;
let reloads = 0;
let currentAlerts = [{ id: "transfer-missed:0", kind: "recovery", title: "Connection missed", detail: "Replan now", replan: true }];

function on(registry, name, fn) {
  if (!registry.has(name)) registry.set(name, []);
  registry.get(name).push(fn);
}
function emit(registry, name, event = {}) {
  for (const fn of registry.get(name) || []) fn(event);
}
function tracked(value) {
  let current = value;
  return {
    get() { return current; },
    set(next) { if (next !== current) domMutations += 1; current = next; },
  };
}
function makeElement(tag) {
  const hidden = tracked(false);
  const textContent = tracked("");
  const disabled = tracked(false);
  const listeners = new Map();
  const element = {
    tagName: String(tag).toUpperCase(),
    id: "",
    className: "",
    innerHTML: "",
    classList: { toggle() { domMutations += 1; } },
    setAttribute() { domMutations += 1; },
    addEventListener(name, fn) { on(listeners, name, fn); },
    querySelector(selector) { return selector.startsWith("#") ? elements.get(selector.slice(1)) || null : null; },
    insertAdjacentElement(_where, child) { return main.appendChild(child); },
  };
  Object.defineProperty(element, "hidden", hidden);
  Object.defineProperty(element, "textContent", textContent);
  Object.defineProperty(element, "disabled", disabled);
  return element;
}

for (const id of ["v0111RecoveryScope", "v0111RecoveryTitle", "v0111RecoveryDetail", "v0111RecoveryAction", "v0111RecoveryPrivacy", "v0111RecoveryLater"]) {
  const child = makeElement(id.includes("Action") || id.includes("Later") ? "button" : "span");
  child.id = id;
  elements.set(id, child);
}
const main = makeElement("main");
main.appendChild = (child) => {
  if (child.id) elements.set(child.id, child);
  domMutations += 1;
  return child;
};

const document = {
  hidden: true,
  getElementById(id) { return elements.get(id) || null; },
  createElement: makeElement,
  querySelector(selector) { return selector === "main.app" ? main : null; },
  addEventListener(name, fn) { on(documentListeners, name, fn); },
};
const window = {
  __NVS_LAST_RECOMMENDATIONS__: { primary: { assignments: [] } },
  NVSIntelligence: { getAlerts: () => currentAlerts, replan() {} },
  NVSShare: { isViewer: () => false, getFocusIndex: () => -1 },
  NVSSharedLive: { hasPendingPlanUpdate: () => false },
  location: { href: "https://example.test/", reload() { reloads += 1; }, assign() { reloads += 1; } },
  addEventListener(name, fn) { on(windowListeners, name, fn); },
};
const context = {
  window,
  document,
  navigator: { onLine: true },
  console,
  setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
  clearTimeout(id) { timers.delete(id); },
};
vm.runInNewContext(source, context, { filename: "recovery-v0111.js" });

assert.equal(elements.has("v0111RecoveryDesk"), false, "hidden cold start must not create Recovery Desk DOM");
assert.equal(timers.size, 0, "hidden cold start must not schedule Recovery Desk work");
assert.equal(window.NVSRecovery0111.reloadPendingPlan(), false, "hidden direct reload must fail closed");
assert.equal(reloads, 0, "hidden direct reload must not navigate");

document.hidden = false;
emit(documentListeners, "visibilitychange");
assert.equal(elements.has("v0111RecoveryDesk"), true, "visible restore should reconcile and create Recovery Desk");
assert.equal(timers.size, 1, "visible active recovery should own one periodic timer");
const staleTimer = [...timers.values()][0];

document.hidden = true;
emit(documentListeners, "visibilitychange");
assert.equal(timers.size, 0, "hiding must cancel Recovery Desk periodic work");
const beforeHidden = domMutations;
staleTimer();
window.NVSRecovery0111.refresh();
emit(windowListeners, "nvs-shared-live-change");
emit(windowListeners, "nvs-routing-provider");
emit(windowListeners, "offline");
assert.equal(domMutations, beforeHidden, "stale timers, direct refreshes, and routine events must be DOM-inert while hidden");
assert.equal(timers.size, 0, "hidden stale work must not rearm periodic polling");

window.__NVS_LAST_RECOMMENDATIONS__ = null;
currentAlerts = [];
emit(windowListeners, "nvs-recommendations-cleared");
assert.equal(domMutations, beforeHidden, "authoritative hidden clear may update memory but must not repaint");

document.hidden = false;
emit(documentListeners, "visibilitychange");
assert.equal(elements.get("v0111RecoveryDesk").hidden, true, "visible restore should reconcile the authoritative hidden clear");
assert.equal(timers.size, 0, "cleared recommendation ownership must not restart polling after restore");

assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, "Recovery lifecycle ownership must remain memory-only");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "Recovery lifecycle ownership must not add location tracking");
console.log("recovery-hidden-ownership: hidden work is inert and current state reconciles on foreground restore");
