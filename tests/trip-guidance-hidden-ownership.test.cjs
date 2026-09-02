const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../trip-guidance-v0111.js"), "utf8");

const windowHandlers = new Map();
const documentHandlers = new Map();
let observerCallback = null;
let observerDisconnects = 0;
let nextTimerId = 1;
const timers = new Map();
const clearedTimers = [];
let card = null;
let cardWrites = 0;

const now = Date.now();
const assignment = {
  route: {
    segments: [{
      mode: "BUS",
      modeLabel: "Bus",
      line: "1",
      from: "Marienplatz",
      to: "Central Station",
      departure: new Date(now + 5 * 60_000).toISOString(),
      arrival: new Date(now + 20 * 60_000).toISOString(),
    }],
  },
};

const sharedPanel = {};
const personalPlan = {
  nextElementSibling: sharedPanel,
  querySelector() { return null; },
  appendChild(node) { card = node; },
  insertAdjacentElement() { throw new Error("shared panel is already positioned in this fixture"); },
};
const resultsRoot = {};

function makeCard() {
  let html = "";
  return {
    id: "",
    className: "",
    childElementCount: 0,
    setAttribute() {},
    remove() { card = null; },
    set innerHTML(value) {
      html = String(value);
      this.childElementCount = 1;
      cardWrites += 1;
    },
    get innerHTML() { return html; },
  };
}

const document = {
  hidden: false,
  getElementById(id) {
    if (id === "personalSharedPlan") return personalPlan;
    if (id === "sharedLiveV010") return sharedPanel;
    if (id === "results") return resultsRoot;
    if (id === "v0111TripGuidance") return card;
    return null;
  },
  createElement(tag) {
    assert.equal(tag, "aside");
    return makeCard();
  },
  addEventListener(name, handler) { documentHandlers.set(name, handler); },
};

class MutationObserver {
  constructor(callback) { observerCallback = callback; }
  observe() {}
  disconnect() { observerDisconnects += 1; }
}

const window = {
  MutationObserver,
  __NVS_LAST_RECOMMENDATIONS__: { primary: { assignments: [assignment] } },
  NVSShare: {
    getSharedPlan() { return { id: "plan-1" }; },
    getFocusIndex() { return 0; },
  },
  NVSSharedLive: { getState() { return { members: {} }; } },
  addEventListener(name, handler) { windowHandlers.set(name, handler); },
};

function setTimeoutStub(callback) {
  const id = nextTimerId++;
  timers.set(id, callback);
  return id;
}
function clearTimeoutStub(id) {
  if (id == null) return;
  clearedTimers.push(id);
  timers.delete(id);
}

vm.runInNewContext(source, {
  window,
  document,
  MutationObserver,
  setTimeout: setTimeoutStub,
  clearTimeout: clearTimeoutStub,
  Date,
  Intl,
  Number,
  String,
  Boolean,
  Array,
  Math,
  Object,
});

assert.equal(typeof window.NVSTripGuidance0111?.refresh, "function");
assert.equal(typeof windowHandlers.get("nvs-shared-live-change"), "function");
assert.equal(typeof windowHandlers.get("nvs-live-plan-synced"), "function");
assert.equal(typeof documentHandlers.get("visibilitychange"), "function");
assert.equal(typeof observerCallback, "function");
assert.ok(card?.innerHTML.includes("Bus 1"), "visible startup should render current trip guidance");
assert.equal(timers.size, 1, "visible personal guidance should own one countdown timer");

const visibleTimerId = [...timers.keys()][0];
const staleTimerCallback = timers.get(visibleTimerId);
const visibleWrites = cardWrites;
const visibleHtml = card.innerHTML;
assignment.route.segments[0].line = "2";

document.hidden = true;
documentHandlers.get("visibilitychange")();
assert.equal(timers.has(visibleTimerId), false, "ordinary hiding should cancel the current guidance countdown");
assert.ok(clearedTimers.includes(visibleTimerId), "the hidden transition should explicitly release timer ownership");

window.NVSTripGuidance0111.refresh();
windowHandlers.get("nvs-shared-live-change")();
windowHandlers.get("nvs-live-plan-synced")();
observerCallback();
staleTimerCallback();

assert.equal(cardWrites, visibleWrites, "hidden direct/event/observer/stale-timer work must not repaint guidance");
assert.equal(card.innerHTML, visibleHtml, "hidden callbacks must leave the last visible guidance untouched");
assert.equal(timers.size, 0, "a stale countdown callback must not rearm itself while hidden");

windowHandlers.get("nvs-recommendations-cleared")();
assert.equal(cardWrites, visibleWrites, "authoritative clears may cancel ownership while hidden but must not mutate hidden guidance DOM");
assert.equal(card.innerHTML, visibleHtml, "hidden authoritative clear should defer visible reconciliation");

document.hidden = false;
documentHandlers.get("visibilitychange")();
assert.ok(card?.innerHTML.includes("Bus 2"), "visibility restore should reconcile the latest route instead of replaying hidden work");
assert.ok(cardWrites > visibleWrites, "visible restore should be allowed to repaint current guidance");
assert.equal(timers.size, 1, "visible restore should reacquire exactly one countdown timer");
assert.ok(observerDisconnects >= 2, "hidden suspension and visible reconciliation should reset scoped observation ownership");

assert.match(source, /function ownsForeground\(\) \{ return !lifecycleFrozen && !document\.hidden; \}/,
  "Trip Guidance should centralize ordinary-hidden and bfcache foreground ownership");
assert.match(source, /timer = setTimeout\(\(\) => \{\s*timer = null;\s*if \(!ownsForeground\(\)\) return;/s,
  "an already dequeued countdown must re-check foreground ownership before rendering or rearming");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
  "guidance lifecycle ownership must remain memory-only");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i,
  "guidance lifecycle hardening must not introduce location tracking");

console.log("trip-guidance-hidden-ownership: hidden direct/events/observer/dequeued timer stay inert and visible restore reconciles current route");
