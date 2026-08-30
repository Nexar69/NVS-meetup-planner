const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../offline-journey-v0111.js"), "utf8");

const assignment = {
  member: { id: "private-member", name: "Private Person" },
  route: {
    arrival: "2026-08-30T08:40:00.000Z",
    segments: [{
      mode: "TRAM",
      modeLabel: "Tram",
      line: "2",
      from: "Marienplatz",
      to: "Krebsförden",
      departure: "2026-08-30T08:10:00.000Z",
      arrival: "2026-08-30T08:30:00.000Z",
    }],
  },
};

function runtime({ storageMode = "methods-throw" } = {}) {
  const listeners = {};
  const window = {
    NVSShare: {
      getSharedPlan: () => ({ planId: "private-plan" }),
      getFocusIndex: () => 0,
    },
    NVSSharedLive: {
      getState: () => ({ expiresAt: "2026-08-30T10:00:00.000Z" }),
    },
    __NVS_LAST_RECOMMENDATIONS__: { primary: { assignments: [assignment] } },
    location: { pathname: "/p/private", search: "?me=0" },
    addEventListener(name, fn) { listeners[name] = fn; },
  };
  const document = {
    hidden: false,
    getElementById() { return null; },
    querySelector() { return null; },
    addEventListener() {},
  };
  const context = {
    window,
    document,
    navigator: { onLine: true },
    URLSearchParams,
    Intl,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    setTimeout() { return 1; },
    clearTimeout() {},
  };

  if (storageMode === "accessor-throws") {
    Object.defineProperty(context, "sessionStorage", {
      configurable: true,
      get() { throw new Error("SECURITY_ERR"); },
    });
  } else {
    context.sessionStorage = {
      setItem() { throw new Error("QUOTA_EXCEEDED_ERR"); },
      getItem() { throw new Error("SECURITY_ERR"); },
      removeItem() { throw new Error("SECURITY_ERR"); },
    };
  }

  assert.doesNotThrow(() => vm.runInNewContext(source, context, { filename: "offline-journey-v0111.js" }), `${storageMode}: module bootstrap must survive unavailable tab storage`);
  return { api: window.NVSOfflineJourney0111, listeners };
}

for (const storageMode of ["methods-throw", "accessor-throws"]) {
  const { api, listeners } = runtime({ storageMode });
  assert.equal(typeof api?.capture, "function");
  assert.equal(typeof api?.readSnapshot, "function");
  assert.equal(typeof api?.clearSnapshot, "function");
  assert.equal(typeof api?.reconcileAuthoritativeExpiry, "function");

  const now = new Date("2026-08-30T08:00:00.000Z");
  const snapshot = api.capture(now);
  assert.equal(snapshot?.segments?.length, 1, `${storageMode}: a usable route may still be sanitized even when persistence is unavailable`);
  assert.equal(snapshot?.expiresAt, "2026-08-30T10:00:00.000Z");
  assert.equal(api.readSnapshot(now.getTime() + 60_000), null, `${storageMode}: blocked storage must fail closed instead of inventing a persisted fallback`);
  assert.doesNotThrow(() => api.clearSnapshot(), `${storageMode}: cleanup must remain safe when removeItem is unavailable`);
  assert.equal(api.reconcileAuthoritativeExpiry(now.getTime() + 60_000), null, `${storageMode}: expiry reconciliation must safely no-op without a readable snapshot`);
  assert.doesNotThrow(() => listeners["nvs-shared-session-expired"]?.(), `${storageMode}: authoritative expiry events must remain safe under storage failure`);
}

assert.match(source, /try\s*\{\s*sessionStorage\.setItem/s, "tab fallback writes should be isolated from storage exceptions");
assert.match(source, /try\s*\{\s*const parsed = JSON\.parse\(sessionStorage\.getItem/s, "tab fallback reads should be isolated from storage exceptions");
assert.match(source, /try \{ sessionStorage\.removeItem\(STORAGE_KEY\); \} catch \{\}/, "tab fallback cleanup should tolerate storage exceptions");
assert.doesNotMatch(source, /localStorage|indexedDB/i, "personal route fallback must not escape tab-scoped storage when sessionStorage is unavailable");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "storage degradation must never introduce location tracking");

console.log("offline-journey-storage-failure: blocked/private-mode sessionStorage fails closed without crashing, durable fallback, or GPS escalation");
