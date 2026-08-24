(() => {
  const LIVE_KEY = "meet-schwerin-live-v1";
  const AUTO_REFRESH_MS = 120_000;
  const TICK_MS = 1_000;

  const results = document.getElementById("results");
  const resultsSection = document.querySelector(".results-section");
  const destinationInput = document.getElementById("destination");
  const toast = document.getElementById("toast");

  let enabled = true;
  let tickTimer = null;
  let autoRefreshTimer = null;
  let renderTimer = null;
  let refreshing = false;
  let lastAutoRefresh = 0;

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
    return date ? new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date) : "—";
  }

  function countdown(ms) {
    const seconds = Math.round(ms / 1000);
    if (seconds <= -90) return `${Math.max(1, Math.round(Math.abs(seconds) / 60))} min ago`;
    if (seconds < 0) return "now";
    if (seconds < 90) return "now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `in ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `in ${hours}h ${remainder}m` : `in ${hours}h`;
  }

  function durationText(ms) {
    const minutes = Math.max(0, Math.round(ms / 60_000));
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  function readState() {
    try {
      const raw = localStorage.getItem(LIVE_KEY);
      if (raw === "0") enabled = false;
      if (raw === "1") enabled = true;
    } catch {
      enabled = true;
    }
  }

  function writeState() {
    try { localStorage.setItem(LIVE_KEY, enabled ? "1" : "0"); } catch {}
  }

  function recommendation() {
    return window.__NVS_LAST_RECOMMENDATIONS__?.primary || null;
  }

  function assignments(group = recommendation()) {
    return Array.isArray(group?.assignments) ? group.assignments.filter((item) => item?.member && item?.route) : [];
  }

  function destinationLocation() {
    return window.NVSTransit?.LOCATIONS?.[destinationInput?.value] || null;
  }

  function analysisFor(group) {
    if (!group || !window.NVSConvergence?.analyze) return { events: [], memberEvents: {}, sharedLegs: [] };
    const destination = destinationLocation();
    return window.NVSConvergence.analyze(group, {
      destinationPoint: destination ? [destination.lat, destination.lon] : null,
      destinationLabel: destination?.label || destinationInput?.value || "Meetup",
    });
  }

  function instructionFor(segment) {
    if (window.NVSInstructions?.instructionFor) return window.NVSInstructions.instructionFor(segment);
    const mode = String(segment?.modeLabel || segment?.mode || "Journey").trim();
    const line = String(segment?.line || "").trim();
    const vehicle = line && !mode.toLowerCase().includes(line.toLowerCase()) ? `${mode} ${line}` : mode;
    const to = String(segment?.to || "next stop").trim();
    return {
      title: String(segment?.mode || "").toUpperCase() === "WALK" ? `Walk to ${to}` : `${vehicle} → ${to}`,
      detail: segment?.headsign ? `toward ${segment.headsign}` : "",
      status: "",
    };
  }

  function routeState(assignment, now = new Date()) {
    const route = assignment?.route || {};
    const departure = asDate(route.departure);
    const arrival = asDate(route.arrival);
    const segments = Array.isArray(route.segments) ? route.segments.filter(Boolean) : [];

    if (!departure || !arrival) {
      return { phase: "unknown", label: "Timetable unavailable", detail: "Refresh the route data.", progress: 0, segmentIndex: -1, nextIndex: -1 };
    }

    const total = Math.max(1, arrival - departure);
    const progress = Math.max(0, Math.min(1, (now - departure) / total));

    if (now < departure) {
      const next = segments[0] ? instructionFor(segments[0]) : null;
      return {
        phase: "waiting",
        label: `Leave ${countdown(departure - now)}`,
        detail: next ? next.title : `Departure at ${formatTime(departure)}`,
        nextDetail: next?.detail || "",
        progress: 0,
        segmentIndex: -1,
        nextIndex: segments.length ? 0 : -1,
      };
    }

    if (now >= arrival) {
      return {
        phase: "arrived",
        label: "Arrived",
        detail: `Planned arrival ${formatTime(arrival)}`,
        progress: 1,
        segmentIndex: -1,
        nextIndex: -1,
      };
    }

    let currentIndex = -1;
    for (let index = 0; index < segments.length; index += 1) {
      const segmentDeparture = asDate(segments[index]?.departure);
      const segmentArrival = asDate(segments[index]?.arrival);
      if (segmentDeparture && segmentArrival && now >= segmentDeparture && now < segmentArrival) {
        currentIndex = index;
        break;
      }
    }

    if (currentIndex >= 0) {
      const current = instructionFor(segments[currentIndex]);
      const nextIndex = currentIndex + 1 < segments.length ? currentIndex + 1 : -1;
      const next = nextIndex >= 0 ? instructionFor(segments[nextIndex]) : null;
      const nextDeparture = nextIndex >= 0 ? asDate(segments[nextIndex].departure) : null;
      return {
        phase: "moving",
        label: current.title,
        detail: current.detail || `Until ${formatTime(segments[currentIndex].arrival)}`,
        nextLabel: next ? next.title : "",
        nextDetail: nextDeparture ? `${countdown(nextDeparture - now)} · ${next.detail || ""}`.replace(/ · $/, "") : (next?.detail || ""),
        progress,
        segmentIndex: currentIndex,
        nextIndex,
      };
    }

    const nextIndex = segments.findIndex((segment) => {
      const departureTime = asDate(segment?.departure);
      return departureTime && departureTime > now;
    });
    if (nextIndex >= 0) {
      const next = instructionFor(segments[nextIndex]);
      const nextDeparture = asDate(segments[nextIndex].departure);
      return {
        phase: "transfer",
        label: `Next ${countdown(nextDeparture - now)}`,
        detail: next.title,
        nextDetail: next.detail || "",
        progress,
        segmentIndex: -1,
        nextIndex,
      };
    }

    return {
      phase: "moving",
      label: "Journey in progress",
      detail: `Expected arrival ${formatTime(arrival)}`,
      progress,
      segmentIndex: -1,
      nextIndex: -1,
    };
  }

  function focusIndex(group) {
    const shared = window.NVSShare?.getSharedPlan?.();
    const sharedFocus = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    if (shared?.view === "person" && Number.isInteger(sharedFocus) && sharedFocus >= 0) return sharedFocus;
    return assignments(group).length ? 0 : -1;
  }

  function statePill(state) {
    if (state.phase === "arrived") return { text: "Arrived", cls: "good" };
    if (state.phase === "moving") return { text: "On route", cls: "live" };
    if (state.phase === "transfer") return { text: "Changing", cls: "warn" };
    if (state.phase === "waiting") return { text: "Before departure", cls: "" };
    return { text: "Check route", cls: "warn" };
  }

  function joinHealth(group, now = new Date()) {
    const groupAssignments = assignments(group);
    if (!groupAssignments.length) return { title: "No live plan", detail: "Find connections first.", cls: "", pill: "Waiting" };

    const latestArrival = asDate(group.latestArrival) || new Date(Math.max(...groupAssignments.map((item) => asDate(item.route.arrival)?.getTime() || 0)));
    if (latestArrival && now >= latestArrival) {
      return { title: "Everyone should be there", detail: `Whole-group arrival ${formatTime(latestArrival)}`, cls: "good", pill: "Arrived" };
    }

    const analysis = analysisFor(group);
    const events = (analysis.events || []).filter((event) => asDate(event.time)).sort((a, b) => asDate(a.time) - asDate(b.time));
    const upcoming = events.find((event) => asDate(event.time).getTime() >= now.getTime() - 120_000);

    if (upcoming) {
      const time = asDate(upcoming.time);
      const delta = time - now;
      if (delta > 120_000) {
        return {
          title: `★ ${upcoming.title} ${countdown(delta)}`,
          detail: `${upcoming.label} · ${formatTime(time)}`,
          cls: "good",
          pill: "Join on track",
        };
      }
      if (delta >= -120_000) {
        return {
          title: `★ ${upcoming.title} now`,
          detail: `${upcoming.label} · planned ${formatTime(time)}`,
          cls: "live",
          pill: "Meet now",
        };
      }
    }

    const past = [...events].reverse().find((event) => asDate(event.time) < now);
    if (past && latestArrival && now < latestArrival) {
      const time = asDate(past.time);
      if (now - time > 120_000) {
        return {
          title: "A planned join time has passed",
          detail: `Last ★ was ${past.label} at ${formatTime(time)}. If anyone missed it, refresh & replan.`,
          cls: "warn",
          pill: "Check meetup",
        };
      }
    }

    if (!events.length) {
      return {
        title: "Meet at the destination",
        detail: latestArrival ? `Everyone together around ${formatTime(latestArrival)}` : "No intermediate ★ join is planned.",
        cls: "good",
        pill: "On track",
      };
    }

    return {
      title: "Intermediate joins complete",
      detail: latestArrival ? `Everyone together around ${formatTime(latestArrival)}` : "Continue to the meetup.",
      cls: "good",
      pill: "On track",
    };
  }

  function ensurePanel() {
    let panel = document.getElementById("liveMeetupPanel");
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = "liveMeetupPanel";
    panel.className = "live090-panel";
    panel.setAttribute("aria-labelledby", "live090Title");
    panel.innerHTML = `
      <div class="live090-head">
        <div class="live090-head-copy">
          <span class="live090-kicker">Live meetup</span>
          <h2 id="live090Title">What should happen next?</h2>
          <p>Timetable/realtime estimate only — no GPS tracking.</p>
        </div>
        <div class="live090-actions">
          <button type="button" class="live090-button" id="live090Toggle"></button>
          <button type="button" class="live090-button primary" id="live090Refresh">Refresh & replan</button>
        </div>
      </div>
      <div class="live090-grid">
        <div class="live090-focus" id="live090Focus"></div>
        <div class="live090-health" id="live090Health"></div>
      </div>
      <div class="live090-members" id="live090Members"></div>
      <p class="live090-note" id="live090Note"></p>
    `;
    if (resultsSection) resultsSection.insertAdjacentElement("beforebegin", panel);
    else document.querySelector("main.app")?.appendChild(panel);

    panel.querySelector("#live090Toggle")?.addEventListener("click", () => {
      enabled = !enabled;
      writeState();
      scheduleTimers();
      render();
    });
    panel.querySelector("#live090Refresh")?.addEventListener("click", () => refreshPlan(false));
    return panel;
  }

  function highlightTimeline(group, now = new Date()) {
    const groupAssignments = assignments(group);
    const primary = results?.querySelector(':scope > .result[data-map-pair="primary"]');
    if (!primary) return;
    const timelines = [...primary.querySelectorAll(".route-timeline")];
    timelines.forEach((timeline, index) => {
      const assignment = groupAssignments[index];
      if (!assignment) return;
      const state = routeState(assignment, now);
      const steps = [...timeline.querySelectorAll(".timeline-step")];
      steps.forEach((step, stepIndex) => {
        step.classList.toggle("live090-current", enabled && stepIndex === state.segmentIndex);
        step.classList.toggle("live090-next-step", enabled && stepIndex === state.nextIndex);
        const arrival = asDate(assignment.route.segments?.[stepIndex]?.arrival);
        step.classList.toggle("live090-past", enabled && arrival && arrival < now && stepIndex !== state.segmentIndex);
      });
    });
  }

  function memberCards(group, now = new Date()) {
    return assignments(group).map((assignment) => {
      const state = routeState(assignment, now);
      const dot = escapeHtml(assignment.member.color || "#667085");
      let copy = state.label;
      if (state.phase === "waiting") copy = `${state.label} · ${formatTime(assignment.route.departure)}`;
      if (state.phase === "arrived") copy = `Arrived · ${formatTime(assignment.route.arrival)}`;
      return `
        <div class="live090-member">
          <span class="live090-member-dot" style="background:${dot}" aria-hidden="true"></span>
          <div><strong>${escapeHtml(assignment.member.name)}</strong><small>${escapeHtml(copy)}</small></div>
        </div>`;
    }).join("");
  }

  function render() {
    const panel = ensurePanel();
    const group = recommendation();
    if (!panel || !group || !assignments(group).length) {
      panel?.classList.remove("visible");
      return;
    }

    panel.classList.add("visible");
    const now = new Date();
    const groupAssignments = assignments(group);
    const focus = focusIndex(group);
    const assignment = groupAssignments[focus] || groupAssignments[0];
    const focusState = routeState(assignment, now);
    const pill = statePill(focusState);
    const health = joinHealth(group, now);

    const toggle = panel.querySelector("#live090Toggle");
    if (toggle) {
      toggle.textContent = enabled ? "● Live updates on" : "Start live mode";
      toggle.classList.toggle("active", enabled);
    }

    const refresh = panel.querySelector("#live090Refresh");
    if (refresh) {
      refresh.disabled = refreshing;
      refresh.textContent = refreshing ? "Refreshing…" : "Refresh & replan";
    }

    const focusEl = panel.querySelector("#live090Focus");
    if (focusEl) {
      const nextCopy = focusState.nextLabel
        ? `<div class="live090-next"><b>Next:</b> ${escapeHtml(focusState.nextLabel)}${focusState.nextDetail ? `<br>${escapeHtml(focusState.nextDetail)}` : ""}</div>`
        : focusState.nextDetail
          ? `<div class="live090-next">${escapeHtml(focusState.nextDetail)}</div>`
          : "";
      focusEl.innerHTML = `
        <div class="live090-focus-top"><span>${escapeHtml(assignment.member.name)} · current plan</span><span class="live090-state-pill ${pill.cls}">${pill.text}</span></div>
        <strong>${escapeHtml(focusState.label)}</strong>
        <p>${escapeHtml(focusState.detail || "")}</p>
        ${nextCopy}
        <div class="live090-progress" aria-label="Estimated journey progress"><span style="width:${Math.round(focusState.progress * 100)}%"></span></div>`;
    }

    const healthEl = panel.querySelector("#live090Health");
    if (healthEl) {
      healthEl.innerHTML = `
        <div class="live090-health-top"><span>Meetup health</span><span class="live090-state-pill ${health.cls}">${escapeHtml(health.pill)}</span></div>
        <strong>${escapeHtml(health.title)}</strong>
        <p>${escapeHtml(health.detail)}</p>`;
    }

    const membersEl = panel.querySelector("#live090Members");
    if (membersEl) membersEl.innerHTML = memberCards(group, now);

    const earliestDeparture = new Date(Math.min(...groupAssignments.map((item) => asDate(item.route.departure)?.getTime() || Infinity)));
    const note = panel.querySelector("#live090Note");
    if (note) {
      note.textContent = enabled && earliestDeparture > now
        ? `Live mode refreshes timetable data about every ${Math.round(AUTO_REFRESH_MS / 60_000)} min until the first departure. Once somebody is underway, it will not silently replace the route; use Refresh & replan if needed.`
        : `Status is inferred from the route timetable and realtime data currently loaded. It does not confirm a person's physical location.`;
    }

    highlightTimeline(group, now);
    ensureShareControls();
  }

  async function refreshPlan(auto = false) {
    if (refreshing || !window.NVSGroup?.search) return;
    if (auto && !enabled) return;
    refreshing = true;
    render();
    try {
      await window.NVSGroup.search();
      lastAutoRefresh = Date.now();
    } catch (error) {
      console.warn("Live meetup refresh failed:", error);
    } finally {
      refreshing = false;
      render();
    }
  }

  function autoRefresh() {
    if (!enabled || refreshing) return;
    const group = recommendation();
    const groupAssignments = assignments(group);
    if (!groupAssignments.length) return;
    const now = Date.now();
    const earliest = Math.min(...groupAssignments.map((item) => asDate(item.route.departure)?.getTime() || Infinity));
    if (!Number.isFinite(earliest) || now >= earliest - 30_000) return;
    if (now - lastAutoRefresh < AUTO_REFRESH_MS - 5_000) return;
    refreshPlan(true);
  }

  function scheduleTimers() {
    clearInterval(tickTimer);
    clearInterval(autoRefreshTimer);
    tickTimer = setInterval(render, TICK_MS);
    if (enabled) autoRefreshTimer = setInterval(autoRefresh, 30_000);
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2600);
  }

  async function shareCurrentUrl() {
    const url = window.location.href;
    const plan = window.NVSShare?.getSharedPlan?.();
    const focus = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    const person = plan?.members?.[focus];
    const title = person ? `${person.name} · Meet Schwerin` : "Meet Schwerin route";
    try {
      if (navigator.share) await navigator.share({ title, text: "Read-only Meet Schwerin route.", url });
      else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        showToast("Route link copied.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") showToast("Could not share the route.");
    }
  }

  function ensureSharedRouteShare() {
    if (!window.NVSShare?.isViewer?.()) return;
    const focus = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    if (focus < 0) return;
    const actions = document.querySelector(".topbar-actions");
    if (!actions || document.getElementById("live090ShareCurrent")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "live090ShareCurrent";
    button.className = "icon-button live090-share-current";
    button.innerHTML = `<span aria-hidden="true">↗</span><span class="install-label">Share route</span>`;
    button.setAttribute("aria-label", "Share this read-only route");
    button.addEventListener("click", shareCurrentUrl);
    actions.appendChild(button);
  }

  function ensurePlannerPersonLinks() {
    if (window.NVSShare?.isViewer?.() || !window.NVSShare?.sharePerson) return;
    const primary = results?.querySelector(':scope > .result[data-map-pair="primary"]');
    if (!primary) return;
    [...primary.querySelectorAll(".group-card-person")].forEach((row, index) => {
      if (row.querySelector(".person-share-link")) return;
      const duration = row.querySelector(".group-person-duration");
      if (!duration) return;
      let side = duration.closest(".group-person-side");
      if (!side) {
        side = document.createElement("div");
        side.className = "group-person-side";
        duration.replaceWith(side);
        side.appendChild(duration);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "person-share-link";
      button.innerHTML = `<span aria-hidden="true">↗</span><span>Link</span>`;
      button.setAttribute("aria-label", `Share person ${index + 1}'s route`);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.NVSShare.sharePerson(index);
      });
      side.appendChild(button);
    });
  }

  function ensureShareControls() {
    ensureSharedRouteShare();
    ensurePlannerPersonLinks();
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 45);
  }

  readState();
  ensurePanel();
  ensureShareControls();
  scheduleTimers();
  render();

  window.addEventListener("nvs-group-recommendations-rendered", scheduleRender);
  window.addEventListener("nvs-group-change", scheduleRender);
  window.addEventListener("nvs-priority-change", scheduleRender);
  window.addEventListener("nvs-timing-change", scheduleRender);
  window.addEventListener("nvs-routing-provider", scheduleRender);
  window.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
  window.addEventListener("pageshow", render);
  window.addEventListener("load", render);
  if (results) new MutationObserver(scheduleRender).observe(results, { childList: true, subtree: true });

  window.NVSLiveMeetup = Object.freeze({
    isEnabled: () => enabled,
    setEnabled: (value) => { enabled = Boolean(value); writeState(); scheduleTimers(); render(); },
    refresh: () => refreshPlan(false),
    routeState,
    joinHealth,
  });
})();
