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
  Symbol,
  setTimeout: () => 1,
  clearTimeout: () => {},
  console,
});

vm.runInContext(source, context, { filename: "test-lab-v0111.js" });

assert.equal(window.NVSTestLab.active, true, "test lab should activate only from explicit query mode");
assert.equal(document.documentElement.dataset.nvsTestMode, "true");
assert.equal(window.Date.now(), realMs, "virtual clock starts at real time");
assert.equal(window.NVSTestLab.persistent, false, "test state must be explicitly ephemeral");

const oldDate = new NativeDate(realMs);
assert(oldDate instanceof window.Date, "pre-Test-Lab Date objects must remain compatible with the virtual Date constructor");

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
assert.equal(window.NVSTestLab.getNetwork(), "normal");

(async () => {
  const backend = "https://meet-schwerin.timothy-ua-pa.workers.dev";
  const transitous = "https://api.transitous.org/api/v6/plan?from=1&to=2";

  const blocked = await window.fetch(`${backend}/api/live/abc`, { method: "POST" });
  assert.equal(blocked.status, 409, "backend writes must be blocked in test mode");
  assert.equal(nativeCalls.length, 0, "blocked writes must never reach the real fetch implementation");
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.error, "TEST_MODE_WRITE_BLOCKED");
  assert(events.some((event) => event.type === "nvs-test-write-blocked"), "blocked write should emit a local diagnostic event");

  await window.fetch(`${backend}/api/live/abc`, { method: "GET" });
  assert.equal(nativeCalls.length, 1, "read-only backend requests should remain available for realistic testing");

  await window.fetch("https://example.com/api/live/abc", { method: "POST" });
  assert.equal(nativeCalls.length, 2, "foreign-origin writes must not be intercepted as Meet Schwerin backend traffic");

  assert.equal(window.NVSTestLab.setNetwork("vmv-fail"), true);
  await assert.rejects(
    () => window.fetch(`${backend}/api/vmv/plan?fromLat=1`, { method: "GET" }),
    /TEST_MODE_VMV_FAIL/,
    "VMV failure mode should fail only the configured VMV route endpoint",
  );
  assert.equal(nativeCalls.length, 2, "simulated VMV failure must happen before the real network call");
  await window.fetch(transitous, { method: "GET" });
  assert.equal(nativeCalls.length, 3, "VMV-only failure must not suppress Transitous fallback traffic");

  assert.equal(window.NVSTestLab.setNetwork("transit-fail"), true);
  await assert.rejects(
    () => window.fetch(transitous, { method: "GET" }),
    /TEST_MODE_TRANSIT_FAIL/,
    "Transitous failure mode should fail Transitous without affecting the configured backend",
  );
  await window.fetch(`${backend}/api/vmv/plan?fromLat=1`, { method: "GET" });
  assert.equal(nativeCalls.length, 4, "Transitous-only failure must leave VMV available");

  assert.equal(window.NVSTestLab.setNetwork("all-fail"), true);
  await assert.rejects(() => window.fetch(`${backend}/api/vmv/plan`, { method: "GET" }), /TEST_MODE_ALL_FAIL/);
  await assert.rejects(() => window.fetch(transitous, { method: "GET" }), /TEST_MODE_ALL_FAIL/);
  await window.fetch(`${backend}/api/live/abc`, { method: "GET" });
  assert.equal(nativeCalls.length, 5, "both-route-provider failure should not take Shared Live reads down");

  assert.equal(window.NVSTestLab.setNetwork("offline-api"), true);
  await assert.rejects(() => window.fetch(`${backend}/api/live/abc`, { method: "GET" }), /TEST_MODE_OFFLINE_API/);
  await assert.rejects(() => window.fetch(transitous, { method: "GET" }), /TEST_MODE_OFFLINE_API/);
  await window.fetch("https://example.com/asset.json", { method: "GET" });
  assert.equal(nativeCalls.length, 6, "offline API mode must not become a broad internet kill-switch");

  assert.equal(window.NVSTestLab.setNetwork("bogus"), false, "unknown network modes must be rejected");
  window.NVSTestLab.setNetwork("normal");
  const diagnostics = window.NVSTestLab.getDiagnostics();
  assert.equal(diagnostics.network, "normal");
  assert.equal(typeof diagnostics.label, "string");
  assert(!("url" in diagnostics), "diagnostics must not expose request URLs");

  assert(config.includes("test-lab-v0111.js") && config.includes("test-lab-v0111.css"), "config bootstrap must load Test Lab assets");
  assert(config.includes('params.get("test") === "1"'), "Test Lab must require an explicit test query opt-in");
  assert(css.includes("44px"), "Test Lab controls should retain mobile-sized targets");
  assert(css.includes("forced-colors") && css.includes("prefers-reduced-motion"), "Test Lab should retain accessibility fallbacks");
  assert(source.includes("TEST MODE · writes blocked"), "Test Mode must remain visibly distinguishable from real operation");
  assert(source.includes("VMV fails") && source.includes("Transitous fails"), "network fault scenarios must be visible rather than hidden developer state");
  assert(!/localStorage|sessionStorage/.test(source), "Test Lab state must stay ephemeral rather than persistent");
  assert(!/getCurrentPosition|watchPosition|geolocation/.test(source), "Test Lab must not add location access");
  assert(!/setInterval\s*\(/.test(source), "Test Lab must not add a permanent interval loop");

  console.log("test-lab.test.cjs passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
