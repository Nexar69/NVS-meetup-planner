(() => {
  const results = document.getElementById("results");
  const resultsSection = document.querySelector(".results-section");
  const dataBadge = document.getElementById("dataBadge");
  const plannerForm = document.getElementById("plannerForm");
  const personAInput = document.getElementById("personA");
  const personBInput = document.getElementById("personB");
  const destinationInput = document.getElementById("destination");
  const dateInput = document.getElementById("date");
  const timeInput = document.getElementById("time");

  let refreshTimer = null;
  let clockTimer = null;
  let currentRecommendations = null;
  let currentContext = null;

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

  function fallbackMembers() {
    return [
      { id: "personA", name: "You", color: "#2563eb", originKey: personAInput?.value, markerLabel: "A" },
      { id: "personB", name: "Friend", color: "#db2777", originKey: personBInput?.value, markerLabel: "B" },
    ];
  }

  function groupMembers() {
    const members = window.NVSGroup?.getMembers?.();
    return Array.isArray(members) && members.length >= 2 ? members : fallbackMembers();
  }

  function currentContextFromForm() {
    const target = dateInput?.value && timeInput?.value ? new Date(`${dateInput.value}T${timeInput.value}`) : null;
    return {
      members: groupMembers(),
      destination: destinationInput?.value,
      target: target && !Number.isNaN(target.getTime()) ? target : null,
    };
  }

  function ensureDepartureBoard() {
    let board = document.getElementById("departureBoard");
    if (board || !resultsSection) return board;

    board = document.createElement("section");
    board.id = "departureBoard";
    board.className = "departure-board";
    board.hidden = true;
    board.innerHTML = `
      <div class="departure-board-heading">
        <div><p class="section-kicker">Live plan</p><h3>When should everyone leave?</h3></div>
        <span class="departure-board-badge" id="departureBoardBadge">Best match</span>
      </div>
      <div class="departure-people" id="departurePeople"></div>
      <div class="departure-board-footer">
        <span id="departureMeetText"></span>
        <button type="button" id="recalculateButton" class="recalculate-button" hidden>Recalculate now</button>
      </div>
    `;

    const heading = resultsSection.querySelector(".results-heading");
    if (heading) heading.insertAdjacentElement("afterend", board);
    else resultsSection.prepend(board);
    board.querySelector("#recalculateButton")?.addEventListener("click", () => plannerForm?.requestSubmit());
    return board;
  }

  function countdownText(departure, now = new Date()) {
    const seconds = Math.round((departure.getTime() - now.getTime()) / 1000);
    if (seconds <= -60) return { text: `${Math.abs(Math.round(seconds / 60))} min ago`, state: "missed" };
    if (seconds < 0) return { text: "just left", state: "missed" };
    if (seconds < 60) return { text: "leave now", state: "now" };
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return { text: `in ${minutes} min`, state: minutes <= 5 ? "soon" : "future" };
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    return { text: `in ${hours}h${remaining ? ` ${remaining}m` : ""}`, state: "future" };
  }

  function personDepartureRow(member, route) {
    const countdown = countdownText(route.departure);
    return `<div class="departure-person ${countdown.state}">
      <div class="departure-person-name"><span class="group-person-swatch" style="background:${escapeHtml(member.color)}" aria-hidden="true"></span><span>${escapeHtml(member.name)}</span></div>
      <div class="departure-person-clock"><strong>${formatTime(route.departure)}</strong><span>${escapeHtml(countdown.text)}</span></div>
    </div>`;
  }

  function boardBadge(recommendations) {
    if (recommendations?.mode === "fastest") return "⚡ Fastest";
    if (recommendations?.mode === "easy") return "😌 Easy";
    return "🤝 Together";
  }

  function assignmentsFor(group) {
    if (Array.isArray(group?.assignments) && group.assignments.length) return group.assignments;
    const members = currentContext?.members || fallbackMembers();
    return [
      { member: members[0], route: group?.routeA },
      { member: members[1], route: group?.routeB },
    ].filter((assignment) => assignment.member && assignment.route);
  }

  function meetupBoardText(group) {
    if (group.priorityAssignments?.length >= 2) {
      const names = group.priorityAssignments.map((assignment) => assignment.member.name).join(" + ");
      return `<strong>${escapeHtml(names)}</strong> meet first around <strong>${formatTime(group.priorityCompleteTime)}</strong> · whole group <strong>${formatTime(group.latestArrival)}</strong>`;
    }
    if (group.priorityAssignments?.length === 1) {
      const assignment = group.priorityAssignments[0];
      return `<strong>${escapeHtml(assignment.member.name)}</strong> priority arrival <strong>${formatTime(assignment.route.arrival)}</strong> · whole group <strong>${formatTime(group.latestArrival)}</strong>`;
    }
    const prefix = currentRecommendations?.timingMode === "asap" ? "Everyone there by" : "Everyone together around";
    return `${prefix} <strong>${formatTime(group.latestArrival)}</strong> · ${group.groupSpread ?? group.waitingDifference} min group spread`;
  }

  function updateDepartureBoard() {
    const board = ensureDepartureBoard();
    const group = currentRecommendations?.primary;
    if (!board || !group || !currentContext) {
      if (board) board.hidden = true;
      return;
    }

    board.hidden = false;
    const people = board.querySelector("#departurePeople");
    const meetText = board.querySelector("#departureMeetText");
    const badge = board.querySelector("#departureBoardBadge");
    const recalcButton = board.querySelector("#recalculateButton");
    const assignments = assignmentsFor(group);

    if (people) {
      people.classList.toggle("group-departure-people", assignments.length > 2);
      people.innerHTML = assignments.map((assignment) => personDepartureRow(assignment.member, assignment.route)).join("");
    }
    if (meetText) meetText.innerHTML = meetupBoardText(group);
    if (badge) badge.textContent = boardBadge(currentRecommendations);

    if (recalcButton) {
      const now = Date.now();
      recalcButton.hidden = !assignments.some((assignment) => assignment.route.departure.getTime() < now - 30_000);
    }
  }

  function delayLabel(segment) {
    const delay = Number(segment?.departureDelay || segment?.arrivalDelay || 0);
    if (!Number.isFinite(delay) || delay === 0) return "";
    return delay > 0 ? `+${delay} min` : `${delay} min`;
  }

  function segmentMeta(segment) {
    const items = [];
    if (segment.headsign) items.push(`toward ${segment.headsign}`);
    const delay = delayLabel(segment);
    if (delay) items.push(delay);
    if (Number.isFinite(segment.duration)) items.push(`${segment.duration} min`);
    return items.join(" · ");
  }

  function withPlatform(name, platform) {
    const cleanName = String(name || "").trim();
    const cleanPlatform = String(platform || "").trim();
    if (!cleanPlatform) return cleanName;
    if (!cleanName) return `Stop ${cleanPlatform}`;

    const normalizedName = cleanName.toLocaleLowerCase("de-DE");
    const normalizedPlatform = cleanPlatform.toLocaleLowerCase("de-DE");
    const suffixPatterns = [` ${normalizedPlatform}`, `(${normalizedPlatform})`, `platform ${normalizedPlatform}`, `steig ${normalizedPlatform}`, `gleis ${normalizedPlatform}`];
    if (suffixPatterns.some((suffix) => normalizedName.endsWith(suffix))) return cleanName;
    return `${cleanName} ${cleanPlatform}`;
  }

  function intermediateHtml(segment) {
    const stops = Array.isArray(segment.intermediateStops) ? segment.intermediateStops : [];
    if (!stops.length) return "";
    const names = stops.map((stop) => typeof stop === "string" ? stop : withPlatform(stop?.name, stop?.track)).filter(Boolean);
    if (!names.length) return "";
    const visible = names.slice(0, 5);
    const suffix = names.length > visible.length ? ` +${names.length - visible.length} more` : "";
    return `<small class="timeline-via">via ${escapeHtml(visible.join(" · "))}${escapeHtml(suffix)}</small>`;
  }

  function instructionsHtml(segment) {
    const instructions = Array.isArray(segment.instructions) ? segment.instructions : [];
    if (!instructions.length) return "";
    return `<small class="timeline-instructions">${instructions.slice(0, 3).map(escapeHtml).join(" · ")}</small>`;
  }

  function renderSegment(segment, isLast, fallback = false) {
    const from = withPlatform(segment.from || "Start", segment.platformFrom);
    const to = withPlatform(segment.to || "Next stop", segment.platformTo);
    const meta = segmentMeta(segment);
    return `<div class="timeline-step ${isLast ? "last" : ""} ${fallback ? "fallback-step" : ""}">
      <div class="timeline-time">${formatTime(segment.departure)}</div>
      <div class="timeline-rail"><span></span></div>
      <div class="timeline-copy">
        <strong>${escapeHtml(segment.title || segment.modeLabel || "Journey")}</strong>
        <span>${escapeHtml(from)} → ${escapeHtml(to)}</span>
        ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
        ${intermediateHtml(segment)}${instructionsHtml(segment)}
      </div>
    </div>`;
  }

  function fallbackSegments(route) {
    const parts = String(route?.description || "Public transport").split("→").map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return [];
    const totalMs = Math.max(60_000, route.arrival - route.departure);
    const stepMs = totalMs / parts.length;
    return parts.map((title, index) => ({
      title,
      modeLabel: title,
      from: index === 0 ? (route.origin || "Start") : "Transfer",
      to: index === parts.length - 1 ? (route.destination || "Destination") : "Next leg",
      departure: new Date(route.departure.getTime() + stepMs * index),
      arrival: new Date(route.departure.getTime() + stepMs * (index + 1)),
      duration: Math.max(1, Math.round(stepMs / 60_000)),
      fallback: true,
    }));
  }

  function routeTimeline(member, route) {
    let segments = Array.isArray(route.segments) ? route.segments.filter(Boolean) : [];
    let fallback = false;
    if (!segments.length) { segments = fallbackSegments(route); fallback = true; }

    const timeline = segments.length
      ? segments.map((segment, index) => renderSegment(segment, index === segments.length - 1, fallback)).join("")
      : `<p class="timeline-empty">No route steps are available for this journey.</p>`;

    return `<div class="route-timeline">
      <div class="route-timeline-heading"><span class="group-person-swatch" style="background:${escapeHtml(member.color)}" aria-hidden="true"></span><strong>${escapeHtml(member.name)}</strong><span>${formatTime(route.departure)} → ${formatTime(route.arrival)}</span></div>
      ${fallback ? `<p class="timeline-fallback-note">Basic breakdown — MOTIS did not include full leg metadata for this specific journey.</p>` : ""}
      <div class="timeline-steps">${timeline}</div>
    </div>`;
  }

  function enrichCard(card, group) {
    card.querySelector(".journey-v05")?.remove();
    if (!group) return;
    const assignments = assignmentsFor(group);
    const details = document.createElement("details");
    details.className = "journey-v05 journey-details";
    details.innerHTML = `<summary><span>Journey timeline</span><span class="journey-summary-meta">stops · platforms · direction</span></summary>
      <div class="journey-timeline-grid ${assignments.length > 2 ? "group-timeline-grid" : ""}">${assignments.map((assignment) => routeTimeline(assignment.member, assignment.route)).join("")}</div>`;
    card.appendChild(details);
  }

  function enrichResultCards() {
    if (!results || !currentRecommendations) return;
    const cards = [...results.querySelectorAll(":scope > .result")];
    const types = ["primary", "backup"];
    cards.forEach((card, index) => {
      const type = card.dataset.mapPair || types[index];
      if (type && currentRecommendations[type]) enrichCard(card, currentRecommendations[type]);
    });
  }

  async function refreshJourneyData() {
    if (!dataBadge?.classList.contains("live") || !window.NVSTransit?.fetchRoutes || !window.NVSRecommend?.recommendGroup) {
      currentRecommendations = null;
      currentContext = null;
      updateDepartureBoard();
      return;
    }

    const context = currentContextFromForm();
    if (!context.target || !context.destination || context.members.some((member) => !member.originKey)) return;

    try {
      const routeSets = await Promise.all(
        context.members.map((member) => window.NVSTransit.fetchRoutes(member.originKey, context.destination, context.target)),
      );
      if (routeSets.some((routes) => !routes.length)) return;
      currentRecommendations = window.NVSRecommend.recommendGroup(routeSets, context.members, context.target, {
        priorityIds: window.NVSGroup?.getPriorityIds?.() || [],
      });
      if (!currentRecommendations?.primary) return;
      currentContext = context;
      updateDepartureBoard();
      enrichResultCards();
    } catch (error) {
      console.warn("v0.7 journey enrichment failed:", error);
    }
  }

  function scheduleRefresh(delay = 100) {
    clearTimeout(refreshTimer);
    if (document.hidden) return;
    refreshTimer = setTimeout(refreshJourneyData, delay);
  }

  function scheduleClock(delay = 15_000) {
    clearTimeout(clockTimer);
    if (document.hidden) return;
    clockTimer = setTimeout(() => {
      updateDepartureBoard();
      scheduleClock();
    }, delay);
  }

  function resumeJourney() {
    if (document.hidden) return;
    updateDepartureBoard();
    scheduleClock();
    if (dataBadge?.classList.contains("live")) scheduleRefresh(0);
  }

  if (dataBadge) new MutationObserver(() => scheduleRefresh(100)).observe(dataBadge, { attributes: true, attributeFilter: ["class"] });
  if (results) new MutationObserver(() => {
    if (dataBadge?.classList.contains("live")) scheduleRefresh(80);
  }).observe(results, { childList: true });

  [personAInput, personBInput, destinationInput, dateInput, timeInput].forEach((input) => input?.addEventListener("change", () => scheduleRefresh(180)));
  window.addEventListener("nvs-priority-change", () => scheduleRefresh(30));
  window.addEventListener("nvs-timing-change", () => scheduleRefresh(30));
  window.addEventListener("nvs-group-change", () => scheduleRefresh(30));
  window.addEventListener("nvs-group-recommendations-rendered", (event) => {
    const detail = event.detail || {};
    if (!detail.recommendations) return;
    currentRecommendations = detail.recommendations;
    currentContext = {
      members: detail.members || groupMembers(),
      destination: detail.destination || destinationInput?.value,
      target: detail.target || currentContextFromForm().target,
    };
    updateDepartureBoard();
    enrichResultCards();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(clockTimer);
      clearTimeout(refreshTimer);
      return;
    }
    resumeJourney();
  });
  window.addEventListener("pageshow", resumeJourney);
  window.addEventListener("nvs-shared-view-resumed", resumeJourney);

  ensureDepartureBoard();
  scheduleClock();
  scheduleRefresh(350);

  window.NVSJourney = Object.freeze({ refresh: scheduleRefresh, recalculate: () => plannerForm?.requestSubmit() });
})();