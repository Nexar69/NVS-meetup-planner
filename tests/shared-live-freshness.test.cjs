const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../shared-live-freshness-v0111.js"), "utf8");
const release = fs.readFileSync(path.resolve(__dirname, "../release-v011.js"), "utf8");
const serviceWorker = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

const classes = new Set(["v010-person", "manual", "warn"]);
const label = { textContent: "! Missed it" };
const detail = { textContent: "confirmed 20 min ago" };
const sourceBadge = { textContent: "CONFIRMED", title: "" };
const row = {
  dataset: {},
  classList: {
    add: (...names) => names.forEach((name) => classes.add(name)),
    remove: (...names) => names.forEach((name) => classes.delete(name)),
  },
  querySelector(selector) {
    if (selector === "small") return label;
    if (selector === "em") return detail;
    if (selector === ".v010-source") return sourceBadge;
    return null;
  },
};
const list = { querySelectorAll: () => [row] };
const sharedPanel = {
  hidden: false,
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
};
const guidancePanel = {
  hidden: false,
  dataset: {},
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
  removeAttribute(name) { delete this.attributes[name]; },
};
const now = Date.now();
const state = { members: { "0": { status: "missed", at: now - 20 * 60_000 } } };
const handlers = {};
const dispatched = [];
let reloads = 0;
const window = {
  location: {
    pathname: "/p/ABCDEF",
    reload() { reloads += 1; },
  },
  __NVS_LAST_RECOMMENDATIONS__: { primary: { assignments: [{ route: { segments: [] } }] } },
  NVSSharedLive: { getState: () => state },
  NVSLiveMeetup: { routeState: () => ({ label: "On Tram 2", detail: "Expected toward Stauffenbergstraße" }) },
  NVSIntelligenceCore: {
    checkinFreshness(entry, date) {
      const ageMs = Math.max(0, date.getTime() - Number(entry?.at));
      return { fresh: ageMs <= 15 * 60_000, stale: ageMs > 15 * 60_000, ageMs, ageMinutes: ageMs / 60_000 };
    },
  },
  addEventListener(type, handler) { handlers[type] = handler; },
  dispatchEvent(event) { dispatched.push(event); return true; },
};
const document = {
  hidden: true,
  documentElement: { dataset: {} },
  getElementById(id) {
    if (id === "v010StatusList") return list;
    if (id === "sharedLiveV010") return sharedPanel;
    if (id === "v0111TripGuidance") return guidancePanel;
    return null;
  },
  addEventListener() {},
};
class FakeCustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}

vm.runInNewContext(source, {
  window,
  document,
  CustomEvent: FakeCustomEvent,
  Date,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Object,
  setTimeout,
  clearTimeout,
});

const api = window.NVSSharedLiveFreshness0111;
assert.ok(api, "freshness guard should expose a testable API");
assert.equal(api.getScopedPlanId(), "ABCDEF", "the guard should bind itself to the current shared-plan path");
assert.equal(api.freshnessFor({ at: now - 16 * 60_000 }, now).stale, true);
assert.equal(api.freshnessFor({ at: now - 2 * 60_000 }, now).fresh, true);
assert.equal(api.freshnessFor({ at: now + 4 * 60_000 }, now).fresh, true,
  "small clock skew should not discard a valid voluntary check-in");
const impossibleFuture = api.freshnessFor({ at: now + 6 * 60_000 }, now);
assert.equal(impossibleFuture.fresh, false,
  "a check-in too far in the future must never remain authoritative until the client clock catches up");
assert.equal(impossibleFuture.stale, true);
assert.equal(impossibleFuture.future, true);

assert.equal(api.refresh(now), 1, "one stale voluntary row should be downgraded");
assert.equal(classes.has("manual"), false, "stale rows must stop looking like current manual confirmations");
assert.equal(classes.has("estimated"), true, "stale rows should fall back to timetable styling");
assert.equal(classes.has("stale-confirmation"), true);
assert.equal(row.dataset.v0111Freshness, "stale");
assert.equal(label.textContent, "On Tram 2");
assert.match(detail.textContent, /Expected toward Stauffenbergstraße/);
assert.match(detail.textContent, /last voluntary check-in about 20 min ago/);
assert.equal(sourceBadge.textContent, "STALE · TIMETABLE");
assert.match(sourceBadge.title, /older than 15 minutes/);

state.members["0"] = { status: "arrived", at: now + 10 * 60_000 };
assert.equal(api.refresh(now), 1, "an impossible future voluntary timestamp should be downgraded immediately");
assert.equal(row.dataset.v0111Freshness, "invalid-future");
assert.equal(sourceBadge.textContent, "INVALID TIME · TIMETABLE");
assert.match(detail.textContent, /invalid future timestamp/);
assert.match(sourceBadge.title, /too far in the future/);

assert.equal(typeof handlers["nvs-shared-live-change"], "function");
assert.doesNotThrow(() => handlers["nvs-shared-live-change"]({ type: "nvs-shared-live-change" }), "DOM events must not be mistaken for timestamps");
assert.equal(sourceBadge.textContent, "INVALID TIME · TIMETABLE");

window.location.pathname = "/p/BCDEFG";
assert.equal(api.enforcePlanScope(), true,
  "a same-document shared-plan path change must become an immediate trust boundary");
assert.equal(reloads, 1, "cross-plan state should recover through a clean document reload");
assert.equal(sharedPanel.hidden, true, "the old Shared Live panel must fail closed before reload");
assert.equal(sharedPanel.attributes["aria-hidden"], "true", "old shared state must leave the accessibility tree too");
assert.equal(sharedPanel.attributes.inert, "", "old shared controls must become non-interactive before recovery reload");
assert.equal(guidancePanel.hidden, true, "route-derived intelligence must not remain visible under the new plan path");
assert.equal(guidancePanel.attributes.inert, "", "stale route-derived controls must not remain focusable or clickable during scope recovery");
assert.equal(document.documentElement.dataset.nvsSharedPlanScopeChanging, "true");
assert.equal(dispatched.at(-1)?.type, "nvs-shared-plan-scope-change",
  "scope changes should publish a privacy-safe lifecycle signal without plan identifiers");
assert.equal(api.routeIntelligenceBlocked(), true,
  "the in-flight recovery itself must remain a trust boundary until the replacement document loads");
assert.doesNotThrow(() => handlers["nvs-shared-live-change"]({ type: "nvs-shared-live-change" }),
  "a late old-plan Shared Live event may arrive before reload finishes but must be ignored");
assert.equal(sharedPanel.hidden, true, "late live events must not revive the old Shared Live surface during recovery");
assert.equal(guidancePanel.hidden, true, "late live events must not unhide stale route intelligence during recovery");
assert.equal(guidancePanel.attributes["aria-hidden"], "true");
assert.equal(guidancePanel.attributes.inert, "");
assert.equal(reloads, 1, "late events must not cause a second recovery reload");
assert.equal(api.enforcePlanScope(), false, "the same replacement plan must not trigger a reload loop");
assert.equal(reloads, 1);

assert.match(release, /loadSharedLiveFreshness0111/, "release owner must load the stale-status consistency guard");
assert.match(release, /shared-live-freshness-v0111\.js/);
assert.match(serviceWorker, /shared-live-freshness-v0111\.js/, "stale-status consistency guard must be available in the offline shell");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "freshness handling must not introduce location tracking");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i,
  "cross-plan ownership must remain memory-only rather than persisting personal live state");
assert.match(source, /document\.hidden/, "periodic freshness checks should pause while hidden");
assert.match(source, /nvs-shared-live-change/, "shared-live events should trigger freshness and plan-trust reevaluation");
assert.match(source, /MAX_FUTURE_SKEW_MS/, "freshness handling should bound tolerated client/server clock skew");
assert.match(source, /nvs-shared-plan-scope-change/,
  "same-document plan changes should expose a lifecycle boundary for adjacent recovery modules");
assert.match(source, /scopeReloading \|\| hasPendingPlanUpdate\(\) \|\| sharedSessionExpired/,
  "route intelligence must remain blocked for the entire cross-plan recovery window");
assert.match(source, /setAttribute\?\.\("inert", ""\)/,
  "cross-plan fail-closed recovery should make stale interactive surfaces inert before reload");
assert.doesNotMatch(JSON.stringify(dispatched), /ABCDEF|BCDEFG|\/p\//,
  "scope-change lifecycle events must not leak shared plan IDs or paths");

console.log("shared-live-freshness: stale timestamps and cross-plan same-document state fail closed");