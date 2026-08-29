(() => {
  const STORAGE_KEY = "meet-schwerin-group-v1";
  const MAX_PEOPLE = 6;
  const MIN_PEOPLE = 2;
  const COLORS = ["#2563eb", "#db2777", "#7c3aed", "#ea580c", "#0891b2", "#65a30d"];

  const plannerForm = document.getElementById("plannerForm");
  const peopleGrid = document.querySelector(".people-grid");
  const personASelect = document.getElementById("personA");
  const personBSelect = document.getElementById("personB");
  const destinationSelect = document.getElementById("destination");
  const dateInput = document.getElementById("date");
  const timeInput = document.getElementById("time");
  const results = document.getElementById("results");
  const summary = document.getElementById("summary");
  const dataBadge = document.getElementById("dataBadge");
  const dataBadgeLabel = document.getElementById("dataBadgeLabel");
  const mobileSearchButton = document.getElementById("mobileSearchButton");
  const desktopSearchButton = plannerForm?.querySelector(".desktop-search");

  let searchSequence = 0;
  let toastTimer = null;
  let state = loadGroupState();

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

  function formatShortDate(date) {
    return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short" }).format(date);
  }

  function defaultMembers() {
    return [
      { id: "personA", name: "You", color: COLORS[0], base: true },
      { id: "personB", name: "Friend", color: COLORS[1], base: true },
    ];
  }

  function loadGroupState() {
    const fallback = { members: defaultMembers(), priorityIds: [] };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      const saved = Array.isArray(parsed?.members) ? parsed.members : [];
      const byId = new Map(saved.map((member) => [member.id, member]));
      const members = defaultMembers().map((member) => ({ ...member, ...(byId.get(member.id) || {}) }));
      saved
        .filter((member) => member?.id && !["personA", "personB"].includes(member.id))
        .slice(0, MAX_PEOPLE - 2)
        .forEach((member, index) => {
          members.push({
            id: String(member.id),
            name: String(member.name || `Person ${index + 3}`).slice(0, 24),
            color: member.color || COLORS[(index + 2) % COLORS.length],
            base: false,
            originKey: member.originKey || "",
          });
        });

      const order = Array.isArray(parsed?.order) ? parsed.order : [];
      if (order.length) {
        members.sort((a, b) => {
          const ai = order.indexOf(a.id);
          const bi = order.indexOf(b.id);
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });
      }

      return {
        members,
        priorityIds: Array.isArray(parsed?.priorityIds) ? parsed.priorityIds.filter((id) => members.some((member) => member.id === id)) : [],
      };
    } catch {
      return fallback;
    }
  }

  function saveGroupState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        members: state.members.map((member) => ({
          id: member.id,
          name: member.name,
          color: member.color,
          base: member.base,
          originKey: member.base ? undefined : member.originKey,
        })),
        order: state.members.map((member) => member.id),
        priorityIds: state.priorityIds,
      }));
    } catch {
      // Group state persistence is optional.
    }
  }

  function selectedOrigin(member) {
    if (member.id === "personA") return personASelect?.value || "";
    if (member.id === "personB") return personBSelect?.value || "";
    return member.originKey || "";
  }

  function locationLabel(key) {
    return window.NVSTransit?.LOCATIONS?.[key]?.label || key || "Choose a starting point";
  }

  function membersForRouting() {
    return state.members.map((member, index) => ({
      id: member.id,
      name: member.name?.trim() || `Person ${index + 1}`,
      color: member.color || COLORS[index % COLORS.length],
      originKey: selectedOrigin(member),
      markerLabel: String.fromCharCode(65 + index),
      priority: state.priorityIds.includes(member.id),
    }));
  }

  function getPriorityIds() {
    const ids = new Set(state.members.map((member) => member.id));
    return state.priorityIds.filter((id) => ids.has(id));
  }

  function priorityDescription() {
    const priorityIds = getPriorityIds();
    if (!priorityIds.length) return "No arrival priority — coordinate the whole group together.";
    const names = state.members.filter((member) => priorityIds.includes(member.id)).map((member) => member.name);
    if (names.length === 1) return `Try to have ${names[0]} there before the rest of the group.`;
    return `Try to have ${names.join(" + ")} meet first before everyone else joins.`;
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function setDataMode(mode) {
    if (!dataBadge || !dataBadgeLabel) return;
    dataBadge.classList.remove("live", "loading", "fallback", "offline");
    dataBadge.classList.add(mode);
    dataBadgeLabel.textContent = {
      live: "Live timetable",
      loading: "Checking live data…",
      fallback: "Demo fallback",
      offline: "Offline demo",
    }[mode] || "Timetable";
  }

  function setSearching(searching) {
    [mobileSearchButton, desktopSearchButton].forEach((button) => {
      if (!button) return;
      button.disabled = searching;
      button.classList.toggle("is-loading", searching);
      const label = button.querySelector("span:first-child");
      if (label) label.textContent = searching ? "Checking group routes…" : "Find connections";
    });
  }

  function currentTarget() {
    if (window.NVSRecommend?.getTimingMode?.() === "asap") {
      const anchor = new Date(Date.now() + 60 * 60_000);
      anchor.setSeconds(0, 0);
      const remainder = anchor.getMinutes() % 5;
      if (remainder) anchor.setMinutes(anchor.getMinutes() + 5 - remainder);
      const pad = (value) => String(value).padStart(2, "0");
      if (dateInput) dateInput.value = `${anchor.getFullYear()}-${pad(anchor.getMonth() + 1)}-${pad(anchor.getDate())}`;
      if (timeInput) timeInput.value = `${pad(anchor.getHours())}:${pad(anchor.getMinutes())}`;
      return anchor;
    }

    if (!dateInput?.value || !timeInput?.value) return null;
    const target = new Date(`${dateInput.value}T${timeInput.value}`);
    return Number.isNaN(target.getTime()) ? null : target;
  }

  function updateBaseLabels() {
    [
      [personASelect, state.members.find((member) => member.id === "personA"), "person-dot-you"],
      [personBSelect, state.members.find((member) => member.id === "personB"), "person-dot-friend"],
    ].forEach(([select, member, dotClass]) => {
      const label = select?.closest(".field")?.querySelector(".field-label");
      if (!label || !member) return;
      label.innerHTML = `<span class="person-dot ${dotClass}" aria-hidden="true"></span>${escapeHtml(member.name)} starts at`;
    });
  }

  function cycleColor(member) {
    const index = COLORS.indexOf(member.color);
    member.color = COLORS[(index + 1 + COLORS.length) % COLORS.length];
    saveGroupState();
    renderGroupPanel();
    dispatchGroupChange(false);
  }

  function moveMember(id, direction) {
    const index = state.members.findIndex((member) => member.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= state.members.length) return;
    [state.members[index], state.members[next]] = [state.members[next], state.members[index]];
    saveGroupState();
    renderGroupPanel();
    dispatchGroupChange(true);
  }

  function removeMember(id) {
    if (state.members.length <= MIN_PEOPLE) return;
    const member = state.members.find((item) => item.id === id);
    if (!member || member.base) return;
    state.members = state.members.filter((item) => item.id !== id);
    state.priorityIds = state.priorityIds.filter((item) => item !== id);
    saveGroupState();
    renderGroupPanel();
    dispatchGroupChange(true);
  }

  function addMember() {
    if (state.members.length >= MAX_PEOPLE) return;
    const number = state.members.length + 1;
    const id = `member-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    state.members.push({
      id,
      name: `Person ${number}`,
      color: COLORS[(number - 1) % COLORS.length],
      base: false,
      originKey: "",
    });
    saveGroupState();
    renderGroupPanel();
    const input = document.querySelector(`[data-group-origin-id="${CSS.escape(id)}"]`);
    setTimeout(() => input?.focus(), 30);
    dispatchGroupChange(false);
  }

  function togglePriority(id) {
    if (state.priorityIds.includes(id)) state.priorityIds = state.priorityIds.filter((item) => item !== id);
    else state.priorityIds = [...state.priorityIds, id];
    saveGroupState();
    renderGroupPanel();
    dispatchGroupChange(true);
  }

  function localPlaceSearch(query) {
    const clean = query.trim().toLocaleLowerCase("de-DE");
    if (!clean) return [];
    return Object.entries(window.NVSTransit?.LOCATIONS || {})
      .filter(([key, value]) => `${key} ${value?.label || ""}`.toLocaleLowerCase("de-DE").includes(clean))
      .slice(0, 8)
      .map(([key, value]) => ({
        key,
        label: value.label || key,
        detail: value.custom ? "Saved on this device" : "Schwerin",
        kindLabel: "Saved place",
        icon: "📍",
        lat: value.lat,
        lon: value.lon,
      }));
  }

  async function searchPlaces(query) {
    if (window.NVSUX051?.searchPlaces) return window.NVSUX051.searchPlaces(query);
    return localPlaceSearch(query);
  }

  function registerPlace(item) {
    if (item.key) return item.key;
    const registered = window.NVSPlaces?.registerPlace?.({
      label: item.label,
      lat: item.lat,
      lon: item.lon,
      source: item.source || "group-search",
    });
    if (registered?.key) return registered.key;

    const key = `group:${String(item.label || "place").replace(/\s+/g, "-").toLowerCase()}:${Number(item.lat).toFixed(5)}:${Number(item.lon).toFixed(5)}`;
    try {
      window.NVSTransit?.registerLocation?.(key, {
        label: item.label || "Custom place",
        lat: item.lat,
        lon: item.lon,
        source: "group-search",
      });
      return key;
    } catch {
      return "";
    }
  }

  function renderExtraSearchResults(member, container, items, input) {
    container.innerHTML = "";
    if (!items.length) {
      container.innerHTML = `<div class="v051-search-state">No matching place found in Schwerin.</div>`;
      container.classList.add("open");
      return;
    }

    items.slice(0, 9).forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "group-place-result";
      button.innerHTML = `
        <span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail || "Schwerin")}</small></span>
        <span class="group-place-type">${escapeHtml(item.icon || "📍")} ${escapeHtml(item.kindLabel || "Place")}</span>
      `;
      button.addEventListener("click", () => {
        const key = registerPlace(item);
        if (!key) return;
        member.originKey = key;
        input.value = locationLabel(key) || item.label;
        container.classList.remove("open");
        saveGroupState();
        renderGroupPanel();
        dispatchGroupChange(true);
      });
      container.appendChild(button);
    });
    container.classList.add("open");
  }

  function bindExtraOriginSearch(member, card) {
    const input = card.querySelector(`[data-group-origin-id="${CSS.escape(member.id)}"]`);
    const list = card.querySelector(".group-extra-results");
    if (!input || !list) return;
    let timer = null;
    let sequence = 0;

    input.addEventListener("focus", () => {
      input.select();
      if (!input.value.trim()) {
        list.innerHTML = `<div class="v051-search-state">Search a stop, street, address or place.</div>`;
        list.classList.add("open");
      }
    });

    input.addEventListener("input", () => {
      clearTimeout(timer);
      const query = input.value.trim();
      if (!query) {
        list.innerHTML = `<div class="v051-search-state">Search a stop, street, address or place.</div>`;
        list.classList.add("open");
        return;
      }

      const current = ++sequence;
      list.innerHTML = `<div class="v051-search-state">Searching…</div>`;
      list.classList.add("open");
      timer = setTimeout(async () => {
        try {
          const items = await searchPlaces(query);
          if (current !== sequence || input.value.trim() !== query) return;
          renderExtraSearchResults(member, list, items, input);
        } catch {
          if (current !== sequence) return;
          list.innerHTML = `<div class="v051-search-state">Search unavailable right now.</div>`;
        }
      }, 380);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        list.classList.remove("open");
        input.blur();
      }
    });
  }

  function memberCardHtml(member, index) {
    const origin = selectedOrigin(member);
    const priority = state.priorityIds.includes(member.id);
    return `
      <article class="group-member-card" data-group-member="${escapeHtml(member.id)}">
        <div class="group-member-main">
          <button type="button" class="group-color-button" data-group-action="color" title="Change colour" style="background:${escapeHtml(member.color)}"></button>
          <input class="group-name-input" data-group-name="${escapeHtml(member.id)}" value="${escapeHtml(member.name)}" maxlength="24" aria-label="Person name">
          <div class="group-member-actions">
            <button type="button" class="group-priority-button ${priority ? "active" : ""}" data-group-action="priority" aria-pressed="${priority}"><span>★</span><span>First</span></button>
            <button type="button" class="group-icon-button" data-group-action="up" ${index === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
            <button type="button" class="group-icon-button" data-group-action="down" ${index === state.members.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
            ${member.base ? "" : `<button type="button" class="group-icon-button group-remove-button" data-group-action="remove" aria-label="Remove person">×</button>`}
          </div>
        </div>
        ${member.base ? `
          <div class="group-origin-label"><span>From</span><strong>${escapeHtml(locationLabel(origin))}</strong></div>
        ` : `
          <div class="group-extra-origin">
            <div class="group-extra-origin-head"><span>Starting point</span><span>${origin ? "Selected" : "Required"}</span></div>
            <div class="group-extra-search-wrap">
              <input type="search" class="group-extra-search" data-group-origin-id="${escapeHtml(member.id)}" autocomplete="off" spellcheck="false" placeholder="Search stop, street or place" value="${escapeHtml(origin ? locationLabel(origin) : "")}">
              <div class="group-extra-results"></div>
            </div>
          </div>
        `}
      </article>
    `;
  }

  function renderGroupPanel() {
    let panel = document.getElementById("groupPanel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "groupPanel";
      panel.className = "group-panel";
      peopleGrid?.insertAdjacentElement("afterend", panel);
    }

    panel.innerHTML = `
      <div class="group-panel-head">
        <div>
          <p class="section-kicker">Group</p>
          <h3>People & who meets first</h3>
          <span class="group-count">${state.members.length} / ${MAX_PEOPLE} people</span>
        </div>
        <button type="button" id="groupAddButton" class="group-add-button" ${state.members.length >= MAX_PEOPLE ? "disabled" : ""}>＋ Add person</button>
      </div>
      <div class="group-roster">${state.members.map(memberCardHtml).join("")}</div>
      <div class="group-priority-summary"><strong>★ Meet first</strong><span>${escapeHtml(priorityDescription())}</span></div>
    `;

    panel.querySelector("#groupAddButton")?.addEventListener("click", addMember);
    panel.querySelectorAll(".group-member-card").forEach((card) => {
      const id = card.dataset.groupMember;
      const member = state.members.find((item) => item.id === id);
      if (!member) return;

      card.querySelector('[data-group-action="color"]')?.addEventListener("click", () => cycleColor(member));
      card.querySelector('[data-group-action="priority"]')?.addEventListener("click", () => togglePriority(id));
      card.querySelector('[data-group-action="up"]')?.addEventListener("click", () => moveMember(id, -1));
      card.querySelector('[data-group-action="down"]')?.addEventListener("click", () => moveMember(id, 1));
      card.querySelector('[data-group-action="remove"]')?.addEventListener("click", () => removeMember(id));

      const nameInput = card.querySelector(`[data-group-name="${CSS.escape(id)}"]`);
      nameInput?.addEventListener("input", () => {
        member.name = nameInput.value.slice(0, 24);
        saveGroupState();
        updateBaseLabels();
      });
      nameInput?.addEventListener("change", () => dispatchGroupChange(true));

      if (!member.base) bindExtraOriginSearch(member, card);
    });

    updateBaseLabels();
    updateFairAvailability();
  }

  function updateFairAvailability() {
    const button = document.getElementById("fairMeetupButton");
    if (!button) return;
    const groupMode = state.members.length > 2;
    button.disabled = groupMode;
    button.title = groupMode
      ? "Fair Meetup is limited to two people for now to avoid excessive routing requests."
      : "Find a fair meetup point";
  }

  function dispatchGroupChange(submit) {
    const detail = { members: membersForRouting(), priorityIds: getPriorityIds() };
    window.dispatchEvent(new CustomEvent("nvs-group-change", { detail }));
    updateFairAvailability();
    if (submit) plannerForm?.requestSubmit();
  }

  function routeMeta(route) {
    const parts = [];
    if (Number.isFinite(route?.transfers)) parts.push(route.transfers === 0 ? "Direct" : `${route.transfers} change${route.transfers === 1 ? "" : "s"}`);
    if (route?.realtime) parts.push("Realtime");
    return parts.join(" · ");
  }

  function targetMessage(group, timingMode) {
    if (timingMode === "asap") return `ASAP · ${group.asapMinutes} min`;
    if (group.targetDifference === 0) return "On time";
    if (group.targetDifference < 0) return `${Math.abs(group.targetDifference)} min early`;
    return `${group.targetDifference} min late`;
  }

  function modeCopy(mode, primary) {
    const labels = {
      together: primary ? ["Best group match", "🤝 Together"] : ["Group backup", "Backup"],
      fastest: primary ? ["Fastest group match", "⚡ Fastest"] : ["Fast backup", "Backup"],
      easy: primary ? ["Easiest group match", "😌 Easy"] : ["Easy backup", "Backup"],
    };
    const [title, badge] = labels[mode] || labels.together;
    return { title, badge };
  }

  function personRows(group) {
    return group.assignments.map((assignment) => {
      const member = assignment.member;
      const route = assignment.route;
      return `
        <div class="group-card-person">
          <span class="group-person-swatch" style="background:${escapeHtml(member.color)}"></span>
          <div class="group-person-copy">
            <strong>${escapeHtml(member.name)}${member.priority ? " ★" : ""}</strong>
            <span>${formatTime(route.departure)} → ${formatTime(route.arrival)}</span>
            <small>${escapeHtml(route.description || "Public transport")}${routeMeta(route) ? ` · ${escapeHtml(routeMeta(route))}` : ""}</small>
          </div>
          <span class="group-person-duration">${Number(route.duration) || "—"} min</span>
        </div>
      `;
    }).join("");
  }

  function firstMeetupText(group) {
    if (group.priorityAssignments?.length >= 2) {
      const names = group.priorityAssignments.map((assignment) => assignment.member.name).join(" + ");
      return `<strong>First meetup:</strong> ${escapeHtml(names)} around <strong>${formatTime(group.priorityCompleteTime)}</strong> · whole group together <strong>${formatTime(group.everyoneTogetherTime)}</strong>`;
    }

    if (group.priorityAssignments?.length === 1) {
      const assignment = group.priorityAssignments[0];
      return `<strong>Priority arrival:</strong> ${escapeHtml(assignment.member.name)} at <strong>${formatTime(assignment.route.arrival)}</strong> · whole group together <strong>${formatTime(group.everyoneTogetherTime)}</strong>`;
    }

    if (group.assignments.length > 2) {
      return `<strong>First meetup:</strong> around <strong>${formatTime(group.firstMeetupTime)}</strong> · everyone together <strong>${formatTime(group.everyoneTogetherTime)}</strong>`;
    }

    return `<strong>Together:</strong> around <strong>${formatTime(group.everyoneTogetherTime)}</strong>`;
  }

  function recommendationCard(group, slot, recommendations) {
    if (!group) return "";
    const primary = slot === "primary";
    const copy = modeCopy(recommendations.mode, primary);
    const explanation = window.NVSRecommend?.explainGroup?.(group, recommendations.mode, recommendations.timingMode) || "";

    return `
      <article class="result ${primary ? "best v052-primary" : "v052-backup"}" data-map-pair="${slot}">
        <div class="result-header">
          <div>
            <div class="result-title">${escapeHtml(copy.title)}</div>
            <div class="result-subtitle">Everyone together around ${formatTime(group.latestArrival)}</div>
          </div>
          <span class="v052-mode-badge">${escapeHtml(copy.badge)}</span>
        </div>
        <div class="group-card-people">${personRows(group)}</div>
        <div class="group-meetup-metrics">
          <div class="metric"><span>Group spread</span><strong>${group.groupSpread} min</strong></div>
          <div class="metric"><span>${recommendations.timingMode === "asap" ? "Meet" : "Target"}</span><strong>${escapeHtml(targetMessage(group, recommendations.timingMode))}</strong></div>
          <div class="metric"><span>Longest trip</span><strong>${group.maxTravel} min</strong></div>
        </div>
        <div class="group-first-meetup">${firstMeetupText(group)}</div>
        <div class="group-why"><strong>Why this one?</strong> ${escapeHtml(explanation)}</div>
      </article>
    `;
  }

  function renderGroupRecommendations(routeSets, members, target) {
    const priorityIds = getPriorityIds();
    const recommendations = window.NVSRecommend?.recommendGroup?.(routeSets, members, target, { priorityIds });
    if (!recommendations?.primary) return false;

    results.classList.add("v052-recommendations", "group-recommendations");
    results.innerHTML =
      recommendationCard(recommendations.primary, "primary", recommendations) +
      recommendationCard(recommendations.backup, "backup", recommendations);

    window.__NVS_LAST_RECOMMENDATIONS__ = recommendations;
    window.dispatchEvent(new CustomEvent("nvs-group-recommendations-rendered", {
      detail: {
        recommendations,
        members,
        target,
        destination: destinationSelect?.value,
      },
    }));
    return true;
  }

  function renderLoading() {
    results.innerHTML = `
      <div class="loading-card" role="status">
        <span class="spinner" aria-hidden="true"></span>
        <div><strong>Checking group connections…</strong><p>Finding coordinated routes for everyone.</p></div>
      </div>
    `;
  }

  function renderNoRoutes(member) {
    results.innerHTML = `
      <div class="loading-card no-routes-card">
        <span aria-hidden="true">⌁</span>
        <div><strong>No usable connection for ${escapeHtml(member.name)}</strong><p>Try another time or starting point.</p></div>
      </div>
    `;
  }

  function updateSummary(members, destination, target, suffix = "") {
    const names = members.map((member) => member.name);
    const visible = names.slice(0, 3).map(escapeHtml).join(" + ");
    const extra = names.length > 3 ? ` + ${names.length - 3} more` : "";
    const asap = window.NVSRecommend?.getTimingMode?.() === "asap";
    summary.innerHTML = `<strong>${visible}${extra}</strong> → ${escapeHtml(locationLabel(destination))} · ${asap ? "ASAP" : `${formatShortDate(target)} at <strong>${formatTime(target)}</strong>`}${suffix}`;
  }

  function demoRoutesFor(member, destination, target) {
    if (typeof window.generateDemoRoutes === "function") return window.generateDemoRoutes(member.originKey, destination, target);
    const duration = 20;
    return [-20, -8, 4, 16, 28].map((offset, index) => {
      const arrival = new Date(target.getTime() + offset * 60_000);
      return {
        id: `${member.id}-demo-${index}`,
        origin: member.originKey,
        destination,
        departure: new Date(arrival.getTime() - duration * 60_000),
        arrival,
        duration,
        description: "Demo public-transport route",
        transfers: 0,
        realtime: false,
        segments: [],
        source: "demo",
      };
    });
  }

  function groupFallback(members, destination, target, mode) {
    const routeSets = members.map((member) => demoRoutesFor(member, destination, target));
    setDataMode(mode);
    renderGroupRecommendations(routeSets, members, target);
    updateSummary(members, destination, target, ` <span class="summary-note">· ${mode === "offline" ? "offline demo" : "demo fallback"}</span>`);
  }

  async function groupSearch({ scrollToResults = false } = {}) {
    const id = ++searchSequence;
    const members = membersForRouting();
    const missing = members.find((member) => !member.originKey || !window.NVSTransit?.LOCATIONS?.[member.originKey]);
    if (missing) {
      setSearching(false);
      summary.textContent = `Choose a starting point for ${missing.name}.`;
      showToast(`Choose a starting point for ${missing.name}`);
      return;
    }

    const target = currentTarget();
    const destination = destinationSelect?.value;
    if (!target || !destination) {
      setSearching(false);
      summary.textContent = "Choose a valid meetup time and destination.";
      return;
    }

    if (typeof window.saveState === "function") window.saveState();
    saveGroupState();
    updateSummary(members, destination, target);

    if (scrollToResults) document.getElementById("results-title")?.scrollIntoView({ behavior: "smooth", block: "start" });

    if (!navigator.onLine) {
      setSearching(false);
      groupFallback(members, destination, target, "offline");
      return;
    }

    if (!window.NVSTransit?.fetchRoutes || !window.NVSRecommend?.recommendGroup) {
      setSearching(false);
      groupFallback(members, destination, target, "fallback");
      showToast("Group routing module unavailable — showing demo data.");
      return;
    }

    setSearching(true);
    setDataMode("loading");
    renderLoading();

    try {
      const routeSets = await Promise.all(
        members.map((member) => window.NVSTransit.fetchRoutes(member.originKey, destination, target)),
      );
      if (id !== searchSequence) return;

      const emptyIndex = routeSets.findIndex((routes) => !routes.length);
      if (emptyIndex >= 0) {
        setDataMode("live");
        renderNoRoutes(members[emptyIndex]);
        updateSummary(members, destination, target, ` <span class="summary-note">· live · checked ${formatTime(new Date())}</span>`);
        return;
      }

      setDataMode("live");
      renderGroupRecommendations(routeSets, members, target);
      updateSummary(members, destination, target, ` <span class="summary-note">· live · checked ${formatTime(new Date())}</span>`);
    } catch (error) {
      if (id !== searchSequence) return;
      console.warn("Group routing failed; using demo fallback:", error);
      groupFallback(members, destination, target, "fallback");
      showToast("Live timetable unavailable — showing demo group routes.");
    } finally {
      if (id === searchSequence) setSearching(false);
    }
  }

  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".group-extra-origin")) return;
    document.querySelectorAll(".group-extra-results.open").forEach((list) => list.classList.remove("open"));
  });

  [personASelect, personBSelect].forEach((select) => {
    select?.addEventListener("change", () => {
      renderGroupPanel();
      saveGroupState();
      dispatchGroupChange(false);
    });
  });

  window.addEventListener("nvs-priority-change", () => groupSearch());
  window.addEventListener("nvs-timing-change", () => groupSearch());

  renderGroupPanel();

  // Replace the original two-person search function. Existing form/mobile
  // event listeners resolve this global binding at click/submit time.
  window.search = groupSearch;

  const version = document.getElementById("versionLabel");
  if (version) version.textContent = "v0.7.0 · Group planning + first-meet priorities";
  const heading = document.getElementById("results-title");
  if (heading) heading.textContent = "Best group matches";

  window.NVSGroup = Object.freeze({
    getMembers: membersForRouting,
    getPriorityIds,
    getPriorityDescription: priorityDescription,
    search: groupSearch,
    refreshUI: renderGroupPanel,
    maxPeople: MAX_PEOPLE,
  });

  setTimeout(() => {
    updateFairAvailability();
    groupSearch();
  }, 80);
})();