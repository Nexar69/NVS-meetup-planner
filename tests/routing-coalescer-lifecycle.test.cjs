const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../routing-coalesce-v0111.js"), "utf8");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

(async () => {
  const providerCalls = [];
  const pendingByOrigin = new Map();
  const listeners = new Map();
  const documentListeners = new Map();

  const document = {
    hidden: false,
    addEventListener(name, handler) { documentListeners.set(name, handler); },
  };

  const window = {
    NVSTransit: Object.freeze({
      fetchRoutes(origin, destination, target) {
        providerCalls.push({ origin, destination, target });
        let request = pendingByOrigin.get(origin);
        if (!request) {
          request = deferred();
          pendingByOrigin.set(origin, request);
        }
        return request.promise;
      },
    }),
    addEventListener(name, handler) { listeners.set(name, handler); },
  };

  const context = {
    console,
    Date,
    Promise,
    Object,
    Array,
    Map,
    String,
    Number,
    Math,
    AbortController,
    queueMicrotask,
    document,
    window,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "routing-coalesce-v0111.js" });

  const transit = window.NVSTransit;
  const coalescer = window.NVSRoutingCoalescer0111;
  const target = new Date("2026-09-01T18:00:00.000Z");

  assert.equal(typeof listeners.get("pagehide"), "function", "routing should own pagehide cancellation");
  assert.equal(typeof listeners.get("pageshow"), "function", "routing should reopen lifecycle ownership on pageshow");
  assert.equal(typeof documentListeners.get("visibilitychange"), "function", "routing should cancel consumers when hidden");

  coalescer.beginPlannerConsumerBatch();
  const staleA = transit.fetchRoutes("A", "Meet", target);
  const staleB = transit.fetchRoutes("B", "Meet", target);
  await Promise.resolve();
  assert.equal(providerCalls.length, 2);
  assert.equal(coalescer.pendingCount(), 2);

  listeners.get("pagehide")();
  assert.equal(coalescer.isLifecycleFrozen(), true);
  const staleErrors = await Promise.all([
    staleA.then(() => null, (error) => error),
    staleB.then(() => null, (error) => error),
  ]);
  assert.ok(staleErrors.every((error) => coalescer.isConsumerAbort(error)), "pagehide must abort both stale ordinary-planner consumers");
  assert.equal(coalescer.pendingCount(), 2, "consumer suspension must not cancel shared provider work");

  listeners.get("pageshow")();
  assert.equal(coalescer.isLifecycleFrozen(), false);
  coalescer.beginPlannerConsumerBatch();
  const freshA = transit.fetchRoutes("A", "Meet", target);
  const freshB = transit.fetchRoutes("B", "Meet", target);
  await Promise.resolve();
  assert.equal(providerCalls.length, 2, "restored consumers should reuse still-useful in-flight provider requests");

  pendingByOrigin.get("A").resolve([{ id: "a", departure: target, arrival: target, segments: [] }]);
  pendingByOrigin.get("B").resolve([{ id: "b", departure: target, arrival: target, segments: [] }]);
  const [routesA, routesB] = await Promise.all([freshA, freshB]);
  assert.equal(routesA[0].id, "a");
  assert.equal(routesB[0].id, "b");
  assert.equal(coalescer.pendingCount(), 0);

  const hiddenProvider = deferred();
  pendingByOrigin.set("Hidden", hiddenProvider);
  coalescer.beginPlannerConsumerBatch();
  const hiddenConsumer = transit.fetchRoutes("Hidden", "Meet", target);
  await Promise.resolve();
  document.hidden = true;
  documentListeners.get("visibilitychange")();
  const hiddenError = await hiddenConsumer.then(() => null, (error) => error);
  assert.ok(coalescer.isConsumerAbort(hiddenError), "visibility loss must abort an active planner consumer");
  assert.equal(coalescer.pendingCount(), 1, "hidden cancellation must keep shared provider work alive");

  coalescer.beginPlannerConsumerBatch();
  hiddenProvider.resolve([{ id: "hidden-provider", departure: target, arrival: target, segments: [] }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(coalescer.pendingCount(), 0, "provider work should still settle normally while hidden");

  assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "routing lifecycle hardening must not add location access");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, "routing lifecycle ownership should remain memory-only");

  console.log("routing-coalescer-lifecycle: stale UI consumers abort on suspension while shared provider work survives");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
