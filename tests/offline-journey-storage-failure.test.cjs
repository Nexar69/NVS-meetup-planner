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

function recoverableRuntime() {
  const listeners = {};
  const saved = new Map();
  let writesBlocked = false;
  const route = JSON.parse(JSON.stringify(assignment));
  const window = {
    NVSShare: {
      getSharedPlan: () => ({ planId: "recoverable-plan" }),
      getFocusIndex: () => 0,
    },
    NVSSharedLive: {
      getState: () => ({ expiresAt: "2026-08-30T09:00:00.000Z" }),
    },
    __NVS_LAST_RECOMMENDATIONS__: { primary: { assignments: [route] } },
    location: { pathname: "/p/recoverable", search: "?me=0" },
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
  const sessionStorage = {
    setItem(key, value) {
      if (writesBlocked) throw new Error("QUOTA_EXCEEDED_ERR");
      saved.set(key, String(value));
    },
    getItem(key) { return saved.has(key) ? saved.get(key) : null; },
    removeItem(key) { saved.delete(key); },
  };
  const context = {
    window,
    document,
    navigator: { onLine: true },
    sessionStorage,
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

  vm.runInNewContext(source, context, { filename: "offline-journey-v0111.js" });
  const api = window.NVSOfflineJourney0111;
  api.clearSnapshot();
  saved.clear();
  return {
    api,
    route,
    saved,
    window,
    setWritesBlocked(value) { writesBlocked = Boolean(value); },
  };
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

{
  const storageKey = "meet-schwerin-offline-journey-v1";
  const { api, route, saved, window, setWritesBlocked } = recoverableRuntime();
  const firstAt = new Date("2026-08-30T08:00:00.000Z");
  route.route.segments[0].line = "2";
  const persisted = api.capture(firstAt);
  assert.equal(JSON.parse(saved.get(storageKey)).segments[0].line, "2");

  setWritesBlocked(true);
  route.route.segments[0].line = "3";
  window.NVSSharedLive.getState = () => ({ expiresAt: "2026-08-30T10:00:00.000Z" });
  const memory = api.capture(new Date("2026-08-30T08:05:00.000Z"));
  assert.equal(memory.segments[0].line, "3");
  assert.equal(JSON.parse(saved.get(storageKey)).segments[0].line, "2", "failed newer writes should leave the older persisted copy untouched");

  const selectedWhileBlocked = api.readSnapshot(Date.parse("2026-08-30T08:06:00.000Z"));
  assert.equal(selectedWhileBlocked.segments[0].line, "3", "newer in-memory route must win over an older still-usable persisted route");
  assert.equal(selectedWhileBlocked.expiresAt, persisted.expiresAt, "arbitration must retain the stricter known authoritative expiry instead of extending the session");

  setWritesBlocked(false);
  const selectedAfterRecovery = api.readSnapshot(Date.parse("2026-08-30T08:07:00.000Z"));
  assert.equal(selectedAfterRecovery.segments[0].line, "3", "storage recovery must keep the newer memory route authoritative");
  const promoted = JSON.parse(saved.get(storageKey));
  assert.equal(promoted.segments[0].line, "3", "recovered sessionStorage should receive the newer memory fallback");
  assert.equal(promoted.expiresAt, persisted.expiresAt, "promotion must preserve the earliest known session expiry");

  setWritesBlocked(true);
  route.route.segments[0].line = "4";
  api.capture(new Date("2026-08-30T08:08:00.000Z"));
  saved.set(storageKey, JSON.stringify({ ...promoted, scope: "wrong-scope" }));
  const afterInvalidPersisted = api.readSnapshot(Date.parse("2026-08-30T08:09:00.000Z"));
  assert.equal(afterInvalidPersisted.segments[0].line, "4", "an invalid persisted copy must not erase a valid newer in-memory route");
}

assert.match(source, /memorySnapshot\s*=\s*snapshot/, "failed tab storage writes should use only an in-memory same-document fallback");
assert.match(source, /snapshotCapturedAtMs/, "storage arbitration should compare capture age instead of blindly preferring persistence");
assert.match(source, /strictestExpiry/, "storage arbitration should preserve the earliest known authoritative expiry");
assert.match(source, /try\s*\{\s*sessionStorage\.setItem/s, "tab fallback writes should remain isolated from storage exceptions");
assert.match(source, /sessionStorage\.getItem\(STORAGE_KEY\)/, "tab fallback reads should still consider tab-scoped sessionStorage when available");
assert.match(source, /memorySnapshot\s*=\s*null;\s*try \{ sessionStorage\.removeItem/s, "explicit cleanup should clear memory before attempting storage cleanup");
assert.doesNotMatch(source, /localStorage|indexedDB/i, "personal route fallback must never escape same-document/session storage scope");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "storage degradation must never introduce location tracking");

console.log("offline-journey-storage-failure: private-mode failures arbitrate persisted and memory routes by freshness, preserve strict expiry, recover sessionStorage safely, and never add durable storage or GPS");