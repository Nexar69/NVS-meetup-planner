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
const now = Date.now();
const state = { members: { "0": { status: "missed", at: now - 20 * 60_000 } } };
const handlers = {};
const window = {
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
};
const document = {
  hidden: true,
  getElementById(id) { return id === "v010StatusList" ? list : null; },
  addEventListener() {},
};

vm.runInNewContext(source, {
  window,
  document,
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
assert.equal(api.freshnessFor({ at: now - 16 * 60_000 }, now).stale, true);
assert.equal(api.freshnessFor({ at: now - 2 * 60_000 }, now).fresh, true);
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

assert.equal(typeof handlers["nvs-shared-live-change"], "function");
assert.doesNotThrow(() => handlers["nvs-shared-live-change"]({ type: "nvs-shared-live-change" }), "DOM events must not be mistaken for timestamps");
assert.equal(sourceBadge.textContent, "STALE · TIMETABLE");

assert.match(release, /loadSharedLiveFreshness0111/, "release owner must load the stale-status consistency guard");
assert.match(release, /shared-live-freshness-v0111\.js/);
assert.match(serviceWorker, /shared-live-freshness-v0111\.js/, "stale-status consistency guard must be available in the offline shell");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "freshness handling must not introduce location tracking");
assert.match(source, /document\.hidden/, "periodic freshness checks should pause while hidden");
assert.match(source, /nvs-shared-live-change", \(\) => refresh\(\)/, "shared-live events should trigger a fresh timestamp instead of passing the Event object through");

console.log("shared-live-freshness: stale manual confirmations downgrade to timetable guidance after 15 minutes");
