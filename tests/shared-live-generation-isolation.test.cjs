const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-live-timeout-v0111.js"), "utf8");
const events = [];
const callsByUrl = new Map();
const listeners = new Map();
let timers = [];

function originalFetch(input, init = {}) {
  const url = String(input);
  const count = (callsByUrl.get(url) || 0) + 1;
  callsByUrl.set(url, count);

  if (
    url.endsWith("/SESSION_A")
    || ((url.endsWith("/SESSION_C") || url.endsWith("/SESSION_D") || url.endsWith("/SESSION_E")) && count === 1)
  ) {
    return new Promise((resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal.reason || new Error("aborted")), { once: true });
    });
  }

  return Promise.resolve({
    ok: true,
    status: 200,
    clone() { return this; },
  });
}

const window = {
  fetch: originalFetch,
  location: { href: "https://meet.example/p/SESSION_A" },
  dispatchEvent(event) { events.push(event); return true; },
  addEventListener(name, handler) { listeners.set(name, handler); },
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

  const sessionA = "https://meet.example/api/live/SESSION_A";
  const sessionB = "https://meet.example/api/live/SESSION_B";
  const hangingA = window.fetch(sessionA, { method: "GET" });
  const timerA = timers.at(-1);

  await window.fetch(sessionB, { method: "GET" });
  assert.equal(callsByUrl.get(sessionB), 1, "a different shared session should start its own request");

  timerA.fn();
  await assert.rejects(hangingA, /timed out|TimeoutError/i);
  assert.equal(events.length, 1,
    "starting a GET for another shared session must not make the first session's timeout look stale");
  assert.equal(events[0].type, "nvs-shared-live-timeout");
  assert.equal(api.getConsecutiveGetTimeouts(), 1,
    "different-session traffic must not suppress timeout accounting for the original current request");

  api.resetGetBackoff();
  const sessionC = "https://meet.example/api/live/SESSION_C";
  const staleC = window.fetch(sessionC, { method: "GET" });
  const staleCTimer = timers.at(-1);
  api.allowNextGet();
  await window.fetch(sessionC, { method: "GET" });
  assert.equal(callsByUrl.get(sessionC), 2, "explicit fresh retry should escape a same-session hung request");

  const eventsBeforeStaleC = events.length;
  staleCTimer.fn();
  await assert.rejects(staleC, /timed out|TimeoutError/i);
  assert.equal(events.length, eventsBeforeStaleC,
    "a superseded GET for the same session must remain unable to downgrade the newer healthy request");
  assert.equal(api.getConsecutiveGetTimeouts(), 0,
    "same-session stale timeout must not restart backoff after a fresh retry succeeds");

  const sessionD = "https://meet.example/api/live/SESSION_D";
  const sessionE = "https://meet.example/api/live/SESSION_E";
  const staleD = window.fetch(sessionD, { method: "GET" });
  const staleDTimer = timers.at(-1);
  const staleE = window.fetch(sessionE, { method: "GET" });
  const staleETimer = timers.at(-1);
  assert.equal(api.getPendingGetCount(), 2, "two distinct sessions may both have coalescing entries before reconnect");

  listeners.get("online")?.();
  assert.equal(api.getPendingGetCount(), 0,
    "reconnect should release every pre-reconnect coalescing entry, not just whichever session refreshes first");

  const freshD = window.fetch(sessionD, { method: "GET" });
  const freshE = window.fetch(sessionE, { method: "GET" });
  assert.equal(callsByUrl.get(sessionD), 2, "session D should start a genuinely fresh request after reconnect");
  assert.equal(callsByUrl.get(sessionE), 2, "session E should independently start a genuinely fresh request after reconnect");
  await Promise.all([freshD, freshE]);

  const eventsBeforeReconnectStale = events.length;
  staleDTimer.fn();
  staleETimer.fn();
  await assert.rejects(staleD, /timed out|TimeoutError/i);
  await assert.rejects(staleE, /timed out|TimeoutError/i);
  assert.equal(events.length, eventsBeforeReconnectStale,
    "late failures from any pre-reconnect session must not downgrade post-reconnect health");
  assert.equal(api.getConsecutiveGetTimeouts(), 0);
  assert.equal(api.getBackoffUntil(), 0);

  assert.doesNotMatch(JSON.stringify(events), /SESSION_[A-E]|https?:/,
    "generation-isolation lifecycle events must not leak shared IDs or URLs");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|geolocation|watchPosition|getCurrentPosition/,
    "generation isolation must remain memory-only and location-free");
  assert.doesNotMatch(source, /setInterval\s*\(/, "generation isolation must not add a background loop");

  console.log("shared-live-generation-isolation: cross-session independence, all-session reconnect release, and same-session stale-request protection passed");
})().catch((error) => { console.error(error); process.exit(1); });
