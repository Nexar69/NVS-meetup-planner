(() => {
  const results = document.getElementById("results");
  const mapSection = document.querySelector(".map-section");
  const destinationInput = document.getElementById("destination");
  let refreshTimer = null;
  let clockTimer = null;

  function isPersonalView() {
    const plan = window.NVSShare?.getSharedPlan?.();
    return Boolean(plan && plan.view === "person" && Number.isInteger(plan.focus) && plan.focus >= 0);
  }

  function focusIndex() {
    return Number(window.NVSShare?.getFocusIndex?.() ?? -1);
  }

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

  function formatTime(value) {
    const date = asDate(value);
    return date ? new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date) : "—";
  }

  function withPlatform(name, platform) {
    const cleanName = String(name || "").trim();
    const cleanPlatform = String(platform || "").trim();
    if (!cleanPlatform) return cleanName;
    if (!cleanName) return `Stop ${cleanPlatform}`;
    const lower = cleanName.toLocaleLowerCase("de-DE");
    const p = cleanPlatform.toLocaleLowerCase("de-DE");
    if (lower.endsWith(` ${p}`) || lower.endsWith(`(${p})`) || lower.includes(`steig ${p}`) || lower.includes(`gleis ${p}`)) return cleanName;
    return `${cleanName} ${cleanPlatform}`;
  }

  function segmentIcon(segment) {
    const mode = String(segment?.mode || "").toUpperCase();
    if (mode === "WALK") return "🚶";
    if (mode === "TRAM") return "🚋";
    if (mode === "BUS") return "🚌";
    if (["RAIL", "REGIONAL_RAIL", "REGIONAL_FAST_RAIL", "LONG_DISTANCE", "HIGHSPEED_RAIL", "SUBURBAN"].includes(mode)) return "🚆";
    if (mode === "SUBWAY") return "🚇";
    if (mode === "FERRY") return "⛴";
    return "→";
  }

  function transportLabel(segment) {
    const mode = String(segment?.mode || "").toUpperCase();
    if (mode === "WALK") return `Walk${Number.isFinite(Number(segment.duration)) ? ` ${Number(segment.duration)} min` : ""}`;
    const modeLabel = String(segment?.modeLabel || segment?.mode || "Transit").trim();
    const line = String(segment?.line || "").trim();
    return line ? `${modeLabel} ${line}` : modeLabel;
  }

  function destinationLocation() {
    return window.NVSTransit?.LOCATIONS?.[destinationInput?.value] || null;
  }

  function analysisFor(group) {
    if (!window.NVSConvergence?.analyze) return { memberEvents: {}, events: [] };
    const destination = destinationLocation();
    return window.NVSConvergence.analyze(group, {
      destinationPoint: destination ? [destination.lat, destination.lon] : null,
      destinationLabel: destination?.label || destinationInput?.value || "Meetup",
    });
  }

  function joinAssignments(member, route, events) {
    const segments = Array.isArray(route?.segments) ? route.segments.filter(Boolean) : [];
    const assigned = new Map();
    const usableEvents = events.filter((event) => !event.final && (event.memberIds || []).includes(member.id));

    usableEvents.forEach((event) => {
      const eventTime = asDate(event.time);
      if (!eventTime) return;
      let index = -1;

      if (event.sharedTransit?.label) {
        const target = String(event.sharedTransit.label).toLocaleLowerCase("de-DE");
        index = segments.findIndex((segment) => {
          const label = transportLabel(segment).toLocaleLowerCase("de-DE");
          const departure = asDate(segment.departure);
          return label === target && departure && departure.getTime() >= eventTime.getTime() - 90_000 && departure.getTime() <= eventTime.getTime() + 10 * 60_000;
        });
      }

      if (index < 0) {
        index = segments.findIndex((segment) => {
          const departure = asDate(segment.departure);
          const arrival = asDate(segment.arrival);
          return departure && arrival && eventTime >= departure && eventTime <= arrival;
        });
      }

      if (index < 0) {
        index = segments.findIndex((segment) => {
          const departure = asDate(segment.departure);
          return departure && departure.getTime() >= eventTime.getTime() && departure.getTime() - eventTime.getTime() <= 5 * 60_000;
        });
      }

      if (index < 0) return;
      if (!assigned.has(index)) assigned.set(index, []);
      assigned.get(index).push(event);
    });

    return assigned;
  }

  function otherNames(event, memberId) {
    return (event.members || [])
      .filter((person) => person?.id !== memberId)
      .map((person) => person.name)
      .filter(Boolean);
  }

  function compactSteps(member, route, analysis) {
    const segments = Array.isArray(route?.segments) ? route.segments.filter(Boolean) : [];
    if (!segments.length) {
      return `<div class="personal-route-fallback">${escapeHtml(route?.description || "Public transport")}</div>`;
    }

    const events = analysis?.memberEvents?.[member.id] || [];
    const joinsBySegment = joinAssignments(member, route, events);

    return segments.map((segment, index) => {
      const joins = joinsBySegment.get(index) || [];
      const names = [...new Set(joins.flatMap((event) => otherNames(event, member.id)))];
      const joinText = names.length ? ` <span class="personal-inline-join">+ meet ${escapeHtml(names.join(" + "))}</span>` : "";
      const from = withPlatform(segment.from || "Start", segment.platformFrom);
      const to = withPlatform(segment.to || "Next stop", segment.platformTo);
      const direction = segment.headsign ? ` · toward ${segment.headsign}` : "";
      const delay = Number(segment.departureDelay || segment.arrivalDelay || 0);
      const delayText = delay > 0 ? ` · +${delay} min` : delay < 0 ? ` · ${delay} min` : "";
      return `
        <div class="personal-route-step">
          <time>${formatTime(segment.departure)}</time>
          <span class="personal-route-step-icon" aria-hidden="true">${segmentIcon(segment)}</span>
          <div>
            <strong>${escapeHtml(transportLabel(segment))}${joinText}</strong>
            <small>${escapeHtml(from)} → ${escapeHtml(to)}${escapeHtml(direction)}${escapeHtml(delayText)}</small>
          </div>
        </div>
      `;
    }).join("");
  }

  function leaveStatus(value) {
    const departure = asDate(value);
    if (!departure) return "";
    const seconds = Math.round((departure.getTime() - Date.now()) / 1000);
    if (seconds > 90) {
      const minutes = Math.round(seconds / 60);
      return minutes >= 60 ? `Leave in ${Math.floor(minutes / 60)}h ${minutes % 60}m` : `Leave in ${minutes} min`;
    }
    if (seconds >= -30) return "Leave now";
    const minutesAgo = Math.max(1, Math.round(Math.abs(seconds) / 60));
    return `Departure ${minutesAgo} min ago`;
  }

  function ensurePlanSection() {
    let section = document.getElementById("personalSharedPlan");
    if (section) return section;
    section = document.createElement("section");
    section.id = "personalSharedPlan";
    section.className = "personal-shared-plan";
    if (mapSection) mapSection.insertAdjacentElement("beforebegin", section);
    return section;
  }

  function tuneDetailedTimeline(focus) {
    const primary = results?.querySelector(':scope > .result[data-map-pair="primary"]');
    if (!primary) return;
    const details = primary.querySelector("details.journey-v05");
    if (details) {
      details.open = true;
      const title = details.querySelector("summary span:first-child");
      if (title) title.textContent = "Detailed journey";
      const meta = details.querySelector(".journey-summary-meta");
      if (meta) meta.textContent = "your stops · platforms · direction";
    }
    primary.querySelectorAll(".route-timeline").forEach((timeline, index) => {
      timeline.classList.toggle("personal-route-selected", index === focus);
    });
  }

  function render() {
    clearTimeout(refreshTimer);
    if (document.hidden) return;
    refreshTimer = setTimeout(() => {
      if (document.hidden || !isPersonalView()) return;
      const focus = focusIndex();
      const recommendations = window.__NVS_LAST_RECOMMENDATIONS__;
      const group = recommendations?.primary;
      const assignments = Array.isArray(group?.assignments) ? group.assignments : [];
      const assignment = assignments[focus];
      if (!assignment?.member || !assignment?.route) return;

      const member = assignment.member;
      const route = assignment.route;
      const analysis = analysisFor(group);
      const section = ensurePlanSection();
      const status = leaveStatus(route.departure);
      const destination = destinationLocation();

      section.innerHTML = `
        <div class="personal-plan-head">
          <div>
            <p class="section-kicker">Your plan · Person ${focus + 1}</p>
            <h2>${escapeHtml(member.name)}</h2>
            <p>${escapeHtml(destination?.label || destinationInput?.value || "Meetup")} · ${formatTime(route.departure)} → ${formatTime(route.arrival)}</p>
          </div>
          <div class="personal-plan-duration">
            <strong>${Number(route.duration) || "—"} min</strong>
            <span>${escapeHtml(status)}</span>
          </div>
        </div>
        <div class="personal-route-steps">${compactSteps(member, route, analysis)}</div>
        <p class="personal-plan-note">★ A join is shown only when somebody new actually meets you or your current subgroup.</p>
      `;

      tuneDetailedTimeline(focus);
      const version = document.getElementById("versionLabel");
      if (version) version.textContent = "v0.7.4 · Precise joins + personal itineraries";
    }, 50);
  }

  function scheduleClock(delay = 15_000) {
    clearTimeout(clockTimer);
    if (document.hidden) return;
    clockTimer = setTimeout(() => {
      render();
      scheduleClock();
    }, delay);
  }

  function resumePersonalItinerary() {
    if (document.hidden || !isPersonalView()) return;
    render();
    scheduleClock();
  }

  if (!isPersonalView()) return;

  document.body.classList.add("personal-itinerary-view");
  window.addEventListener("nvs-group-recommendations-rendered", render);
  window.addEventListener("load", resumePersonalItinerary);
  window.addEventListener("pageshow", resumePersonalItinerary);
  window.addEventListener("nvs-shared-view-resumed", resumePersonalItinerary);
  if (results) new MutationObserver(() => render()).observe(results, { childList: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(clockTimer);
      clearTimeout(refreshTimer);
      return;
    }
    resumePersonalItinerary();
  });
  scheduleClock();
  render();
})();