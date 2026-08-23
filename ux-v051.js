(() => {
  const PHOTON_API = "https://photon.komoot.io/api/";
  const SEARCH_BBOX = "11.25,53.54,11.56,53.72";
  const SEARCH_DEBOUNCE_MS = 380;
  const SEARCH_CACHE_MS = 10 * 60_000;

  const plannerForm = document.getElementById("plannerForm");
  const results = document.getElementById("results");
  const selects = {
    personA: document.getElementById("personA"),
    personB: document.getElementById("personB"),
    destination: document.getElementById("destination"),
  };

  const searchCache = new Map();
  const controllerState = new Map();
  let photonController = null;
  let destinationDialog = null;
  let destinationChip = null;

  const PRESET_KINDS = Object.freeze({
    "Lankow-Siedlung": { kind: "tram", icon: "🚋", label: "Tram stop" },
    "Hegelstraße": { kind: "tram", icon: "🚋", label: "Tram stop" },
    "Dreescher Markt": { kind: "transit", icon: "🚏", label: "Transit stop" },
    Marienplatz: { kind: "transit", icon: "🚏", label: "Transit stop" },
    Hauptbahnhof: { kind: "rail", icon: "🚆", label: "Station" },
    "Schlosspark-Center": { kind: "place", icon: "📍", label: "Place" },
  });

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeText(value) {
    return String(value || "")
      .toLocaleLowerCase("de-DE")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function categoryText(properties) {
    return Array.isArray(properties?.categories)
      ? properties.categories.map((item) => String(item).toLowerCase()).join(" ")
      : "";
  }

  function classifyFeature(properties = {}) {
    const key = String(properties.osm_key || "").toLowerCase();
    const value = String(properties.osm_value || "").toLowerCase();
    const type = String(properties.type || properties.address_type || "").toLowerCase();
    const categories = categoryText(properties);
    const combined = `${key}=${value} ${categories}`;

    const isTram =
      (key === "railway" && ["tram_stop", "tram", "light_rail"].includes(value)) ||
      /osm\.railway\.(tram_stop|tram|light_rail)/.test(categories);

    const isBus =
      (key === "highway" && value === "bus_stop") ||
      (key === "amenity" && value === "bus_station") ||
      /osm\.(highway\.bus_stop|amenity\.bus_station)/.test(categories);

    const isRail =
      (key === "railway" && ["station", "halt"].includes(value)) ||
      /osm\.railway\.(station|halt)/.test(categories);

    const isTransit =
      isTram ||
      isBus ||
      isRail ||
      (key === "public_transport" && ["platform", "stop_position", "station"].includes(value)) ||
      /osm\.public_transport\.(platform|stop_position|station)/.test(categories);

    if (isTram) return { kind: "tram", icon: "🚋", kindLabel: "Tram stop", isStop: true };
    if (isBus) return { kind: "bus", icon: "🚌", kindLabel: "Bus stop", isStop: true };
    if (isRail) return { kind: "rail", icon: "🚆", kindLabel: "Station", isStop: true };
    if (isTransit) return { kind: "transit", icon: "🚏", kindLabel: "Transit stop", isStop: true };

    if (properties.housenumber || type === "house") {
      return { kind: "address", icon: "⌂", kindLabel: "Address", isStop: false };
    }

    if (type === "street" || key === "highway") {
      return { kind: "street", icon: "↔", kindLabel: "Street", isStop: false };
    }

    if (key === "shop" || key === "amenity" || key === "tourism" || key === "leisure") {
      return { kind: "place", icon: "📍", kindLabel: "Place", isStop: false };
    }

    if (/bus|tram|station|stop|platform/.test(combined)) {
      return { kind: "transit", icon: "🚏", kindLabel: "Transit stop", isStop: true };
    }

    return { kind: "place", icon: "📍", kindLabel: "Place", isStop: false };
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
      detail: [...new Set(details)].join(" · ") || "Schwerin",
    };
  }

  function normalizeFeature(feature, originalIndex = 0) {
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const { label, detail } = featureLabel(feature);
    return {
      label,
      detail,
      lat,
      lon,
      source: "photon-v051",
      originalIndex,
      ...classifyFeature(feature.properties || {}),
    };
  }

  function localKind(key, location) {
    if (PRESET_KINDS[key]) {
      const preset = PRESET_KINDS[key];
      return {
        ...preset,
        kindLabel: preset.label,
        isStop: ["tram", "bus", "rail", "transit"].includes(preset.kind),
      };
    }

    if (location?.source === "gps") {
      return { kind: "location", icon: "◎", kindLabel: "Current location", isStop: false };
    }

    if (location?.source === "shared") {
      return { kind: "place", icon: "↗", kindLabel: "Shared place", isStop: false };
    }

    return { kind: "place", icon: "📍", kindLabel: "Saved place", isStop: false };
  }

  function localMatches(query) {
    const clean = normalizeText(query);
    if (!clean) return [];

    return Object.entries(window.NVSTransit?.LOCATIONS || {})
      .filter(([key, location]) => normalizeText(`${key} ${location?.label || ""}`).includes(clean))
      .slice(0, 7)
      .map(([key, location], index) => ({
        key,
        label: location.label || key,
        detail: location.custom ? "Saved on this device" : "Built-in Schwerin option",
        lat: Number(location.lat),
        lon: Number(location.lon),
        source: location.source || "local",
        originalIndex: index - 100,
        isLocal: true,
        ...localKind(key, location),
      }));
  }

  function prioritizeSameNameStops(items) {
    const groups = new Map();

    items.forEach((item, index) => {
      const name = normalizeText(item.label);
      if (!groups.has(name)) groups.set(name, { firstIndex: index, items: [] });
      groups.get(name).items.push(item);
    });

    return [...groups.values()]
      .sort((a, b) => a.firstIndex - b.firstIndex)
      .flatMap((group) =>
        group.items.sort((a, b) => Number(Boolean(b.isStop)) - Number(Boolean(a.isStop))),
      );
  }

  function dedupePlaces(items) {
    const seen = new Set();
    return items.filter((item) => {
      const coordinateKey = `${Number(item.lat).toFixed(5)},${Number(item.lon).toFixed(5)}`;
      const labelKey = normalizeText(item.label);
      const key = `${coordinateKey}|${labelKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function photonSearch(query) {
    const clean = normalizeText(query);
    const cached = searchCache.get(clean);
    if (cached && Date.now() - cached.createdAt < SEARCH_CACHE_MS) return cached.results;

    photonController?.abort();
    photonController = new AbortController();

    const params = new URLSearchParams({
      q: query.trim(),
      lat: "53.628",
      lon: "11.415",
      limit: "8",
      lang: "de",
      bbox: SEARCH_BBOX,
    });

    const response = await fetch(`${PHOTON_API}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      credentials: "omit",
      mode: "cors",
      signal: photonController.signal,
    });

    if (!response.ok) throw new Error(`PHOTON_${response.status}`);
    const data = await response.json();
    const items = (Array.isArray(data?.features) ? data.features : [])
      .map((feature, index) => normalizeFeature(feature, index))
      .filter(Boolean);

    const prioritized = prioritizeSameNameStops(items);
    searchCache.set(clean, { createdAt: Date.now(), results: prioritized });
    return prioritized;
  }

  async function searchPlaces(query) {
    const local = localMatches(query);
    if (query.trim().length < 2) return local;

    try {
      const remote = await photonSearch(query);
      return dedupePlaces([...local, ...remote]).slice(0, 10);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      console.warn("v0.5.1 place search failed:", error);
      return local;
    }
  }

  function renderPlaceButtons(container, items, onSelect) {
    container.innerHTML = "";

    if (!items.length) {
      container.innerHTML = `<div class="v051-search-state">No matching place found in the Schwerin area.</div>`;
      return;
    }

    items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "v051-place-result";
      button.innerHTML = `
        <span class="v051-result-icon" aria-hidden="true">${escapeHtml(item.icon)}</span>
        <span class="v051-result-copy">
          <strong>${escapeHtml(item.label)}</strong>
          <small>${escapeHtml(item.detail || "Schwerin")}</small>
        </span>
        <span class="v051-place-kind" data-kind="${escapeHtml(item.kind)}">${escapeHtml(item.icon)} ${escapeHtml(item.kindLabel)}</span>
      `;
      button.addEventListener("click", () => onSelect(item));
      container.appendChild(button);
    });
  }

  function registerAndSelect(select, item) {
    if (!select) return null;

    let key = item.key;
    let normalized = null;

    if (!key) {
      normalized = window.NVSPlaces?.registerPlace?.({
        label: item.label,
        lat: item.lat,
        lon: item.lon,
        source: item.source || "photon-v051",
      });
      key = normalized?.key;
    }

    if (!key) return null;

    const exists = [...select.options].some((option) => option.value === key);
    if (!exists) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = normalized?.label || item.label || key;
      select.appendChild(option);
    }

    select.value = key;
    select.dataset.v051Kind = item.kind;
    select.dataset.v051KindLabel = item.kindLabel;
    select.dataset.v051Icon = item.icon;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return key;
  }

  function selectedClassification(select) {
    const key = select?.value;
    const location = window.NVSTransit?.LOCATIONS?.[key];
    const fallback = localKind(key, location);
    return {
      kind: select?.dataset.v051Kind || fallback.kind,
      icon: select?.dataset.v051Icon || fallback.icon,
      kindLabel: select?.dataset.v051KindLabel || fallback.kindLabel,
    };
  }

  function updateKindChip(select, chip) {
    if (!chip || !select) return;
    const info = selectedClassification(select);
    chip.dataset.kind = info.kind;
    chip.textContent = `${info.icon} ${info.kindLabel}`;
  }

  function closeAllOriginResults(except = null) {
    controllerState.forEach((state) => {
      if (state !== except) {
        state.results.classList.remove("open");
        state.input.setAttribute("aria-expanded", "false");
      }
    });
  }

  async function runOriginSearch(state, value) {
    const query = value.trim();
    clearTimeout(state.timer);

    if (!query) {
      state.results.innerHTML = `<div class="v051-search-state">Type a stop, street or place.</div>`;
      state.results.classList.add("open");
      state.input.setAttribute("aria-expanded", "true");
      return;
    }

    state.results.innerHTML = `<div class="v051-search-state">Searching…</div>`;
    state.results.classList.add("open");
    state.input.setAttribute("aria-expanded", "true");

    state.timer = setTimeout(async () => {
      try {
        const found = await searchPlaces(query);
        if (state.input.value.trim() !== value.trim()) return;
        renderPlaceButtons(state.results, found, (item) => {
          registerAndSelect(state.select, item);
          state.input.value = item.label;
          updateKindChip(state.select, state.chip);
          state.results.classList.remove("open");
          state.input.setAttribute("aria-expanded", "false");
          plannerForm?.requestSubmit();
        });
      } catch (error) {
        if (error?.name === "AbortError") return;
        state.results.innerHTML = `<div class="v051-search-state">Search is unavailable right now.</div>`;
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  function buildOriginSearch(select, labelText) {
    if (!select || select.dataset.v051SearchReady === "true") return;
    select.dataset.v051SearchReady = "true";
    select.classList.add("v051-hidden-select");

    const field = select.closest(".field");
    if (!field) return;

    const control = document.createElement("div");
    control.className = "v051-origin-control";
    control.innerHTML = `
      <div class="v051-origin-input-wrap">
        <span class="v051-search-icon" aria-hidden="true">⌕</span>
        <input class="v051-origin-input" type="search" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-label="Search ${escapeHtml(labelText)}" placeholder="Search stop, street or place">
        <button type="button" class="v051-clear-origin" aria-label="Clear search">×</button>
      </div>
      <span class="v051-selected-kind"></span>
      <div class="v051-origin-results" role="listbox"></div>
    `;

    select.insertAdjacentElement("afterend", control);

    const state = {
      select,
      input: control.querySelector(".v051-origin-input"),
      clear: control.querySelector(".v051-clear-origin"),
      chip: control.querySelector(".v051-selected-kind"),
      results: control.querySelector(".v051-origin-results"),
      timer: null,
    };
    controllerState.set(select.id, state);

    const syncFromSelect = () => {
      const key = select.value;
      const location = window.NVSTransit?.LOCATIONS?.[key];
      state.input.value = location?.label || select.selectedOptions?.[0]?.textContent || key || "";
      updateKindChip(select, state.chip);
    };

    state.input.addEventListener("focus", () => {
      closeAllOriginResults(state);
      state.input.select();
      runOriginSearch(state, state.input.value);
    });

    state.input.addEventListener("input", () => {
      closeAllOriginResults(state);
      runOriginSearch(state, state.input.value);
    });

    state.input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        state.results.classList.remove("open");
        state.input.setAttribute("aria-expanded", "false");
        state.input.blur();
      }
    });

    state.clear.addEventListener("click", () => {
      state.input.value = "";
      state.input.focus();
      runOriginSearch(state, "");
    });

    select.addEventListener("change", syncFromSelect);
    syncFromSelect();

    field.querySelector(".location-tools")?.querySelectorAll(".location-tool-button").forEach((button) => {
      if (/search place/i.test(button.textContent || "")) button.hidden = true;
    });
  }

  function buildDestinationDialog() {
    const dialog = document.createElement("dialog");
    dialog.className = "v051-place-dialog";
    dialog.innerHTML = `
      <div class="v051-dialog-heading">
        <div>
          <p class="section-kicker">Search Schwerin</p>
          <h2>Choose the meetup place</h2>
        </div>
        <button type="button" class="v051-dialog-close" aria-label="Close">×</button>
      </div>
      <div class="v051-dialog-input-wrap">
        <span class="v051-search-icon" aria-hidden="true">⌕</span>
        <input class="v051-dialog-input" type="search" autocomplete="off" placeholder="Stop, street, address or place">
      </div>
      <div class="v051-dialog-results"><div class="v051-search-state">Type at least 2 characters.</div></div>
    `;
    document.body.appendChild(dialog);

    const input = dialog.querySelector(".v051-dialog-input");
    const list = dialog.querySelector(".v051-dialog-results");
    let timer = null;

    const perform = (query) => {
      clearTimeout(timer);
      const clean = query.trim();
      if (!clean) {
        list.innerHTML = `<div class="v051-search-state">Type a stop, street, address or place.</div>`;
        return;
      }

      list.innerHTML = `<div class="v051-search-state">Searching…</div>`;
      timer = setTimeout(async () => {
        try {
          const found = await searchPlaces(clean);
          if (input.value.trim() !== query.trim()) return;
          renderPlaceButtons(list, found, (item) => {
            registerAndSelect(selects.destination, item);
            updateDestinationChip();
            dialog.close();
            plannerForm?.requestSubmit();
          });
        } catch (error) {
          if (error?.name === "AbortError") return;
          list.innerHTML = `<div class="v051-search-state">Search is unavailable right now.</div>`;
        }
      }, SEARCH_DEBOUNCE_MS);
    };

    input.addEventListener("input", () => perform(input.value));
    dialog.querySelector(".v051-dialog-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });

    dialog.openSearch = () => {
      input.value = "";
      list.innerHTML = `<div class="v051-search-state">Type a stop, street, address or place.</div>`;
      dialog.showModal();
      setTimeout(() => input.focus(), 40);
    };

    return dialog;
  }

  function updateDestinationChip() {
    updateKindChip(selects.destination, destinationChip);
  }

  function installDestinationSearch() {
    const select = selects.destination;
    const field = select?.closest(".field");
    const tools = field?.querySelector(".location-tools");
    if (!field || !tools) return;

    tools.querySelectorAll(".location-tool-button").forEach((button) => {
      if (/search place/i.test(button.textContent || "")) button.hidden = true;
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "location-tool-button v051-destination-search-button";
    button.innerHTML = `<span aria-hidden="true">⌕</span><span>Search stop / place</span>`;
    button.addEventListener("click", () => destinationDialog?.openSearch?.());
    tools.prepend(button);

    destinationChip = document.createElement("span");
    destinationChip.className = "v051-destination-kind";
    select.insertAdjacentElement("afterend", destinationChip);
    select.addEventListener("change", updateDestinationChip);
    updateDestinationChip();
  }

  function decorateViewingState() {
    if (!results) return;

    [...results.querySelectorAll(":scope > .result[data-map-pair]")].forEach((card) => {
      const selected = card.classList.contains("map-selected");
      let chip = card.querySelector(":scope > .v051-viewing-chip");

      if (selected && !chip) {
        chip = document.createElement("span");
        chip.className = "v051-viewing-chip";
        chip.textContent = "● Viewing";
        card.appendChild(chip);
      } else if (!selected && chip) {
        chip.remove();
      }

      if (selected) card.setAttribute("aria-current", "true");
      else card.removeAttribute("aria-current");
    });
  }

  function clearFocusMode() {
    if (!results) return;
    results.classList.remove("v051-focus-mode");
    [...results.querySelectorAll(":scope > .result")].forEach((card) => {
      card.classList.remove("v051-focused", "v051-compact", "v051-compact-left", "v051-compact-right");
    });
  }

  function focusCard(card) {
    if (!results || !card) return;
    const cards = [...results.querySelectorAll(":scope > .result")].filter(
      (item) => !item.classList.contains("unavailable-result"),
    );
    if (!cards.includes(card)) return;

    cards.forEach((item) => {
      const details = item.querySelector(".journey-details");
      if (item !== card && details?.open) details.open = false;
    });

    results.classList.add("v051-focus-mode");
    const others = cards.filter((item) => item !== card);

    cards.forEach((item) => {
      item.classList.toggle("v051-focused", item === card);
      item.classList.toggle("v051-compact", item !== card);
      item.classList.remove("v051-compact-left", "v051-compact-right");
    });

    if (others[0]) others[0].classList.add("v051-compact-left");
    if (others[1]) others[1].classList.add("v051-compact-right");
  }

  function bindJourneyFocus() {
    if (!results) return;

    [...results.querySelectorAll(":scope > .result")].forEach((card) => {
      const details = card.querySelector(".journey-details");
      if (!details || details.dataset.v051FocusBound === "true") return;
      details.dataset.v051FocusBound = "true";

      details.addEventListener("toggle", () => {
        if (details.open) focusCard(card);
        else if (card.classList.contains("v051-focused")) clearFocusMode();
      });
    });
  }

  function installCompactCardSwitching() {
    results?.addEventListener("click", (event) => {
      const card = event.target.closest(".result.v051-compact");
      if (!card) return;
      const details = card.querySelector(".journey-details");
      if (details && !details.open) details.open = true;
    });
  }

  function updateVersionCopy() {
    const version = document.getElementById("versionLabel");
    if (version) version.textContent = "v0.5.1 · Stop-aware search + focused journey view";
  }

  function installGlobalClose() {
    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".v051-origin-control")) closeAllOriginResults();
    });
  }

  buildOriginSearch(selects.personA, "your starting point");
  buildOriginSearch(selects.personB, "friend's starting point");
  destinationDialog = buildDestinationDialog();
  installDestinationSearch();
  installCompactCardSwitching();
  installGlobalClose();
  updateVersionCopy();

  if (results) {
    new MutationObserver(() => {
      bindJourneyFocus();
      decorateViewingState();
    }).observe(results, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "open"],
    });
  }

  bindJourneyFocus();
  decorateViewingState();

  window.NVSUX051 = Object.freeze({
    classifyFeature,
    searchPlaces,
    prioritizeSameNameStops,
  });
})();
