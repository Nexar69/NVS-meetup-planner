(() => {
  const STORAGE_KEY = "meet-schwerin-optimization-v1";
  const MODES = Object.freeze({
    together: {
      label: "Arrive together",
      icon: "🤝",
      description: "Minimise the arrival gap so neither person waits long.",
    },
    fastest: {
      label: "Get there fastest",
      icon: "⚡",
      description: "Prefer the quickest practical journeys, even if the arrival gap is a little larger.",
    },
  });

  let mode = "together";

  function readMode() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && MODES[saved]) mode = saved;
    } catch {
      // Local storage is optional.
    }
  }

  function minutesBetween(a, b) {
    return Math.round(Math.abs(a.getTime() - b.getTime()) / 60_000);
  }

  function signedMinutesBetween(date, target) {
    return Math.round((date.getTime() - target.getTime()) / 60_000);
  }

  function createPairs(routesA, routesB, target) {
    const pairs = [];

    for (const routeA of routesA || []) {
      for (const routeB of routesB || []) {
        if (!(routeA?.arrival instanceof Date) || !(routeB?.arrival instanceof Date)) continue;
        if (!(routeA?.departure instanceof Date) || !(routeB?.departure instanceof Date)) continue;

        const latestArrival = routeA.arrival > routeB.arrival ? routeA.arrival : routeB.arrival;
        const earliestArrival = routeA.arrival < routeB.arrival ? routeA.arrival : routeB.arrival;
        const waitingDifference = minutesBetween(routeA.arrival, routeB.arrival);
        const targetDifference = signedMinutesBetween(latestArrival, target);
        const targetDistance = Math.abs(targetDifference);
        const travelA = Number(routeA.duration) || Math.max(1, minutesBetween(routeA.departure, routeA.arrival));
        const travelB = Number(routeB.duration) || Math.max(1, minutesBetween(routeB.departure, routeB.arrival));
        const totalTravel = travelA + travelB;
        const maxTravel = Math.max(travelA, travelB);

        pairs.push({
          routeA,
          routeB,
          latestArrival,
          earliestArrival,
          waitingDifference,
          targetDifference,
          targetDistance,
          travelA,
          travelB,
          totalTravel,
          maxTravel,
        });
      }
    }

    return pairs;
  }

  function pairScore(pair, selectedMode = mode) {
    if (selectedMode === "fastest") {
      // Speed dominates, while target-time accuracy still prevents a very fast
      // connection an hour too early from becoming the recommendation.
      return (
        pair.totalTravel * 1.7 +
        pair.maxTravel * 0.45 +
        pair.targetDistance * 1.15 +
        pair.waitingDifference * 0.28
      );
    }

    // Togetherness strongly rewards a small arrival gap while still avoiding
    // unnecessarily slow or badly timed pairs.
    return (
      pair.waitingDifference * 4.2 +
      pair.targetDistance * 1.2 +
      pair.maxTravel * 0.22 +
      pair.totalTravel * 0.06
    );
  }

  function distinctEnough(a, b) {
    if (!a || !b) return true;
    const departureA = Math.abs(a.routeA.departure - b.routeA.departure) / 60_000;
    const departureB = Math.abs(a.routeB.departure - b.routeB.departure) / 60_000;
    const differentRoute = a.routeA.description !== b.routeA.description || a.routeB.description !== b.routeB.description;
    return departureA >= 3 || departureB >= 3 || differentRoute;
  }

  function recommend(routesA, routesB, target, selectedMode = mode) {
    const allPairs = createPairs(routesA, routesB, target);
    if (!allPairs.length) return { primary: null, backup: null, mode: selectedMode, pairs: [] };

    // Stay meaningfully near the requested meetup time whenever possible.
    const nearTarget = allPairs.filter((pair) => pair.targetDifference >= -25 && pair.targetDifference <= 20);
    const candidates = nearTarget.length ? nearTarget : allPairs;

    const ranked = [...candidates]
      .map((pair) => ({ ...pair, recommendationScore: pairScore(pair, selectedMode) }))
      .sort((a, b) =>
        a.recommendationScore - b.recommendationScore ||
        a.targetDistance - b.targetDistance ||
        a.waitingDifference - b.waitingDifference,
      );

    const primary = ranked[0] || null;
    const backup = ranked.find((pair) => pair !== primary && distinctEnough(pair, primary)) || ranked[1] || null;

    return {
      primary,
      backup,
      mode: selectedMode,
      pairs: ranked,
    };
  }

  function updateButtons() {
    document.querySelectorAll("[data-optimization-mode]").forEach((button) => {
      const active = button.dataset.optimizationMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    const description = document.getElementById("optimizationDescription");
    if (description) description.textContent = MODES[mode].description;
  }

  function setMode(nextMode, { submit = true } = {}) {
    if (!MODES[nextMode] || nextMode === mode) return;
    mode = nextMode;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Ignore storage failures.
    }
    updateButtons();
    window.dispatchEvent(new CustomEvent("nvs-priority-change", { detail: { mode } }));
    if (submit) document.getElementById("plannerForm")?.requestSubmit();
  }

  function installControl() {
    const timeGrid = document.querySelector(".time-grid");
    if (!timeGrid || document.getElementById("optimizationControl")) return;

    const control = document.createElement("section");
    control.id = "optimizationControl";
    control.className = "optimization-control";
    control.setAttribute("aria-labelledby", "optimizationTitle");
    control.innerHTML = `
      <div class="optimization-heading">
        <div>
          <span class="optimization-kicker">Optimise for</span>
          <strong id="optimizationTitle">What matters more?</strong>
        </div>
      </div>
      <div class="optimization-options" role="group" aria-label="Route optimisation priority">
        <button type="button" data-optimization-mode="together" aria-pressed="false">
          <span class="optimization-icon" aria-hidden="true">🤝</span>
          <span><strong>Arrive together</strong><small>Less waiting</small></span>
        </button>
        <button type="button" data-optimization-mode="fastest" aria-pressed="false">
          <span class="optimization-icon" aria-hidden="true">⚡</span>
          <span><strong>Get there fastest</strong><small>Less travel time</small></span>
        </button>
      </div>
      <p id="optimizationDescription" class="optimization-description"></p>
    `;

    timeGrid.insertAdjacentElement("afterend", control);
    control.querySelectorAll("[data-optimization-mode]").forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.optimizationMode));
    });
    updateButtons();
  }

  function configureMapTabs() {
    const tabs = document.querySelector(".map-tabs");
    if (!tabs) return;
    tabs.innerHTML = `
      <button type="button" data-map-pair="primary" class="active" aria-pressed="true">Best</button>
      <button type="button" data-map-pair="backup" aria-pressed="false">Backup</button>
    `;
  }

  readMode();
  installControl();
  configureMapTabs();

  window.NVSRecommend = Object.freeze({
    MODES,
    createPairs,
    recommend,
    getMode: () => mode,
    getModeInfo: () => MODES[mode],
    setMode,
  });
})();
