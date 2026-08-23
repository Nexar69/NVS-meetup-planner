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
    return new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function currentContextFromForm() {
    const target = dateInput?.value && timeInput?.value
      ? new Date(`${dateInput.value}T${timeInput.value}`)
      : null;
    return {
      personA: personAInput?.value,
      personB: personBInput?.value,
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
        <div>
          <p class="section-kicker">Live plan</p>
          <h3>When should everyone leave?</h3>
        </div>
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

  function personDepartureRow(label, kind, route) {
    const countdown = countdownText(route.departure);
    return `
      <div class="departure-person ${countdown.state}">
        <div class="departure-person-name">
          <span class="person-dot ${kind}" aria-hidden="true"></span>
          <span>${escapeHtml(label)}</span>
        </div>
        <div class="departure-person-clock">
          <strong>${formatTime(route.departure)}</strong>
          <span>${escapeHtml(countdown.text)}</span>
        </div>
      </div>
    `;
  }

  function updateDepartureBoard() {
    const board = ensureDepartureBoard();
    const pair = currentRecommendations?.primary;
    if (!board || !pair || !currentContext) {
      if (board) board.hidden = true;
      return;
    }

    board.hidden = false;
    const people = board.querySelector("#departurePeople");
    const meetText = board.querySelector("#departureMeetText");
    const badge = board.querySelector("#departureBoardBadge");
    const recalcButton = board.querySelector("#recalculateButton");

    if (people) people.innerHTML =
      personDepartureRow("You", "person-dot-you", pair.routeA) +
      personDepartureRow("Friend", "person-dot-friend", pair.routeB);

    if (meetText) meetText.innerHTML = `Together around <strong>${formatTime(pair.latestArrival)}</strong> · ${pair.waitingDifference} min arrival gap`;
    if (badge) badge.textContent = currentRecommendations.mode === "fastest" ? "⚡ Fastest" : "🤝 Together";

    if (recalcButton) {
      const now = Date.now();
      recalcButton.hidden = !(pair.routeA.departure.getTime() < now - 30_000 || pair.routeB.departure.getTime() < now - 30_000);
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
    const suffixPatterns = [
      ` ${normalizedPlatform}`,
      `(${normalizedPlatform})`,
      `platform ${normalizedPlatform}`,
      `steig ${normalizedPlatform}`,
      `gleis ${normalizedPlatform}`,
    ];
    if (suffixPatterns.some((suffix) => normalizedName.endsWith(suffix))) return cleanName;

    return `${cleanName} ${cleanPlatform}`;
  }

  function intermediateHtml(segment) {
    const stops = Array.isArray(segment.intermediateStops) ? segment.intermediateStops : [];
    if (!stops.length) return "";
    const names = stops
      .map((stop) => {
        if (typeof stop === "string") return stop;
        return withPlatform(stop?.name, stop?.track);
      })
      .filter(Boolean);
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
    return `
      <div class="timeline-step ${isLast ? "last" : ""} ${fallback ? "fallback-step" : ""}">
        <div class="timeline-time">${formatTime(segment.departure)}</div>
        <div class="timeline-rail"><span></span></div>
        <div class="timeline-copy">
          <strong>${escapeHtml(segment.title || segment.modeLabel || "Journey")}</strong>
          <span>${escapeHtml(from)} → ${escapeHtml(to)}</span>
          ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
          ${intermediateHtml(segment)}
          ${instructionsHtml(segment)}
        </div>
      </div>
    `;
  }

  function fallbackSegments(route) {
    const parts = String(route?.description || "Public transport")
      .split("→")
      .map((part) => part.trim())
      .filter(Boolean);
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

  function routeTimeline(label, route, dotClass) {
    let segments = Array.isArray(route.segments) ? route.segments.filter(Boolean) : [];
    let fallback = false;
    if (!segments.length) {
      segments = fallbackSegments(route);
      fallback = true;
    }

    const timeline = segments.length
      ? segments.map((segment, index) => renderSegment(segment, index === segments.length - 1, fallback)).join("")
      : `<p class="timeline-empty">No route steps are available for this journey.</p>`;

    return `
      <div class="route-timeline">
        <div class="route-timeline-heading">
          <span class="person-dot ${dotClass}" aria-hidden="true"></span>
          <strong>${escapeHtml(label)}</strong>
          <span>${formatTime(route.departure)} → ${formatTime(route.arrival)}</span>
        </div>
        ${fallback ? `<p class="timeline-fallback-note">Basic breakdown — MOTIS did not include full leg metadata for this specific journey.</p>` : ""}
        <div class="timeline-steps">${timeline}</div>
      </div>
    `;
  }

  function enrichCard(card, pair, type) {
    card.querySelector(".journey-v05")?.remove();
    if (!pair) return;

    const details = document.createElement("details");
    details.className = "journey-v05 journey-details";
    details.innerHTML = `
      <summary><span>Journey timeline</span><span class="journey-summary-meta">stops · platforms · direction</span></summary>
      <div class="journey-timeline-grid">
        ${routeTimeline("You", pair.routeA, "person-dot-you")}
        ${routeTimeline("Friend", pair.routeB, "person-dot-friend")}
      </div>
    `;
    card.appendChild(details);
  }

  function enrichResultCards() {
    if (!results || !currentRecommendations) return;
    const cards = [...results.querySelectorAll(":scope > .result")];
    const types = ["primary", "backup"];
    cards.forEach((card, index) => {
      const type = card.dataset.mapPair || types[index];
      if (!type || !currentRecommendations[type]) return;
      enrichCard(card, currentRecommendations[type], type);
    });
  }

  async function refreshJourneyData() {
    if (!dataBadge?.classList.contains("live") || !window.NVSTransit?.fetchRoutes || !window.NVSRecommend?.recommend) {
      currentRecommendations = null;
      currentContext = null;
      updateDepartureBoard();
      return;
    }

    const context = currentContextFromForm();
    if (!context.target || !context.personA || !context.personB || !context.destination) return;

    try {
      const [routesA, routesB] = await Promise.all([
        window.NVSTransit.fetchRoutes(context.personA, context.destination, context.target),
        window.NVSTransit.fetchRoutes(context.personB, context.destination, context.target),
      ]);

      currentRecommendations = window.NVSRecommend.recommend(routesA, routesB, context.target);
      if (!currentRecommendations?.primary) return;
      currentContext = context;
      updateDepartureBoard();
      enrichResultCards();
    } catch (error) {
      console.warn("v0.5.2 journey enrichment failed:", error);
    }
  }

  function scheduleRefresh(delay = 100) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshJourneyData, delay);
  }

  if (dataBadge) {
    new MutationObserver(() => scheduleRefresh(100)).observe(dataBadge, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  if (results) {
    new MutationObserver(() => {
      if (dataBadge?.classList.contains("live")) scheduleRefresh(80);
    }).observe(results, { childList: true });
  }

  [personAInput, personBInput, destinationInput, dateInput, timeInput].forEach((input) => {
    input?.addEventListener("change", () => scheduleRefresh(180));
  });

  window.addEventListener("nvs-optimization-change", () => scheduleRefresh(30));

  ensureDepartureBoard();
  clearInterval(clockTimer);
  clockTimer = setInterval(updateDepartureBoard, 15_000);
  scheduleRefresh(350);

  window.NVSJourney = Object.freeze({
    refresh: scheduleRefresh,
    recalculate: () => plannerForm?.requestSubmit(),
  });
})();