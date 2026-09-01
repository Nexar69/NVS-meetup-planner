(() => {
  const CANDIDATES = ["Marienplatz", "Dreescher Markt", "Hauptbahnhof"];
  const BETWEEN_CANDIDATES_MS = 180;

  const personAInput = document.getElementById("personA");
  const personBInput = document.getElementById("personB");
  const destinationInput = document.getElementById("destination");
  const dateInput = document.getElementById("date");
  const timeInput = document.getElementById("time");
  const plannerForm = document.getElementById("plannerForm");
  const toast = document.getElementById("toast");

  let toastTimer = null;
  let running = false;
  let frozenDocument = false;
  let runGeneration = 0;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function cancelToast() {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  function showToast(message) {
    if (frozenDocument || !toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    cancelToast();
    toastTimer = setTimeout(() => {
      toastTimer = null;
      if (!frozenDocument) toast.classList.remove("show");
    }, 2800);
  }

  function formatTime(date) {
    return new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function getTargetDate() {
    if (!dateInput?.value || !timeInput?.value) return null;
    const target = new Date(`${dateInput.value}T${timeInput.value}`);
    return Number.isNaN(target.getTime()) ? null : target;
  }

  function minutesBetween(a, b) {
    return Math.round(Math.abs(a.getTime() - b.getTime()) / 60_000);
  }

  function bestPair(routesA, routesB, target) {
    let winner = null;

    for (const routeA of routesA) {
      for (const routeB of routesB) {
        const latestArrival = routeA.arrival > routeB.arrival ? routeA.arrival : routeB.arrival;
        const waitGap = minutesBetween(routeA.arrival, routeB.arrival);
        const targetGap = Math.abs(Math.round((latestArrival.getTime() - target.getTime()) / 60_000));
        const meetupScore = targetGap + waitGap * 1.8;

        if (!winner || meetupScore < winner.meetupScore) {
          winner = {
            routeA,
            routeB,
            latestArrival,
            waitGap,
            targetGap,
            meetupScore,
          };
        }
      }
    }

    return winner;
  }

  function scoreCandidate(candidate, pair) {
    const travelA = pair.routeA.duration;
    const travelB = pair.routeB.duration;
    const fairnessGap = Math.abs(travelA - travelB);
    const maxTravel = Math.max(travelA, travelB);
    const totalTravel = travelA + travelB;

    const fairScore =
      fairnessGap * 3 +
      pair.waitGap * 1.25 +
      pair.targetGap * 0.7 +
      maxTravel * 0.35 +
      totalTravel * 0.08;

    return {
      candidate,
      pair,
      travelA,
      travelB,
      fairnessGap,
      maxTravel,
      totalTravel,
      fairScore,
    };
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function buildDialog() {
    const dialog = document.createElement("dialog");
    dialog.id = "fairMeetupDialog";
    dialog.className = "fair-dialog";
    dialog.innerHTML = `
      <div class="fair-dialog-header">
        <div>
          <p class="section-kicker">v0.5 beta</p>
          <h2>Find somewhere fair</h2>
          <p>Compare three central meetup hubs and balance both people's travel times.</p>
        </div>
        <button type="button" class="fair-close" aria-label="Close">×</button>
      </div>
      <div class="fair-progress" id="fairProgress"></div>
      <div class="fair-results" id="fairResults"></div>
      <p class="fair-footnote">Fair Meetup only runs when you ask for it. It checks three candidates (up to six route searches) and reuses the normal two-minute Transitous route cache.</p>
    `;
    document.body.appendChild(dialog);

    dialog.querySelector(".fair-close")?.addEventListener("click", () => {
      if (!frozenDocument) dialog.close();
    });
    dialog.addEventListener("click", (event) => {
      if (!frozenDocument && event.target === dialog && !running) dialog.close();
    });

    return {
      dialog,
      progress: dialog.querySelector("#fairProgress"),
      results: dialog.querySelector("#fairResults"),
    };
  }

  const fairDialog = buildDialog();

  function ensureOption(key) {
    if (frozenDocument || !destinationInput) return;
    const exists = [...destinationInput.options].some((option) => option.value === key);
    if (exists) return;
    const location = window.NVSTransit?.LOCATIONS?.[key];
    if (!location) return;
    const option = document.createElement("option");
    option.value = key;
    option.textContent = location.label || key;
    destinationInput.appendChild(option);
  }

  function useCandidate(candidate) {
    if (frozenDocument) return;
    ensureOption(candidate);
    destinationInput.value = candidate;
    destinationInput.dispatchEvent(new Event("change", { bubbles: true }));
    fairDialog.dialog.close();
    plannerForm?.requestSubmit();
    showToast(`Meetup set to ${candidate}`);
  }

  function candidateTag(index, item, fastestKey) {
    if (index === 0) return "★ Fairest";
    if (item.candidate === fastestKey) return "⚡ Fastest";
    return "Backup";
  }

  function renderResults(items) {
    if (frozenDocument) return;
    fairDialog.results.innerHTML = "";
    if (!items.length) {
      fairDialog.results.innerHTML = `
        <div class="fair-empty">
          <strong>No fair candidates could be calculated.</strong>
          <span>Try another meetup time or check your connection.</span>
        </div>
      `;
      return;
    }

    const fastest = [...items].sort((a, b) => a.maxTravel - b.maxTravel || a.totalTravel - b.totalTravel)[0];

    items.forEach((item, index) => {
      const card = document.createElement("article");
      card.className = `fair-card ${index === 0 ? "winner" : ""}`;
      card.innerHTML = `
        <div class="fair-card-top">
          <div>
            <span class="fair-rank">${escapeHtml(candidateTag(index, item, fastest?.candidate))}</span>
            <h3>${escapeHtml(item.candidate)}</h3>
          </div>
          <button type="button" class="fair-use-button">Meet here</button>
        </div>

        <div class="fair-travel-grid">
          <div>
            <span>You</span>
            <strong>${item.travelA} min</strong>
            <small>${formatTime(item.pair.routeA.departure)} → ${formatTime(item.pair.routeA.arrival)}</small>
          </div>
          <div>
            <span>Friend</span>
            <strong>${item.travelB} min</strong>
            <small>${formatTime(item.pair.routeB.departure)} → ${formatTime(item.pair.routeB.arrival)}</small>
          </div>
        </div>

        <div class="fair-metrics">
          <span><strong>${item.fairnessGap} min</strong> travel-time difference</span>
          <span><strong>${item.pair.waitGap} min</strong> arrival gap</span>
          <span>Together ~<strong>${formatTime(item.pair.latestArrival)}</strong></span>
        </div>
      `;
      card.querySelector(".fair-use-button")?.addEventListener("click", () => useCandidate(item.candidate));
      fairDialog.results.appendChild(card);
    });
  }

  async function runFairFinder() {
    if (frozenDocument || running) return;
    const target = getTargetDate();
    const originA = personAInput?.value;
    const originB = personBInput?.value;

    if (!target || !originA || !originB) {
      showToast("Choose both starting points and a meetup time first.");
      return;
    }
    if (!navigator.onLine) {
      showToast("Fair Meetup needs an internet connection for real routes.");
      return;
    }
    if (!window.NVSTransit?.fetchRoutes) {
      showToast("Live routing is not available right now.");
      return;
    }

    const runId = ++runGeneration;
    running = true;
    fairDialog.dialog.showModal();
    fairDialog.results.innerHTML = "";
    fairDialog.progress.innerHTML = `<span class="fair-spinner"></span><strong>Checking central meetup options…</strong>`;

    const scored = [];

    try {
      for (let index = 0; index < CANDIDATES.length; index += 1) {
        if (frozenDocument || runId !== runGeneration) return;
        const candidate = CANDIDATES[index];
        fairDialog.progress.innerHTML = `<span class="fair-spinner"></span><strong>Checking ${escapeHtml(candidate)} · ${index + 1}/${CANDIDATES.length}</strong>`;

        try {
          const [routesA, routesB] = await Promise.all([
            window.NVSTransit.fetchRoutes(originA, candidate, target),
            window.NVSTransit.fetchRoutes(originB, candidate, target),
          ]);
          if (frozenDocument || runId !== runGeneration) return;
          const pair = bestPair(routesA, routesB, target);
          if (pair) scored.push(scoreCandidate(candidate, pair));
        } catch (error) {
          if (frozenDocument || runId !== runGeneration) return;
          console.warn(`Fair Meetup candidate failed: ${candidate}`, error);
        }

        if (index < CANDIDATES.length - 1) {
          await wait(BETWEEN_CANDIDATES_MS);
          if (frozenDocument || runId !== runGeneration) return;
        }
      }

      if (frozenDocument || runId !== runGeneration) return;
      scored.sort((a, b) => a.fairScore - b.fairScore || a.maxTravel - b.maxTravel);
      renderResults(scored);
      fairDialog.progress.textContent = scored.length
        ? `Compared ${scored.length} central meetup options.`
        : "No candidate produced usable live journeys.";
    } finally {
      if (runId === runGeneration) running = false;
    }
  }

  function injectButton() {
    if (frozenDocument) return;
    const field = destinationInput?.closest(".field");
    if (!field || document.getElementById("fairMeetupButton")) return;

    let tools = field.querySelector(".location-tools");
    if (!tools) {
      tools = document.createElement("div");
      tools.className = "location-tools";
      field.appendChild(tools);
    }

    const button = document.createElement("button");
    button.id = "fairMeetupButton";
    button.type = "button";
    button.className = "location-tool-button fair-meetup-button";
    button.innerHTML = `<span aria-hidden="true">⚖</span><span>Find fair meetup</span>`;
    button.addEventListener("click", runFairFinder);
    tools.appendChild(button);
  }

  function suspendDocument() {
    frozenDocument = true;
    runGeneration += 1;
    running = false;
    cancelToast();
  }

  function resumeDocument() {
    frozenDocument = false;
    if (fairDialog.dialog.open) fairDialog.dialog.close();
    fairDialog.progress.textContent = "";
    fairDialog.results.innerHTML = "";
    injectButton();
  }

  CANDIDATES.forEach(ensureOption);
  injectButton();
  window.addEventListener("pagehide", suspendDocument);
  window.addEventListener("pageshow", resumeDocument);

  window.NVSFair = Object.freeze({
    run: runFairFinder,
  });
})();
