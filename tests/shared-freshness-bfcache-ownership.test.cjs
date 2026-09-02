const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }
  dispatch(name, event = {}) {
    for (const listener of this.listeners.get(name) || []) listener(event);
  }
}

const windowEvents = new Events();
const documentEvents = new Events();
let stale = false;
let classMutations = 0;
let timerId = 0;
const timers = new Map();

const row = {
  classList: {
    toggle(name, enabled) {
      if (name === "v011-stale") {
        classMutations += 1;
        row.stale = Boolean(enabled);
      }
    },
  },
  querySelector(selector) {
    if (selector === ".v010-source") return row.source;
    if (selector === "small") return row.headline;
    if (selector === "em") return row.detail;
    return null;
  },
  source: { textContent: "LIVE" },
  headline: { textContent: "On the way" },
  detail: { textContent: "confirmed now" },
  stale: false,
};

const panel = {
  querySelectorAll(selector) { return selector === ".v010-person" ? [row] : []; },
  querySelector() { return null; },
};

const document = {
  hidden: false,
  head: { appendChild() {} },
  createElement() { return { textContent: "" }; },
  getElementById(id) { return id === "sharedLiveV010" ? panel : null; },
  addEventListener: documentEvents.addEventListener.bind(documentEvents),
};

const window = {
  addEventListener: windowEvents.addEventListener.bind(windowEvents),
  NVSIntelligenceCore: {
    checkinFreshness() {
      return stale ? { stale: true, fresh: false, ageMinutes: 42 } : { stale: false, fresh: true, ageMinutes: 1 };
    },
  },
  NVSSharedLive: {
    getState() { return { members: { "0": { status: "on_way" } } }; },
  },
};

const context = {
  window,
  document,
  Date,
  console,
  setTimeout(fn) {
    const id = ++timerId;
    timers.set(id, fn);
    return id;
  },
  clearTimeout(id) { timers.delete(id); },
};

const source = fs.readFileSync(path.resolve(__dirname, "../shared-freshness-v011.js"), "utf8");
vm.runInNewContext(source, context, { filename: "shared-freshness-v011.js" });

assert.equal(row.stale, false, "initial fresh state should render normally");
const initialMutations = classMutations;
assert.ok(timers.size > 0, "foreground freshness should arm its one-shot timer");
const staleForegroundTimer = [...timers.values()][0];

document.hidden = true;
documentEvents.dispatch("visibilitychange");
assert.equal(timers.size, 0, "hidden transition should cancel pending freshness timers");

stale = true;
windowEvents.dispatch("nvs-shared-live-change");
windowEvents.dispatch("nvs-group-recommendations-rendered");
windowEvents.dispatch("nvs-shared-view-resumed");
assert.equal(classMutations, initialMutations, "hidden events must not mutate stale-state DOM");
assert.equal(row.stale, false, "hidden DOM should retain its pre-suspension presentation");
assert.equal(timers.size, 0, "hidden events must not restart freshness timers");

staleForegroundTimer();
assert.equal(classMutations, initialMutations, "an already-dequeued timer must re-check hidden ownership before DOM work");
assert.equal(timers.size, 0, "a stale hidden timer must not rearm itself");

document.hidden = false;
documentEvents.dispatch("visibilitychange");
assert.equal(row.stale, true, "visibility restoration should reconcile the current authoritative freshness state");
assert.equal(row.source.textContent, "STALE", "restoration should refresh stale semantics from current state");
assert.match(row.detail.textContent, /last confirmed 42 min ago/, "restoration should compute current freshness copy");
assert.ok(timers.size > 0, "visibility restoration should restart the foreground one-shot cadence");

const visibleMutations = classMutations;
windowEvents.dispatch("pagehide", { persisted: true });
assert.equal(timers.size, 0, "pagehide should cancel pending freshness timers");

stale = false;
windowEvents.dispatch("nvs-shared-live-change");
assert.equal(classMutations, visibleMutations, "bfcache-frozen events must not mutate stale-state DOM");
assert.equal(row.stale, true, "frozen DOM should retain its pre-suspension presentation");

windowEvents.dispatch("pageshow", { persisted: true });
assert.equal(row.stale, false, "pageshow should reconcile the current authoritative freshness state");
assert.ok(timers.size > 0, "pageshow should restart the foreground one-shot cadence");

assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "freshness lifecycle must remain no-GPS");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, "freshness lifecycle ownership should remain memory-only");

console.log("shared-freshness-bfcache-ownership: hidden and frozen callbacks stay DOM-inert; restore reconciles current state");
