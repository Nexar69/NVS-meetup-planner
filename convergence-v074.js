(() => {
  const base = window.NVSConvergence;
  if (!base?.analyze || !base?.normalizeStopName) return;

  const originalAnalyze = base.analyze.bind(base);
  const SCHWERIN_CENTER = [53.628, 11.415];

  function validPoint(point) {
    if (!Array.isArray(point) || point.length < 2) return false;
    const lat = Number(point[0]);
    const lon = Number(point[1]);
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  }

  function cleanPoint(point) {
    return validPoint(point) ? [Number(point[0]), Number(point[1])] : null;
  }

  function locationPoint(key) {
    const location = window.NVSTransit?.LOCATIONS?.[key];
    if (!location) return null;
    const point = [Number(location.lat), Number(location.lon)];
    return validPoint(point) ? point : null;
  }

  function distanceSquared(a, b) {
    if (!validPoint(a) || !validPoint(b)) return Number.POSITIVE_INFINITY;
    const dLat = Number(a[0]) - Number(b[0]);
    const dLon = Number(a[1]) - Number(b[1]);
    return dLat * dLat + dLon * dLon;
  }

  function assignmentAnchors(assignment) {
    const anchors = [];
    const route = assignment?.route || {};
    const member = assignment?.member || {};

    [
      locationPoint(member.originKey),
      locationPoint(route.origin),
      locationPoint(route.destination),
    ].filter(Boolean).forEach((point) => anchors.push(point));

    const geometry = Array.isArray(route.geometry) ? route.geometry.filter(validPoint) : [];
    if (geometry.length) {
      anchors.push(cleanPoint(geometry[0]));
      anchors.push(cleanPoint(geometry[geometry.length - 1]));
    }

    return anchors.filter(Boolean);
  }

  function orientationScore(point, assignments) {
    if (!validPoint(point)) return Number.POSITIVE_INFINITY;
    const anchors = assignments.flatMap(assignmentAnchors);
    if (!anchors.length) return distanceSquared(point, SCHWERIN_CENTER);
    return Math.min(...anchors.map((anchor) => distanceSquared(point, anchor)));
  }

  function orientPoint(point, assignments) {
    const direct = cleanPoint(point);
    if (!direct) return null;
    const swapped = cleanPoint([direct[1], direct[0]]);
    if (!swapped) return direct;

    const directScore = orientationScore(direct, assignments);
    const swappedScore = orientationScore(swapped, assignments);
    return swappedScore + 0.000001 < directScore ? swapped : direct;
  }

  function pointReasonable(point, assignments) {
    if (!validPoint(point)) return false;
    const anchors = assignments.flatMap(assignmentAnchors);
    const nearest = anchors.length
      ? Math.min(...anchors.map((anchor) => distanceSquared(point, anchor)))
      : distanceSquared(point, SCHWERIN_CENTER);

    // This app is local to Schwerin. A real intermediate stop should never be
    // hundreds or thousands of kilometres from every route endpoint. The
    // generous 1.0 degree squared threshold still allows regional journeys but
    // rejects classic [lon,lat] mistakes such as Schwerin -> [11.4, 53.6].
    return nearest <= 1.0;
  }

  function pointForStop(assignment, stopKey) {
    const segments = Array.isArray(assignment?.route?.segments) ? assignment.route.segments : [];
    const points = [];

    function add(rawPoint) {
      const point = orientPoint(rawPoint, [assignment]);
      if (point && pointReasonable(point, [assignment])) points.push(point);
    }

    for (const segment of segments) {
      if (base.normalizeStopName(segment?.from) === stopKey) add(segment?.fromPoint);
      if (base.normalizeStopName(segment?.to) === stopKey) add(segment?.toPoint);

      const intermediate = Array.isArray(segment?.intermediateStops) ? segment.intermediateStops : [];
      for (const stop of intermediate) {
        if (!stop || typeof stop !== "object") continue;
        if (base.normalizeStopName(stop.name) === stopKey) add(stop.point);
      }
    }

    if (!points.length) return null;
    return [
      points.reduce((sum, point) => sum + point[0], 0) / points.length,
      points.reduce((sum, point) => sum + point[1], 0) / points.length,
    ];
  }

  function exactEventPoint(event, assignments) {
    if (!event?.stopKey || event.final) return null;
    const memberIds = new Set(event.memberIds || []);
    const relevantAssignments = assignments.filter((assignment) => memberIds.has(assignment?.member?.id));
    const points = relevantAssignments
      .map((assignment) => pointForStop(assignment, event.stopKey))
      .filter(validPoint);

    if (!points.length) return null;
    const point = [
      points.reduce((sum, item) => sum + item[0], 0) / points.length,
      points.reduce((sum, item) => sum + item[1], 0) / points.length,
    ];
    return pointReasonable(point, relevantAssignments) ? point : null;
  }

  function analyze(group, options = {}) {
    const result = originalAnalyze(group, options);
    const assignments = Array.isArray(group?.assignments) ? group.assignments : [];
    if (!result || !assignments.length) return result;

    result.events?.forEach((event) => {
      if (event.final) return;
      const memberIds = new Set(event.memberIds || []);
      const relevantAssignments = assignments.filter((assignment) => memberIds.has(assignment?.member?.id));
      const precise = exactEventPoint(event, assignments);

      if (precise) {
        event.point = precise;
        event.pointSource = "stop";
        return;
      }

      const fallback = orientPoint(event.point, relevantAssignments.length ? relevantAssignments : assignments);
      if (fallback && pointReasonable(fallback, relevantAssignments.length ? relevantAssignments : assignments)) {
        event.point = fallback;
        event.pointSource = "geometry";
      } else {
        // Never allow a bogus join coordinate to poison Leaflet fitBounds().
        // The textual join still exists; only the unsafe map marker is omitted.
        event.point = null;
        event.pointSource = "rejected";
      }
    });

    result.sharedLegs = (result.events || [])
      .map((event) => event.sharedTransit ? { ...event.sharedTransit, eventId: event.id, event } : null)
      .filter(Boolean);
    return result;
  }

  window.NVSConvergence = Object.freeze({
    ...base,
    analyze,
    preciseStopPoints: true,
    coordinateOrientationGuard: true,
  });
})();