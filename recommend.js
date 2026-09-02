(() => {
  const STORAGE_KEY = "meet-schwerin-optimization-v2";
  const TIMING_KEY = "meet-schwerin-timing-v1";
  const NON_TRANSIT_MODES = new Set(["WALK", "BIKE", "BICYCLE", "CAR"]);
  const ASAP_PAST_TOLERANCE_MS = 2 * 60_000;
  const ASAP_SOON_HORIZON_MINUTES = 180;

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
    easy: {
      label: "Easy trip",
      icon: "😌",
      description: "Prefer fewer changes and less walking without making the journey unnecessarily slow.",
    },
  });

  const TIMING_MODES = Object.freeze({
    target: {
      label: "Around chosen time",
      icon: "🎯",
      description: "Stay close to the arrival time you picked.",
    },
    asap: {
      label: "Meet ASAP",
      icon: "🚀",
      description: "Find the earliest realistic time both people can be there from now.",
    },
  });

  let mode = "together";
  let timingMode = "target";

  const plannerForm = document.getElementById("plannerForm");
  const dateInput = document.getElementById("date");
  const timeInput = document.getElementById("time");
  const timeGrid = document.querySelector(".time-grid");
  const quickTimes = document.querySelector(".quick-times");

  function readState() {
    try {
      const savedMode = localStorage.getItem(STORAGE_KEY);
      const savedTiming = localStorage.getItem(TIMING_KEY);
      if (savedMode && MODES[savedMode]) mode = savedMode;
      if (savedTiming && TIMING_MODES[savedTiming]) timingMode = savedTiming;
    } catch {
      // Local storage is optional.
    }
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function roundUp(date, minutes = 5) {
    const copy = new Date(date);
    copy.setSeconds(0, 0);
    const remainder = copy.getMinutes() % minutes;
    if (remainder) copy.setMinutes(copy.getMinutes() + minutes - remainder);
    return copy;
  }

  function syncAsapAnchor() {
    if (timingMode !== "asap" || !dateInput || !timeInput) return;

    // Transitous needs a time anchor. Setting it one hour ahead makes the
    // existing two-hour timetable window begin around now, while the scorer
    // below still ranks by the real earliest shared arrival.
    const anchor = roundUp(new Date(Date.now() + 60 * 60_000), 5);
    dateInput.value = `${anchor.getFullYear()}-${pad(anchor.getMonth() + 1)}-${pad(anchor.getDate())}`;
    timeInput.value = `${pad(anchor.getHours())}:${pad(anchor.getMinutes())}`;
  }

  function minutesBetween(a, b) {
    return Math.round(Math.abs(a.getTime() - b.getTime()) / 60_000);
  }

  function signedMinutesBetween(date, target) {
    return Math.round((date.getTime() - target.getTime()) / 60_000);
  }

  function validDate(value) {
    return value instanceof Date && Number.isFinite(value.getTime());
  }

  function numericValue(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || !value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function positiveMinutes(value) {
    const parsed = numericValue(value);
    return parsed !== null && parsed > 0 ? parsed : null;
  }

  function fallbackTransfers(route) {
    const segments = Array.isArray(route?.segments) ? route.segments : [];
    const transitLegs = segments.filter((segment) => {
      const modeName = String(segment?.mode || "").trim().toUpperCase();
      return Boolean(modeName) && !NON_TRANSIT_MODES.has(modeName);
    }).length;
    return Math.max(0, transitLegs - 1);
  }

  function walkingMinutes(route) {
    const segments = Array.isArray(route?.segments) ? route.segments : [];
    return segments
      .filter((segment) => String(segment?.mode || "").toUpperCase() === "WALK")
      .reduce((sum, segment) => sum + (positiveMinutes(segment?.duration) || 0), 0);
  }

  function transfers(route) {
    const parsed = numericValue(route?.transfers);
    return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : fallbackTransfers(route);
  }

  function travelMinutes(route) {
    const explicit = positiveMinutes(route?.duration);
    if (explicit !== null) return explicit;
    const timetable = Math.round((route.arrival.getTime() - route.departure.getTime()) / 60_000);
    return Math.max(1, timetable);
  }

  function createPairs(routesA, routesB, target, nowValue) {
    const pairs = [];
    const now = validDate(nowValue) ? nowValue : new Date();
    const hasValidTarget = validDate(target);

    for (const routeA of routesA || []) {
      for (const routeB of routesB || []) {
        if (!validDate(routeA?.arrival) || !validDate(routeB?.arrival)) continue;
        if (!validDate(routeA?.departure) || !validDate(routeB?.departure)) continue;
        if (routeA.arrival < routeA.departure || routeB.arrival < routeB.departure) continue;

        const latestArrival = routeA.arrival > routeB.arrival ? routeA.arrival : routeB.arrival;
        const earliestArrival = routeA.arrival < routeB.arrival ? routeA.arrival : routeB.arrival;
        const waitingDifference = minutesBetween(routeA.arrival, routeB.arrival);
        const targetDifference = hasValidTarget ? signedMinutesBetween(latestArrival, target) : null;
        const targetDistance = targetDifference === null ? null : Math.abs(targetDifference);
        const travelA = travelMinutes(routeA);
        const travelB = travelMinutes(routeB);
        const totalTravel = travelA + travelB;
        const maxTravel = Math.max(travelA, travelB);
        const walkA = walkingMinutes(routeA);
        const walkB = walkingMinutes(routeB);
        const totalWalk = walkA + walkB;
        const totalTransfers = transfers(routeA) + transfers(routeB);
        const asapDeltaMs = latestArrival.getTime() - now.getTime();
        const asapEligible = asapDeltaMs >= -ASAP_PAST_TOLERANCE_MS;
        const asapMinutes = Math.max(0, Math.round(asapDeltaMs / 60_000));

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
          walkA,
          walkB,
          totalWalk,
          totalTransfers,
          asapEligible,
          asapMinutes,
        });
      }
    }

    return pairs;
  }

  function preferenceCost(pair, selectedMode = mode) {
    if (selectedMode === "fastest") {
      return pair.totalTravel * 1.7 + pair.maxTravel * 0.45 + pair.waitingDifference * 0.28;
    }

    if (selectedMode === "easy") {
      return (
        pair.totalTransfers * 16 +
        pair.totalWalk * 0.85 +
        pair.maxTravel * 0.28 +
        pair.totalTravel * 0.12 +
        pair.waitingDifference * 0.4
      );
    }

    return pair.waitingDifference * 4.2 + pair.maxTravel * 0.22 + pair.totalTravel * 0.06;
  }

  function pairScore(pair, selectedMode = mode, selectedTiming = timingMode) {
    const preference = preferenceCost(pair, selectedMode);

    if (selectedTiming === "asap") {
      // Earliest shared arrival dominates. Route preference then separates
      // similarly timed options.
      return pair.asapMinutes * 5.5 + preference;
    }

    return preference + (Number.isFinite(pair.targetDistance) ? pair.targetDistance * 1.2 : 0);
  }

  function distinctEnough(a, b) {
    if (!a || !b) return true;
    const departureA = Math.abs(a.routeA.departure - b.routeA.departure) / 60_000;
    const departureB = Math.abs(a.routeB.departure - b.routeB.departure) / 60_000;
    const differentRoute = a.routeA.description !== b.routeA.description || a.routeB.description !== b.routeB.description;
    return departureA >= 3 || departureB >= 3 || differentRoute;
  }

  function explain(pair, selectedMode = mode, selectedTiming = timingMode) {
    if (!pair) return "";

    const timingLead = selectedTiming === "asap"
      ? `Both can be there in about ${pair.asapMinutes} min.`
      : !Number.isFinite(pair.targetDistance)
        ? "The target time is unavailable, so route quality decides this recommendation."
        : pair.targetDifference === 0
          ? "It lands exactly on your target time."
          : `It stays ${pair.targetDistance} min from your target.`;

    if (selectedMode === "fastest") {
      return `${timingLead} ${pair.totalTravel} min combined travel, with a ${pair.waitingDifference} min arrival gap.`;
    }

    if (selectedMode === "easy") {
      const changes = pair.totalTransfers === 0 ? "no changes" : `${pair.totalTransfers} total change${pair.totalTransfers === 1 ? "" : "s"}`;
      const walk = pair.totalWalk ? ` and about ${pair.totalWalk} min walking combined` : " and almost no walking";
      return `${timingLead} It keeps things simple: ${changes}${walk}.`;
    }

    return `${timingLead} You arrive only ${pair.waitingDifference} min apart, so neither person waits long.`;
  }

  function recommend(routesA, routesB, target, selectedMode = mode, selectedTiming = timingMode, nowValue) {
    const allPairs = createPairs(routesA, routesB, target, nowValue);
    if (!allPairs.length) return { primary: null, backup: null, mode: selectedMode, timingMode: selectedTiming, pairs: [] };

    let candidates = allPairs;
    if (selectedTiming === "target") {
      const nearTarget = allPairs.filter((pair) => Number.isFinite(pair.targetDifference) && pair.targetDifference >= -25 && pair.targetDifference <= 20);
      candidates = nearTarget.length ? nearTarget : allPairs;
    } else {
      const fresh = allPairs.filter((pair) => pair.asapEligible);
      if (!fresh.length) return { primary: null, backup: null, mode: selectedMode, timingMode: selectedTiming, pairs: [] };
      const soon = fresh.filter((pair) => pair.asapMinutes <= ASAP_SOON_HORIZON_MINUTES);
      candidates = soon.length ? soon : fresh;
    }

    const ranked = [...candidates]
      .map((pair) => ({ ...pair, recommendationScore: pairScore(pair, selectedMode, selectedTiming) }))
      .sort((a, b) =>
        a.recommendationScore - b.recommendationScore ||
        (selectedTiming === "asap"
          ? a.asapMinutes - b.asapMinutes
          : (Number.isFinite(a.targetDistance) ? a.targetDistance : Infinity) - (Number.isFinite(b.targetDistance) ? b.targetDistance : Infinity)) ||
        a.waitingDifference - b.waitingDifference,
      );

    const primary = ranked[0] || null;
    const backup = ranked.find((pair) => pair !== primary && distinctEnough(pair, primary)) || ranked[1] || null;

    return {
      primary,
      backup,
      mode: selectedMode,
      timingMode: selectedTiming,
      pairs: ranked,
    };
  }

  function updateControls() {
    document.querySelectorAll("[data-optimization-mode]").forEach((button) => {
      const active = button.dataset.optimizationMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    document.querySelectorAll("[data-timing-mode]").forEach((button) => {
      const active = button.dataset.timingMode === timingMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    const description = document.getElementById("optimizationDescription");
    if (description) description.textContent = MODES[mode].description;

    const timingDescription = document.getElementById("timingDescription");
    if (timingDescription) timingDescription.textContent = TIMING_MODES[timingMode].description;

    const asap = timingMode === "asap";
    timeGrid?.classList.toggle("asap-time-muted", asap);
    quickTimes?.classList.toggle("asap-time-muted", asap);
    dateInput?.toggleAttribute("disabled", asap);
    timeInput?.toggleAttribute("disabled", asap);
    quickTimes?.querySelectorAll("button").forEach((button) => { button.disabled = asap; });
  }

  function setMode(nextMode, { submit = true } = {}) {
    if (!MODES[nextMode] || nextMode === mode) return;
    mode = nextMode;
    try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
    updateControls();
    window.dispatchEvent(new CustomEvent("nvs-priority-change", { detail: { mode } }));
    if (submit) plannerForm?.requestSubmit();
  }

  function setTimingMode(nextMode, { submit = true } = {}) {
    if (!TIMING_MODES[nextMode] || nextMode === timingMode) return;
    timingMode = nextMode;
    try { localStorage.setItem(TIMING_KEY, timingMode); } catch {}
    if (timingMode === "asap") syncAsapAnchor();
    updateControls();
    window.dispatchEvent(new CustomEvent("nvs-timing-change", { detail: { timingMode } }));
    if (submit) plannerForm?.requestSubmit();
  }

  function installControl() {
    if (!timeGrid || document.getElementById("optimizationControl")) return;

    const control = document.createElement("section");
    control.id = "optimizationControl";
    control.className = "optimization-control";
    control.innerHTML = `
      <div class="v060-control-block">
        <div class="optimization-heading">
          <div><span class="optimization-kicker">Meet when</span><strong>How should timing work?</strong></div>
        </div>
        <div class="meet-when-options" role="group" aria-label="Meetup timing preference">
          <button type="button" data-timing-mode="target" aria-pressed="false">
            <span class="optimization-icon" aria-hidden="true">🎯</span>
            <span><strong>Around chosen time</strong><small>Use your target arrival</small></span>
          </button>
          <button type="button" data-timing-mode="asap" aria-pressed="false">
            <span class="optimization-icon" aria-hidden="true">🚀</span>
            <span><strong>Meet ASAP</strong><small>Earliest realistic meetup</small></span>
          </button>
        </div>
        <p id="timingDescription" class="optimization-description"></p>
      </div>

      <div class="v060-control-divider"></div>

      <div class="v060-control-block">
        <div class="optimization-heading">
          <div><span class="optimization-kicker">Optimise for</span><strong>What matters more?</strong></div>
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
          <button type="button" data-optimization-mode="easy" aria-pressed="false">
            <span class="optimization-icon" aria-hidden="true">😌</span>
            <span><strong>Easy trip</strong><small>Fewer changes + less walking</small></span>
          </button>
        </div>
        <p id="optimizationDescription" class="optimization-description"></p>
      </div>
    `;

    timeGrid.insertAdjacentElement("afterend", control);
    control.querySelectorAll("[data-optimization-mode]").forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.optimizationMode));
    });
    control.querySelectorAll("[data-timing-mode]").forEach((button) => {
      button.addEventListener("click", () => setTimingMode(button.dataset.timingMode));
    });
    updateControls();
  }

  function configureMapTabs() {
    const tabs = document.querySelector(".map-tabs");
    if (!tabs) return;
    tabs.innerHTML = `
      <button type="button" data-map-pair="primary" class="active" aria-pressed="true">Best</button>
      <button type="button" data-map-pair="backup" aria-pressed="false">Backup</button>
    `;
  }

  readState();
  if (timingMode === "asap") syncAsapAnchor();
  installControl();
  configureMapTabs();

  plannerForm?.addEventListener("submit", () => {
    if (timingMode === "asap") syncAsapAnchor();
  }, true);

  window.NVSRecommend = Object.freeze({
    MODES,
    TIMING_MODES,
    createPairs,
    recommend,
    explain,
    getMode: () => mode,
    getModeInfo: () => MODES[mode],
    getTimingMode: () => timingMode,
    getTimingInfo: () => TIMING_MODES[timingMode],
    setMode,
    setTimingMode,
  });
})();
