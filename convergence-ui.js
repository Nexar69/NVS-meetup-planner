(() => {
  const results = document.getElementById("results");
  const destinationInput = document.getElementById("destination");
  const FALLBACK_COLORS = ["#2563eb", "#db2777", "#7c3aed", "#ea580c", "#0891b2", "#65a30d"];
  let decorateTimer = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatTime(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function asDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function safeColor(value, fallback) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
  }

  function mixedGradient(event) {
    const members = Array.isArray(event?.members) ? event.members : [];
    const colors = members.map((member, index) => safeColor(member?.color, FALLBACK_COLORS[index % FALLBACK_COLORS.length]));
    if (!colors.length) return "#101828";
    if (colors.length === 1) return colors[0];
    const slice = 360 / colors.length;
    return `conic-gradient(${colors.map((color, index) => `${color} ${Math.round(index * slice)}deg ${Math.round((index + 1) * slice)}deg`).join(",")})`;
  }

  function locationFor(key) {
    return window.NVSTransit?.LOCATIONS?.[key] || null;
  }

  function analysisFor(group) {
    if (!group || !window.NVSConvergence?.analyze) return { events: [], memberEvents: {}, sharedLegs: [] };
    const destinationKey = destinationInput?.value;
    const destination = locationFor(destinationKey);
    return window.NVSConvergence.analyze(group, {
      destinationPoint: destination ? [destination.lat, destination.lon] : null,
      destinationLabel: destination?.label || destinationKey || "Meetup",
    });
  }

  function firstIntermediateEvent(analysis) {
    return analysis.events.find((event) => !event.final) || null;
  }

  function decorateMeetupSummary(card, group, analysis) {
    const summary = card.querySelector(".group-first-meetup");
    if (!summary) return;
    const first = firstIntermediateEvent(analysis);
    if (!first) return;

    const everyoneTime = group.everyoneTogetherTime || group.latestArrival;
    const signature = `${first.id}|${first.time.getTime()}|${first.memberIds?.join(",") || ""}|${everyoneTime instanceof Date ? everyoneTime.getTime() : ""}`;
    if (summary.dataset.convergenceSignature === signature) return;
    summary.dataset.convergenceSignature = signature;
    summary.innerHTML = `
      <span class="convergence-inline">
        <span class="convergence-inline-star mixed" style="background:${escapeHtml(mixedGradient(first))}">★</span>
        <strong>First join:</strong>
        ${escapeHtml(first.title)} · ${escapeHtml(first.label)} · <strong>${formatTime(first.time)}</strong>
      </span>
      ${everyoneTime instanceof Date ? ` · everyone arrives <strong>${formatTime(everyoneTime)}</strong>` : ""}
    `;
  }

  function eventHtml(event, memberId) {
    const shared = event.sharedTransit && event.sharedTransit.memberIds.includes(memberId)
      ? `<small>Continue together on ${escapeHtml(event.sharedTransit.label)}</small>`
      : "";
    const icon = event.final ? "👥" : "★";
    const style = event.final ? "" : ` style="background:${escapeHtml(mixedGradient(event))}"`;
    const title = event.final ? "Everyone arrives" : event.title;
    return `
      <div class="timeline-convergence-event ${escapeHtml(event.kind || "meet")}" data-convergence-generated="true">
        <div class="timeline-convergence-time">${formatTime(event.time)}</div>
        <div class="timeline-convergence-rail"><span class="timeline-convergence-star ${event.final ? "" : "mixed"}"${style}>${icon}</span></div>
        <div class="timeline-convergence-copy">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(event.label)}</span>
          ${shared}
        </div>
      </div>
    `;
  }

  function withPlatform(name, platform) {
    const cleanName = String(name || "").trim();
    const cleanPlatform = String(platform || "").trim();
    if (!cleanPlatform) return cleanName;
    if (!cleanName) return `Stop ${cleanPlatform}`;
    const nameLower = cleanName.toLocaleLowerCase("de-DE");
    const platformLower = cleanPlatform.toLocaleLowerCase("de-DE");
    if (
      nameLower.endsWith(` ${platformLower}`) ||
      nameLower.endsWith(`(${platformLower})`) ||
      nameLower.includes(`bstg. ${platformLower}`) ||
      nameLower.includes(`steig ${platformLower}`) ||
      nameLower.includes(`gleis ${platformLower}`)
    ) return cleanName;
    return `${cleanName} ${cleanPlatform}`;
  }

  function startHtml(assignment) {
    const route = assignment?.route;
    const member = assignment?.member;
    const departure = asDate(route?.departure);
    if (!member || !departure) return "";
    const firstSegment = Array.isArray(route?.segments) ? route.segments.find(Boolean) : null;
    const origin = firstSegment
      ? withPlatform(firstSegment.from, firstSegment.platformFrom)
      : (locationFor(member.originKey)?.label || member.originKey || "Starting point");
    const color = safeColor(member.color, "#2563eb");
    return `
      <div class="timeline-convergence-event start" data-convergence-generated="true">
        <div class="timeline-convergence-time">${formatTime(departure)}</div>
        <div class="timeline-convergence-rail"><span class="timeline-convergence-star" style="background:${escapeHtml(color)};box-shadow:0 0 0 2px ${escapeHtml(color)}">▶</span></div>
        <div class="timeline-convergence-copy">
          <strong>Start</strong>
          <span>${escapeHtml(origin)}</span>
        </div>
      </div>
    `;
  }

  function nodeFromHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "").trim();
    return template.content.firstElementChild || null;
  }

  function stepTime(node, index, assignment) {
    const segment = Array.isArray(assignment?.route?.segments) ? assignment.route.segments[index] : null;
    const segmentTime = asDate(segment?.departure);
    if (segmentTime) return segmentTime;

    const match = String(node?.querySelector(".timeline-time")?.textContent || "").match(/^(\d{1,2}):(\d{2})$/);
    const routeStart = asDate(assignment?.route?.departure);
    if (!match || !routeStart) return new Date((routeStart?.getTime?.() || 0) + index * 60_000);
    const candidate = new Date(routeStart);
    candidate.setHours(Number(match[1]), Number(match[2]), 0, 0);
    if (candidate.getTime() < routeStart.getTime() - 12 * 60 * 60 * 1000) candidate.setDate(candidate.getDate() + 1);
    return candidate;
  }

  function decorateTimelines(card, group, analysis) {
    const assignments = Array.isArray(group?.assignments) ? group.assignments : [];
    const timelines = [...card.querySelectorAll(".route-timeline")];
    if (!assignments.length || !timelines.length) return;

    timelines.forEach((timeline, index) => {
      const assignment = assignments[index];
      if (!assignment?.member || !assignment?.route) return;
      const timelineSteps = timeline.querySelector(".timeline-steps");
      if (!timelineSteps) return;

      // Remove the old v0.7.3 summary block if a cached copy left one behind.
      timeline.querySelector(".route-convergence-events")?.remove();

      const events = (analysis.memberEvents?.[assignment.member.id] || [])
        .filter((event) => event?.time instanceof Date)
        .sort((a, b) => a.time - b.time);
      const departure = asDate(assignment.route.departure);
      const signature = [
        departure?.getTime?.() || "",
        ...events.map((event) => `${event.id}:${event.time.getTime()}:${event.memberIds?.join(",") || ""}`),
      ].join("|");
      if (timelineSteps.dataset.convergenceSignature === signature) return;

      const originalSteps = [...timelineSteps.children].filter((node) => node.classList?.contains("timeline-step"));
      if (!originalSteps.length) return;

      // Clear only previously generated lifecycle/join rows; keep the real route steps.
      [...timelineSteps.querySelectorAll('[data-convergence-generated="true"]')].forEach((node) => node.remove());

      const entries = originalSteps.map((node, stepIndex) => ({
        time: stepTime(node, stepIndex, assignment),
        priority: 2,
        node,
      }));

      const startNode = nodeFromHtml(startHtml(assignment));
      if (startNode && departure) entries.push({ time: departure, priority: 0, node: startNode });

      events.forEach((event) => {
        const node = nodeFromHtml(eventHtml(event, assignment.member.id));
        if (!node) return;
        // A join at the same timestamp as a new leg should be shown before boarding
        // that next leg; the final arrival naturally sorts to the bottom.
        entries.push({ time: event.time, priority: event.final ? 3 : 1, node });
      });

      entries.sort((a, b) => {
        const timeDiff = a.time - b.time;
        return timeDiff || a.priority - b.priority;
      });

      const fragment = document.createDocumentFragment();
      entries.forEach((entry) => fragment.appendChild(entry.node));
      timelineSteps.replaceChildren(fragment);
      timelineSteps.dataset.convergenceSignature = signature;
    });
  }

  function decorateCard(card, group) {
    if (!card || !group) return;
    const analysis = analysisFor(group);
    decorateMeetupSummary(card, group, analysis);
    decorateTimelines(card, group, analysis);
  }

  function decorateExisting() {
    clearTimeout(decorateTimer);
    decorateTimer = setTimeout(() => {
      const recommendations = window.__NVS_LAST_RECOMMENDATIONS__;
      if (!recommendations || !results) return;
      [...results.querySelectorAll(":scope > .result[data-map-pair]")].forEach((card) => {
        const slot = card.dataset.mapPair;
        if (slot && recommendations[slot]) decorateCard(card, recommendations[slot]);
      });
    }, 20);
  }

  window.addEventListener("nvs-group-recommendations-rendered", decorateExisting);
  window.addEventListener("nvs-group-change", decorateExisting);
  window.addEventListener("nvs-priority-change", decorateExisting);
  window.addEventListener("nvs-timing-change", decorateExisting);

  if (results) {
    new MutationObserver(() => decorateExisting()).observe(results, {
      childList: true,
      subtree: true,
    });
  }

  decorateExisting();
})();