const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let source = fs.readFileSync(path.resolve(__dirname, "../shared-live-v010.js"), "utf8");
source = source.replace(
  /\n  start\(\);\n\}\)\(\);\s*$/,
  "\n  window.__NVSSharedLiveSchedulerTest = Object.freeze({ schedulePoll });\n})();\n",
);
assert.match(source, /__NVSSharedLiveSchedulerTest/, "test instrumentation should expose schedulePoll without changing production source");

function makeRuntime(hidden) {
  const timers = [];
  const cleared = [];
  let nextId = 1;
  const documentHandlers = {};

  const document = {
    hidden,
    addEventListener(name, handler) { documentHandlers[name] = handler; },
  };
  const window = {
    location: { pathname: "/p/ABCDEF", search: "", hash: "", origin: "https://app.example" },
    history: { state: null, replaceState() {} },
    addEventListener() {},
    NVSShare: { getSharedPlan: () => null, getFocusIndex: () => -1 },
  };

  const context = {
    window,
    document,
    Object,
    URLSearchParams,
    console,
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.push({ id, callback, delay });
      return id;
    },
    clearTimeout(id) { if (id != null) cleared.push(id); },
    fetch: async () => { throw new Error("network should not be needed for scheduler test"); },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  };
  vm.runInNewContext(source, context, { filename: "shared-live-v010.js" });
  return { window, document, documentHandlers, timers, cleared };
}

{
  const rt = makeRuntime(true);
  rt.window.__NVSSharedLiveSchedulerTest.schedulePoll();
  assert.equal(rt.timers.length, 0, "hidden shared pages must not arm polling wakeups");
}

{
  const rt = makeRuntime(false);
  rt.window.__NVSSharedLiveSchedulerTest.schedulePoll();
  assert.equal(rt.timers.length, 1, "visible shared pages should arm one polling wakeup");
  assert.equal(rt.timers[0].delay, 12_000, "shared-live polling cadence should remain 12 seconds");

  rt.window.__NVSSharedLiveSchedulerTest.schedulePoll(250);
  assert.equal(rt.cleared.includes(rt.timers[0].id), true, "rescheduling should cancel the previous timer");
  assert.equal(rt.timers.at(-1).delay, 250, "explicit immediate/resume scheduling should honor its delay");
}

console.log("shared-live-scheduler: hidden/visible polling lifecycle passed");
