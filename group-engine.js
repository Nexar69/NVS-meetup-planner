(() => {
  const base = window.NVSRecommend;
  if (!base) return;

  const BEAM_WIDTH = 220;
  const ROUTES_PER_PERSON = 8;

  function minutesBetween(a, b) {
    return Math.round(Math.abs(a.getTime() - b.getTime()) / 60_000);
  }

  function signedMinutesBetween(date, target) {
    return Math.round((date.getTime() - target.getTime()) / 60_000);
  }

  function walkingMinutes(route) {
    const segments = Array.isArray(route?.segments) ? route.segments : [];
    return segments
      .filter((segment) => String(segment?.mode || "").toUpperCase() === "WALK")
      .reduce((sum, segment) => sum + (Number(segment?.duration) || 0), 0);
  }

  function routeTransfers(route) {
    return Math.max(0, Number(route?.transfers) || 0);
  }

  function routeDuration(route) {
    if (Number.isFinite(Number(route?.duration))) return Math.max(1, Number(route.duration));
    if (route?.arrival instanceof Date && route?.departure instanceof Date) {
      return Math.max(1, minutesBetween(route.arrival, route.departure));
    }
    return 999;
  }

  function earliestPairMeetup(assignments) {
    const arrivals = assignments
      .map((assignment) => assignment.route.arrival)
      .filter((date) => date instanceof Date)
      .sort((a, b) => a - b);
    return arrivals.length >= 2 ? arrivals[1] : arrivals[0] || null;
  }

  function priorityMetrics(assignments, priorityIds) {
    const selected = assignments.filter((assignment) => priorityIds.includes(assignment.member.id));
    const others = assignments.filter((assignment) => !priorityIds.includes(assignment.member.id));

    if (!selected.length) {
      return {
        priorityAssignments: [],
        priorityCompleteTime: null,
        prioritySpread: 0,
        priorityOrderPenalty: 0,
        priorityLead: 0,
      };
    }

    const selectedArrivals = selected.map((assignment) => assignment.route.arrival).sort((a, b) => a - b);
    const priorityCompleteTime = selectedArrivals[selectedArrivals.length - 1];
    const prioritySpread = selectedArrivals.length > 1
      ? minutesBetween(selectedArrivals[0], priorityCompleteTime)
      : 0;

    const otherArrivals = others.map((assignment) => assignment.route.arrival).sort((a, b) => a - b);
    const earliestOther = otherArrivals[0] || null;
    const priorityOrderPenalty = earliestOther && earliestOther < priorityCompleteTime
      ? minutesBetween(earliestOther, priorityCompleteTime)
      : 0;
    const priorityLead = earliestOther && earliestOther >= priorityCompleteTime
      ? minutesBetween(priorityCompleteTime, earliestOther)
      : 0;

    return {
      priorityAssignments: selected,
      priorityCompleteTime,
      prioritySpread,
      priorityOrderPenalty,
      priorityLead,
    };
  }

  function metricsFor(assignments, target, priorityIds = []) {
    if (!assignments.length) return null;

    const arrivals = assignments.map((assignment) => assignment.route.arrival).sort((a, b) => a - b);
    const earliestArrival = arrivals[0];
    const latestArrival = arrivals[arrivals.length - 1];
    const groupSpread = minutesBetween(earliestArrival, latestArrival);
    const targetDifference = signedMinutesBetween(latestArrival, target);
    const targetDistance = Math.abs(targetDifference);
    const durations = assignments.map((assignment) => routeDuration(assignment.route));
    const totalTravel = durations.reduce((sum, value) => sum + value, 0);
    const maxTravel = Math.max(...durations);
    const totalWalk = assignments.reduce((sum, assignment) => sum + walkingMinutes(assignment.route), 0);
    const totalTransfers = assignments.reduce((sum, assignment) => sum + routeTransfers(assignment.route), 0);
    const asapMinutes = Math.max(0, Math.round((latestArrival - new Date()) / 60_000));
    const priority = priorityMetrics(assignments, priorityIds);
    const firstMeetupTime = priority.priorityAssignments.length >= 2
      ? priority.priorityCompleteTime
      : earliestPairMeetup(assignments);

    return {
      assignments,
      routeA: assignments[0]?.route || null,
      routeB: assignments[1]?.route || null,
      latestArrival,
      earliestArrival,
      everyoneTogetherTime: latestArrival,
      firstMeetupTime,
      waitingDifference: groupSpread,
      groupSpread,
      targetDifference,
      targetDistance,
      totalTravel,
      maxTravel,
      totalWalk,
      totalTransfers,
      asapMinutes,
      priorityIds,
      ...priority,
    };
  }

  function preferenceCost(group, selectedMode) {
    const priorityPenalty = group.priorityIds.length
      ? group.priorityOrderPenalty * 5.5 + group.prioritySpread * 2.2
      : 0;

    if (selectedMode === "fastest") {
      return (
        group.totalTravel * 1.35 +
        group.maxTravel * 0.55 +
        group.groupSpread * 0.32 +
        priorityPenalty
      );
    }

    if (selectedMode === "easy") {
      return (
        group.totalTransfers * 14 +
        group.totalWalk * 0.75 +
        group.maxTravel * 0.34 +
        group.totalTravel * 0.1 +
        group.groupSpread * 0.45 +
        priorityPenalty
      );
    }

    return (
      group.groupSpread * 4.1 +
      group.maxTravel * 0.22 +
      group.totalTravel * 0.055 +
      priorityPenalty
    );
  }

  function groupScore(group, selectedMode, selectedTiming) {
    const preference = preferenceCost(group, selectedMode);
    if (selectedTiming === "asap") return group.asapMinutes * 5.5 + preference;
    return preference + group.targetDistance * 1.2;
  }

  function quickRouteScore(route, target, selectedTiming) {
    const duration = routeDuration(route);
    if (selectedTiming === "asap") {
      return Math.max(0, Math.round((route.arrival - new Date()) / 60_000)) + duration * 0.08;
    }
    return Math.abs(signedMinutesBetween(route.arrival, target)) + duration * 0.08;
  }

  function routeOptions(routes, target, selectedTiming) {
    return [...(routes || [])]
      .filter((route) => route?.arrival instanceof Date && route?.departure instanceof Date)
      .sort((a, b) => quickRouteScore(a, target, selectedTiming) - quickRouteScore(b, target, selectedTiming))
      .slice(0, ROUTES_PER_PERSON);
  }

  function partialPriorityIds(assignments, priorityIds) {
    const assigned = new Set(assignments.map((assignment) => assignment.member.id));
    return priorityIds.filter((id) => assigned.has(id));
  }

  function buildBeam(routeSets, members, target, priorityIds, selectedMode, selectedTiming) {
    let beam = [{ assignments: [], score: 0 }];

    for (let index = 0; index < members.length; index += 1) {
      const member = members[index];
      const options = routeOptions(routeSets[index], target, selectedTiming);
      if (!options.length) return [];

      const expanded = [];
      for (const state of beam) {
        for (const route of options) {
          const assignments = [...state.assignments, { member, route }];
          const relevantPriority = partialPriorityIds(assignments, priorityIds);
          const metrics = metricsFor(assignments, target, relevantPriority);
          expanded.push({
            assignments,
            score: metrics ? groupScore(metrics, selectedMode, selectedTiming) : Number.POSITIVE_INFINITY,
          });
        }
      }

      expanded.sort((a, b) => a.score - b.score);
      beam = expanded.slice(0, BEAM_WIDTH);
    }

    return beam;
  }

  function distinctEnough(a, b) {
    if (!a || !b) return true;
    const count = Math.min(a.assignments.length, b.assignments.length);
    for (let index = 0; index < count; index += 1) {
      const left = a.assignments[index];
      const right = b.assignments[index];
      if (left.member.id !== right.member.id) return true;
      if (Math.abs(left.route.departure - right.route.departure) / 60_000 >= 3) return true;
      if (left.route.description !== right.route.description) return true;
    }
    return false;
  }

  function explainGroup(group, selectedMode, selectedTiming) {
    if (!group) return "";
    const count = group.assignments.length;
    const timingLead = selectedTiming === "asap"
      ? `The whole group can be together in about ${group.asapMinutes} min.`
      : group.targetDifference === 0
        ? "The whole group lands exactly on the target time."
        : `The whole group is together ${group.targetDistance} min from the target.`;

    let preference;
    if (selectedMode === "fastest") {
      preference = `${group.totalTravel} min combined travel; the longest individual trip is ${group.maxTravel} min.`;
    } else if (selectedMode === "easy") {
      const changes = group.totalTransfers === 0
        ? "no changes across the group"
        : `${group.totalTransfers} total change${group.totalTransfers === 1 ? "" : "s"}`;
      preference = `It keeps the group trip simple: ${changes} and about ${group.totalWalk} min walking combined.`;
    } else {
      preference = `Everyone arrives within a ${group.groupSpread} min window.`;
    }

    if (!group.priorityIds.length) return `${timingLead} ${preference}`;

    const priorityNames = group.priorityAssignments.map((assignment) => assignment.member.name).join(" + ");
    if (group.priorityAssignments.length === 1) {
      const status = group.priorityOrderPenalty
        ? `The route could not fully keep ${priorityNames} ahead of everyone else.`
        : `${priorityNames} is scheduled ahead of the rest of the group.`;
      return `${timingLead} ${preference} ${status}`;
    }

    const status = group.priorityOrderPenalty
      ? `${priorityNames} are ${group.prioritySpread} min apart, but another person may arrive before their first meetup is complete.`
      : `${priorityNames} meet first within ${group.prioritySpread} min of each other.`;
    return `${timingLead} ${preference} ${status}`;
  }

  function recommendGroup(routeSets, members, target, options = {}) {
    const selectedMode = options.mode || base.getMode?.() || "together";
    const selectedTiming = options.timingMode || base.getTimingMode?.() || "target";
    const priorityIds = Array.isArray(options.priorityIds) ? options.priorityIds : [];

    if (!Array.isArray(routeSets) || !Array.isArray(members) || routeSets.length !== members.length || members.length < 2) {
      return { primary: null, backup: null, mode: selectedMode, timingMode: selectedTiming, members: members || [], priorityIds, groups: [] };
    }

    const beam = buildBeam(routeSets, members, target, priorityIds, selectedMode, selectedTiming);
    let groups = beam
      .map((state) => metricsFor(state.assignments, target, priorityIds))
      .filter(Boolean)
      .map((group) => ({ ...group, recommendationScore: groupScore(group, selectedMode, selectedTiming) }));

    if (selectedTiming === "target") {
      const near = groups.filter((group) => group.targetDifference >= -25 && group.targetDifference <= 20);
      if (near.length) groups = near;
    } else {
      const soon = groups.filter((group) => group.asapMinutes >= 0 && group.asapMinutes <= 180);
      if (soon.length) groups = soon;
    }

    groups.sort((a, b) =>
      a.recommendationScore - b.recommendationScore ||
      (selectedTiming === "asap" ? a.asapMinutes - b.asapMinutes : a.targetDistance - b.targetDistance) ||
      a.groupSpread - b.groupSpread,
    );

    const primary = groups[0] || null;
    const backup = groups.find((group) => group !== primary && distinctEnough(group, primary)) || groups[1] || null;

    return {
      primary,
      backup,
      mode: selectedMode,
      timingMode: selectedTiming,
      members,
      priorityIds,
      groups,
    };
  }

  window.NVSRecommend = Object.freeze({
    ...base,
    recommendGroup,
    explainGroup,
    groupScore,
  });
})();