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
  let currentConnections = null;
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

  function minutesBetween(a, b) {
    return Math.round(Math.abs(a.getTime() - b.getTime()) / 60_000);
  }

  function signedMinutesBetween(date, target) {
    return Math.round((date.getTime() - target.getTime()) / 60_000);
  }

  function createPairs(routesA, routesB, target) {
    const pairs = [];
    for (const routeA of routesA) {
      for (const routeB of routesB) {
        const latestArrival = routeA.arrival > routeB.arrival ? routeA.arrival : routeB.arrival;
        const earliestArrival = routeA.arrival < routeB.arrival ? routeA.arrival : routeB.arrival;
        const waitingDifference = minutesBetween(routeA.arrival, routeB.arrival);
        const targetDifference = signedMinutesBetween(latestArrival, target);
        const score = Math.abs(targetDifference) + waitingDifference * 1.8;
        pairs.push({
          routeA,
          routeB,
          latestArrival,
          earliestArrival,
          waitingDifference,
          targetDifference,
          score,
        });
      }
    }
    return pairs;
  }

  function scoreDirectionalPair(pair, target, direction) {
    const targetDistance = direction === "early"
      ? (target.getTime() - pair.latestArrival.getTime()) / 60_000
      : (pair.earliestArrival.getTime() - target.getTime()) / 60_000;
    return Math.max(0, targetDistance) + pair.waitingDifference * 1.5;
  }

  function chooseConnections(pairs, target) {
    if (!pairs.length) return { early: null, best: null, later: null };
    const best = [...pairs].sort((a, b) => a.score - b.score)[0];
    const early = pairs
      .filter((pair) => pair !== best && pair.latestArrival <= target)
      .sort((a, b) => scoreDirectionalPair(a, target, "early") - scoreDirectionalPair(b, target, "early"))[0] || null;
    const later = pairs
      .filter((pair) => pair !== best && pair.earliestArrival >= target)
      .sort((a, b) => scoreDirectionalPair(a, target, "later") - scoreDirectionalPair(b, target, "later"))[0] || null;
    return { early, best, later };
  }

  function getTargetDate() {
    if (!dateInput?.value || !timeInput?.value) return null;
    const target = new Date(`${dateInput.value}T${timeInput.value}`);
    return Number.isNaN(target.getTime()) ? null : target;
  }

  function currentContextFromForm() {
    return {
      personA: personAInput?.value,
      personB: personBInput?.value,
      destination: destinationInput?.value,
      target: getTargetDate(),
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
        <span class="departure-board-badge">Best match</span>
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

    board.querySelector("#recalculateButton")?.addEventListener("click", () => {
      plannerForm?.requestSubmit();
    });

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
    return {
      text: `in ${hours}h${remaining ? ` ${remaining}m` : ""}`,
      state: "future",
    };
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
    const pair = currentConnections?.best;
    if (!board || !pair || !currentContext) {
      if (board) board.hidden = true;
      return;
    }

    board.hidden = false;
    const people = board.querySelector("#departurePeople");
    const meetText = board.querySelector("#departureMeetText");
    const recalcButton = board.querySelector("#recalculateButton");

    if (people) {
      people.innerHTML =
        personDepartureRow("You", "person-dot-you", pair.routeA) +
        personDepartureRow("Friend", "person-dot-friend", pair.routeB);
    }

    if (meetText) {
      meetText.innerHTML = `Together around <strong>${formatTime(pair.latestArrival)}</strong> · ${pair.waitingDifference} min arrival gap`;
    }

    if (recalcButton) {
      const now = Date.now();
      const missed = pair.routeA.departure.getTime() < now - 30_000 || pair.routeB.departure.getTime() < now - 30_000;
      recalcButton.hidden = !missed;
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
    if (segment.platformFrom) items.push(`platform ${segment.platformFrom}`);
    const delay = delayLabel(segment);
    if (delay) items.push(delay);
    return items.join(" · ");
  }

  function renderSegment(segment, isLast) {
    const from = segment.from || "Start";
    const to = segment.to || "Next stop";
    const meta = segmentMeta(segment);
    const duration = Number.isFinite(segment.duration) ? `${segment.duration} min` : "";

    return `
      <div class="timeline-step ${isLast ? "last" : ""}">
        <div class="timeline-time">${formatTime(segment.departure)}</div>
        <div class="timeline-rail"><span></span></div>
        <div class="timeline-copy">
          <strong>${escapeHtml(segment.title || segment.modeLabel || "Journey")}</strong>
          <span>${escapeHtml(from)} → ${escapeHtml(to)}</span>
          <small>${escapeHtml([meta, duration].filter(Boolean).join(" · "))}</small>
        </div>
      </div>
    `;
  }

  function routeTimeline(label, route, dotClass) {
    const segments = Array.isArray(route.segments) ? route.segments : [];
    const timeline = segments.length
      ? segments.map((segment, index) => renderSegment(segment, index === segments.length - 1)).join("")
      : `<p class="timeline-empty">Detailed leg information was not returned for this route.</p>`;

    return `
      <div class="route-timeline">
        <div class="route-timeline-heading">
          <span class="person-dot ${dotClass}" aria-hidden="true"></span>
          <strong>${escapeHtml(label)}</strong>
          <span>${formatTime(route.departure)} → ${formatTime(route.arrival)}</span>
        </div>
        <div class="timeline-steps">${timeline}</div>
      </div>
    `;
  }

  function enrichCard(card, pair, type) {
    card.querySelector(".journey-v05")?.remove();
    if (!pair) return;

    const details = document.createElement("details");
    details.className = "journey-v05 journey-details";
    if (type === "best") details.open = false;
    details.innerHTML = `
      <summary>
        <span>Journey timeline</span>
        <span class="journey-summary-meta">stops · platforms · direction</span>
      </summary>
      <div class="journey-timeline-grid">
        ${routeTimeline("You", pair.routeA, "person-dot-you")}
        ${routeTimeline("Friend", pair.routeB, "person-dot-friend")}
      </div>
    `;
    card.appendChild(details);
  }

  function enrichResultCards() {
    if (!results || !currentConnections) return;
    const cards = [...results.querySelectorAll(":scope > .result")];
    const types = ["early", "best", "later"];

    cards.forEach((card, index) => {
      const type = types[index];
      if (!type || card.classList.contains("unavailable-result")) return;
      enrichCard(card, currentConnections[type], type);
    });
  }

  async function refreshJourneyData() {
    if (!dataBadge?.classList.contains("live") || !window.NVSTransit?.fetchRoutes) {
      currentConnections = null;
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

      const connections = chooseConnections(createPairs(routesA, routesB, context.target), context.target);
      if (!connections.best) return;

      currentConnections = connections;
      currentContext = context;
      updateDepartureBoard();
      enrichResultCards();
    } catch (error) {
      console.warn("v0.5 journey enrichment failed:", error);
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

  ensureDepartureBoard();
  clearInterval(clockTimer);
  clockTimer = setInterval(updateDepartureBoard, 15_000);
  scheduleRefresh(350);

  window.NVSJourney = Object.freeze({
    refresh: scheduleRefresh,
    recalculate: () => plannerForm?.requestSubmit(),
  });
})();
