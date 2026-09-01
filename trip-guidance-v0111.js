(() => {
  const UPDATE_MS = 15_000;
  let timer = null;
  let lastAnnouncement = "";
  let mutationRefreshQueued = false;
  let mutationRefreshTimer = null;
  let observer = null;
  let lifecycleFrozen = false;

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
  function asDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }
  function focusIndex() { const value = Number(window.NVSShare?.getFocusIndex?.() ?? -1); return Number.isInteger(value) ? value : -1; }
  function isPersonalSharedView() { return Boolean(window.NVSShare?.getSharedPlan?.() && focusIndex() >= 0); }
  function assignment() { const items = window.__NVS_LAST_RECOMMENDATIONS__?.primary?.assignments; return Array.isArray(items) ? items[focusIndex()] : null; }
  function formatTime(value) { const date = asDate(value); return date ? new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date) : ""; }
  function minutesUntil(value, now = Date.now()) { const date = asDate(value); if (!date) return null; return Math.max(0, Math.ceil((date.getTime() - now) / 60_000)); }
  function vehicleLabel(segment) {
    const instruction = window.NVSInstructions?.instructionFor?.(segment);
    if (instruction?.title) return String(instruction.title);
    const mode = String(segment?.modeLabel || segment?.mode || "Transit").trim();
    const line = String(segment?.line || "").trim();
    return line ? `${mode} ${line}` : mode;
  }
  function isWalk(segment) { return String(segment?.mode || "").toUpperCase() === "WALK"; }
  function transferWindowMinutes(current, next) {
    const arrival = asDate(current?.arrival)?.getTime();
    const departure = asDate(next?.departure)?.getTime();
    if (!Number.isFinite(arrival) || !Number.isFinite(departure) || departure < arrival) return null;
    return Math.round((departure - arrival) / 60_000);
  }
  function continuationDetail(current, next, destination) {
    if (!next) return `Stay aware of your stop so you're ready to get off at ${destination}.`;
    if (isWalk(next)) return `Get ready to leave at ${destination}; your planned walking leg starts there.`;
    const nextVehicle = vehicleLabel(next);
    const nextTime = formatTime(next.departure);
    const transfer = transferWindowMinutes(current, next);
    const windowCopy = transfer != null && transfer <= 5
      ? ` Your planned transfer window is about ${Math.max(0, transfer)} min, so be ready to change.`
      : "";
    return `Get ready to leave at ${destination}. Next: ${nextVehicle}${nextTime ? ` around ${nextTime}` : ""}.${windowCopy}`;
  }
  function approachCopy(destination, vehicle, current, next, minutes) {
    if (minutes <= 1) return { eyebrow: "Your stop is coming up", title: `${destination} in about 1 min`, detail: `${continuationDetail(current, next, destination)} You're currently on ${vehicle}.` };
    return { eyebrow: minutes <= 2 ? "Coming up soon" : "Next important stop", title: `${destination} in about ${minutes} min`, detail: `${continuationDetail(current, next, destination)} You're currently on ${vehicle}.` };
  }
  function activeSegmentIndex(segments, now) {
    return segments.findIndex((segment) => {
      const departure = asDate(segment.departure)?.getTime();
      const arrival = asDate(segment.arrival)?.getTime();
      return Number.isFinite(departure) && Number.isFinite(arrival) && departure <= now && now < arrival;
    });
  }
  function nextSegment(segments, now) {
    return segments.find((segment) => {
      const departure = asDate(segment.departure)?.getTime();
      return Number.isFinite(departure) && departure > now;
    }) || null;
  }
  function guidanceFromVoluntary(entry, route, now) {
    if (entry?.status === "missed") {
      return {
        icon: "!",
        eyebrow: "Your voluntary update",
        title: "You reported a missed connection",
        detail: "The timetable may no longer match your journey. Check the Recovery Desk or open the planner for a fresh route before relying on the next step.",
      };
    }
    if (entry?.status === "arrived") {
      return {
        icon: "✓",
        eyebrow: "Confirmed by you",
        title: "You're at the meetup",
        detail: "Your voluntary arrival check-in is being shown to the group. Clear it below if your situation changes.",
      };
    }
    const segments = Array.isArray(route?.segments) ? route.segments.filter(Boolean) : [];
    if (!segments.length) return null;
    const activeIndex = activeSegmentIndex(segments, now);
    const active = activeIndex >= 0 ? segments[activeIndex] : null;
    const upcoming = nextSegment(segments, now);

    if (entry?.status === "on-vehicle") {
      if (active && !isWalk(active)) {
        const destination = String(active.to || "your next stop");
        const minutes = minutesUntil(active.arrival, now);
        const vehicle = vehicleLabel(active);
        if (minutes != null && minutes <= 8) {
          const model = approachCopy(destination, vehicle, active, segments[activeIndex + 1] || null, Math.max(1, minutes));
          return { icon: "●", ...model, eyebrow: "Confirmed on board", detail: `${model.detail} Your voluntary check-in confirms you're on board.` };
        }
        return {
          icon: "●",
          eyebrow: "Confirmed on board",
          title: `You're on ${vehicle}`,
          detail: `Your voluntary check-in confirms you're on board. The timetable expects ${destination}${active.arrival ? ` around ${formatTime(active.arrival)}` : ""}${minutes != null ? ` · about ${Math.max(1, minutes)} min` : ""}.`,
        };
      }
      const plannedTransit = upcoming && !isWalk(upcoming) ? upcoming : segments.find((segment) => !isWalk(segment)) || null;
      return {
        icon: "●",
        eyebrow: "Confirmed on board",
        title: "You're on board",
        detail: plannedTransit
          ? `Your check-in is ahead of the timetable state. The next planned transit leg shown is ${vehicleLabel(plannedTransit)} toward ${String(plannedTransit.to || "the next stop")}${plannedTransit.arrival ? `, expected around ${formatTime(plannedTransit.arrival)}` : ""}.`
          : "Your voluntary check-in confirms you're on board. The timetable does not currently have another transit leg to describe.",
      };
    }

    if (entry?.status === "at-stop") {
      if (active && !isWalk(active)) {
        return {
          icon: "⌖",
          eyebrow: "Confirmed by you",
          title: "You're at a stop",
          detail: `Your check-in differs from the timetable, which currently expects ${vehicleLabel(active)} to be underway. If you missed or left that service, use “Missed it” or the Recovery Desk so the next advice does not rely on the old timing.`,
        };
      }
      const plannedNext = upcoming || null;
      if (plannedNext && !isWalk(plannedNext)) {
        const departure = formatTime(plannedNext.departure);
        return {
          icon: "⌖",
          eyebrow: "Confirmed by you",
          title: "You're at a stop",
          detail: `Next planned service: ${vehicleLabel(plannedNext)} from ${String(plannedNext.from || "your stop")}${departure ? ` around ${departure}` : ""}. Stay near the correct stop or platform and be ready to board.`,
        };
      }
      return {
        icon: "⌖",
        eyebrow: "Confirmed by you",
        title: "You're at a stop",
        detail: "Your voluntary check-in is more current than the timetable state. Keep the route visible and use Recovery Desk if the planned next step no longer matches what you see.",
      };
    }
    return null;
  }
  function guidanceForRoute(route, now = Date.now(), voluntaryEntry = null) {
    const voluntaryGuidance = guidanceFromVoluntary(voluntaryEntry, route, now);
    if (voluntaryGuidance) return voluntaryGuidance;
    const segments = Array.isArray(route?.segments) ? route.segments.filter(Boolean) : [];
    if (!segments.length) return null;
    const activeIndex = activeSegmentIndex(segments, now);
    const active = activeIndex >= 0 ? segments[activeIndex] : null;
    if (active) {
      const destination = String(active.to || "your next stop"); const minutes = minutesUntil(active.arrival, now); const next = segments[activeIndex + 1] || null;
      if (isWalk(active)) return { icon: "🚶", eyebrow: "Right now", title: `Walking to ${destination}`, detail: minutes == null ? "Follow your planned walking leg." : `About ${Math.max(1, minutes)} min remaining on this walking leg.` };
      const vehicle = vehicleLabel(active);
      if (minutes != null && minutes <= 8) return { icon: "◉", ...approachCopy(destination, vehicle, active, next, Math.max(1, minutes)) };
      return { icon: "◉", eyebrow: "On the way", title: `You're on ${vehicle}`, detail: `Expected at ${destination}${active.arrival ? ` around ${formatTime(active.arrival)}` : ""}${minutes != null ? ` · about ${Math.max(1, minutes)} min` : ""}.` };
    }
    const upcoming = nextSegment(segments, now);
    if (upcoming) {
      const minutes = minutesUntil(upcoming.departure, now); const from = String(upcoming.from || "your next stop");
      if (isWalk(upcoming)) return { icon: "🚶", eyebrow: "Coming up", title: `Walk toward ${String(upcoming.to || "the next stop")}`, detail: minutes != null && minutes <= 2 ? "Your planned walking leg starts now." : `Planned to start in about ${Math.max(1, minutes || 1)} min.` };
      const vehicle = vehicleLabel(upcoming);
      return { icon: "→", eyebrow: minutes != null && minutes <= 2 ? "Board next" : "Coming up", title: `${vehicle} from ${from}`, detail: `${minutes != null && minutes <= 2 ? "Be ready to board" : `Expected in about ${Math.max(1, minutes || 1)} min`}${upcoming.departure ? ` · ${formatTime(upcoming.departure)}` : ""}.` };
    }
    return { icon: "✓", eyebrow: "Planned journey complete", title: "You should have reached the meetup", detail: "This is based on the timetable, not your location. If your real journey differs, update your voluntary status below." };
  }
  function freshVoluntaryEntry(now = Date.now()) {
    const focus = focusIndex();
    const state = window.NVSSharedLive?.getState?.();
    const entry = focus >= 0 ? state?.members?.[String(focus)] : null;
    if (!entry) return null;
    const freshness = window.NVSIntelligenceCore?.checkinFreshness?.(entry, new Date(now));
    if (freshness && !freshness.fresh) return null;
    if (!freshness) {
      const at = Number(entry.at);
      const age = now - at;
      if (!Number.isFinite(at) || age < -5 * 60_000 || age > 15 * 60_000) return null;
    }
    return entry;
  }
  function positionSharedLivePanel() {
    if (!isPersonalSharedView()) return;
    const personalPlan = document.getElementById("personalSharedPlan"); const sharedPanel = document.getElementById("sharedLiveV010");
    if (!personalPlan || !sharedPanel) return;
    if (personalPlan.nextElementSibling !== sharedPanel) personalPlan.insertAdjacentElement("afterend", sharedPanel);
  }
  function removeGuidance() { const card = document.getElementById("v0111TripGuidance"); if (card) card.remove(); lastAnnouncement = ""; }
  function renderGuidance() {
    if (lifecycleFrozen) return;
    if (!isPersonalSharedView()) { removeGuidance(); return; }
    positionSharedLivePanel();
    const personalPlan = document.getElementById("personalSharedPlan"); const current = assignment();
    if (!personalPlan || !current?.route) { removeGuidance(); return; }
    const now = Date.now();
    const guidance = guidanceForRoute(current.route, now, freshVoluntaryEntry(now)); if (!guidance) { removeGuidance(); return; }
    let card = document.getElementById("v0111TripGuidance");
    if (!card) {
      card = document.createElement("aside"); card.id = "v0111TripGuidance"; card.className = "v0111-trip-guidance"; card.setAttribute("role", "status"); card.setAttribute("aria-live", "polite"); card.setAttribute("aria-atomic", "true");
      const steps = personalPlan.querySelector(".personal-route-steps"); if (steps) steps.insertAdjacentElement("beforebegin", card); else personalPlan.appendChild(card);
    }
    const announcement = `${guidance.title}. ${guidance.detail}`; if (announcement === lastAnnouncement && card.childElementCount) return; lastAnnouncement = announcement;
    card.innerHTML = `<span class="v0111-trip-guidance-icon" aria-hidden="true">${escapeHtml(guidance.icon)}</span><div><small>${escapeHtml(guidance.eyebrow)}</small><strong>${escapeHtml(guidance.title)}</strong><p>${escapeHtml(guidance.detail)}</p></div>`;
  }
  function schedule(delay = UPDATE_MS) { clearTimeout(timer); if (lifecycleFrozen || document.hidden || !isPersonalSharedView()) return; timer = setTimeout(() => { if (lifecycleFrozen) return; renderGuidance(); schedule(); }, delay); }
  function refresh() { if (lifecycleFrozen) return; renderGuidance(); observeGuidanceSurfaces(); schedule(); }
  function cancelMutationRefresh() {
    if (mutationRefreshTimer != null) clearTimeout(mutationRefreshTimer);
    mutationRefreshTimer = null;
    mutationRefreshQueued = false;
  }
  function queueMutationRefresh() {
    if (lifecycleFrozen || mutationRefreshQueued) return;
    mutationRefreshQueued = true;
    mutationRefreshTimer = setTimeout(() => {
      mutationRefreshTimer = null;
      mutationRefreshQueued = false;
      if (lifecycleFrozen || document.hidden) return;
      if (document.getElementById("personalSharedPlan") || document.getElementById("sharedLiveV010") || document.getElementById("v0111TripGuidance")) renderGuidance();
      observeGuidanceSurfaces();
    }, 0);
  }
  function stopObserving() { observer?.disconnect?.(); }
  function clearRecommendationGuidance() {
    cancelMutationRefresh();
    if (lifecycleFrozen) return;
    clearTimeout(timer);
    stopObserving();
    removeGuidance();
  }
  function observeGuidanceSurfaces() {
    if (lifecycleFrozen || document.hidden || !("MutationObserver" in window)) return;
    if (!observer) observer = new MutationObserver(queueMutationRefresh);
    observer.disconnect();
    const resultsRoot = document.getElementById("results");
    const personalPlan = document.getElementById("personalSharedPlan");
    const sharedPanel = document.getElementById("sharedLiveV010");
    [resultsRoot, personalPlan, sharedPanel].filter(Boolean).forEach((node) => {
      observer.observe(node, { childList: true, subtree: true, characterData: true });
    });
  }
  function freezeLifecycle() {
    lifecycleFrozen = true;
    clearTimeout(timer);
    cancelMutationRefresh();
    stopObserving();
  }
  function resumeLifecycle() {
    lifecycleFrozen = false;
    refresh();
  }
  document.addEventListener("visibilitychange", () => {
    if (lifecycleFrozen) return;
    if (document.hidden) { clearTimeout(timer); cancelMutationRefresh(); stopObserving(); }
    else refresh();
  });
  window.addEventListener("pagehide", freezeLifecycle);
  window.addEventListener("pageshow", resumeLifecycle);
  ["load", "nvs-group-recommendations-rendered", "nvs-shared-live-change", "nvs-live-plan-synced", "nvs-shared-view-resumed"].forEach((name) => window.addEventListener(name, refresh));
  window.addEventListener("nvs-recommendations-cleared", clearRecommendationGuidance);
  window.NVSTripGuidance0111 = Object.freeze({ guidanceForRoute, freshVoluntaryEntry, refresh, observeGuidanceSurfaces, clearRecommendationGuidance });
  observeGuidanceSurfaces();
  refresh();
})();