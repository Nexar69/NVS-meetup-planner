(() => {
  const results = document.getElementById("results");
  const destinationInput = document.getElementById("destination");
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
    summary.innerHTML = `
      <span class="convergence-inline">
        <span class="convergence-inline-star">★</span>
        <strong>First join:</strong>
        ${escapeHtml(first.title)} · ${escapeHtml(first.label)} · <strong>${formatTime(first.time)}</strong>
      </span>
      ${everyoneTime instanceof Date ? ` · everyone together <strong>${formatTime(everyoneTime)}</strong>` : ""}
    `;
  }

  function eventHtml(event, memberId) {
    const shared = event.sharedTransit && event.sharedTransit.memberIds.includes(memberId)
      ? `<small>Continue together on ${escapeHtml(event.sharedTransit.label)}</small>`
      : "";
    const icon = event.final ? "👥" : "★";
    return `
      <div class="timeline-convergence-event ${escapeHtml(event.kind || "meet")}">
        <div class="timeline-convergence-time">${formatTime(event.time)}</div>
        <div class="timeline-convergence-rail"><span class="timeline-convergence-star">${icon}</span></div>
        <div class="timeline-convergence-copy">
          <strong>${escapeHtml(event.title)}</strong>
          <span>${escapeHtml(event.label)}</span>
          ${shared}
        </div>
      </div>
    `;
  }

  function decorateTimelines(card, group, analysis) {
    const assignments = Array.isArray(group?.assignments) ? group.assignments : [];
    const timelines = [...card.querySelectorAll(".route-timeline")];
    if (!assignments.length || !timelines.length) return;

    timelines.forEach((timeline, index) => {
      timeline.querySelector(".route-convergence-events")?.remove();
      const assignment = assignments[index];
      if (!assignment?.member) return;
      const events = (analysis.memberEvents?.[assignment.member.id] || [])
        .filter((event) => event?.time instanceof Date)
        .sort((a, b) => a.time - b.time);
      if (!events.length) return;

      const container = document.createElement("div");
      container.className = "route-convergence-events";
      container.innerHTML = events.map((event) => eventHtml(event, assignment.member.id)).join("");

      const heading = timeline.querySelector(".route-timeline-heading");
      const fallbackNote = timeline.querySelector(".timeline-fallback-note");
      if (fallbackNote) fallbackNote.insertAdjacentElement("afterend", container);
      else if (heading) heading.insertAdjacentElement("afterend", container);
      else timeline.prepend(container);
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
