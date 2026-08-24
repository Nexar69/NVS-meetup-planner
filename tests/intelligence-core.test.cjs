const assert = require("node:assert/strict");
const core = require("../intelligence-core.js");

function at(minute) {
  return new Date(`2026-08-24T10:${String(minute).padStart(2, "0")}:00.000Z`);
}

function assignment(overrides = {}) {
  return {
    member: { id: "p1", name: "You" },
    route: {
      departure: at(10),
      arrival: at(40),
      segments: [
        {
          mode: "TRAM",
          modeLabel: "Tram",
          line: "4",
          from: "Marienplatz",
          to: "Krebsförden",
          departure: at(10),
          arrival: at(25),
          platformFrom: "C",
          plannedPlatformFrom: "C",
          departureDelay: 0,
          arrivalDelay: 0,
        },
        {
          mode: "BUS",
          modeLabel: "Bus",
          line: "7",
          from: "Krebsförden",
          to: "Meetup",
          departure: at(28),
          arrival: at(40),
          departureDelay: 0,
          arrivalDelay: 0,
        },
      ],
      ...overrides,
    },
  };
}

{
  const alerts = core.routeAlerts(assignment(), at(6));
  assert.equal(alerts.some((item) => item.kind === "leave"), true, "leave-soon alert should be produced");
}

{
  const alerts = core.routeAlerts(assignment(), at(22));
  assert.equal(alerts.some((item) => item.kind === "get-off"), true, "get-off alert should be produced near arrival");
  assert.equal(alerts.some((item) => item.kind === "transfer"), true, "tight transfer should be detected");
}

{
  const item = assignment();
  item.route.segments[0].departureDelay = 11;
  const alerts = core.routeAlerts(item, at(15));
  const delay = alerts.find((entry) => entry.kind === "disruption" && entry.delayMinutes);
  assert.ok(delay, "delay alert should be produced");
  assert.equal(delay.severity, "critical");
  assert.equal(delay.replan, true);
}

{
  const item = assignment();
  item.route.segments[0].plannedPlatformFrom = "B";
  item.route.segments[0].platformFrom = "C";
  const alerts = core.routeAlerts(item, at(15));
  assert.equal(alerts.some((entry) => entry.kind === "platform"), true, "platform changes should be detected");
}

{
  const events = [{ id: "join", time: at(24), label: "Gartenstadt", memberIds: ["p1"], members: [{ name: "You" }, { name: "Friend" }] }];
  const alerts = core.meetupAlerts(events, "p1", at(20));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "meetup");
}

{
  const state = { members: { "0": { status: "missed", note: "Tram 4", at: at(20).getTime() } } };
  const alerts = core.sharedAlerts(state, [{ name: "You" }], at(22));
  assert.equal(alerts.some((entry) => entry.kind === "recovery" && entry.replan), true, "fresh missed check-in should request recovery");
}

{
  const state = { members: { "0": { status: "missed", at: at(0).getTime() } } };
  const alerts = core.sharedAlerts(state, [{ name: "You" }], at(30));
  assert.equal(alerts.some((entry) => entry.kind === "stale-checkin"), true, "old check-ins should become stale");
  assert.equal(alerts.some((entry) => entry.kind === "recovery"), false, "stale missed status must not keep forcing recovery");
}

{
  const ranked = core.rankAlerts([
    { id: "a", severity: "info" },
    { id: "b", severity: "critical" },
    { id: "c", severity: "action" },
  ]);
  assert.equal(ranked[0].id, "b", "critical alerts should rank first");
}

console.log("intelligence-core: all tests passed");
