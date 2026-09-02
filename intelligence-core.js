((root, factory) => {
  const api = factory();
  if (root) root.NVSIntelligenceCore = Object.freeze(api);
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const MINUTE = 60_000;
  const DEFAULT_STALE_MS = 15 * MINUTE;
  const DEFAULT_FUTURE_SKEW_MS = 5 * MINUTE;
  const SEVERITY = { critical: 5, warn: 4, action: 3, info: 2, good: 1 };

  function asDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function minutesBetween(a, b) {
    const first = asDate(a);
    const second = asDate(b);
    if (!first || !second) return null;
    return (second.getTime() - first.getTime()) / MINUTE;
  }

  function minutesUntil(value, now = new Date()) {
    return minutesBetween(now, value);
  }

  // VMV delay values may be negative when a vehicle is running early. Only
  // positive delay should be described as "late" or used as group-impact delay.
  function segmentDelay(segment) {
    const values = [Number(segment?.departureDelay), Number(segment?.arrivalDelay)]
      .filter(Number.isFinite);
    return values.length ? Math.max(0, ...values) : 0;
  }

  function isCancelled(segment) {
    return Boolean(segment?.cancelled || segment?.isCancelled);
  }

  function platformChanged(segment) {
    const actual = String(segment?.platformFrom || "").trim();
    const planned = String(segment?.plannedPlatformFrom || "").trim();
    return Boolean(actual && planned && actual !== planned);
  }

  function currentSegmentIndex(route, now = new Date()) {
    const time = asDate(now) || new Date();
    const segments = Array.isArray(route?.segments) ? route.segments : [];
    return segments.findIndex((segment) => {
      const departure = asDate(segment?.departure);
      const arrival = asDate(segment?.arrival);
      return departure && arrival && time >= departure && time < arrival;
    });
  }

  function nextSegmentIndex(route, now = new Date()) {
    const current = currentSegmentIndex(route, now);
    if (current >= 0) return current + 1 < (route?.segments?.length || 0) ? current + 1 : -1;
    const time = asDate(now) || new Date();
    const segments = Array.isArray(route?.segments) ? route.segments : [];
    return segments.findIndex((segment) => {
      const departure = asDate(segment?.departure);
      return departure && departure > time;
    });
  }

  function vehicleLabel(segment) {
    const mode = String(segment?.modeLabel || segment?.mode || "Transit").trim();
    const line = String(segment?.line || "").trim();
    if (!line) return mode;
    return mode.toLowerCase().includes(line.toLowerCase()) ? mode : `${mode} ${line}`;
  }

  function alert(id, severity, kind, title, detail = "", extra = {}) {
    return { id, severity, kind, title, detail, ...extra };
  }

  function routeAlerts(assignment, now = new Date()) {
    const route = assignment?.route || {};
    const member = assignment?.member || {};
    const segments = Array.isArray(route.segments) ? route.segments : [];
    const alerts = [];
    if (!segments.length) return alerts;

    const currentIndex = currentSegmentIndex(route, now);
    const upcomingIndex = nextSegmentIndex(route, now);
    const activeIndexes = [...new Set([currentIndex, upcomingIndex].filter((index) => index >= 0))];

    for (const index of activeIndexes) {
      const segment = segments[index];
      if (isCancelled(segment)) {
        alerts.push(alert(
          `cancelled:${member.id || "member"}:${index}`,
          "critical",
          "disruption",
          `${vehicleLabel(segment)} is cancelled`,
          `${segment?.from || "This leg"} → ${segment?.to || "next stop"}. Replan this meetup now.`,
          { memberId: member.id, segmentIndex: index, replan: true },
        ));
      }

      const delay = segmentDelay(segment);
      if (delay >= 5) {
        alerts.push(alert(
          `delay:${member.id || "member"}:${index}:${Math.round(delay)}`,
          delay >= 10 ? "critical" : "warn",
          "disruption",
          `${vehicleLabel(segment)} is about ${Math.round(delay)} min late`,
          `${member.name || "This person"}'s current plan may affect the group meetup.`,
          { memberId: member.id, segmentIndex: index, delayMinutes: Math.round(delay), replan: delay >= 10 },
        ));
      }

      if (platformChanged(segment)) {
        alerts.push(alert(
          `platform:${member.id || "member"}:${index}:${segment.platformFrom}`,
          "warn",
          "platform",
          `Platform changed to ${segment.platformFrom}`,
          `${vehicleLabel(segment)} was planned from ${segment.plannedPlatformFrom}.`,
          { memberId: member.id, segmentIndex: index },
        ));
      }
    }

    const departure = asDate(route.departure);
    const untilDeparture = departure ? minutesUntil(departure, now) : null;
    if (untilDeparture != null && untilDeparture >= 0 && untilDeparture <= 5) {
      const first = segments[0];
      alerts.push(alert(
        `leave:${member.id || "member"}:${Math.max(0, Math.ceil(untilDeparture))}`,
        "action",
        "leave",
        untilDeparture <= 1 ? "Leave now" : `Leave in ${Math.ceil(untilDeparture)} min`,
        first ? `${first.mode === "WALK" ? "Walk to" : `Head to ${vehicleLabel(first)}`} ${first.from || "your first stop"}.` : "Your journey is about to start.",
        { memberId: member.id, minutes: Math.max(0, untilDeparture) },
      ));
    }

    if (currentIndex >= 0) {
      const current = segments[currentIndex];
      const untilArrival = minutesUntil(current?.arrival, now);
      if (untilArrival != null && untilArrival >= 0 && untilArrival <= 4 && current?.mode !== "WALK") {
        alerts.push(alert(
          `getoff:${member.id || "member"}:${currentIndex}`,
          "action",
          "get-off",
          untilArrival <= 1.5 ? `Get off at ${current.to || "the next stop"}` : `Get off soon — ${current.to || "next stop"}`,
          `${vehicleLabel(current)} · about ${Math.max(1, Math.ceil(untilArrival))} min remaining.`,
          { memberId: member.id, segmentIndex: currentIndex, minutes: Math.max(0, untilArrival) },
        ));
      }

      const next = segments[currentIndex + 1];
      if (next && next?.mode !== "WALK") {
        const gap = minutesBetween(current?.arrival, next?.departure);
        if (gap != null && gap < 0) {
          const missedBy = Math.max(1, Math.ceil(Math.abs(gap)));
          alerts.push(alert(
            `transfer-missed:${member.id || "member"}:${currentIndex + 1}`,
            "critical",
            "transfer",
            `Connection no longer works`,
            `${vehicleLabel(next)} is due to leave ${current.to || next.from || "the transfer stop"} about ${missedBy} min before this leg now arrives. Refresh & replan.`,
            { memberId: member.id, segmentIndex: currentIndex + 1, transferMinutes: gap, replan: true },
          ));
        } else if (gap != null && gap <= 6) {
          alerts.push(alert(
            `transfer:${member.id || "member"}:${currentIndex + 1}`,
            gap <= 3 ? "warn" : "info",
            "transfer",
            gap <= 3 ? `Tight transfer: ${Math.max(1, Math.round(gap))} min` : `Next: ${vehicleLabel(next)}`,
            `${current.to || next.from || "Transfer"} · ${next.platformFrom ? `platform ${next.platformFrom} · ` : ""}${vehicleLabel(next)} → ${next.to || "next stop"}.`,
            { memberId: member.id, segmentIndex: currentIndex + 1, transferMinutes: gap },
          ));
        }
      }
    }

    return alerts;
  }

  function meetupAlerts(events, memberId, now = new Date()) {
    if (!Array.isArray(events)) return [];
    const time = asDate(now) || new Date();
    const upcoming = events
      .filter((event) => {
        const eventTime = asDate(event?.time);
        const relevant = !memberId || !Array.isArray(event?.memberIds) || event.memberIds.includes(memberId);
        return eventTime && relevant && eventTime >= new Date(time.getTime() - 90_000);
      })
      .sort((a, b) => asDate(a.time) - asDate(b.time))[0];
    if (!upcoming) return [];
    const minutes = minutesUntil(upcoming.time, time);
    if (minutes == null || minutes > 5) return [];
    const names = Array.isArray(upcoming.members) ? upcoming.members.map((member) => member?.name).filter(Boolean).join(" + ") : "";
    return [alert(
      `meet:${upcoming.id || upcoming.label || asDate(upcoming.time)?.getTime()}`,
      "action",
      "meetup",
      upcoming.final ? "Everyone arrives soon" : (minutes <= 1 ? "Meetup point now" : `Meetup in ${Math.max(1, Math.ceil(minutes))} min`),
      `${upcoming.label || "Meetup point"}${names ? ` · ${names}` : ""}.`,
      { minutes: Math.max(0, minutes), eventId: upcoming.id || null },
    )];
  }

  function checkinFreshness(entry, now = new Date(), staleMs = DEFAULT_STALE_MS, futureSkewMs = DEFAULT_FUTURE_SKEW_MS) {
    const at = Number(entry?.at);
    const nowMs = (asDate(now) || new Date()).getTime();
    if (!Number.isFinite(at)) {
      return { fresh: false, stale: true, invalidTime: true, futureSkew: false, ageMs: Infinity, ageMinutes: Infinity };
    }
    const rawAgeMs = nowMs - at;
    if (rawAgeMs < -futureSkewMs) {
      return {
        fresh: false,
        stale: true,
        invalidTime: true,
        futureSkew: true,
        ageMs: rawAgeMs,
        ageMinutes: rawAgeMs / MINUTE,
      };
    }
    const ageMs = Math.max(0, rawAgeMs);
    return {
      fresh: ageMs <= staleMs,
      stale: ageMs > staleMs,
      invalidTime: false,
      futureSkew: rawAgeMs < 0,
      ageMs,
      ageMinutes: ageMs / MINUTE,
    };
  }

  function sharedAlerts(sharedState, members = [], now = new Date()) {
    const values = sharedState?.members && typeof sharedState.members === "object" ? sharedState.members : {};
    const alerts = [];
    let freshArrivals = 0;

    members.forEach((member, index) => {
      const entry = values[String(index)];
      if (!entry) return;
      const freshness = checkinFreshness(entry, now);
      const name = member?.name || `Person ${index + 1}`;
      if (freshness.invalidTime) {
        alerts.push(alert(
          `invalid-checkin-time:${index}:${entry.at}`,
          "info",
          "stale-checkin",
          `${name}'s check-in time cannot be trusted`,
          "The timestamp is outside the allowed clock-skew window; timetable estimates should take priority now.",
          { memberIndex: index, stale: true, invalidTime: true },
        ));
        return;
      }
      if (freshness.stale) {
        alerts.push(alert(
          `stale:${index}:${entry.at}`,
          "info",
          "stale-checkin",
          `${name}'s check-in is stale`,
          `Last confirmed about ${Math.max(15, Math.round(freshness.ageMinutes))} min ago; timetable estimates should take priority now.`,
          { memberIndex: index, stale: true },
        ));
        return;
      }
      if (entry.status === "missed") {
        alerts.push(alert(
          `missed:${index}:${entry.at}`,
          "critical",
          "recovery",
          `${name} reported a missed connection`,
          entry.note || "The planned meetup may no longer work. Refresh & replan.",
          { memberIndex: index, replan: true },
        ));
      }
      if (entry.status === "arrived") freshArrivals += 1;
    });

    if (members.length && freshArrivals === members.length) {
      alerts.push(alert("all-arrived", "good", "arrival", "Everyone confirmed here 🎉", "The meetup is complete."));
    } else if (freshArrivals > 0) {
      alerts.push(alert(
        `arrivals:${freshArrivals}:${members.length}`,
        "good",
        "arrival",
        `${freshArrivals}/${members.length} confirmed here`,
        "Waiting for the rest of the group.",
      ));
    }
    return alerts;
  }

  function groupImpactAlerts(assignments = [], events = [], sharedState = null, now = new Date()) {
    const alerts = [];
    const upcoming = (Array.isArray(events) ? events : [])
      .filter((event) => {
        const eventTime = asDate(event?.time);
        return eventTime && eventTime >= now && minutesUntil(eventTime, now) <= 20;
      })
      .sort((a, b) => asDate(a.time) - asDate(b.time))[0];

    if (upcoming && Array.isArray(upcoming.memberIds)) {
      const affected = assignments.filter((assignment) => upcoming.memberIds.includes(assignment?.member?.id));
      const delayed = affected
        .map((assignment) => ({ assignment, delay: Math.max(0, ...((assignment?.route?.segments || []).map(segmentDelay))) }))
        .filter((item) => item.delay >= 5);
      if (delayed.length) {
        const names = delayed.map((item) => item.assignment?.member?.name || "Someone").join(" + ");
        const maxDelay = Math.max(...delayed.map((item) => item.delay));
        alerts.push(alert(
          `impact:${upcoming.id || upcoming.label}:${Math.round(maxDelay)}`,
          maxDelay >= 10 ? "critical" : "warn",
          "group-impact",
          `Delay may affect the ★ meetup`,
          `${names} ${delayed.length === 1 ? "is" : "are"} about ${Math.round(maxDelay)} min late before ${upcoming.label || "the planned join"}.`,
          { replan: maxDelay >= 10, eventId: upcoming.id || null },
        ));
      }
    }

    const missed = sharedAlerts(sharedState, assignments.map((assignment) => assignment.member), now)
      .find((item) => item.kind === "recovery");
    if (missed) alerts.push(missed);
    return alerts;
  }

  function rankAlerts(alerts = []) {
    return [...alerts].sort((a, b) => {
      const severity = (SEVERITY[b?.severity] || 0) - (SEVERITY[a?.severity] || 0);
      if (severity) return severity;
      return String(a?.id || "").localeCompare(String(b?.id || ""));
    });
  }

  function primaryAlert(alerts = []) {
    return rankAlerts(alerts)[0] || null;
  }

  return Object.freeze({
    MINUTE,
    DEFAULT_STALE_MS,
    DEFAULT_FUTURE_SKEW_MS,
    asDate,
    minutesBetween,
    minutesUntil,
    segmentDelay,
    isCancelled,
    platformChanged,
    currentSegmentIndex,
    nextSegmentIndex,
    vehicleLabel,
    routeAlerts,
    meetupAlerts,
    checkinFreshness,
    sharedAlerts,
    groupImpactAlerts,
    rankAlerts,
    primaryAlert,
  });
});
