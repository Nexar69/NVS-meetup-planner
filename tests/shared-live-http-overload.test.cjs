const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-live-timeout-v0111.js"), "utf8");
const calls = [];
const events = [];
let nextResponse = null;

const window = {
  location: { href: "https://meet.example/p/ABC234" },
  fetch(input, init = {}) {
    calls.push({ input, init });
    return Promise.resolve(nextResponse || new Response("ok", { status: 200 }));
  },
  addEventListener() {},
  dispatchEvent(event) { events.push(event); return true; },
};
class FakeCustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }

vm.runInNewContext(source, {
  window, URL, Date, Math, Number, Object, String, AbortController, DOMException,
  CustomEvent: FakeCustomEvent, Response, setTimeout, clearTimeout,
});

const api = window.NVSSharedLiveTimeout0111;
assert.equal(api.DEFAULT_HTTP_BACKOFF_MS, 24_000);
assert.equal(api.isTransientStatus(408), true);
assert.equal(api.isTransientStatus(429), true);
assert.equal(api.isTransientStatus(503), true);
assert.equal(api.isTransientStatus(404), false);
assert.equal(api.isTransientStatus(200), false);

(async () => {
  nextResponse = new Response("busy", { status: 503 });
  const first = await window.fetch("https://meet.example/api/live/ABC234", { method: "GET" });
  assert.equal(first.status, 503);
  assert.ok(api.getBackoffUntil() > Date.now(), "transient server failure should create a bounded GET backoff immediately");
  assert.equal(api.getConsecutiveGetTimeouts(), 0, "HTTP overload must not masquerade as a transport timeout streak");
  assert.equal(events.at(-1)?.type, "nvs-shared-live-degraded");
  assert.deepEqual({ ...events.at(-1).detail }, { status: 503, retryAfterMs: 24_000 });
  assert.doesNotMatch(JSON.stringify(events.at(-1).detail), /ABC234|https?:|plan|member|key/i, "degraded signal must contain only coarse transport metadata");

  const callsBeforeSuppression = calls.length;
  await assert.rejects(
    window.fetch("https://meet.example/api/live/ABC234", { method: "GET" }),
    /backed off|RetryLaterError/i,
  );
  assert.equal(calls.length, callsBeforeSuppression, "automatic GET inside HTTP backoff must fail locally without another request");

  api.allowNextGet();
  nextResponse = new Response("still busy", { status: 429, headers: { "retry-after": "2" } });
  const retry = await window.fetch("https://meet.example/api/live/ABC234", { method: "GET" });
  assert.equal(retry.status, 429, "explicit manual bypass should still receive the real server response");
  const remaining = api.getBackoffUntil() - Date.now();
  assert.ok(remaining > 1_000 && remaining <= 2_100, `Retry-After should define the next bounded window, got ${remaining}ms`);
  assert.deepEqual({ ...events.at(-1).detail }, { status: 429, retryAfterMs: 2_000 });

  api.allowNextGet();
  nextResponse = new Response("ok", { status: 200 });
  await window.fetch("https://meet.example/api/live/ABC234", { method: "GET" });
  assert.equal(api.getBackoffUntil(), 0, "healthy backend response should release transient HTTP backoff immediately");

  nextResponse = new Response("server error", { status: 503 });
  const postCallsBefore = calls.length;
  const post = await window.fetch("https://meet.example/api/live/ABC234", { method: "POST" });
  assert.equal(post.status, 503);
  assert.equal(calls.length, postCallsBefore + 1, "voluntary POSTs must never inherit automatic GET overload throttling");
  assert.equal(api.getBackoffUntil(), 0, "POST response errors must not throttle later GET polling");

  const longRetry = new Response("busy", { status: 503, headers: { "retry-after": "600" } });
  assert.equal(api.retryAfterMs(longRetry), 60_000, "server Retry-After must stay bounded to the client safety maximum");
  const dateRetry = new Response("busy", { status: 503, headers: { "retry-after": new Date(Date.now() + 5_000).toUTCString() } });
  const parsedDateRetry = api.retryAfterMs(dateRetry);
  assert.ok(parsedDateRetry >= 3_500 && parsedDateRetry <= 5_500, "HTTP-date Retry-After should be accepted");

  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|geolocation|watchPosition|getCurrentPosition/,
    "HTTP overload guard must remain memory-only and no-GPS");
  assert.doesNotMatch(source, /setInterval\s*\(/, "HTTP overload handling must not add another polling loop");
  console.log("shared-live-http-overload: transient GET backoff, Retry-After, manual bypass, recovery reset, POST independence and privacy passed");
})().catch((error) => { console.error(error); process.exit(1); });