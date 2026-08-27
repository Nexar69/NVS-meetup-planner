const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-live-timeout-v0111.js"), "utf8");
const calls = [];
const events = [];
const listeners = new Map();
let reconnectHangCalls = 0;

const originalFetch = (input, init = {}) => {
  calls.push({ input, init });
  if (String(input).includes("reconnect-hang")) {
    reconnectHangCalls += 1;
    if (reconnectHangCalls === 1) {
      return new Promise((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal.reason || new Error("aborted")), { once: true });
      });
    }
    return Promise.resolve({ ok: true, status: 200, input, init });
  }
  if (String(input).includes("hang")) {
    return new Promise((resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal.reason || new Error("aborted")), { once: true });
    });
  }
  return Promise.resolve({ ok: true, status: 200, input, init });
};

const window = {
  fetch: originalFetch,
  location: { href: "https://meet.example/p/ABC234" },
  dispatchEvent(event) { events.push(event); return true; },
  addEventListener(name, handler) { listeners.set(name, handler); },
};

class FastAbortController extends AbortController {}
class FastDOMException extends DOMException {}
class FakeCustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}
let timers = [];
function fastSetTimeout(fn, delay) {
  const id = { fn, delay, active: true };
  timers.push(id);
  return id;
}
function fastClearTimeout(id) { if (id) id.active = false; }
function fireTimeoutFor(promise) {
  const timer = timers.at(-1);
  assert.equal(timer.delay, 8000);
  timer.fn();
  return promise;
}

vm.runInNewContext(source, {
  window,
  URL,
  Date,
  Math,
  Number,
  AbortController: FastAbortController,
  DOMException: FastDOMException,
  CustomEvent: FakeCustomEvent,
  setTimeout: fastSetTimeout,
  clearTimeout: fastClearTimeout,
  Object,
  String,
});

const api = window.NVSSharedLiveTimeout0111;
assert.equal(api.REQUEST_TIMEOUT_MS, 8000);
assert.equal(api.MAX_GET_BACKOFF_MS, 60_000);
assert.equal(api.isSharedLiveRequest("https://meet.example/api/live/ABC234"), true);
assert.equal(api.isSharedLiveRequest("https://meet.example/api/health"), false);
assert.equal(api.isSharedLiveRequest("https://other.example/api/live/ABC234/extra"), false);
assert.equal(api.getBackoffMs(1), 0);
assert.equal(api.getBackoffMs(2), 24_000);
assert.equal(api.getBackoffMs(3), 48_000);
assert.equal(api.getBackoffMs(4), 60_000);
assert.equal(api.getBackoffMs(8), 60_000, "automatic GET backoff must stay bounded");

(async () => {
  await window.fetch("https://meet.example/api/health", { method: "GET" });
  assert.equal(calls.at(-1).init.signal, undefined, "unrelated fetches must stay untouched");
  assert.equal(timers.length, 0, "unrelated fetches must not allocate timeout timers");
  assert.equal(events.length, 0);

  await window.fetch("https://meet.example/api/live/ABC234", { method: "GET" });
  assert.ok(calls.at(-1).init.signal, "Shared Live GET should receive an abort signal");
  assert.equal(timers.at(-1).delay, 8000);
  assert.equal(timers.at(-1).active, false, "successful Shared Live fetch should clear its timeout");
  assert.equal(api.getConsecutiveGetTimeouts(), 0);
  assert.equal(events.length, 0, "successful requests must not emit a timeout event");

  const external = new AbortController();
  const pending = window.fetch("https://meet.example/api/live/hang", { method: "POST", signal: external.signal });
  const timer = timers.at(-1);
  timer.fn();
  await assert.rejects(pending, /timed out|TimeoutError/i, "stalled Shared Live requests should abort at the deadline");
  assert.equal(timer.active, false, "timeout should be cleared after abort settles");
  assert.equal(events.length, 1, "transport timeout should emit one lifecycle signal");
  assert.equal(events[0].type, "nvs-shared-live-timeout");
  assert.deepEqual({ ...events[0].detail }, { method: "POST", timeoutMs: 8000 });
  assert.doesNotMatch(JSON.stringify(events[0].detail), /ABC234|hang|https?:/i, "timeout signal must not leak plan IDs or URLs");
  assert.equal(api.getConsecutiveGetTimeouts(), 0, "voluntary POST timeouts must never throttle later check-ins");

  const external2 = new AbortController();
  const pending2 = window.fetch("https://meet.example/api/live/hang", { method: "GET", signal: external2.signal });
  external2.abort(new Error("caller cancelled"));
  await assert.rejects(pending2, /caller cancelled|aborted/i, "caller-provided abort must propagate through the bounded request");
  assert.equal(events.length, 1, "caller cancellation must not masquerade as a transport timeout");
  assert.equal(api.getConsecutiveGetTimeouts(), 0, "caller cancellation must not count as backend instability");

  const firstHang = window.fetch("https://meet.example/api/live/hang", { method: "GET" });
  await assert.rejects(fireTimeoutFor(firstHang), /timed out|TimeoutError/i);
  assert.equal(api.getConsecutiveGetTimeouts(), 1);
  assert.equal(api.getBackoffUntil(), 0, "one isolated GET timeout should keep the normal polling cadence");

  const secondHang = window.fetch("https://meet.example/api/live/hang", { method: "GET" });
  await assert.rejects(fireTimeoutFor(secondHang), /timed out|TimeoutError/i);
  assert.equal(api.getConsecutiveGetTimeouts(), 2);
  assert.ok(api.getBackoffUntil() > Date.now(), "repeated stalled polling should create a short memory-only backoff window");

  const callsBeforeBackoff = calls.length;
  const timersBeforeBackoff = timers.length;
  await assert.rejects(
    window.fetch("https://meet.example/api/live/ABC234", { method: "GET" }),
    /temporarily backed off|RetryLaterError/i,
    "automatic polling inside the backoff window should fail locally instead of hitting the backend again",
  );
  assert.equal(calls.length, callsBeforeBackoff, "backed-off automatic polling must not issue a network request");
  assert.equal(timers.length, timersBeforeBackoff, "backed-off automatic polling must not allocate another request timeout");
  assert.equal(events.length, 3, "local backoff suppression must not masquerade as another transport timeout");

  api.allowNextGet();
  await window.fetch("https://meet.example/api/live/ABC234", { method: "GET" });
  assert.equal(calls.length, callsBeforeBackoff + 1, "explicit recovery should get one bypass through automatic polling backoff");
  assert.equal(api.getConsecutiveGetTimeouts(), 0, "a real Shared Live response should reset timeout streak state");
  assert.equal(api.getBackoffUntil(), 0, "a real response should clear backoff immediately");

  const thirdHang1 = window.fetch("https://meet.example/api/live/hang", { method: "GET" });
  await assert.rejects(fireTimeoutFor(thirdHang1), /timed out|TimeoutError/i);
  const thirdHang2 = window.fetch("https://meet.example/api/live/hang", { method: "GET" });
  await assert.rejects(fireTimeoutFor(thirdHang2), /timed out|TimeoutError/i);
  assert.ok(api.getBackoffUntil() > Date.now());
  listeners.get("online")?.();
  assert.equal(api.getConsecutiveGetTimeouts(), 0, "a browser reconnect signal should immediately release old polling backoff");
  assert.equal(api.getBackoffUntil(), 0);

  const reconnectUrl = "https://meet.example/api/live/reconnect-hang";
  const oldReconnectGet = window.fetch(reconnectUrl, { method: "GET" });
  const oldReconnectTimer = timers.at(-1);
  const callsBeforeReconnect = calls.length;
  const eventsBeforeReconnect = events.length;
  listeners.get("online")?.();
  await window.fetch(reconnectUrl, { method: "GET" });
  assert.equal(calls.length, callsBeforeReconnect + 1,
    "first refresh after reconnect must start a fresh GET instead of joining the pre-reconnect hung request");
  assert.equal(api.getConsecutiveGetTimeouts(), 0);
  assert.equal(api.getBackoffUntil(), 0);
  oldReconnectTimer.fn();
  await assert.rejects(oldReconnectGet, /timed out|TimeoutError/i);
  assert.equal(events.length, eventsBeforeReconnect,
    "a stale pre-reconnect GET timing out later must not downgrade the recovered Shared Live connection");
  assert.equal(api.getConsecutiveGetTimeouts(), 0,
    "a stale pre-reconnect timeout must not restart automatic polling backoff after recovery");
  assert.equal(api.getBackoffUntil(), 0);

  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|geolocation|watchPosition|getCurrentPosition/,
    "timeout/backoff layer must not add storage or location behavior");
  assert.doesNotMatch(source, /setInterval\s*\(/, "polling backoff must not create another background loop");
  console.log("shared-live-timeout: bounded GET/POST timeouts, privacy-safe signals, repeated-GET backoff, explicit bypass, reconnect isolation and no-storage/no-GPS boundaries passed");
})().catch((error) => { console.error(error); process.exit(1); });