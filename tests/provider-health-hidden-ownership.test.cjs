const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../provider-health-v0111.js"), "utf8");

(async () => {
  let fetches = 0;
  let nextTimerId = 1;
  const timers = new Map();
  const windowHandlers = new Map();
  const documentHandlers = new Map();

  const document = {
    hidden: true,
    getElementById() { return null; },
    createElement() { throw new Error("hidden provider health must not create DOM"); },
    addEventListener(name, handler) { documentHandlers.set(name, handler); },
  };

  const window = {
    NVSConfig: { backendUrl: "https://backend.example.test" },
    NVSTransit: { getProviderStatus: () => ({ provider: "VMV", fallback: false }) },
    addEventListener(name, handler) { windowHandlers.set(name, handler); },
  };

  const navigator = { onLine: true };
  const fetch = async (url, options) => {
    fetches += 1;
    assert.equal(url, "https://backend.example.test/api/health");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    return {
      ok: true,
      async json() {
        return {
          ok: true,
          release: "v0.11.1",
          capabilities: {
            sharedCheckins: true,
            organizerReplan: true,
            capabilityRevocation: true,
            realtimeDisruptions: true,
            authoritativeExpiry: true,
          },
        };
      },
    };
  };

  function setTimeout(callback, delay) {
    const id = nextTimerId++;
    timers.set(id, { callback, delay });
    return id;
  }
  function clearTimeout(id) { timers.delete(id); }

  vm.runInNewContext(source, {
    window,
    document,
    navigator,
    fetch,
    AbortController,
    Object,
    String,
    Boolean,
    Number,
    Math,
    Date,
    Error,
    setTimeout,
    clearTimeout,
  });

  assert.ok(window.NVSProviderHealth0111, "provider health should expose its testable API");
  assert.equal(fetches, 0, "booting in a hidden document must not start a health probe");
  assert.equal(timers.size, 0, "booting hidden must not arm periodic or timeout work");

  await window.NVSProviderHealth0111.check();
  assert.equal(fetches, 0, "direct checks must fail closed while hidden");

  windowHandlers.get("online")?.();
  windowHandlers.get("offline")?.();
  windowHandlers.get("nvs-routing-provider")?.();
  windowHandlers.get("nvs-group-recommendations-rendered")?.();
  assert.equal(fetches, 0, "ordinary hidden events must not trigger backend work");

  document.hidden = false;
  documentHandlers.get("visibilitychange")?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fetches, 1, "becoming visible should reconcile provider health once");

  const periodic = [...timers.values()].find((entry) => entry.delay === 5 * 60 * 1000);
  assert.ok(periodic, "visible health reconciliation should own a periodic callback");

  document.hidden = true;
  periodic.callback();
  await Promise.resolve();
  assert.equal(fetches, 1, "a stale periodic callback that races after hiding must not start a request");

  windowHandlers.get("online")?.();
  windowHandlers.get("offline")?.();
  assert.equal(fetches, 1, "network changes after hiding must stay background-inert");

  const state = window.NVSProviderHealth0111.getState();
  assert.equal(state.status, "good", "the last visible authoritative health result should remain intact while hidden");
  assert.doesNotMatch(source, /geolocation|watchPosition|getCurrentPosition/i,
    "hidden-work hardening must not introduce location access");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
    "provider health lifecycle state must remain memory-only");

  console.log("provider-health-hidden-ownership: hidden boot, stale timer and network events perform zero backend/DOM work");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
