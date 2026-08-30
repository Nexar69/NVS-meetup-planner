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
    createElement() {
      return {
        id: "",
        className: "",
        innerHTML: "",
        setAttribute() {},
        remove() {},
      };
    },
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
  return { api: window.NVSOfflineJourney0111, listeners, window };
}

for (const storageMode of ["methods-throw", "accessor-throws"]) {
  const { api, listeners, window } = runtime({ storageMode });
  assert.equal(typeof api?.capture, "function");
  assert.equal(typeof api?.readSnapshot, "function");
  assert.equal(typeof api?.clearSnapshot, "function");
  assert.equal(typeof api?.reconcileAuthoritativeExpiry, "function");

  const now = new Date("2026-08-30T08:00:00.000Z");
  const snapshot = api.capture(now);
  assert.equal(snapshot?.segments?.length, 1, `${storageMode}: a usable route should still be sanitized when tab persistence is unavailable`);
  assert.equal(snapshot?.expiresAt, "2026-08-30T10:00:00.000Z");

  const recovered = api.readSnapshot(now.getTime() + 60_000);
  assert.equal(recovered?.capturedAt, snapshot.capturedAt, `${storageMode}: failed sessionStorage writes should retain a same-document memory fallback`);
  assert.equal(recovered?.scope, snapshot.scope);

  window.NVSSharedLive.getState = () => ({ expiresAt: "2026-08-30T09:00:00.000Z" });
  const reconciled = api.reconcileAuthoritativeExpiry(now.getTime() + 2 * 60_000);
  assert.equal(reconciled?.expiresAt, "2026-08-30T09:00:00.000Z", `${storageMode}: memory fallback should still honor newly learned authoritative expiry`);
  assert.equal(api.readSnapshot(Date.parse("2026-08-30T09:00:00.000Z")), null, `${storageMode}: memory fallback must disappear exactly at authoritative expiry`);

  api.capture(now);
  window.location.search = "?me=1";
  assert.equal(api.readSnapshot(now.getTime() + 60_000), null, `${storageMode}: memory fallback must not cross a personal-view scope change`);
  window.location.search = "?me=0";

  api.capture(now);
  assert.doesNotThrow(() => api.clearSnapshot(), `${storageMode}: cleanup must remain safe when removeItem is unavailable`);
  assert.equal(api.readSnapshot(now.getTime() + 60_000), null, `${storageMode}: explicit cleanup must clear the memory fallback too`);
  assert.doesNotThrow(() => listeners["nvs-shared-session-expired"]?.(), `${storageMode}: authoritative expiry events must remain safe under storage failure`);
}

assert.match(source, /memorySnapshot\s*=\s*snapshot/, "failed tab storage writes should use only an in-memory same-document fallback");
assert.match(source, /try\s*\{\s*sessionStorage\.setItem/s, "tab fallback writes should remain isolated from storage exceptions");
assert.match(source, /sessionStorage\.getItem\(STORAGE_KEY\)/, "tab fallback reads should still prefer tab-scoped sessionStorage when available");
assert.match(source, /memorySnapshot\s*=\s*null;\s*try \{ sessionStorage\.removeItem/s, "explicit cleanup should clear memory before attempting storage cleanup");
assert.doesNotMatch(source, /localStorage|indexedDB/i, "personal route fallback must never escape same-document/session storage scope");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "storage degradation must never introduce location tracking");

console.log("offline-journey-storage-failure: private-mode storage failures retain only a scope-bound, expiry-bound memory fallback without durable storage or GPS escalation");
