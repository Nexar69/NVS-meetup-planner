(() => {
  const PRESENCE_TOLERANCE_MS = 90_000;
  const MERGE_VISIT_GAP_MS = 15 * 60_000;
  const DUPLICATE_EVENT_MS = 3 * 60_000;

  function asDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function normalizeStopName(value) {
    return String(value || "")
      .trim()
      .toLocaleLowerCase("de-DE")
      .replace(/^schwerin\s*,\s*/i, "")
      .replace(/\s+/g, " ")
      .replace(/[()]/g, "")
      .trim();
  }

  function cleanPlatform(value) {
    return String(value || "").trim();
  }

  function stopLabel(name, platforms = []) {
    const cleanName = String(name || "Stop").trim() || "Stop";
    const unique = [...new Set(platforms.map(cleanPlatform).filter(Boolean))];
    if (!unique.length) return cleanName;

    const lower = cleanName.toLocaleLowerCase("de-DE");
    const missing = unique.filter((platform) => {
      const p = platform.toLocaleLowerCase("de-DE");
      return !lower.endsWith(` ${p}`) && !lower.endsWith(`(${p})`) && !lower.includes(`platform ${p}`) && !lower.includes(`steig ${p}`) && !lower.includes(`gleis ${p}`);
    });
    return missing.length ? `${cleanName} ${missing.join("/")}` : cleanName;
  }

  function memberName(member) {
    return String(member?.name || "Person");
  }

  function rawVisits(assignment) {
    const route = assignment?.route;
    const segments = Array.isArray(route?.segments) ? route.segments.filter(Boolean) : [];
    const visits = [];

    segments.forEach((segment, segmentIndex) => {
      const departure = asDate(segment.departure);
      const arrival = asDate(segment.arrival);
      const from = String(segment.from || "").trim();
      const to = String(segment.to || "").trim();

      if (from && departure) {
        visits.push({
          member: assignment.member,
          route,
          name: from,
          key: normalizeStopName(from),
          platforms: [cleanPlatform(segment.platformFrom)].filter(Boolean),
          start: departure,
          end: departure,
          segmentIndexes: [segmentIndex],
        });
      }

      const intermediate = Array.isArray(segment.intermediateStops) ? segment.intermediateStops : [];
      intermediate.forEach((stop) => {
        const name = String(typeof stop === "string" ? stop : stop?.name || "").trim();
        if (!name) return;
        const stopArrival = asDate(typeof stop === "string" ? null : stop?.arrival);
        const stopDeparture = asDate(typeof stop === "string" ? null : stop?.departure);
        const time = stopArrival || stopDeparture;
        if (!time) return;
        visits.push({
          member: assignment.member,
          route,
          name,
          key: normalizeStopName(name),
          platforms: [cleanPlatform(typeof stop === "string" ? "" : stop?.track)].filter(Boolean),
          start: stopArrival || time,
          end: stopDeparture || time,
          segmentIndexes: [segmentIndex],
        });
      });

      if (to && arrival) {
        visits.push({
          member: assignment.member,
          route,
          name: to,
          key: normalizeStopName(to),
          platforms: [cleanPlatform(segment.platformTo)].filter(Boolean),
          start: arrival,
          end: arrival,
          segmentIndexes: [segmentIndex],
        });
      }
    });

    return visits
      .filter((visit) => visit.key && visit.start && visit.end)
      .sort((a, b) => a.start - b.start || a.end - b.end);
  }

  function mergedVisits(assignment) {
    const raw = rawVisits(assignment);
    const merged = [];

    for (const visit of raw) {
      const previous = merged[merged.length - 1];
      const adjacentSegment = previous && Math.min(...visit.segmentIndexes) - Math.max(...previous.segmentIndexes) <= 1;
      const close = previous && visit.start.getTime() - previous.end.getTime() <= MERGE_VISIT_GAP_MS;

      if (previous && previous.key === visit.key && adjacentSegment && close) {
        if (visit.start < previous.start) previous.start = visit.start;
        if (visit.end > previous.end) previous.end = visit.end;
        previous.platforms = [...new Set([...previous.platforms, ...visit.platforms])];
        previous.segmentIndexes = [...new Set([...previous.segmentIndexes, ...visit.segmentIndexes])];
        continue;
      }
      merged.push({ ...visit, platforms: [...visit.platforms], segmentIndexes: [...visit.segmentIndexes] });
    }

    return merged;
  }

  function visitsCompatible(a, b) {
    const latestStart = Math.max(a.start.getTime(), b.start.getTime());
    const earliestEnd = Math.min(a.end.getTime(), b.end.getTime());
    return latestStart <= earliestEnd + PRESENCE_TOLERANCE_MS;
  }

  function pointAlongRoute(route, time) {
    const points = Array.isArray(route?.geometry) ? route.geometry.filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) : [];
    if (!points.length) return null;
    if (points.length === 1) return points[0];

    const departure = asDate(route.departure);
    const arrival = asDate(route.arrival);
    if (!departure || !arrival || arrival <= departure) return points[Math.floor(points.length / 2)];
    const ratio = Math.max(0, Math.min(1, (time.getTime() - departure.getTime()) / (arrival.getTime() - departure.getTime())));
    return points[Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))];
  }

  function averagePoint(points) {
    const valid = points.filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
    if (!valid.length) return null;
    return [
      valid.reduce((sum, point) => sum + point[0], 0) / valid.length,
      valid.reduce((sum, point) => sum + point[1], 0) / valid.length,
    ];
  }

  function segmentSignature(segment) {
    if (!segment || String(segment.mode || "").toUpperCase() === "WALK") return "";
    if (segment.tripId) return `trip:${segment.tripId}`;
    const departure = asDate(segment.departure);
    const bucket = departure ? Math.round(departure.getTime() / 180_000) : 0;
    return [
      String(segment.mode || "").toUpperCase(),
      String(segment.line || "").toLocaleLowerCase("de-DE"),
      String(segment.headsign || "").toLocaleLowerCase("de-DE"),
      normalizeStopName(segment.to),
      bucket,
    ].join("|");
  }

  function candidateTransitSegments(assignment, eventTime) {
    const segments = Array.isArray(assignment?.route?.segments) ? assignment.route.segments : [];
    return segments.filter((segment) => {
      if (!segmentSignature(segment)) return false;
      const departure = asDate(segment.departure);
      const arrival = asDate(segment.arrival);
      if (!departure || !arrival) return false;
      return departure.getTime() <= eventTime.getTime() + 10 * 60_000 && arrival.getTime() >= eventTime.getTime() - PRESENCE_TOLERANCE_MS;
    });
  }

  function geometrySlice(route, startTime, endTime) {
    const points = Array.isArray(route?.geometry) ? route.geometry.filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) : [];
    const departure = asDate(route?.departure);
    const arrival = asDate(route?.arrival);
    if (points.length < 2 || !departure || !arrival || arrival <= departure) return [];

    const duration = arrival.getTime() - departure.getTime();
    const startRatio = Math.max(0, Math.min(1, (startTime.getTime() - departure.getTime()) / duration));
    const endRatio = Math.max(startRatio, Math.min(1, (endTime.getTime() - departure.getTime()) / duration));
    const from = Math.max(0, Math.floor(startRatio * (points.length - 1)) - 1);
    const to = Math.min(points.length - 1, Math.ceil(endRatio * (points.length - 1)) + 1);
    return points.slice(from, to + 1);
  }

  function sharedTransitFor(event, assignments) {
    const signatureGroups = new Map();
    for (const memberId of event.memberIds) {
      const assignment = assignments.find((item) => item.member.id === memberId);
      if (!assignment) continue;
      for (const segment of candidateTransitSegments(assignment, event.time)) {
        const signature = segmentSignature(segment);
        if (!signature) continue;
        if (!signatureGroups.has(signature)) signatureGroups.set(signature, []);
        signatureGroups.get(signature).push({ assignment, segment });
      }
    }

    const winner = [...signatureGroups.values()]
      .filter((items) => new Set(items.map((item) => item.assignment.member.id)).size >= 2)
      .sort((a, b) => b.length - a.length)[0];
    if (!winner) return null;

    const representative = winner[0];
    const members = [...new Map(winner.map((item) => [item.assignment.member.id, item.assignment.member])).values()];
    const starts = winner.map((item) => asDate(item.segment.departure)).filter(Boolean);
    const ends = winner.map((item) => asDate(item.segment.arrival)).filter(Boolean);
    const startTime = new Date(Math.max(event.time.getTime(), ...starts.map((date) => date.getTime())));
    const endTime = new Date(Math.min(...ends.map((date) => date.getTime())));
    const segment = representative.segment;
    const line = String(segment.line || "").trim();
    const mode = String(segment.modeLabel || segment.mode || "Transit").trim();
    const label = line ? `${mode} ${line}` : mode;

    return {
      memberIds: members.map((member) => member.id),
      members,
      label,
      startTime,
      endTime,
      geometry: endTime > startTime ? geometrySlice(representative.assignment.route, startTime, endTime) : [],
    };
  }

  function setsOverlap(a, b) {
    return a.some((id) => b.includes(id));
  }

  function candidateEvents(assignments) {
    const visits = assignments.flatMap((assignment) => mergedVisits(assignment));
    const byStop = new Map();
    visits.forEach((visit) => {
      if (!byStop.has(visit.key)) byStop.set(visit.key, []);
      byStop.get(visit.key).push(visit);
    });

    const candidates = [];
    for (const stopVisits of byStop.values()) {
      for (const anchor of stopVisits) {
        const cluster = [];
        const seenMembers = new Set();
        const compatible = stopVisits
          .filter((visit) => visitsCompatible(anchor, visit))
          .sort((a, b) => a.start - b.start);

        for (const visit of compatible) {
          const id = visit.member.id;
          if (seenMembers.has(id)) continue;
          seenMembers.add(id);
          cluster.push(visit);
        }
        if (cluster.length < 2) continue;

        const time = new Date(Math.max(...cluster.map((visit) => visit.start.getTime())));
        const latestAllowed = Math.min(...cluster.map((visit) => visit.end.getTime() + PRESENCE_TOLERANCE_MS));
        if (time.getTime() > latestAllowed) continue;

        const memberIds = cluster.map((visit) => visit.member.id).sort();
        const platforms = [...new Set(cluster.flatMap((visit) => visit.platforms).filter(Boolean))];
        const name = cluster[0].name;
        const point = averagePoint(cluster.map((visit) => pointAlongRoute(visit.route, time)));
        candidates.push({
          stopKey: cluster[0].key,
          name,
          label: stopLabel(name, platforms),
          platforms,
          time,
          memberIds,
          members: cluster.map((visit) => visit.member),
          point,
        });
      }
    }

    candidates.sort((a, b) => a.time - b.time || b.memberIds.length - a.memberIds.length);
    const unique = [];
    for (const candidate of candidates) {
      const duplicateIndex = unique.findIndex((existing) =>
        existing.stopKey === candidate.stopKey &&
        Math.abs(existing.time - candidate.time) <= DUPLICATE_EVENT_MS &&
        setsOverlap(existing.memberIds, candidate.memberIds),
      );
      if (duplicateIndex < 0) {
        unique.push(candidate);
        continue;
      }

      const existing = unique[duplicateIndex];
      const existingContainsCandidate = candidate.memberIds.every((id) => existing.memberIds.includes(id));
      const candidateContainsExisting = existing.memberIds.every((id) => candidate.memberIds.includes(id));
      if (candidateContainsExisting && !existingContainsCandidate) unique[duplicateIndex] = candidate;
      else if (!existingContainsCandidate && !candidateContainsExisting && candidate.memberIds.length > existing.memberIds.length) unique[duplicateIndex] = candidate;
    }
    return unique;
  }

  function progressiveEvents(events, assignments) {
    const groups = [];
    const allMembers = assignments.map((assignment) => assignment.member);
    const byId = new Map(allMembers.map((member) => [member.id, member]));
    const emitted = [];

    for (const event of events) {
      const eventSet = new Set(event.memberIds);
      const touching = groups.filter((group) => [...group].some((id) => eventSet.has(id)));
      const existing = new Set(touching.flatMap((group) => [...group]));
      const newcomers = event.memberIds.filter((id) => !existing.has(id));

      // If exactly one already-formed group reaches another station together and
      // nobody new joins it, nothing changed. This is travel, not a new meetup.
      if (touching.length === 1 && newcomers.length === 0) continue;

      if (!touching.length) {
        event.kind = "meet";
        event.title = `${event.members.map(memberName).join(" + ")} meet`;
        groups.push(new Set(event.memberIds));
        emitted.push(event);
        continue;
      }

      const merged = new Set([...existing, ...event.memberIds]);
      touching.forEach((group) => groups.splice(groups.indexOf(group), 1));
      groups.push(merged);

      if (newcomers.length) {
        const newcomerNames = newcomers.map((id) => memberName(byId.get(id))).join(" + ");
        const existingNames = [...existing].map((id) => memberName(byId.get(id))).join(" + ");
        event.kind = "join";
        event.title = `${newcomerNames} ${newcomers.length === 1 ? "joins" : "join"} ${existingNames}`;
      } else {
        // Two previously separate groups have connected, even though every
        // participant was already part of some subgroup.
        event.kind = "join";
        event.title = `${event.members.map(memberName).join(" + ")} join together`;
      }
      emitted.push(event);
    }

    return emitted;
  }

  function analyze(group, options = {}) {
    const assignments = Array.isArray(group?.assignments) ? group.assignments.filter((item) => item?.member && item?.route) : [];
    if (assignments.length < 2) return { events: [], sharedLegs: [], memberEvents: {} };

    let events = progressiveEvents(candidateEvents(assignments), assignments);
    events = events.filter((event) => {
      const latestArrival = asDate(group.latestArrival);
      return !latestArrival || event.time.getTime() < latestArrival.getTime() - 30_000 || event.memberIds.length < assignments.length;
    });

    events.forEach((event, index) => {
      event.id = `join-${index}-${event.stopKey.replace(/[^a-z0-9]+/gi, "-")}`;
      event.sharedTransit = sharedTransitFor(event, assignments);
    });

    const destinationPoint = Array.isArray(options.destinationPoint) ? options.destinationPoint : null;
    const destinationLabel = String(options.destinationLabel || group.destination || "Meetup");
    const finalTime = asDate(group.latestArrival);
    if (finalTime) {
      events.push({
        id: "everyone-together",
        kind: "everyone",
        title: "Everyone together",
        name: destinationLabel,
        label: destinationLabel,
        time: finalTime,
        memberIds: assignments.map((assignment) => assignment.member.id),
        members: assignments.map((assignment) => assignment.member),
        point: destinationPoint,
        final: true,
        sharedTransit: null,
      });
    }

    const memberEvents = {};
    assignments.forEach((assignment) => { memberEvents[assignment.member.id] = []; });
    events.forEach((event) => {
      event.memberIds.forEach((id) => {
        if (memberEvents[id]) memberEvents[id].push(event);
      });
    });

    const sharedLegs = events
      .map((event) => event.sharedTransit ? { ...event.sharedTransit, eventId: event.id, event } : null)
      .filter(Boolean);

    return { events, sharedLegs, memberEvents };
  }

  window.NVSConvergence = Object.freeze({ analyze, stopLabel, normalizeStopName });
})();