const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-live-timeout-v0111.js"), "utf8");
const calls = [];
let abortListeners = [];

const originalFetch = (input, init = {}) => {
  calls.push({ input, init });
  if (String(input).includes("hang")) {
    return new Promise((resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal.reason || new Error("aborted")), { once: true });
    });
  }
  return Promise.resolve({ ok: true, input, init });
};

const window = {
  fetch: originalFetch,
  location: { href: "https://meet.example/p/ABC234" },
};

class FastAbortController extends AbortController {}
class FastDOMException extends DOMException {}
let timers = [];
function fastSetTimeout(fn, delay) {
  const id = { fn, delay, active: true };
  timers.push(id);
  return id;
}
function fastClearTimeout(id) { if (id) id.active = false; }

vm.runInNewContext(source, {
  window,
  URL,
  AbortController: FastAbortController,
  DOMException: FastDOMException,
  setTimeout: fastSetTimeout,
  clearTimeout: fastClearTimeout,
  Object,
  String,
});

assert.equal(window.NVSSharedLiveTimeout0111.REQUEST_TIMEOUT_MS, 8000);
assert.equal(window.NVSSharedLiveTimeout0111.isSharedLiveRequest("https://meet.example/api/live/ABC234"), true);
assert.equal(window.NVSSharedLiveTimeout0111.isSharedLiveRequest("https://meet.example/api/health"), false);
assert.equal(window.NVSSharedLiveTimeout0111.isSharedLiveRequest("https://other.example/api/live/ABC234/extra"), false);

(async () => {
  await window.fetch("https://meet.example/api/health", { method: "GET" });
  assert.equal(calls.at(-1).init.signal, undefined, "unrelated fetches must stay untouched");
  assert.equal(timers.length, 0, "unrelated fetches must not allocate timeout timers");

  await window.fetch("https://meet.example/api/live/ABC234", { method: "GET" });
  assert.ok(calls.at(-1).init.signal, "Shared Live GET should receive an abort signal");
  assert.equal(timers.at(-1).delay, 8000);
  assert.equal(timers.at(-1).active, false, "successful Shared Live fetch should clear its timeout");

  const external = new AbortController();
  const pending = window.fetch("https://meet.example/api/live/hang", { method: "POST", signal: external.signal });
  const timer = timers.at(-1);
  assert.equal(timer.delay, 8000);
  timer.fn();
  await assert.rejects(pending, /timed out|TimeoutError/i, "stalled Shared Live requests should abort at the deadline");
  assert.equal(timer.active, false, "timeout should be cleared after abort settles");

  const external2 = new AbortController();
  const pending2 = window.fetch("https://meet.example/api/live/hang", { method: "GET", signal: external2.signal });
  external2.abort(new Error("caller cancelled"));
  await assert.rejects(pending2, /caller cancelled|aborted/i, "caller-provided abort must propagate through the bounded request");

  assert.doesNotMatch(source, /localStorage|sessionStorage|geolocation|watchPosition|getCurrentPosition/,
    "timeout layer must not add storage or location behavior");
  console.log("shared-live-timeout: GET/POST timeout, cleanup, caller abort propagation and narrow request scope passed");
})().catch((error) => { console.error(error); process.exit(1); });
