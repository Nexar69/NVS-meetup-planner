(() => {
  const UPDATE_MS = 15_000;
  const BLOCKING_VOLUNTARY = new Set(["missed", "arrived", "at-stop"]);
  let timer = null;
  let observer = null;
  let queued = false;
  let queuedTimer = null;
  let recommendationsActive = Boolean(window.__NVS_LAST_RECOMMENDATIONS__?.primary?.assignments?.length);

  function asDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function focusIndex() {
    const value = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    return Number.isInteger(value) ? value : -1;
  }

  function isPersonalSharedView() {
    return Boolean(window.NVSShare?.getSharedPlan?.() && focusIndex() >= 0);
  }

  function assignment() {
    const items = window.__NVS_LAST_RECOMMENDATIONS__?.primary?.assignments;
    return Array.isArray(items) ? items[focusIndex()] : null;
  }

  function focusedFreshEntry(now = Date.now()) {
    const focus = focusIndex();
    if (focus < 0) return null;
    const entry = window.NVSSharedLive?.getState?.()?.members?.[String(focus)] || null;
    if (!entry) return null;
    const freshness = window.NVSIntelligenceCore?.checkinFreshness?.(entry, new Date(now));
    if (freshness) return freshness.fresh ? entry : null;
    const at = Number(entry.at);
    return Number.isFinite(at) && now >= at && now - at <= 15 * 60_000 ? entry : null;
  }

  function blockingVoluntaryState(now = Date.now()) {
    const entry = focusedFreshEntry(now);
    return entry && BLOCKING_VOLUNTARY.has(entry.status) ? entry.status : null;
  }

  function isWalk(segment) {
    return String(segment?.mode || "").toUpperCase() === "WALK";
  }

  function stopTimestamp(stop) {
    return asDate(stop?.arrival || stop?.departure)?.getTime() ?? null;
  }

  function minutesUntil(timestamp, now) {
    if (!Number.isFinite(timestamp)) return null;
    return Math.max(0, Math.ceil((timestamp - now) / 60_000));
  }

  function stopAwarenessForSegment(segment, now = Date.now()) {
    if (!segment || isWalk(segment)) return null;
    const destination = String(segment.to || "your stop").trim() || "your stop";
    const finalArrival = asDate(segment.arrival)?.getTime();
    const stops = Array.isArray(segment.intermediateStops) ? segment.intermediateStops : [];
    const upcoming = stops
      .map((stop) => ({ stop, at: stopTimestamp(stop) }))
      .filter(({ stop, at }) => String(stop?.name || "").trim() && Number.isFinite(at) && at > now && (!Number.isFinite(finalArrival) || at < finalArrival))
      .sort((a, b) => a.at - b.at);

    if (!upcoming.length) return null;

    const next = upcoming[0];
    const stopsUntilExit = upcoming.length + 1;
    const nextMinutes = minutesUntil(next.at, now);
    const countCopy = stopsUntilExit === 1 ? "1 stop" : `${stopsUntilExit} stops`;
    const urgency = stopsUntilExit <= 2 ? "soon" : "normal";

    return {
      nextStop: String(next.stop.name).trim(),
      nextMinutes,
      stopsUntilExit,
      destination,
      urgency,
      title: `Next expected: ${String(next.stop.name).trim()}${nextMinutes != null ? ` · ~${Math.max(1, nextMinutes)} min` : ""}`,
      detail: `${countCopy} until ${destination}. Timetable estimate — keep an eye on the vehicle stop display so you are ready when your stop comes up.`,
    };
  }

  function activeSegment(route, now = Date.now()) {
    const segments = Array.isArray(route?.segments) ? route.segments.filter(Boolean) : [];
    return segments.find((segment) => {
      const departure = asDate(segment.departure)?.getTime();
      const arrival = asDate(segment.arrival)?.getTime();
      return Number.isFinite(departure) && Number.isFinite(arrival) && departure <= now && now < arrival;
    }) || null;
  }

  function modelForRoute(route, now = Date.now()) {
    const segment = activeSegment(route, now);
    return segment ? stopAwarenessForSegment(segment, now) : null;
  }

  function removeRow() {
    document.getElementById("v0111StopAwareness")?.remove?.();
  }

  function render() {
    if (!recommendationsActive || !isPersonalSharedView()) {
      removeRow();
      return;
    }
    const now = Date.now();
    const current = assignment();
    const guidance = document.getElementById("v0111TripGuidance");
    if (!current?.route || !guidance || blockingVoluntaryState(now)) {
      removeRow();
      return;
    }
    const model = modelForRoute(current.route, now);
    if (!model) {
      removeRow();
      return;
    }

    let row = document.getElementById("v0111StopAwareness");
    if (!row) {
      row = document.createElement("div");
      row.id = "v0111StopAwareness";
      row.className = "v0111-stop-awareness";
      row.setAttribute("role", "note");
      guidance.appendChild(row);
    }
    row.dataset.urgency = model.urgency;
    row.setAttribute("aria-label", `${model.title}. ${model.detail}`);
    row.innerHTML = `<span aria-hidden="true">◎</span><div><small>STOP AWARENESS</small><strong>${escapeHtml(model.title)}</strong><p>${escapeHtml(model.detail)}</p></div>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (document.hidden || !recommendationsActive || !isPersonalSharedView()) return;
    timer = setTimeout(() => {
      render();
      schedule();
    }, UPDATE_MS);
  }

  function queueRender() {
    if (queued || !recommendationsActive) return;
    queued = true;
    queuedTimer = setTimeout(() => {
      queued = false;
      queuedTimer = null;
      if (!recommendationsActive) return;
      render();
      observe();
    }, 0);
  }

  function observe() {
    if (document.hidden || !recommendationsActive || !("MutationObserver" in window)) return;
    if (!observer) observer = new MutationObserver(queueRender);
    observer.disconnect();
    const personal = document.getElementById("personalSharedPlan");
    if (personal) observer.observe(personal, { childList: true, subtree: true });
  }

  function refresh() {
    render();
    observe();
    schedule();
  }

  function clearRecommendationState() {
    recommendationsActive = false;
    clearTimeout(timer);
    timer = null;
    if (queuedTimer != null) clearTimeout(queuedTimer);
    queuedTimer = null;
    queued = false;
    observer?.disconnect?.();
    removeRow();
  }

  function activateRecommendationState() {
    recommendationsActive = true;
    refresh();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(timer);
      timer = null;
      observer?.disconnect?.();
    } else {
      refresh();
    }
  });

  ["load", "pageshow", "nvs-shared-live-change", "nvs-live-plan-synced", "nvs-shared-view-resumed"].forEach((name) => window.addEventListener(name, refresh));
  window.addEventListener("nvs-group-recommendations-rendered", activateRecommendationState);
  window.addEventListener("nvs-recommendations-cleared", clearRecommendationState);

  window.NVSStopAwareness0111 = Object.freeze({ stopAwarenessForSegment, activeSegment, modelForRoute, focusedFreshEntry, blockingVoluntaryState, refresh });
  refresh();
})();
