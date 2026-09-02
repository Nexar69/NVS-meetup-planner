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

const transferRoute = {
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
};
const transferGuidance = guidanceForRoute(transferRoute, now);
assert.equal(transferGuidance.eyebrow, "Next important stop");
assert.match(transferGuidance.title, /Stauffenbergstraße in about 5 min/);
assert.match(transferGuidance.detail, /Get ready to leave at Stauffenbergstraße/);
assert.match(transferGuidance.detail, /Next: Tram 3/);
assert.match(transferGuidance.detail, /currently on Tram 2/);

const confirmedOnVehicle = guidanceForRoute(transferRoute, now, { status: "on-vehicle" });
assert.equal(confirmedOnVehicle.eyebrow, "Confirmed on board");
assert.match(confirmedOnVehicle.title, /Stauffenbergstraße in about 5 min/);
assert.match(confirmedOnVehicle.detail, /voluntary check-in confirms you're on board/);
assert.match(confirmedOnVehicle.detail, /Next: Tram 3/);

const futureRoute = {
  segments: [{
    mode: "TRAM",
    modeLabel: "Tram",
    line: "4",
    from: "Marienplatz",
    to: "Platz der Freiheit",
    departure: at(14),
    arrival: at(20),
  }],
};
const confirmedAtStop = guidanceForRoute(futureRoute, now, { status: "at-stop" });
assert.equal(confirmedAtStop.eyebrow, "Confirmed by you");
assert.match(confirmedAtStop.title, /You're at a stop/);
assert.match(confirmedAtStop.detail, /Next planned service: Tram 4 from Marienplatz/);
assert.match(confirmedAtStop.detail, /be ready to board/);

const conflictingAtStop = guidanceForRoute(transferRoute, now, { status: "at-stop" });
assert.match(conflictingAtStop.detail, /differs from the timetable/);
assert.match(conflictingAtStop.detail, /expects Tram 2 to be underway/);
assert.doesNotMatch(conflictingAtStop.detail, /You're currently on Tram 2/, "an explicit at-stop check-in must not be contradicted by inferred riding copy");

const aheadOfTimetableOnVehicle = guidanceForRoute(futureRoute, now, { status: "on-vehicle" });
assert.equal(aheadOfTimetableOnVehicle.eyebrow, "Confirmed on board");
assert.match(aheadOfTimetableOnVehicle.title, /You're on board/);
assert.match(aheadOfTimetableOnVehicle.detail, /check-in is ahead of the timetable state/);
assert.match(aheadOfTimetableOnVehicle.detail, /Tram 4/);

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

const oneMinuteGuidance = guidanceForRoute({
  segments: [{
    mode: "TRAM",
    modeLabel: "Tram",
    line: "3",
    from: "Stauffenbergstraße",
    to: "Krebsförden",
    departure: at(0),
    arrival: new Date(now + 30_000),
  }],
}, now);
assert.equal(oneMinuteGuidance.eyebrow, "Your stop is coming up");
assert.match(oneMinuteGuidance.title, /Krebsförden in about 1 min/);
assert.match(oneMinuteGuidance.detail, /Stay aware of your stop/);

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

const sampleRoute = {
  segments: [{
    mode: "TRAM",
    modeLabel: "Tram",
    line: "3",
    from: "Stauffenbergstraße",
    to: "Krebsförden",
    departure: at(0),
    arrival: at(12),
  }],
};
const missedGuidance = guidanceForRoute(sampleRoute, now, { status: "missed" });
assert.equal(missedGuidance.eyebrow, "Your voluntary update");
assert.match(missedGuidance.title, /reported a missed connection/);
assert.match(missedGuidance.detail, /Recovery Desk|fresh route/);
assert.doesNotMatch(missedGuidance.detail, /currently on Tram 3/, "a fresh missed-connection report must override contradictory timetable riding copy");

const arrivedGuidance = guidanceForRoute(sampleRoute, now, { status: "arrived" });
assert.equal(arrivedGuidance.eyebrow, "Confirmed by you");
assert.match(arrivedGuidance.title, /You're at the meetup/);
assert.match(arrivedGuidance.detail, /voluntary arrival check-in/);

const ordinaryWithNonOverrideStatus = guidanceForRoute(sampleRoute, now, { status: "left" });
assert.match(ordinaryWithNonOverrideStatus.title, /Krebsförden/);

assert.match(source, /personalSharedPlan/);
assert.match(source, /sharedLiveV010/);
assert.match(source, /insertAdjacentElement\("afterend", sharedPanel\)/, "voluntary shared-live controls should be moved directly below the personal plan");
assert.match(source, /function removeGuidance\(\)/, "stale guidance should be removable when a personal route disappears");
assert.match(source, /mutationRefreshQueued/, "DOM mutation refreshes should be coalesced instead of rerendering for every mutation");
assert.match(source, /checkinFreshness/, "trip guidance should honor the same stale-check-in policy as meetup intelligence");
assert.match(source, /15 \* 60_000/, "trip guidance should retain a safe 15-minute freshness fallback if the intelligence core is unavailable");
assert.match(source, /Confirmed on board/, "fresh on-vehicle reports should be reflected explicitly instead of contradicted by timetable-only state");
assert.match(source, /You're at a stop/, "fresh at-stop reports should be reflected explicitly instead of contradicted by timetable-only state");
assert.match(source, /aria-live/);
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "guidance must remain timetable-only and never introduce location tracking");
assert.match(css, /body\.shared-viewer \.v051-viewing-chip\{display:none!important\}/, "shared viewers should not show the planner-only Viewing badge over the detailed journey header");
assert.match(css, /body\.shared-viewer \.result\.map-selected \.result-header\{padding-top:0\}/, "shared viewer headers should not reserve empty space for the hidden Viewing badge");
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /forced-colors/);
assert.match(release, /trip-guidance-v0111\.js/);
assert.match(release, /trip-guidance-v0111\.css/);

console.log("trip-guidance: executable approaching-stop, transfer, voluntary on-board/at-stop/missed/arrived precedence, shared-view polish, stale cleanup, placement, accessibility and no-GPS behavior passed");
