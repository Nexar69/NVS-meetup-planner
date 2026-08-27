const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-live-timeout-v0111.js"), "utf8");

function makeRuntime(fetchImpl) {
  const listeners = {};
  const window = {
    location: { href: "https://app.example/p/ABC234?me=0" },
    fetch: fetchImpl,
    addEventListener(name, fn) { listeners[name] = fn; },
    dispatchEvent() {},
  };
  class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  }
  vm.runInNewContext(source, {
    window,
    URL,
    Request,
    AbortController,
    DOMException,
    CustomEvent,
    Response,
    Promise,
    Map,
    Object,
    String,
    Number,
    Boolean,
    Math,
    Date,
    setTimeout,
    clearTimeout,
  });
  return { window, listeners };
}

(async () => {
  {
    let calls = 0;
    let release;
    const underlying = new Promise((resolve) => { release = resolve; });
    const rt = makeRuntime(async () => {
      calls += 1;
      return underlying;
    });
    const url = "https://backend.example/api/live/ABC234";
    const a = rt.window.fetch(url, { method: "GET", cache: "no-store" });
    const b = rt.window.fetch(url, { method: "GET", cache: "no-store" });
    assert.equal(calls, 1, "concurrent identical Shared Live GETs should share one underlying request");
    assert.equal(rt.window.NVSSharedLiveTimeout0111.getPendingGetCount(), 1);
    release(new Response(JSON.stringify({ revision: 7 }), { status: 200, headers: { "content-type": "application/json" } }));
    const [ra, rb] = await Promise.all([a, b]);
    assert.notEqual(ra, rb, "each coalesced consumer should receive its own Response clone");
    assert.deepEqual(await ra.json(), { revision: 7 });
    assert.deepEqual(await rb.json(), { revision: 7 }, "one consumer reading the body must not consume another consumer's body");
    await Promise.resolve();
    assert.equal(rt.window.NVSSharedLiveTimeout0111.getPendingGetCount(), 0, "settled GETs must leave the pending registry");
  }

  {
    let calls = 0;
    const rt = makeRuntime(async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    });
    const url = "https://backend.example/api/live/ABC234";
    await Promise.all([
      rt.window.fetch(url, { method: "POST", body: "{}" }),
      rt.window.fetch(url, { method: "POST", body: "{}" }),
    ]);
    assert.equal(calls, 2, "voluntary POST check-ins must never be coalesced or throttled with GET polling");
  }

  {
    let calls = 0;
    const rt = makeRuntime(async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    });
    const url = "https://backend.example/api/live/ABC234";
    await Promise.all([
      rt.window.fetch(new Request(url, { method: "POST", body: "{}" })),
      rt.window.fetch(new Request(url, { method: "POST", body: "{}" })),
    ]);
    assert.equal(calls, 2, "POST methods carried by Request objects must stay independent and must never be misclassified as coalescible GETs");
  }

  {
    let calls = 0;
    let release;
    const underlying = new Promise((resolve) => { release = resolve; });
    const rt = makeRuntime(async () => {
      calls += 1;
      return underlying;
    });
    const a = rt.window.fetch("https://backend.example/api/live/ABC234", { method: "GET" });
    const b = rt.window.fetch("https://backend.example/api/live/XYZ789", { method: "GET" });
    assert.equal(calls, 2, "different shared-plan URLs must never be coalesced together");
    release(new Response("{}", { status: 200 }));
    await Promise.all([a, b]);
  }

  {
    let calls = 0;
    let rejectFirst;
    const first = new Promise((_, reject) => { rejectFirst = reject; });
    const rt = makeRuntime(async () => {
      calls += 1;
      if (calls === 1) return first;
      return new Response("{}", { status: 200 });
    });
    const url = "https://backend.example/api/live/ABC234";
    const a = rt.window.fetch(url, { method: "GET" });
    const b = rt.window.fetch(url, { method: "GET" });
    rejectFirst(new Error("temporary failure"));
    await assert.rejects(a, /temporary failure/);
    await assert.rejects(b, /temporary failure/);
    await Promise.resolve();
    await rt.window.fetch(url, { method: "GET" });
    assert.equal(calls, 2, "a failed coalesced GET must be removed so the next refresh can retry");
  }

  {
    let calls = 0;
    let release;
    const underlying = new Promise((resolve) => { release = resolve; });
    const rt = makeRuntime(async () => {
      calls += 1;
      return underlying;
    });
    const controller = new AbortController();
    const url = "https://backend.example/api/live/ABC234";
    const cancelled = rt.window.fetch(url, { method: "GET", signal: controller.signal });
    const survivor = rt.window.fetch(url, { method: "GET" });
    controller.abort(new DOMException("consumer cancelled", "AbortError"));
    await assert.rejects(cancelled, (error) => error?.name === "AbortError");
    assert.equal(calls, 1, "consumer cancellation must not abort the shared underlying GET");
    release(new Response("{}", { status: 200 }));
    assert.equal((await survivor).status, 200, "another consumer should still receive the shared response after one consumer cancels");
  }

  {
    let calls = 0;
    let releaseHung;
    const hung = new Promise((resolve) => { releaseHung = resolve; });
    const rt = makeRuntime(async () => {
      calls += 1;
      if (calls === 1) return hung;
      return new Response(JSON.stringify({ revision: 9 }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const url = "https://backend.example/api/live/ABC234";
    const automatic = rt.window.fetch(url, { method: "GET" });
    assert.equal(calls, 1);
    rt.window.NVSSharedLiveTimeout0111.allowNextGet();
    const manual = rt.window.fetch(url, { method: "GET" });
    assert.equal(calls, 2, "manual Check now bypass must start a fresh GET instead of joining an already-hung coalesced poll");
    assert.deepEqual(await (await manual).json(), { revision: 9 }, "manual retry should receive the fresh request response independently");
    releaseHung(new Response(JSON.stringify({ revision: 8 }), { status: 200, headers: { "content-type": "application/json" } }));
    assert.deepEqual(await (await automatic).json(), { revision: 8 }, "the older automatic consumer should still be allowed to finish independently");
    await Promise.resolve();
    assert.equal(rt.window.NVSSharedLiveTimeout0111.getPendingGetCount(), 0, "manual replacement and older poll cleanup must leave no poisoned pending entry");
  }

  assert.match(source, /forceFresh = consumeGetBypass\(\)/, "manual bypass should explicitly force one fresh Shared Live GET");
  assert.match(source, /init\?\.method \|\| input\?\.method \|\| "GET"/, "request classification must honor methods carried by Request objects");
  assert.doesNotMatch(source, /localStorage|sessionStorage/, "GET coalescing state must remain memory-only");
  assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "Shared Live coalescing must not introduce location access");
  console.log("shared-live-coalescing: duplicate GET suppression, response isolation, POST independence including Request objects, retry cleanup, consumer cancellation and manual fresh-retry escape passed");
})().catch((error) => { console.error(error); process.exit(1); });