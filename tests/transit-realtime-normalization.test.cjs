const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "transit.js"), "utf8");

function itineraryWith(overrides = {}) {
  return {
    startTime: "2026-08-28T10:00:00Z",
    scheduledStartTime: "2026-08-28T10:00:00Z",
    endTime: "2026-08-28T10:20:00Z",
    scheduledEndTime: "2026-08-28T10:20:00Z",
    duration: 1200,
    legs: [{
      mode: "TRAM",
      displayName: "2",
      startTime: "2026-08-28T10:00:00Z",
      scheduledStartTime: "2026-08-28T10:00:00Z",
      endTime: "2026-08-28T10:20:00Z",
      scheduledEndTime: "2026-08-28T10:20:00Z",
      realTime: true,
      from: { name: "Start", track: "3", scheduledTrack: "1" },
      to: { name: "Finish", track: "5", scheduledTrack: "4" },
      intermediateStops: [{
        name: "Middle",
        arrival: "2026-08-28T10:10:00Z",
        scheduledArrival: "2026-08-28T10:09:00Z",
        departure: "2026-08-28T10:11:00Z",
        scheduledDeparture: "2026-08-28T10:10:00Z",
        track: "7",
        scheduledTrack: "6",
        isCancelled: true,
      }],
      ...overrides,
    }],
  };
}

function timedLeg(mode, startMinute, endMinute, displayName = "") {
  const iso = (minute) => `2026-08-28T10:${String(minute).padStart(2, "0")}:00Z`;
  return {
    mode,
    displayName,
    startTime: iso(startMinute),
    scheduledStartTime: iso(startMinute),
    endTime: iso(endMinute),
    scheduledEndTime: iso(endMinute),
    from: { name: `Stop ${startMinute}` },
    to: { name: `Stop ${endMinute}` },
  };
}

async function normalizedRoute(responseItinerary) {
  const responseBody = { itineraries: [responseItinerary] };
  const sandbox = {
    window: {},
    console,
    Date,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => responseBody,
    }),
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "transit.js" });
  const routes = await sandbox.window.NVSTransit.fetchRoutes("Lankow-Siedlung", "Marienplatz", new Date("2026-08-28T10:30:00Z"));
  assert.equal(routes.length, 1);
  return routes[0];
}

async function normalizedSegment(legOverrides = {}) {
  const route = await normalizedRoute(itineraryWith(legOverrides));
  return route.segments[0];
}

function mixedModeItinerary(modes, overrides = {}) {
  const legs = modes.map((mode, index) => timedLeg(mode, index * 5, index * 5 + 4, mode && `${index + 1}`));
  return {
    startTime: legs[0].startTime,
    scheduledStartTime: legs[0].scheduledStartTime,
    endTime: legs[legs.length - 1].endTime,
    scheduledEndTime: legs[legs.length - 1].scheduledEndTime,
    duration: (modes.length * 5 - 1) * 60,
    legs,
    ...overrides,
  };
}

(async () => {
  const segment = await normalizedSegment();
  assert.equal(segment.platformFrom, "3", "current departure track should stay visible");
  assert.equal(segment.plannedPlatformFrom, "1", "scheduled departure track should be preserved separately");
  assert.equal(segment.platformTo, "5", "current arrival track should stay visible");
  assert.equal(segment.plannedPlatformTo, "4", "scheduled arrival track should be preserved separately");

  assert.equal(segment.intermediateStops.length, 1);
  assert.equal(segment.intermediateStops[0].track, "7");
  assert.equal(segment.intermediateStops[0].plannedTrack, "6");
  assert.equal(segment.intermediateStops[0].cancelled, true, "stop-level isCancelled should normalize to cancelled");

  const scheduledOnly = await normalizedSegment({
    from: { name: "Start", scheduledTrack: "8" },
    to: { name: "Finish", scheduledTrack: "9" },
    intermediateStops: [],
  });
  assert.equal(scheduledOnly.platformFrom, "8", "scheduled track should remain a safe display fallback when no realtime track exists");
  assert.equal(scheduledOnly.plannedPlatformFrom, "8");
  assert.equal(scheduledOnly.platformTo, "9");
  assert.equal(scheduledOnly.plannedPlatformTo, "9");

  const cancelledFalse = await normalizedSegment({
    intermediateStops: [{
      name: "Middle",
      arrival: "2026-08-28T10:10:00Z",
      departure: "2026-08-28T10:11:00Z",
      isCancelled: false,
    }],
  });
  assert.equal(cancelledFalse.intermediateStops[0].cancelled, false);

  const bikeRoute = await normalizedRoute(mixedModeItinerary(["TRAM", "BIKE", "BUS"]));
  assert.equal(bikeRoute.transfers, 1, "bike legs must not inflate fallback public-transport transfer counts");

  const bicycleRoute = await normalizedRoute(mixedModeItinerary(["TRAM", "BICYCLE", "BUS"]));
  assert.equal(bicycleRoute.transfers, 1, "BICYCLE aliases must remain non-transit for fallback transfer counting");

  const carRoute = await normalizedRoute(mixedModeItinerary(["TRAM", "CAR", "BUS"]));
  assert.equal(carRoute.transfers, 1, "car legs must not inflate fallback public-transport transfer counts");

  const walkRoute = await normalizedRoute(mixedModeItinerary(["TRAM", "WALK", "BUS"]));
  assert.equal(walkRoute.transfers, 1, "walk legs must remain excluded from fallback transfer counting");

  const missingModeRoute = await normalizedRoute(mixedModeItinerary(["TRAM", "", "BUS"]));
  assert.equal(missingModeRoute.transfers, 1, "missing/unknown-empty mode data must not be assumed to be a transit ride");

  const futureTransitRoute = await normalizedRoute(mixedModeItinerary(["TRAM", "FUTURE_RAIL", "BUS"]));
  assert.equal(futureTransitRoute.transfers, 2, "named future transit modes should remain forward-compatible instead of being rejected by a brittle allowlist");

  const explicitTransfers = await normalizedRoute(mixedModeItinerary(["TRAM", "BIKE", "BUS"], { transfers: 4 }));
  assert.equal(explicitTransfers.transfers, 4, "provider-supplied transfer counts must remain authoritative when present");

  const explicitZeroTransfers = await normalizedRoute(mixedModeItinerary(["TRAM", "BUS"], { transfers: 0 }));
  assert.equal(explicitZeroTransfers.transfers, 0, "a real numeric provider transfer count of zero must remain authoritative");

  const nullTransfers = await normalizedRoute(mixedModeItinerary(["TRAM", "BUS"], { transfers: null }));
  assert.equal(nullTransfers.transfers, 1, "null provider transfer counts must fall back to the normalized transit-leg count");

  const blankTransfers = await normalizedRoute(mixedModeItinerary(["TRAM", "BUS"], { transfers: "" }));
  assert.equal(blankTransfers.transfers, 1, "blank provider transfer counts must not be coerced into an authoritative zero");

  const whitespaceTransfers = await normalizedRoute(mixedModeItinerary(["TRAM", "BUS"], { transfers: "   " }));
  assert.equal(whitespaceTransfers.transfers, 1, "whitespace-only provider transfer counts must use the fallback count");

  const numericStringTransfers = await normalizedRoute(mixedModeItinerary(["TRAM", "BUS", "TRAM"], { transfers: "2" }));
  assert.equal(numericStringTransfers.transfers, 2, "numeric-string provider transfer counts should stay accepted for API compatibility");

  assert.ok(!/watchPosition\s*\(/.test(source), "normalization must not introduce continuous location tracking");
  console.log("Transitous realtime and mixed-mode transfer normalization regression passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
