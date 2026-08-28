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

async function normalizedSegment(legOverrides = {}) {
  const responseBody = { itineraries: [itineraryWith(legOverrides)] };
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
  return routes[0].segments[0];
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

  assert.ok(!/watchPosition\s*\(/.test(source), "normalization must not introduce continuous location tracking");
  console.log("Transitous realtime normalization regression passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
