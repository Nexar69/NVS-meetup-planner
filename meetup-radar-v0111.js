(() => {
  const UPDATE_MS = 15_000;
  let timer = null;
  let lastMarkup = "";
  let recommendationsActive = Boolean(window.__NVS_LAST_RECOMMENDATIONS__?.primary);

  function asDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatTime(value) {
    const date = asDate(value);
    return date ? new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date) : "";
  }

  function minutesUntil(value, now) {
    const date = asDate(value);
    if (!date) return null;
    return Math.max(0, Math.ceil((date.getTime() - now) / 60_000));
  }

  function assignments(group) {
    return Array.isArray(group?.assignments) ? group.assignments.filter((item) => item?.member && item?.route) : [];
  }

  function isFresh(entry, now) {
    if (!entry) return false;
    const freshness = window.NVSIntelligenceCore?.checkinFreshness?.(entry, new Date(now));
    if (freshness) return Boolean(freshness.fresh);
    const at = Number(entry.at);
    return Number.isFinite(at) && now >= at && now - at <= 15 * 60_000;
  }

  function arrivalSummary(list) {
    const arrivals = list.map((item) => asDate(item.route?.arrival)?.getTime()).filter(Number.isFinite).sort((a, b) => a - b);
    if (!arrivals.length) return { spread: null, latest: null };
    return {
      spread: Math.max(0, Math.round((arrivals[arrivals.length - 1] - arrivals[0]) / 60_000)),
      latest: new Date(arrivals[arrivals.length - 1]),
    };
  }

  function nextConvergenceEvent(analysis, now) {
    const events = Array.isArray(analysis?.events) ? analysis.events.filter((event) => asDate(event?.time)) : [];
    return events
      .filter((event) => asDate(event.time).getTime() >= now - 30_000)
      .sort((a, b) => asDate(a.time) - asDate(b.time))[0] || null;
  }

  function radarModel(group, liveState, analysis, now = Date.now()) {
    const list = assignments(group);
    if (list.length < 2) return null;

    const members = liveState?.members && typeof liveState.members === "object" ? liveState.members : {};
    const freshEntries = list.map((_, index) => members[String(index)]).filter((entry) => isFresh(entry, now));
    const missed = freshEntries.filter((entry) => entry.status === "missed").length;
    const arrived = freshEntries.filter((entry) => entry.status === "arrived").length;
    const arrivals = arrivalSummary(list);
    const next = nextConvergenceEvent(analysis, now);
    const spreadCopy = arrivals.spread == null ? "" : arrivals.spread === 0 ? "planned arrivals aligned" : `planned arrival spread ${arrivals.spread} min`;
    const checkinCopy = freshEntries.length ? `${freshEntries.length}/${list.length} recent voluntary update${freshEntries.length === 1 ? "" : "s"}` : "timetable estimates active";
    const meta = [checkinCopy, spreadCopy].filter(Boolean).join(" · ");

    if (missed) {
      return {
        tone: "warn",
        eyebrow: "Meetup radar · recovery",
        title: `${missed} ${missed === 1 ? "person reported" : "people reported"} a missed connection`,
        detail: "A fresh voluntary report means the planned convergence may no longer hold. Recovery should take priority over the old timetable assumption.",
        meta,
      };
    }

    if (arrived === list.length) {
      return {
        tone: "good",
        eyebrow: "Meetup radar · confirmed",
        title: "Everyone has checked in at the meetup",
        detail: "All participants currently have fresh voluntary arrival confirmations.",
        meta,
      };
    }

    if (next) {
      const minutes = minutesUntil(next.time, now);
      const time = formatTime(next.time);
      const location = String(next.label || next.name || "planned meetup point");
      const count = Array.isArray(next.memberIds) ? next.memberIds.length : 0;
      if (next.kind === "everyone" || next.final) {
        return {
          tone: "good",
          eyebrow: "Meetup radar · final convergence",
          title: minutes != null ? `Everyone expected together in about ${Math.max(1, minutes)} min` : "Everyone expected together soon",
          detail: `${location}${time ? ` · around ${time}` : ""}. This is based on the current planned journeys, not live location tracking.`,
          meta,
        };
      }
      return {
        tone: minutes != null && minutes <= 5 ? "action" : "info",
        eyebrow: "Meetup radar · next join",
        title: `${String(next.title || "Next planned join")}${minutes != null ? ` in about ${Math.max(1, minutes)} min` : ""}`,
        detail: `${location}${time ? ` · around ${time}` : ""}${count ? ` · ${count}/${list.length} people planned there` : ""}.`,
        meta,
      };
    }

    return {
      tone: "info",
      eyebrow: "Meetup radar",
      title: "Group journey is underway",
      detail: arrivals.latest ? `Latest planned arrival is around ${formatTime(arrivals.latest)}. No earlier shared join is currently detected.` : "No shared join is currently detected in the planned journeys.",
      meta,
    };
  }

  function currentContext(now = Date.now()) {
    const group = window.__NVS_LAST_RECOMMENDATIONS__?.primary || null;
    const list = assignments(group);
    if (list.length < 2) return { group, liveState: null, analysis: null };
    const liveState = window.NVSSharedLive?.getState?.() || null;
    const analysis = window.NVSConvergence?.analyze?.(group, {
      destinationLabel: group?.destination || "Meetup",
    }) || { events: [] };
    return { group, liveState, analysis, now };
  }

  function ensureCard() {
    let card = document.getElementById("v0111MeetupRadar");
    if (card) return card;
    const command = document.getElementById("v011CommandCenter");
    if (!command) return null;
    card = document.createElement("section");
    card.id = "v0111MeetupRadar";
    card.className = "v0111-meetup-radar";
    card.setAttribute("aria-labelledby", "v0111MeetupRadarTitle");
    card.setAttribute("aria-live", "polite");
    command.insertAdjacentElement("afterend", card);
    return card;
  }

  function removeCard() {
    document.getElementById("v0111MeetupRadar")?.remove?.();
    lastMarkup = "";
  }

  function render(now = Date.now()) {
    const { group, liveState, analysis } = currentContext(now);
    const model = radarModel(group, liveState, analysis, now);
    if (!model) {
      removeCard();
      return null;
    }
    const card = ensureCard();
    if (!card) return model;
    card.dataset.tone = model.tone;
    const markup = `<div class="v0111-radar-icon" aria-hidden="true">◎</div><div class="v0111-radar-copy"><small>${escapeHtml(model.eyebrow)}</small><strong id="v0111MeetupRadarTitle">${escapeHtml(model.title)}</strong><p>${escapeHtml(model.detail)}</p><em>${escapeHtml(model.meta)}</em></div>`;
    if (markup !== lastMarkup) {
      card.innerHTML = markup;
      lastMarkup = markup;
    }
    return model;
  }

  function schedule(delay = UPDATE_MS) {
    clearTimeout(timer);
    timer = null;
    if (document.hidden || !recommendationsActive) return;
    timer = setTimeout(() => {
      render();
      schedule();
    }, delay);
  }

  function refresh() {
    render();
    schedule();
  }

  function activateRecommendations() {
    recommendationsActive = Boolean(window.__NVS_LAST_RECOMMENDATIONS__?.primary);
    refresh();
  }

  function clearRecommendations() {
    recommendationsActive = false;
    clearTimeout(timer);
    timer = null;
    removeCard();
  }

  ["load", "pageshow", "nvs-shared-live-change", "nvs-live-plan-synced", "nvs-group-change", "nvs-timing-change", "nvs-shared-view-resumed"].forEach((name) => {
    window.addEventListener(name, refresh);
  });
  window.addEventListener("nvs-group-recommendations-rendered", activateRecommendations);
  window.addEventListener("nvs-recommendations-cleared", clearRecommendations);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(timer);
      timer = null;
    } else {
      refresh();
    }
  });

  window.NVSMeetupRadar0111 = Object.freeze({ radarModel, render, refresh });
  refresh();
})();
