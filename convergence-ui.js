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
      ${everyoneTime instanceof Date ? ` · everyone together <strong>${formatTime(everyoneTime)}</strong>` : ""}
    `;
  }

  function eventHtml(event, memberId) {
    const shared = event.sharedTransit && event.sharedTransit.memberIds.includes(memberId)
      ? `<small>Continue together on ${escapeHtml(event.sharedTransit.label)}</small>`
      : "";
    const icon = event.final ? "👥" : "★";
    const style = event.final ? "" : ` style="background:${escapeHtml(mixedGradient(event))}"`;
    return `
      <div class="timeline-convergence-event ${escapeHtml(event.kind || "meet")}">
        <div class="timeline-convergence-time">${formatTime(event.time)}</div>
        <div class="timeline-convergence-rail"><span class="timeline-convergence-star ${event.final ? "" : "mixed"}"${style}>${icon}</span></div>
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
      const assignment = assignments[index];
      if (!assignment?.member) return;
      const events = (analysis.memberEvents?.[assignment.member.id] || [])
        .filter((event) => event?.time instanceof Date)
        .sort((a, b) => a.time - b.time);
      const existing = timeline.querySelector(".route-convergence-events");
      if (!events.length) {
        existing?.remove();
        return;
      }

      const signature = events.map((event) => `${event.id}:${event.time.getTime()}:${event.memberIds?.join(",") || ""}`).join("|");
      if (existing?.dataset.signature === signature) return;
      existing?.remove();

      const container = document.createElement("div");
      container.className = "route-convergence-events";
      container.dataset.signature = signature;
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

  const version = document.getElementById("versionLabel");
  if (version) version.textContent = "v0.7.3 · Stable map + meaningful joins";

  decorateExisting();
})();