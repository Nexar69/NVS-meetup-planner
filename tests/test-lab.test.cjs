const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("test-lab-v0111.js", "utf8");
const config = fs.readFileSync("config.js", "utf8");
const css = fs.readFileSync("test-lab-v0111.css", "utf8");

let realMs = Date.parse("2026-08-27T12:00:00Z");
class NativeDate extends Date {
  static now() { return realMs; }
}

const nativeCalls = [];
const events = [];
const windowListeners = new Map();
const documentListeners = new Map();

const document = {
  readyState: "loading",
  hidden: false,
  body: null,
  activeElement: null,
  documentElement: { dataset: {} },
  addEventListener(type, handler) { documentListeners.set(type, handler); },
  getElementById() { return null; },
};

const window = {
  location: {
    search: "?test=1",
    href: "https://nexar69.github.io/NVS-meetup-planner/?test=1",
    origin: "https://nexar69.github.io",
  },
  Date: NativeDate,
  NVSConfig: { backendUrl: "https://meet-schwerin.timothy-ua-pa.workers.dev" },
  fetch: async (input, init) => {
    nativeCalls.push({ input, init });
    return new Response("ok", { status: 200 });
  },
  addEventListener(type, handler) { windowListeners.set(type, handler); },
  dispatchEvent(event) { events.push(event); return true; },
};

const context = vm.createContext({
  window,
  document,
  URL,
  URLSearchParams,
  Response,
  Intl,
  CustomEvent: class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  },
  Object,
  Number,
  String,
  Boolean,
  Math,
  setTimeout: () => 1,
  clearTimeout: () => {},
  console,
});

vm.runInContext(source, context, { filename: "test-lab-v0111.js" });

assert.equal(window.NVSTestLab.active, true, "test lab should activate only from explicit query mode");
assert.equal(document.documentElement.dataset.nvsTestMode, "true");
assert.equal(window.Date.now(), realMs, "virtual clock starts at real time");

window.NVSTestLab.advance(15);
assert.equal(window.Date.now(), realMs + 15 * 60_000, "advance should move virtual time without changing real clock");
assert.equal(window.NVSTestLab.realNow(), realMs, "real clock remains separately available");

window.NVSTestLab.setSpeed(5);
realMs += 2_000;
assert.equal(window.Date.now(), Date.parse("2026-08-27T12:15:10Z"), "5x speed should advance virtual clock five seconds per real second");

window.NVSTestLab.setPaused(true);
const pausedAt = window.Date.now();
realMs += 60_000;
assert.equal(window.Date.now(), pausedAt, "paused virtual time must not advance");
window.NVSTestLab.setPaused(false);
realMs += 1_000;
assert.equal(window.Date.now(), pausedAt + 5_000, "resume should continue at the configured speed without background jump");

window.NVSTestLab.reset();
assert.equal(window.Date.now(), realMs, "reset returns simulated time to real time");
assert.equal(window.NVSTestLab.getSpeed(), 1);
assert.equal(window.NVSTestLab.isPaused(), false);

(async () => {
  const blocked = await window.fetch("https://meet-schwerin.timothy-ua-pa.workers.dev/api/live/abc", { method: "POST" });
  assert.equal(blocked.status, 409, "backend writes must be blocked in test mode");
  assert.equal(nativeCalls.length, 0, "blocked writes must never reach the real fetch implementation");
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.error, "TEST_MODE_WRITE_BLOCKED");
  assert(events.some((event) => event.type === "nvs-test-write-blocked"), "blocked write should emit a local diagnostic event");

  await window.fetch("https://meet-schwerin.timothy-ua-pa.workers.dev/api/live/abc", { method: "GET" });
  assert.equal(nativeCalls.length, 1, "read-only backend requests should remain available for realistic testing");

  await window.fetch("https://example.com/api/live/abc", { method: "POST" });
  assert.equal(nativeCalls.length, 2, "foreign-origin writes must not be intercepted as Meet Schwerin backend traffic");

  assert(config.includes("test-lab-v0111.js") && config.includes("test-lab-v0111.css"), "config bootstrap must load Test Lab assets");
  assert(config.includes('params.get("test") === "1"'), "Test Lab must require an explicit test query opt-in");
  assert(css.includes("44px"), "Test Lab controls should retain mobile-sized targets");
  assert(source.includes("TEST MODE · writes blocked"), "Test Mode must remain visibly distinguishable from real operation");
  assert(!/localStorage|sessionStorage/.test(source), "Test Lab state must stay ephemeral rather than persistent");
  assert(!/getCurrentPosition|watchPosition|geolocation/.test(source), "Test Lab must not add location access");

  console.log("test-lab.test.cjs passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
