(() => {
  const UPDATE_MS = 15_000;
  let timer = null;
  let lastAnnouncement = "";

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

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

  function formatTime(value) {
    const date = asDate(value);
    return date ? new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date) : "";
  }

  function minutesUntil(value, now = Date.now()) {
    const date = asDate(value);
    if (!date) return null;
    return Math.max(0, Math.round((date.getTime() - now) / 60_000));
  }

  function vehicleLabel(segment) {
    const instruction = window.NVSInstructions?.instructionFor?.(segment);
    if (instruction?.title) return String(instruction.title);
    const mode = String(segment?.modeLabel || segment?.mode || "Transit").trim();
    const line = String(segment?.line || "").trim();
    return line ? `${mode} ${line}` : mode;
  }

  function isWalk(segment) {
    return String(segment?.mode || "").toUpperCase() === "WALK";
  }

  function continuationDetail(next, destination) {
    if (!next) return `Keep an eye on your surroundings so you're ready to get off at ${destination}.`;
    if (isWalk(next)) {
      return `Get ready to leave at ${destination}; your planned walking leg starts there.`;
    }
    const nextVehicle = vehicleLabel(next);
    const nextTime = formatTime(next.departure);
    return `Get ready to leave at ${destination}. Next: ${nextVehicle}${nextTime ? ` around ${nextTime}` : ""}.`;
  }

  function guidanceForRoute(route, now = Date.now()) {
    const segments = Array.isArray(route?.segments) ? route.segments.filter(Boolean) : [];
    if (!segments.length) return null;

    const activeIndex = segments.findIndex((segment) => {
      const departure = asDate(segment.departure)?.getTime();
      const arrival = asDate(segment.arrival)?.getTime();
      return Number.isFinite(departure) && Number.isFinite(arrival) && departure <= now && now < arrival;
    });
    const active = activeIndex >= 0 ? segments[activeIndex] : null;

    if (active) {
      const destination = String(active.to || "your next stop");
      const minutes = minutesUntil(active.arrival, now);
      const next = segments[activeIndex + 1] || null;
      if (isWalk(active)) {
        return {
          icon: "🚶",
          eyebrow: "Right now",
          title: `Walking to ${destination}`,
          detail: minutes == null ? "Follow your planned walking leg." : `About ${Math.max(1, minutes)} min remaining on this walking leg.`,
        };
      }

      const vehicle = vehicleLabel(active);
      if (minutes != null && minutes <= 8) {
        return {
          icon: "◉",
          eyebrow: minutes <= 2 ? "Coming up soon" : "Next important stop",
          title: `${destination} in about ${Math.max(1, minutes)} min`,
          detail: `${continuationDetail(next, destination)} You're currently on ${vehicle}.`,
        };
      }
      return {
        icon: "◉",
        eyebrow: "On the way",
        title: `You're on ${vehicle}`,
        detail: `Expected at ${destination}${active.arrival ? ` around ${formatTime(active.arrival)}` : ""}${minutes != null ? ` · about ${Math.max(1, minutes)} min` : ""}.`,
      };
    }

    const upcoming = segments.find((segment) => {
      const departure = asDate(segment.departure)?.getTime();
      return Number.isFinite(departure) && departure > now;
    });
    if (upcoming) {
      const minutes = minutesUntil(upcoming.departure, now);
      const from = String(upcoming.from || "your next stop");
      if (isWalk(upcoming)) {
        return {
          icon: "🚶",
          eyebrow: "Coming up",
          title: `Walk toward ${String(upcoming.to || "the next stop")}`,
          detail: minutes != null && minutes <= 2 ? "Your walking leg starts now." : `Planned to start in about ${Math.max(1, minutes || 1)} min.`,
        };
      }
      const vehicle = vehicleLabel(upcoming);
      return {
        icon: "→",
        eyebrow: minutes != null && minutes <= 2 ? "Board next" : "Coming up",
        title: `${vehicle} from ${from}`,
        detail: `${minutes != null && minutes <= 2 ? "Be ready to board" : `Expected in about ${Math.max(1, minutes || 1)} min`}${upcoming.departure ? ` · ${formatTime(upcoming.departure)}` : ""}.`,
      };
    }

    return {
      icon: "✓",
      eyebrow: "Journey",
      title: "You should be at the meetup",
      detail: "If your real journey differs, you can update your voluntary status below.",
    };
  }

  function positionSharedLivePanel() {
    if (!isPersonalSharedView()) return;
    const personalPlan = document.getElementById("personalSharedPlan");
    const sharedPanel = document.getElementById("sharedLiveV010");
    if (!personalPlan || !sharedPanel) return;
    if (personalPlan.nextElementSibling !== sharedPanel) personalPlan.insertAdjacentElement("afterend", sharedPanel);
  }

  function renderGuidance() {
    if (!isPersonalSharedView()) return;
    positionSharedLivePanel();
    const personalPlan = document.getElementById("personalSharedPlan");
    const current = assignment();
    if (!personalPlan || !current?.route) return;

    const guidance = guidanceForRoute(current.route);
    if (!guidance) return;
    let card = document.getElementById("v0111TripGuidance");
    if (!card) {
      card = document.createElement("aside");
      card.id = "v0111TripGuidance";
      card.className = "v0111-trip-guidance";
      card.setAttribute("role", "status");
      card.setAttribute("aria-live", "polite");
      card.setAttribute("aria-atomic", "true");
      const steps = personalPlan.querySelector(".personal-route-steps");
      if (steps) steps.insertAdjacentElement("beforebegin", card);
      else personalPlan.appendChild(card);
    }

    const announcement = `${guidance.title}. ${guidance.detail}`;
    if (announcement === lastAnnouncement && card.childElementCount) return;
    lastAnnouncement = announcement;
    card.innerHTML = `
      <span class="v0111-trip-guidance-icon" aria-hidden="true">${escapeHtml(guidance.icon)}</span>
      <div>
        <small>${escapeHtml(guidance.eyebrow)}</small>
        <strong>${escapeHtml(guidance.title)}</strong>
        <p>${escapeHtml(guidance.detail)}</p>
      </div>
    `;
  }

  function schedule(delay = UPDATE_MS) {
    clearTimeout(timer);
    if (document.hidden || !isPersonalSharedView()) return;
    timer = setTimeout(() => {
      renderGuidance();
      schedule();
    }, delay);
  }

  function refresh() {
    renderGuidance();
    schedule();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(timer);
    else refresh();
  });
  window.addEventListener("load", refresh);
  window.addEventListener("nvs-group-recommendations-rendered", refresh);
  window.addEventListener("nvs-shared-live-change", refresh);
  window.addEventListener("nvs-live-plan-synced", refresh);
  new MutationObserver(() => {
    if (document.getElementById("personalSharedPlan") || document.getElementById("sharedLiveV010")) renderGuidance();
  }).observe(document.body, { childList: true, subtree: true });

  window.NVSTripGuidance0111 = Object.freeze({ guidanceForRoute, refresh });
  refresh();
})();
