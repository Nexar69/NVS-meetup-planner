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
  const calls = [];
  const first = deferred();
  let implementation = () => first.promise;

  const baseTransit = Object.freeze({
    fetchRoutes(origin, destination, target) {
      calls.push({ origin, destination, target });
      return implementation(origin, destination, target);
    },
    registerLocation() {},
  });

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
    window: { NVSTransit: baseTransit },
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "routing-coalesce-v0111.js" });

  const transit = context.window.NVSTransit;
  assert.equal(transit.v0111RequestCoalescing, true, "coalescer should mark the wrapped transit runtime");
  assert.equal(typeof context.window.NVSRoutingCoalescer0111?.pendingCount, "function");

  const target = new Date("2026-08-25T08:00:00.000Z");
  const requestA = transit.fetchRoutes("A", "B", target);
  const requestB = transit.fetchRoutes("A", "B", new Date("2026-08-25T08:02:00.000Z"));
  await Promise.resolve();

  assert.equal(calls.length, 1, "same route inside the provider cache bucket should share one network request");
  assert.equal(context.window.NVSRoutingCoalescer0111.pendingCount(), 1);

  first.resolve([{
    id: "r1",
    departure: target,
    arrival: new Date("2026-08-25T08:20:00.000Z"),
    segments: [{ departure: target, arrival: new Date("2026-08-25T08:20:00.000Z"), geometry: [[53.6, 11.4]] }],
  }]);

  const [routesA, routesB] = await Promise.all([requestA, requestB]);
  assert.equal(context.window.NVSRoutingCoalescer0111.pendingCount(), 0, "settled requests must leave the pending registry");
  assert.notEqual(routesA, routesB, "callers should receive separate arrays");
  assert.notEqual(routesA[0], routesB[0], "callers should receive separate mutable route objects");
  assert.ok(routesA[0].departure instanceof Date, "route cloning must preserve Date objects");
  routesA[0].segments[0].geometry[0][0] = 0;
  assert.equal(routesB[0].segments[0].geometry[0][0], 53.6, "one consumer must not mutate another consumer's route data");

  implementation = async () => [];
  await transit.fetchRoutes("A", "B", new Date("2026-08-25T08:05:00.000Z"));
  assert.equal(calls.length, 2, "a different five-minute bucket should start a new request");
  await transit.fetchRoutes("C", "B", target);
  assert.equal(calls.length, 3, "a different origin should start a new request");

  let failures = 0;
  implementation = async () => {
    failures += 1;
    throw new Error("provider down");
  };
  await assert.rejects(() => transit.fetchRoutes("X", "Y", target), /provider down/);
  assert.equal(context.window.NVSRoutingCoalescer0111.pendingCount(), 0, "failed requests must not poison the pending registry");
  await assert.rejects(() => transit.fetchRoutes("X", "Y", target), /provider down/);
  assert.equal(failures, 2, "a later retry must be allowed after a failed request");

  console.log("routing-coalescer: duplicate suppression, isolation and retry behavior passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
