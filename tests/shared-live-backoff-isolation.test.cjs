const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-live-timeout-v0111.js"), "utf8");
const calls = new Map();
const events = [];
const timers = [];

function response(status = 200, retryAfter = null) {
  return {
    status,
    headers: { get(name) { return String(name).toLowerCase() === "retry-after" ? retryAfter : null; } },
    clone() { return response(status, retryAfter); },
  };
}

function originalFetch(input, init = {}) {
  const url = String(input);
  calls.set(url, (calls.get(url) || 0) + 1);
  if (url.endsWith("/SESSION_A")) return Promise.resolve(response(503, "30"));
  if (url.endsWith("/SESSION_B")) return Promise.resolve(response(200));
  if (url.endsWith("/SESSION_C")) return Promise.resolve(response(429, "45"));
  return new Promise((resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal.reason || new Error("aborted")), { once: true });
  });
}

const window = {
  fetch: originalFetch,
  location: {
    href: "https://meet.example/p/SESSION_A",
    pathname: "/p/SESSION_A",
    origin: "https://meet.example",
  },
  __NVS_BACKEND_URL__: "https://worker.example",
  dispatchEvent(event) { events.push(event); return true; },
  addEventListener() {},
};

class FakeCustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}

function fakeSetTimeout(fn, delay) {
  const timer = { fn, delay, active: true };
  timers.push(timer);
  return timer;
}
function fakeClearTimeout(timer) { if (timer) timer.active = false; }

vm.runInNewContext(source, {
  window,
  URL,
  Date,
  Math,
  Number,
  Object,
  String,
  AbortController,
  DOMException,
  CustomEvent: FakeCustomEvent,
  setTimeout: fakeSetTimeout,
  clearTimeout: fakeClearTimeout,
});

(async () => {
  const api = window.NVSSharedLiveTimeout0111;
  const sessionA = "https://worker.example/api/live/SESSION_A";
  const sessionB = "https://worker.example/api/live/SESSION_B";
  const sessionC = "https://worker.example/api/live/SESSION_C";

  await window.fetch(sessionA, { method: "GET" });
  assert.ok(api.getBackoffUntil(sessionA) > Date.now(), "503 should back off only session A");
  assert.equal(api.getBackoffUntil(), api.getBackoffUntil(sessionA),
    "default current-session health lookup must honor the configured cross-origin backend");
  assert.equal(api.getConsecutiveGetTimeouts(), 0,
    "default current-session timeout lookup must use the configured backend bucket too");
  assert.equal(api.getBackoffUntil(sessionB), 0, "session B must not inherit session A backoff");
  await assert.rejects(window.fetch(sessionA, { method: "GET" }), /backed off|RetryLaterError/i);
  assert.equal(calls.get(sessionA), 1, "backed-off session A should be suppressed locally");

  await window.fetch(sessionB, { method: "GET" });
  assert.equal(calls.get(sessionB), 1, "healthy session B must still reach the network while A is backed off");
  assert.equal(api.getBackoffUntil(sessionA) > Date.now(), true,
    "healthy traffic for B must not clear A's independent backoff");

  await window.fetch(sessionC, { method: "GET" });
  assert.ok(api.getBackoffUntil(sessionC) > Date.now(), "session C should keep its own overload backoff");
  assert.notEqual(api.getBackoffUntil(sessionA), api.getBackoffUntil(sessionC),
    "independent Retry-After values must create independent deadlines");

  assert.equal(events.filter((event) => event.type === "nvs-shared-live-degraded").length, 1,
    "only degradation for the current page's shared session should affect its connection UI");
  assert.equal(events[0].detail.status, 503);
  assert.doesNotMatch(JSON.stringify(events), /SESSION_[ABC]|https?:/,
    "degradation events must remain free of plan IDs and request URLs");

  api.resetGetBackoff(false, sessionA);
  assert.equal(api.getBackoffUntil(sessionA), 0, "scoped reset should clear A");
  assert.equal(api.getBackoffUntil(), 0, "default cross-origin current-session lookup should reflect the scoped reset");
  assert.ok(api.getBackoffUntil(sessionC) > Date.now(), "scoped reset must preserve C");
  api.resetGetBackoff();
  assert.equal(api.getBackoffUntil(sessionC), 0, "global reconnect-style reset should clear all sessions");

  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|geolocation|watchPosition|getCurrentPosition/,
    "per-session backoff must remain memory-only and location-free");
  assert.doesNotMatch(source, /setInterval\s*\(/, "per-session isolation must not add background polling");

  console.log("shared-live-backoff-isolation: per-session overload/backoff state, cross-origin backend keying, and current-session UI isolation passed");
})().catch((error) => { console.error(error); process.exit(1); });
