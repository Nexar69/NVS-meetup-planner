(() => {
  const SCHWERIN_CENTER = [53.628, 11.415];
  const ROUTE_COLORS = Object.freeze({
    you: "#2563eb",
    friend: "#db2777",
  });

  const state = {
    map: null,
    routeLayer: null,
    connections: null,
    context: null,
    selectedType: "best",
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

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatTime(date) {
    return new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function minutesBetween(a, b) {
    return Math.round(Math.abs(a.getTime() - b.getTime()) / 60_000);
  }

  function signedMinutesBetween(date, target) {
    return Math.round((date.getTime() - target.getTime()) / 60_000);
  }

  function createPairs(routesA, routesB, target) {
    const pairs = [];

    for (const routeA of routesA) {
      for (const routeB of routesB) {
        const latestArrival = routeA.arrival > routeB.arrival ? routeA.arrival : routeB.arrival;
        const earliestArrival = routeA.arrival < routeB.arrival ? routeA.arrival : routeB.arrival;
        const waitingDifference = minutesBetween(routeA.arrival, routeB.arrival);
        const targetDifference = signedMinutesBetween(latestArrival, target);
        const score = Math.abs(targetDifference) + waitingDifference * 1.8;

        pairs.push({
          routeA,
          routeB,
          latestArrival,
          earliestArrival,
          waitingDifference,
          targetDifference,
          score,
        });
      }
    }

    return pairs;
  }

  function scoreDirectionalPair(pair, target, direction) {
    const targetDistance = direction === "early"
      ? (target.getTime() - pair.latestArrival.getTime()) / 60_000
      : (pair.earliestArrival.getTime() - target.getTime()) / 60_000;

    return Math.max(0, targetDistance) + pair.waitingDifference * 1.5;
  }

  function chooseConnections(pairs, target) {
    if (!pairs.length) return { early: null, best: null, later: null };

    const best = [...pairs].sort((a, b) => a.score - b.score)[0];
    const early = pairs
      .filter((pair) => pair !== best && pair.latestArrival <= target)
      .sort((a, b) => scoreDirectionalPair(a, target, "early") - scoreDirectionalPair(b, target, "early"))[0] || null;
    const later = pairs
      .filter((pair) => pair !== best && pair.earliestArrival >= target)
      .sort((a, b) => scoreDirectionalPair(a, target, "later") - scoreDirectionalPair(b, target, "later"))[0] || null;

    return { early, best, later };
  }

  function getTargetDate() {
    if (!dateInput?.value || !timeInput?.value) return null;
    const target = new Date(`${dateInput.value}T${timeInput.value}`);
    return Number.isNaN(target.getTime()) ? null : target;
  }

  function getContext() {
    return {
      personA: personAInput?.value,
      personB: personBInput?.value,
      destination: destinationInput?.value,
      target: getTargetDate(),
    };
  }

  function locationFor(key) {
    return window.NVSTransit?.LOCATIONS?.[key] || null;
  }

  function latLngFor(key) {
    const location = locationFor(key);
    return location ? [location.lat, location.lon] : null;
  }

  function markerIcon(kind, label) {
    return window.L.divIcon({
      className: "meet-marker-wrap",
      html: `<span class="meet-marker ${kind}">${escapeHtml(label)}</span>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
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

  function clearRoutes() {
    state.routeLayer?.clearLayers();
  }

  function addLocationMarker(key, kind, label, detail) {
    const point = latLngFor(key);
    if (!point || !state.routeLayer) return null;

    const marker = window.L.marker(point, {
      icon: markerIcon(kind, label),
      keyboard: true,
      title: key,
    }).addTo(state.routeLayer);

    marker.bindPopup(`
      <div class="map-popup">
        <strong>${escapeHtml(key)}</strong>
        <span>${escapeHtml(detail)}</span>
      </div>
    `);

    return marker;
  }

  function validGeometry(route) {
    if (!Array.isArray(route?.geometry)) return [];
    return route.geometry.filter(
      (point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]),
    );
  }

  function drawRoute(route, fromKey, toKey, color, label) {
    const from = latLngFor(fromKey);
    const to = latLngFor(toKey);
    const geometry = validGeometry(route);
    const points = geometry.length >= 2 ? geometry : [from, to].filter(Boolean);

    if (points.length < 2 || !state.routeLayer) return { bounds: points, approximate: true };

    const approximate = geometry.length < 2;
    const line = window.L.polyline(points, {
      color,
      weight: 6,
      opacity: 0.88,
      lineCap: "round",
      lineJoin: "round",
      dashArray: approximate ? "9 9" : null,
    }).addTo(state.routeLayer);

    line.bindTooltip(
      `${escapeHtml(label)} · ${formatTime(route.departure)} → ${formatTime(route.arrival)}`,
      { sticky: true },
    );

    return { bounds: points, approximate };
  }

  function fitPoints(points) {
    if (!state.map) return;
    const valid = points.filter(Boolean);
    if (!valid.length) return;

    const bounds = window.L.latLngBounds(valid);
    if (!bounds.isValid()) return;

    state.map.fitBounds(bounds, {
      padding: [34, 34],
      maxZoom: 15,
      animate: true,
    });
  }

  function updateTabs() {
    document.querySelectorAll(".map-tabs [data-map-pair]").forEach((button) => {
      const type = button.dataset.mapPair;
      const available = Boolean(state.connections?.[type]);
      button.disabled = !available;
      button.classList.toggle("active", type === state.selectedType && available);
      button.setAttribute("aria-pressed", String(type === state.selectedType && available));
    });
  }

  function tagResultCards() {
    const cards = [...results.querySelectorAll(":scope > .result")];
    const types = ["early", "best", "later"];

    cards.forEach((card, index) => {
      const type = types[index];
      if (!type || card.classList.contains("unavailable-result")) {
        card.removeAttribute("data-map-pair");
        card.classList.remove("map-selected");
        return;
      }

      card.dataset.mapPair = type;
      card.classList.toggle("map-selected", type === state.selectedType);
      card.setAttribute("title", `Show ${type} pair on map`);
    });
  }

  function renderPreview() {
    if (!state.map || !state.routeLayer) return;

    clearRoutes();
    const context = getContext();
    const points = [];

    const you = addLocationMarker(context.personA, "you", "A", "Your starting point");
    const friend = addLocationMarker(context.personB, "friend", "B", "Friend's starting point");
    const meet = addLocationMarker(context.destination, "meet", "M", "Meetup point");

    [you, friend, meet].forEach((marker) => {
      if (marker) points.push(marker.getLatLng());
    });

    const destination = latLngFor(context.destination);
    const fromA = latLngFor(context.personA);
    const fromB = latLngFor(context.personB);

    if (fromA && destination) {
      window.L.polyline([fromA, destination], {
        color: ROUTE_COLORS.you,
        weight: 4,
        opacity: 0.42,
        dashArray: "7 9",
      }).addTo(state.routeLayer);
    }

    if (fromB && destination) {
      window.L.polyline([fromB, destination], {
        color: ROUTE_COLORS.friend,
        weight: 4,
        opacity: 0.42,
        dashArray: "7 9",
      }).addTo(state.routeLayer);
    }

    fitPoints(points);
    if (mapStatus) mapStatus.innerHTML = "Select a meetup time to load <strong>real route geometry</strong>. Dashed lines are only a location preview.";
  }

  function drawSelectedPair() {
    const pair = state.connections?.[state.selectedType];
    const context = state.context;

    if (!state.map || !pair || !context) {
      renderPreview();
      return;
    }

    clearRoutes();

    addLocationMarker(
      context.personA,
      "you",
      "A",
      `You leave ${formatTime(pair.routeA.departure)}`,
    );
    addLocationMarker(
      context.personB,
      "friend",
      "B",
      `Friend leaves ${formatTime(pair.routeB.departure)}`,
    );
    addLocationMarker(
      context.destination,
      "meet",
      "M",
      `Together around ${formatTime(pair.latestArrival)}`,
    );

    const routeA = drawRoute(pair.routeA, context.personA, context.destination, ROUTE_COLORS.you, "You");
    const routeB = drawRoute(pair.routeB, context.personB, context.destination, ROUTE_COLORS.friend, "Friend");
    const allPoints = [...routeA.bounds, ...routeB.bounds];

    fitPoints(allPoints);
    updateTabs();
    tagResultCards();

    const approximate = routeA.approximate || routeB.approximate;
    const label = state.selectedType === "best" ? "Best match" : state.selectedType[0].toUpperCase() + state.selectedType.slice(1);
    if (mapStatus) {
      mapStatus.innerHTML = approximate
        ? `<strong>${label}</strong> · Some path geometry was unavailable, so dashed sections are approximate.`
        : `<strong>${label}</strong> · Routes follow geometry returned by Transitous/MOTIS.`;
    }
  }

  function selectPair(type) {
    if (!state.connections?.[type]) return;
    state.selectedType = type;
    drawSelectedPair();
  }

  async function refreshFromLiveRoutes() {
    const context = getContext();
    if (!context.target || !window.NVSTransit?.fetchRoutes) {
      renderPreview();
      return;
    }

    if (!dataBadge?.classList.contains("live")) {
      state.connections = null;
      state.context = context;
      updateTabs();
      tagResultCards();
      renderPreview();
      return;
    }

    try {
      const [routesA, routesB] = await Promise.all([
        window.NVSTransit.fetchRoutes(context.personA, context.destination, context.target),
        window.NVSTransit.fetchRoutes(context.personB, context.destination, context.target),
      ]);

      const pairs = createPairs(routesA, routesB, context.target);
      const connections = chooseConnections(pairs, context.target);
      if (!connections.best) {
        renderPreview();
        return;
      }

      state.connections = connections;
      state.context = context;
      if (!connections[state.selectedType]) state.selectedType = "best";
      drawSelectedPair();
    } catch (error) {
      console.warn("Map route refresh failed:", error);
      renderPreview();
    }
  }

  function scheduleRefresh(delay = 80) {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(refreshFromLiveRoutes, delay);
  }

  document.querySelectorAll(".map-tabs [data-map-pair]").forEach((button) => {
    button.addEventListener("click", () => selectPair(button.dataset.mapPair));
  });

  document.getElementById("mapFitButton")?.addEventListener("click", () => {
    if (state.connections?.[state.selectedType]) drawSelectedPair();
    else renderPreview();
  });

  results?.addEventListener("click", (event) => {
    const card = event.target.closest(".result[data-map-pair]");
    if (card) selectPair(card.dataset.mapPair);
  });

  [personAInput, personBInput, destinationInput].forEach((input) => {
    input?.addEventListener("change", () => {
      state.connections = null;
      renderPreview();
      scheduleRefresh(250);
    });
  });

  [dateInput, timeInput].forEach((input) => {
    input?.addEventListener("change", () => scheduleRefresh(250));
  });

  if (dataBadge) {
    new MutationObserver(() => scheduleRefresh(120)).observe(dataBadge, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  if (results) {
    new MutationObserver(() => {
      tagResultCards();
      if (dataBadge?.classList.contains("live")) scheduleRefresh(80);
    }).observe(results, { childList: true });
  }

  window.addEventListener("resize", () => state.map?.invalidateSize({ pan: false }));

  initMap();
  scheduleRefresh(400);

  window.NVSMap = Object.freeze({
    refresh: scheduleRefresh,
    selectPair,
  });
})();
