(() => {
  const PHOTON_API = "https://photon.komoot.io/api/";
  const SEARCH_BBOX = "11.25,53.54,11.56,53.72";
  const SCHWERIN_BOUNDS = { minLat: 53.50, maxLat: 53.75, minLon: 11.20, maxLon: 11.65 };
  const CUSTOM_STORAGE_KEY = "meet-schwerin-custom-places-v1";
  const SEARCH_DEBOUNCE_MS = 420;
  const SEARCH_CACHE_MS = 10 * 60_000;

  const selects = {
    personA: document.getElementById("personA"),
    personB: document.getElementById("personB"),
    destination: document.getElementById("destination"),
  };
  const plannerForm = document.getElementById("plannerForm");
  const dateInput = document.getElementById("date");
  const timeInput = document.getElementById("time");
  const toast = document.getElementById("toast");

  let activeSelect = null;
  let searchTimer = null;
  let searchController = null;
  let searchGeneration = 0;
  let toastTimer = null;
  const searchCache = new Map();
  const customPlaces = new Map();

  function invalidateSearch({ clearActive = false } = {}) {
    clearTimeout(searchTimer);
    searchTimer = null;
    searchGeneration += 1;
    searchController?.abort();
    searchController = null;
    if (clearActive) activeSelect = null;
    return searchGeneration;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function currentLocations() {
    return window.NVSTransit?.LOCATIONS || {};
  }

  function samePoint(a, b) {
    return Math.abs(Number(a?.lat) - Number(b?.lat)) < 0.00001 &&
      Math.abs(Number(a?.lon) - Number(b?.lon)) < 0.00001;
  }

  function uniqueKey(label, lat, lon) {
    const base = String(label || "Selected place").trim() || "Selected place";
    const locations = currentLocations();
    if (!locations[base] || samePoint(locations[base], { lat, lon })) return base;

    let number = 2;
    while (locations[`${base} (${number})`]) number += 1;
    return `${base} (${number})`;
  }

  function addOption(select, key, label) {
    if (!select) return;
    const existing = [...select.options].find((option) => option.value === key);
    if (existing) {
      existing.textContent = label;
      return;
    }

    const option = document.createElement("option");
    option.value = key;
    option.textContent = label;
    option.dataset.customPlace = "true";
    select.appendChild(option);
  }

  function registerPlace(place, { persist = true, targets = Object.values(selects) } = {}) {
    const lat = Number(place.lat);
    const lon = Number(place.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Invalid coordinates");

    const key = place.key || uniqueKey(place.label, lat, lon);
    const normalized = {
      key,
      label: String(place.label || key),
      lat,
      lon,
      source: place.source || "search",
    };

    window.NVSTransit?.registerLocation?.(key, normalized);
    targets.filter(Boolean).forEach((select) => addOption(select, key, normalized.label));
    customPlaces.set(key, normalized);

    if (persist && normalized.source !== "gps") saveCustomPlaces();
    return normalized;
  }

  function saveCustomPlaces() {
    try {
      const values = [...customPlaces.values()]
        .filter((place) => place.source !== "gps")
        .slice(-16);
      localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(values));
    } catch {
      // Persistence is optional.
    }
  }

  function restoreCustomPlaces() {
    try {
      const values = JSON.parse(localStorage.getItem(CUSTOM_STORAGE_KEY) || "[]");
      if (!Array.isArray(values)) return;
      values.slice(-16).forEach((place) => registerPlace(place, { persist: false }));
    } catch {
      // Ignore corrupt or unavailable storage.
    }
  }

  function buildDialog() {
    const dialog = document.createElement("dialog");
    dialog.id = "placeSearchDialog";
    dialog.className = "place-search-dialog";
    dialog.innerHTML = `
      <div class="place-dialog-header">
        <div>
          <p class="section-kicker">Search Schwerin</p>
          <h2>Choose a stop, street or place</h2>
        </div>
        <button type="button" class="place-close" aria-label="Close">×</button>
      </div>
      <label class="place-search-box">
        <span class="sr-only">Search for a place</span>
        <span aria-hidden="true">⌕</span>
        <input id="placeSearchInput" type="search" autocomplete="off" autocapitalize="words" placeholder="e.g. Schlosspark-Center or Lübecker Straße">
      </label>
      <div class="place-search-state" id="placeSearchState">Type at least 2 characters.</div>
      <div class="place-results" id="placeSearchResults" role="listbox" aria-label="Place search results"></div>
      <p class="place-privacy-note">Search is provided by Photon/OpenStreetMap. Search requests are limited to the Schwerin area and cached briefly on this device.</p>
    `;
    document.body.appendChild(dialog);

    const input = dialog.querySelector("#placeSearchInput");
    const results = dialog.querySelector("#placeSearchResults");
    const state = dialog.querySelector("#placeSearchState");

    dialog.querySelector(".place-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => invalidateSearch({ clearActive: true }));

    input.addEventListener("input", () => schedulePlaceSearch(input.value, results, state));
    return { dialog, input, results, state };
  }

  const placeDialog = buildDialog();

  function openSearch(select) {
    invalidateSearch({ clearActive: true });
    activeSelect = select;
    placeDialog.input.value = "";
    placeDialog.results.innerHTML = "";
    placeDialog.state.textContent = "Type at least 2 characters.";
    placeDialog.dialog.showModal();
    setTimeout(() => placeDialog.input.focus(), 50);
  }

  function injectLocationTools() {
    Object.entries(selects).forEach(([name, select]) => {
      if (!select) return;
      const field = select.closest(".field");
      if (!field || field.querySelector(".location-tools")) return;

      const tools = document.createElement("div");
      tools.className = "location-tools";

      const searchButton = document.createElement("button");
      searchButton.type = "button";
      searchButton.className = "location-tool-button";
      searchButton.innerHTML = `<span aria-hidden="true">⌕</span><span>Search place</span>`;
      searchButton.addEventListener("click", (event) => {
        event.preventDefault();
        openSearch(select);
      });
      tools.appendChild(searchButton);

      if (name === "personA") {
        const gpsButton = document.createElement("button");
        gpsButton.type = "button";
        gpsButton.className = "location-tool-button gps-button";
        gpsButton.innerHTML = `<span aria-hidden="true">◎</span><span>My location</span>`;
        gpsButton.addEventListener("click", (event) => {
          event.preventDefault();
          useCurrentLocation(gpsButton);
        });
        tools.appendChild(gpsButton);
      }

      field.appendChild(tools);
    });
  }

  function featureLabel(feature) {
    const p = feature?.properties || {};
    const name = p.name || [p.street, p.housenumber].filter(Boolean).join(" ") || p.city || "Place";
    const details = [];

    if (p.street && !String(name).includes(p.street)) details.push(p.street);
    if (p.housenumber && !String(name).includes(p.housenumber)) details.push(p.housenumber);
    if (p.postcode) details.push(p.postcode);
    if (p.city && p.city !== name) details.push(p.city);
    if (p.district && !details.includes(p.district)) details.push(p.district);

    return {
      label: String(name),
      detail: [...new Set(details)].join(" · "),
    };
  }

  function normalizeFeature(feature) {
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const { label, detail } = featureLabel(feature);
    return { label, detail, lat, lon, source: "photon" };
  }

  async function searchPlaces(query) {
    const normalizedQuery = query.trim().toLowerCase();
    const cached = searchCache.get(normalizedQuery);
    if (cached && Date.now() - cached.createdAt < SEARCH_CACHE_MS) return cached.results;

    searchController?.abort();
    const controller = new AbortController();
    searchController = controller;

    try {
      const params = new URLSearchParams({
        q: query.trim(),
        lat: "53.628",
        lon: "11.415",
        limit: "6",
        lang: "de",
        bbox: SEARCH_BBOX,
      });

      const response = await fetch(`${PHOTON_API}?${params.toString()}`, {
        headers: { Accept: "application/json" },
        credentials: "omit",
        mode: "cors",
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`PHOTON_${response.status}`);
      const data = await response.json();
      const found = (Array.isArray(data?.features) ? data.features : [])
        .map(normalizeFeature)
        .filter(Boolean);

      const deduped = found.filter((place, index, list) =>
        list.findIndex((other) => other.label === place.label && Math.abs(other.lat - place.lat) < 0.00005 && Math.abs(other.lon - place.lon) < 0.00005) === index,
      );

      searchCache.set(normalizedQuery, { createdAt: Date.now(), results: deduped });
      return deduped;
    } finally {
      if (searchController === controller) searchController = null;
    }
  }

  function renderSearchResults(found, resultsElement, stateElement) {
    resultsElement.innerHTML = "";
    if (!found.length) {
      stateElement.textContent = "No matching place found in the Schwerin area.";
      return;
    }

    stateElement.textContent = `${found.length} result${found.length === 1 ? "" : "s"}`;
    found.forEach((place) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "place-result";
      button.setAttribute("role", "option");
      button.innerHTML = `
        <span class="place-result-pin" aria-hidden="true">●</span>
        <span class="place-result-copy">
          <strong>${escapeHtml(place.label)}</strong>
          <small>${escapeHtml(place.detail || "Schwerin")}</small>
        </span>
        <span aria-hidden="true">›</span>
      `;
      button.addEventListener("click", () => selectPlace(place));
      resultsElement.appendChild(button);
    });
  }

  function schedulePlaceSearch(query, resultsElement, stateElement) {
    clearTimeout(searchTimer);
    searchTimer = null;
    const generation = ++searchGeneration;
    const clean = query.trim();
    if (clean.length < 2) {
      searchController?.abort();
      searchController = null;
      resultsElement.innerHTML = "";
      stateElement.textContent = "Type at least 2 characters.";
      return;
    }

    stateElement.textContent = "Searching…";
    searchTimer = setTimeout(async () => {
      try {
        const found = await searchPlaces(clean);
        if (generation !== searchGeneration || !placeDialog.dialog.open) return;
        renderSearchResults(found, resultsElement, stateElement);
      } catch (error) {
        if (error?.name === "AbortError" || generation !== searchGeneration || !placeDialog.dialog.open) return;
        console.warn("Place search failed:", error);
        stateElement.textContent = "Search is unavailable right now. Your saved presets still work.";
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  function selectPlace(place) {
    if (!activeSelect || !placeDialog.dialog.open) return;
    const registered = registerPlace(place);
    activeSelect.value = registered.key;
    activeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    placeDialog.dialog.close();
    plannerForm?.requestSubmit();
    showToast(`Selected ${registered.label}`);
  }

  function withinSchwerin(lat, lon) {
    return lat >= SCHWERIN_BOUNDS.minLat && lat <= SCHWERIN_BOUNDS.maxLat &&
      lon >= SCHWERIN_BOUNDS.minLon && lon <= SCHWERIN_BOUNDS.maxLon;
  }

  function useCurrentLocation(button) {
    if (!navigator.geolocation) {
      showToast("This browser does not provide location access.");
      return;
    }

    const oldText = button.innerHTML;
    button.disabled = true;
    button.textContent = "Locating…";

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        button.disabled = false;
        button.innerHTML = oldText;

        if (!withinSchwerin(lat, lon)) {
          showToast("Your current position is outside the Schwerin area supported by this version.");
          return;
        }

        const place = registerPlace(
          {
            key: "My current location",
            label: "My current location",
            lat,
            lon,
            source: "gps",
          },
          { persist: false, targets: [selects.personA] },
        );

        selects.personA.value = place.key;
        selects.personA.dispatchEvent(new Event("change", { bubbles: true }));
        plannerForm?.requestSubmit();
        showToast("Using your current location for this route.");
      },
      (error) => {
        button.disabled = false;
        button.innerHTML = oldText;
        const message = error.code === 1
          ? "Location permission was not granted."
          : "Could not get your location right now.";
        showToast(message);
      },
      {
        enableHighAccuracy: true,
        timeout: 12_000,
        maximumAge: 60_000,
      },
    );
  }

  function injectShareButton() {
    const actions = document.querySelector(".topbar-actions");
    if (!actions || document.getElementById("shareMeetupButton")) return;

    const button = document.createElement("button");
    button.id = "shareMeetupButton";
    button.className = "icon-button share-meetup-button";
    button.type = "button";
    button.setAttribute("aria-label", "Share meetup");
    button.innerHTML = `<span aria-hidden="true">↗</span><span class="share-label">Share</span>`;
    button.addEventListener("click", shareMeetup);
    actions.insertBefore(button, document.getElementById("installButton"));
  }

  function destinationForShare() {
    const key = selects.destination?.value;
    const place = currentLocations()[key];
    if (!place) return null;
    return { label: place.label || key, lat: Number(place.lat), lon: Number(place.lon) };
  }

  async function shareMeetup() {
    const place = destinationForShare();
    if (!place || !dateInput?.value || !timeInput?.value) {
      showToast("Choose a meetup place and time first.");
      return;
    }

    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("meet", `${place.lat.toFixed(6)},${place.lon.toFixed(6)}`);
    url.searchParams.set("label", place.label);
    url.searchParams.set("date", dateInput.value);
    url.searchParams.set("time", timeInput.value);

    const text = `Meet at ${place.label} on ${dateInput.value} at ${timeInput.value}.`;

    try {
      if (navigator.share) {
        await navigator.share({ title: "Meet Schwerin", text, url: url.toString() });
        return;
      }
      await navigator.clipboard.writeText(url.toString());
      showToast("Meetup link copied. Starting locations were not included.");
    } catch (error) {
      if (error?.name !== "AbortError") showToast("Could not share the meetup link.");
    }
  }

  function applySharedMeetup() {
    const params = new URLSearchParams(window.location.search);
    const rawCoordinates = params.get("meet");
    const label = params.get("label") || "Shared meetup";
    if (!rawCoordinates) return;

    const [latRaw, lonRaw] = rawCoordinates.split(",");
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const place = registerPlace(
      { label, lat, lon, source: "shared" },
      { persist: false, targets: [selects.destination] },
    );

    if (selects.destination) selects.destination.value = place.key;
    const sharedDate = params.get("date");
    const sharedTime = params.get("time");
    if (sharedDate && dateInput) dateInput.value = sharedDate;
    if (/^\d{2}:\d{2}$/.test(sharedTime || "") && timeInput) timeInput.value = sharedTime;

    [selects.destination, dateInput, timeInput].filter(Boolean).forEach((input) =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );

    setTimeout(() => plannerForm?.requestSubmit(), 120);
    showToast("Shared meetup loaded. Choose your own starting point if needed.");
  }

  function updateV04Copy() {
    const version = document.getElementById("versionLabel");
    if (version) version.textContent = "v0.4.0 · Search + GPS + private-by-default sharing";

    const liveNote = document.querySelector(".live-note div");
    if (liveNote) {
      liveNote.innerHTML = `<strong>v0.4 goes beyond presets.</strong> Search Schwerin stops, streets and places, use your current position for your own start, or share the meetup destination and time without automatically exposing either person's starting location.`;
    }

    const sourceLinks = document.querySelector(".source-links");
    if (sourceLinks && !sourceLinks.querySelector('[data-photon-credit="true"]')) {
      const link = document.createElement("a");
      link.href = "https://photon.komoot.io/";
      link.target = "_blank";
      link.rel = "noopener";
      link.dataset.photonCredit = "true";
      link.textContent = "Place search: Photon";
      sourceLinks.insertBefore(link, sourceLinks.lastElementChild);
    }
  }

  restoreCustomPlaces();
  injectLocationTools();
  injectShareButton();
  updateV04Copy();

  window.addEventListener("load", applySharedMeetup, { once: true });

  window.NVSPlaces = Object.freeze({
    registerPlace,
    openSearch,
    shareMeetup,
  });
})();