const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../trip-guidance-v0111.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../trip-guidance-v0111.css"), "utf8");
const release = fs.readFileSync(path.resolve(__dirname, "../release-v011.js"), "utf8");

const window = {
  NVSShare: {
    getSharedPlan: () => null,
    getFocusIndex: () => -1,
  },
  addEventListener() {},
};
const document = {
  hidden: true,
  body: {},
  addEventListener() {},
  getElementById() { return null; },
};
class MutationObserver {
  observe() {}
}

vm.runInNewContext(source, {
  window,
  document,
  MutationObserver,
  Intl,
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

const guidanceForRoute = window.NVSTripGuidance0111?.guidanceForRoute;
assert.equal(typeof guidanceForRoute, "function", "trip guidance should expose its pure route guidance helper");

const at = (minutes) => new Date(Date.UTC(2026, 7, 25, 8, minutes, 0));
const now = at(10).getTime();

const transferGuidance = guidanceForRoute({
  segments: [
    {
      mode: "TRAM",
      modeLabel: "Tram",
      line: "2",
      from: "Rahlstedter Straße",
      to: "Stauffenbergstraße",
      departure: at(0),
      arrival: at(15),
    },
    {
      mode: "TRAM",
      modeLabel: "Tram",
      line: "3",
      from: "Stauffenbergstraße",
      to: "Krebsförden",
      departure: at(18),
      arrival: at(25),
    },
  ],
}, now);
assert.equal(transferGuidance.eyebrow, "Next important stop");
assert.match(transferGuidance.title, /Stauffenbergstraße in about 5 min/);
assert.match(transferGuidance.detail, /Get ready to leave at Stauffenbergstraße/);
assert.match(transferGuidance.detail, /Next: Tram 3/);
assert.match(transferGuidance.detail, /currently on Tram 2/);

const urgentGuidance = guidanceForRoute({
  segments: [{
    mode: "TRAM",
    modeLabel: "Tram",
    line: "3",
    from: "Stauffenbergstraße",
    to: "Krebsförden",
    departure: at(0),
    arrival: at(12),
  }],
}, now);
assert.equal(urgentGuidance.eyebrow, "Coming up soon");
assert.match(urgentGuidance.title, /Krebsförden in about 2 min/);
assert.match(urgentGuidance.detail, /ready to get off at Krebsförden/);

const walkContinuation = guidanceForRoute({
  segments: [
    {
      mode: "TRAM",
      modeLabel: "Tram",
      line: "3",
      from: "Stauffenbergstraße",
      to: "Krebsförden",
      departure: at(0),
      arrival: at(12),
    },
    {
      mode: "WALK",
      from: "Krebsförden",
      to: "Gymnasium Neumühler Schule",
      departure: at(12),
      arrival: at(25),
    },
  ],
}, now);
assert.match(walkContinuation.detail, /planned walking leg starts there/);

assert.match(source, /personalSharedPlan/);
assert.match(source, /sharedLiveV010/);
assert.match(source, /insertAdjacentElement\("afterend", sharedPanel\)/, "voluntary shared-live controls should be moved directly below the personal plan");
assert.match(source, /aria-live/);
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "guidance must remain timetable-only and never introduce location tracking");
assert.match(css, /body\.shared-viewer \.v051-viewing-chip\{display:none!important\}/, "shared viewers should not show the planner-only Viewing badge over the detailed journey header");
assert.match(css, /body\.shared-viewer \.result\.map-selected \.result-header\{padding-top:0\}/, "shared viewer headers should not reserve empty space for the hidden Viewing badge");
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /forced-colors/);
assert.match(release, /trip-guidance-v0111\.js/);
assert.match(release, /trip-guidance-v0111\.css/);

console.log("trip-guidance: executable approaching-stop, transfer, shared-view polish, placement, accessibility and no-GPS behavior passed");
