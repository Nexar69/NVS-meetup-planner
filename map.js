(() => {
  const SCHWERIN_CENTER = [53.628, 11.415];
  const FALLBACK_COLORS = ["#2563eb", "#db2777", "#7c3aed", "#ea580c", "#0891b2", "#65a30d"];

  const state = {
    map: null,
    routeLayer: null,
    recommendations: null,
    context: null,
    selectedType: "primary",
    refreshTimer: null,
  };

  const mapElement = document.getElementById("meetupMap");
  const mapFallback = document.getElementById("mapFallback");
  const mapStatus = document.getElementById("mapStatus");
  const dataBadge = document.getElementById("dataBadge");
  const results = document.getElementById("results");
  const personAInput = document.getElementById("personA");
  const personBInput = document.getElementById("personB");
  const destinationInput = document.getElementById("destination");
  const dateInput = document.getElementById("date");
  const timeInput = document.getElementById("time");
  const legend = document.querySelector(".map-legend");

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
    return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function getTargetDate() {
    if (!dateInput?.value || !timeInput?.value) return null;
    const target = new Date(`${dateInput.value}T${timeInput.value}`);
    return Number.isNaN(target.getTime()) ? null : target;
  }

  function fallbackMembers() {
    return [
      { id: "personA", name: "You", color: FALLBACK_COLORS[0], originKey: personAInput?.value, markerLabel: "A" },
      { id: "personB", name: "Friend", color: FALLBACK_COLORS[1], originKey: personBInput?.value, markerLabel: "B" },
    ];
  }

  function groupMembers() {
    const members = window.NVSGroup?.getMembers?.();
    return Array.isArray(members) && members.length >= 2 ? members : fallbackMembers();
  }

  function getContext() {
    return {
      members: groupMembers(),
      destination: destinationInput?.value,
      target: getTargetDate(),
    };
  }

  function locationFor(key) { return window.NVSTransit?.LOCATIONS?.[key] || null; }
  function latLngFor(key) {
    const location = locationFor(key);
    return location ? [location.lat, location.lon] : null;
  }

  function markerIcon(label, color, meet = false) {
    const background = meet ? "#101828" : color || "#667085";
    return window.L.divIcon({
      className: "meet-marker-wrap",
      html: `<span class="meet-marker ${meet ? "meet" : ""}" style="background:${escapeHtml(background)}">${escapeHtml(label)}</span>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -18],
    });
  }

  function convergenceIcon(everyone = false) {
    return window.L.divIcon({
      className: "convergence-marker-wrap",
      html: `<span class="convergence-marker ${everyone ? "everyone" : ""}">${everyone ? "👥" : "★"}</span>`,
      iconSize: everyone ? [34, 34] : [30, 30],
      iconAnchor: everyone ? [17, 17] : [15, 15],
      popupAnchor: [0, -18],
    });
  }

  function initMap() {
    if (!mapElement) return false;
    if (!window.L) {
      mapElement.style.display = "none";
      mapFallback?.classList.add("visible");
      if (mapStatus) mapStatus.textContent = "Map library unavailable. Route cards still work normally.";
      return false;
    }

    state.map = window.L.map(mapElement, {
      center: SCHWERIN_CENTER,
      zoom: 12,
      zoomControl: true,
      attributionControl: true,
    });

    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    }).addTo(state.map);

    state.routeLayer = window.L.layerGroup().addTo(state.map);
    renderPreview();
    return true;
  }

  function clearRoutes() { state.routeLayer?.clearLayers(); }

  function addMemberMarker(member, detail) {
    const point = latLngFor(member.originKey);
    if (!point || !state.routeLayer) return null;
    const marker = window.L.marker(point, {
      icon: markerIcon(member.markerLabel, member.color, false),
      keyboard: true,
      title: member.name,
    }).addTo(state.routeLayer);
    marker.bindPopup(`<div class="map-popup"><strong>${escapeHtml(member.name)}</strong><span>${escapeHtml(detail)}</span></div>`);
    return marker;
  }

  function addMeetMarker(destination, detail) {
    const point = latLngFor(destination);
    if (!point || !state.routeLayer) return null;
    const marker = window.L.marker(point, {
      icon: markerIcon("M", "#101828", true),
      keyboard: true,
      title: destination,
    }).addTo(state.routeLayer);
    marker.bindPopup(`<div class="map-popup"><strong>${escapeHtml(locationFor(destination)?.label || destination)}</strong><span>${escapeHtml(detail)}</span></div>`);
    return marker;
  }

  function convergencePeopleHtml(event) {
    return (event.members || []).map((member) => `
      <span class="convergence-popup-person">
        <span class="convergence-popup-dot" style="background:${escapeHtml(member.color || "#667085")}"></span>
        ${escapeHtml(member.name)}
      </span>
    `).join("");
  }

  function addConvergenceMarker(event) {
    if (!Array.isArray(event?.point) || event.point.length < 2 || event.final || !state.routeLayer) return null;
    const marker = window.L.marker(event.point, {
      icon: convergenceIcon(false),
      keyboard: true,
      title: event.title,
      zIndexOffset: 800,
    }).addTo(state.routeLayer);

    const shared = event.sharedTransit
      ? `<small>Continue together on <strong>${escapeHtml(event.sharedTransit.label)}</strong></small>`
      : "";
    marker.bindPopup(`
      <div class="convergence-popup">
        <strong>★ ${escapeHtml(event.title)}</strong>
        <span>${escapeHtml(event.label)} · ${formatTime(event.time)}</span>
        <div class="convergence-popup-people">${convergencePeopleHtml(event)}</div>
        ${shared}
      </div>
    `);
    return marker;
  }

  function validGeometry(route) {
    if (!Array.isArray(route?.geometry)) return [];
    return route.geometry.filter((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  }

  function drawRoute(route, fromKey, toKey, color, label) {
    const from = latLngFor(fromKey);
    const to = latLngFor(toKey);
    const geometry = validGeometry(route);
    const points = geometry.length >= 2 ? geometry : [from, to].filter(Boolean);
    if (points.length < 2 || !state.routeLayer) return { bounds: points, approximate: true };

    const approximate = geometry.length < 2;
    const line = window.L.polyline(points, {
      color: color || "#667085",
      weight: 5,
      opacity: 0.78,
      lineCap: "round",
      lineJoin: "round",
      dashArray: approximate ? "9 9" : null,
    }).addTo(state.routeLayer);
    line.bindTooltip(`${escapeHtml(label)} · ${formatTime(route.departure)} → ${formatTime(route.arrival)}`, { sticky: true });
    return { bounds: points, approximate };
  }

  function drawSharedLeg(shared) {
    const geometry = Array.isArray(shared?.geometry) ? shared.geometry.filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) : [];
    if (geometry.length < 2 || !state.routeLayer) return [];
    const names = (shared.members || []).map((member) => member.name).join(" + ");
    const line = window.L.polyline(geometry, {
      color: "#101828",
      weight: 9,
      opacity: 0.34,
      lineCap: "round",
      lineJoin: "round",
      dashArray: "4 7",
    }).addTo(state.routeLayer);
    line.bindTooltip(`${escapeHtml(names)} together · ${escapeHtml(shared.label)}`, { sticky: true });
    return geometry;
  }

  function fitPoints(points) {
    if (!state.map) return;
    const valid = points.filter(Boolean);
    if (!valid.length) return;
    const bounds = window.L.latLngBounds(valid);
    if (!bounds.isValid()) return;
    state.map.fitBounds(bounds, { padding: [34, 34], maxZoom: 15, animate: true });
  }

  function updateLegend(members, hasConvergence = false, hasShared = false) {
    if (!legend) return;
    legend.innerHTML = members.map((member) => `
      <span class="map-legend-item"><span class="group-map-legend-dot" style="background:${escapeHtml(member.color)}"></span>${escapeHtml(member.name)}</span>
    `).join("") +
      (hasConvergence ? `<span class="map-legend-item"><span class="convergence-marker" style="width:18px;height:18px;font-size:9px;border-width:2px">★</span>Join</span>` : "") +
      (hasShared ? `<span class="map-legend-item convergence-shared-key"><span class="convergence-shared-line"></span>Together</span>` : "") +
      `<span class="map-legend-item"><span class="map-legend-swatch meet" aria-hidden="true"></span>Meet</span>`;
  }

  function updateTabs() {
    document.querySelectorAll(".map-tabs [data-map-pair]").forEach((button) => {
      const type = button.dataset.mapPair;
      const available = Boolean(state.recommendations?.[type]);
      button.disabled = !available;
      button.classList.toggle("active", type === state.selectedType && available);
      button.setAttribute("aria-pressed", String(type === state.selectedType && available));
    });
  }

  function tagResultCards() {
    [...results.querySelectorAll(":scope > .result[data-map-pair]")].forEach((card) => {
      const type = card.dataset.mapPair;
      card.classList.toggle("map-selected", type === state.selectedType);
      card.setAttribute("title", `Show ${type === "primary" ? "best" : "backup"} recommendation on map`);
    });
  }

  function renderPreview() {
    if (!state.map || !state.routeLayer) return;
    clearRoutes();
    const context = getContext();
    updateLegend(context.members, false, false);
    const points = [];
    const destination = latLngFor(context.destination);

    context.members.forEach((member) => {
      if (!member.originKey) return;
      const marker = addMemberMarker(member, `Starting at ${locationFor(member.originKey)?.label || member.originKey}`);
      if (marker) points.push(marker.getLatLng());
      const from = latLngFor(member.originKey);
      if (from && destination) {
        window.L.polyline([from, destination], {
          color: member.color,
          weight: 4,
          opacity: 0.38,
          dashArray: "7 9",
        }).addTo(state.routeLayer);
      }
    });

    const meet = addMeetMarker(context.destination, "Meetup point");
    if (meet) points.push(meet.getLatLng());
    fitPoints(points);
    if (mapStatus) mapStatus.innerHTML = "Choose your meetup preferences to load <strong>every group route</strong>. Dashed lines are only a preview.";
  }

  function modeLabel(recommendations) {
    if (recommendations?.mode === "fastest") return "⚡ Fastest group match";
    if (recommendations?.mode === "easy") return "😌 Easiest group match";
    return "🤝 Best group match";
  }

  function assignmentsFor(group, context) {
    if (Array.isArray(group?.assignments) && group.assignments.length) return group.assignments;
    return [
      { member: context.members[0], route: group?.routeA },
      { member: context.members[1], route: group?.routeB },
    ].filter((assignment) => assignment.member && assignment.route);
  }

  function convergenceFor(group, context) {
    const destination = locationFor(context.destination);
    return window.NVSConvergence?.analyze?.(group, {
      destinationPoint: destination ? [destination.lat, destination.lon] : null,
      destinationLabel: destination?.label || context.destination,
    }) || { events: [], sharedLegs: [] };
  }

  function drawSelectedPair() {
    const group = state.recommendations?.[state.selectedType];
    const context = state.context;
    if (!state.map || !group || !context) { renderPreview(); return; }

    clearRoutes();
    const assignments = assignmentsFor(group, context);
    const convergence = convergenceFor(group, context);
    const visibleEvents = convergence.events.filter((event) => !event.final && Array.isArray(event.point));
    updateLegend(context.members, visibleEvents.length > 0, convergence.sharedLegs.length > 0);
    const bounds = [];
    let approximate = false;

    assignments.forEach((assignment) => {
      const member = assignment.member;
      const route = assignment.route;
      const marker = addMemberMarker(member, `Leave ${formatTime(route.departure)} · arrive ${formatTime(route.arrival)}`);
      if (marker) bounds.push(marker.getLatLng());
      const drawn = drawRoute(route, member.originKey, context.destination, member.color, member.name);
      bounds.push(...drawn.bounds);
      approximate = approximate || drawn.approximate;
    });

    convergence.sharedLegs.forEach((shared) => bounds.push(...drawSharedLeg(shared)));
    visibleEvents.forEach((event) => {
      const marker = addConvergenceMarker(event);
      if (marker) bounds.push(marker.getLatLng());
    });

    const meet = addMeetMarker(
      context.destination,
      `${state.recommendations.timingMode === "asap" ? "Everyone there by" : "Whole group together around"} ${formatTime(group.latestArrival)}`,
    );
    if (meet) bounds.push(meet.getLatLng());

    fitPoints(bounds);
    updateTabs();
    tagResultCards();

    const label = state.selectedType === "primary" ? modeLabel(state.recommendations) : "Backup group recommendation";
    const joinText = visibleEvents.length
      ? ` · ${visibleEvents.length} intermediate join${visibleEvents.length === 1 ? "" : "s"} marked ★`
      : "";
    if (mapStatus) {
      mapStatus.innerHTML = approximate
        ? `<strong>${label}</strong> · All ${assignments.length} journeys are shown; some geometry is approximate${joinText}.`
        : `<strong>${label}</strong> · All ${assignments.length} live journeys are shown${joinText}.`;
    }
  }

  function selectPair(type) {
    if (!state.recommendations?.[type]) return;
    state.selectedType = type;
    drawSelectedPair();
  }

  async function refreshFromLiveRoutes() {
    const context = getContext();
    if (!context.target || !window.NVSTransit?.fetchRoutes || !window.NVSRecommend?.recommendGroup) { renderPreview(); return; }

    if (!dataBadge?.classList.contains("live")) {
      state.recommendations = null;
      state.context = context;
      updateTabs();
      tagResultCards();
      renderPreview();
      return;
    }

    if (context.members.some((member) => !member.originKey)) {
      renderPreview();
      return;
    }

    try {
      const routeSets = await Promise.all(
        context.members.map((member) => window.NVSTransit.fetchRoutes(member.originKey, context.destination, context.target)),
      );
      if (routeSets.some((routes) => !routes.length)) { renderPreview(); return; }
      const recommendations = window.NVSRecommend.recommendGroup(routeSets, context.members, context.target, {
        priorityIds: window.NVSGroup?.getPriorityIds?.() || [],
      });
      if (!recommendations.primary) { renderPreview(); return; }
      state.recommendations = recommendations;
      state.context = context;
      if (!recommendations[state.selectedType]) state.selectedType = "primary";
      drawSelectedPair();
    } catch (error) {
      console.warn("Group map refresh failed:", error);
      renderPreview();
    }
  }

  function scheduleRefresh(delay = 80) {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(refreshFromLiveRoutes, delay);
  }

  document.querySelectorAll(".map-tabs [data-map-pair]").forEach((button) => button.addEventListener("click", () => selectPair(button.dataset.mapPair)));
  document.getElementById("mapFitButton")?.addEventListener("click", () => state.recommendations?.[state.selectedType] ? drawSelectedPair() : renderPreview());
  results?.addEventListener("click", (event) => {
    const card = event.target.closest(".result[data-map-pair]");
    if (card) selectPair(card.dataset.mapPair);
  });

  [personAInput, personBInput, destinationInput, dateInput, timeInput].forEach((input) => input?.addEventListener("change", () => scheduleRefresh(220)));
  window.addEventListener("nvs-priority-change", () => { state.selectedType = "primary"; scheduleRefresh(20); });
  window.addEventListener("nvs-timing-change", () => { state.selectedType = "primary"; scheduleRefresh(20); });
  window.addEventListener("nvs-group-change", () => { state.selectedType = "primary"; state.recommendations = null; renderPreview(); scheduleRefresh(40); });
  window.addEventListener("nvs-group-recommendations-rendered", (event) => {
    const detail = event.detail || {};
    if (!detail.recommendations) return;
    state.recommendations = detail.recommendations;
    state.context = {
      members: detail.members || groupMembers(),
      destination: detail.destination || destinationInput?.value,
      target: detail.target || getTargetDate(),
    };
    state.selectedType = "primary";
    drawSelectedPair();
  });

  if (dataBadge) new MutationObserver(() => scheduleRefresh(120)).observe(dataBadge, { attributes: true, attributeFilter: ["class"] });
  if (results) new MutationObserver(() => { tagResultCards(); }).observe(results, { childList: true });

  window.addEventListener("resize", () => state.map?.invalidateSize({ pan: false }));
  initMap();
  scheduleRefresh(400);

  window.NVSMap = Object.freeze({ refresh: scheduleRefresh, selectPair });
})();