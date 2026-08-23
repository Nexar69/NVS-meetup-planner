(() => {
  const base = window.NVSConvergence;
  if (!base?.analyze || !base?.normalizeStopName) return;

  const originalAnalyze = base.analyze.bind(base);

  function validPoint(point) {
    return Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]));
  }

  function pointForStop(assignment, stopKey) {
    const segments = Array.isArray(assignment?.route?.segments) ? assignment.route.segments : [];
    const points = [];

    for (const segment of segments) {
      if (base.normalizeStopName(segment?.from) === stopKey && validPoint(segment?.fromPoint)) points.push(segment.fromPoint);
      if (base.normalizeStopName(segment?.to) === stopKey && validPoint(segment?.toPoint)) points.push(segment.toPoint);

      const intermediate = Array.isArray(segment?.intermediateStops) ? segment.intermediateStops : [];
      for (const stop of intermediate) {
        if (!stop || typeof stop !== "object") continue;
        if (base.normalizeStopName(stop.name) === stopKey && validPoint(stop.point)) points.push(stop.point);
      }
    }

    if (!points.length) return null;
    return [
      points.reduce((sum, point) => sum + Number(point[0]), 0) / points.length,
      points.reduce((sum, point) => sum + Number(point[1]), 0) / points.length,
    ];
  }

  function exactEventPoint(event, assignments) {
    if (!event?.stopKey || event.final) return null;
    const memberIds = new Set(event.memberIds || []);
    const points = assignments
      .filter((assignment) => memberIds.has(assignment?.member?.id))
      .map((assignment) => pointForStop(assignment, event.stopKey))
      .filter(validPoint);

    if (!points.length) return null;
    return [
      points.reduce((sum, point) => sum + Number(point[0]), 0) / points.length,
      points.reduce((sum, point) => sum + Number(point[1]), 0) / points.length,
    ];
  }

  function analyze(group, options = {}) {
    const result = originalAnalyze(group, options);
    const assignments = Array.isArray(group?.assignments) ? group.assignments : [];
    if (!result || !assignments.length) return result;

    result.events?.forEach((event) => {
      const precise = exactEventPoint(event, assignments);
      if (precise) {
        event.point = precise;
        event.pointSource = "stop";
      } else if (!event.final) {
        event.pointSource = "geometry";
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
  });
})();